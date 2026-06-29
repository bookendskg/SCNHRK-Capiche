"use strict";
const ExcelJS = require("exceljs");
const { supabase, baseOf, itemCostPerBase, recomputeAllRecipeCosts } = require("./db");

const HEAD = "FF1E293B", HEADTXT = "FFFFFFFF", ZEBRA = "FFF8FAFC", FLAG = "FFFEF3C7";

function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: HEADTXT } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    c.alignment = { vertical: "middle" };
  });
}

const MASTERS = {
  items: {
    sheet: "Items",
    columns: [
      { header: "name", width: 30 }, { header: "category", width: 18 },
      { header: "unit", width: 10 }, { header: "pack_qty", width: 10 },
      { header: "price", width: 12 }, { header: "barcode", width: 16 },
    ],
    sample: [
      ["00 Flour (Caputo)", "Dry goods", "kg", 25, 1950, "8901001"],
      ["Mozzarella Grated", "Dairy", "kg", 2, 1204, "8901002"],
      ["Mayonnaise", "Sauces", "kg", 1, 190, "8901003"],
      ["Sugar", "Dry goods", "kg", 1, 45, "8901004"],
      ["Red sauce", "Sauces", "kg", 1, 180, "8901005"],
      ["Garlic", "Produce", "kg", 1, 240, "8901006"],
      ["Olive oil", "Sauces", "l", 5, 2400, "8901007"],
      ["Water", "Dry goods", "l", 1, 1, ""],
      ["Citric acid", "Dry goods", "kg", 1, 320, ""],
    ],
    live: async () => {
      const { data } = await supabase.from("items").select("*").order("name");
      return (data || []).map((r) => [r.name, r.category, r.unit, r.pack_qty, r.price, r.barcode]);
    },
  },
  categories: {
    sheet: "Categories",
    columns: [{ header: "name", width: 24 }],
    sample: [["Dairy"], ["Dry goods"], ["Produce"], ["Sauces"]],
    live: async () => {
      const { data } = await supabase.from("categories").select("*").order("name");
      return (data || []).map((r) => [r.name]);
    },
  },
  containers: {
    sheet: "Containers",
    columns: [{ header: "name", width: 24 }, { header: "tare", width: 12 }],
    sample: [["GN Pan 1/4", 100], ["GN Pan 1/1", 360], ["2L Cambro", 180], ["Squeeze bottle", 50]],
    live: async () => {
      const { data } = await supabase.from("containers").select("*").order("name");
      return (data || []).map((r) => [r.name, r.tare]);
    },
  },
  recipes: {
    sheet: "Recipes",
    columns: [
      { header: "recipe", width: 24 }, { header: "yield", width: 10 },
      { header: "base_unit", width: 10 }, { header: "ingredient", width: 28 }, { header: "qty", width: 10 },
    ],
    sample: [
      ["Orange sauce", 370, "g", "Red sauce", 300],
      ["Orange sauce", 370, "g", "Garlic", 50],
      ["Orange sauce", 370, "g", "Olive oil", 20],
      ["Sugar syrup", 130, "g", "Sugar", 100],
      ["Sugar syrup", 130, "g", "Water", 20],
      ["Sugar syrup", 130, "g", "Citric acid", 10],
    ],
    live: async () => {
      const [{ data: rcs }, { data: lines }] = await Promise.all([
        supabase.from("recipes").select("*").order("name"),
        supabase.from("recipe_lines").select("*"),
      ]);
      const byRecipe = {};
      for (const ln of lines || []) {
        if (!byRecipe[ln.recipe_id]) byRecipe[ln.recipe_id] = [];
        byRecipe[ln.recipe_id].push(ln);
      }
      const out = [];
      for (const rc of rcs || []) {
        const rlines = byRecipe[rc.id] || [];
        if (!rlines.length) out.push([rc.name, rc.yield_qty, rc.base_unit, "", ""]);
        rlines.forEach((ln) => out.push([rc.name, rc.yield_qty, rc.base_unit, ln.ingredient, ln.qty]));
      }
      return out;
    },
  },
  barcodes: {
    sheet: "Barcodes",
    columns: [{ header: "name", width: 30 }, { header: "barcode", width: 18 }],
    sample: [["00 Flour (Caputo)", "8901001"], ["Mayonnaise", "8901003"]],
    live: async () => {
      const { data } = await supabase.from("items").select("name,barcode").order("name");
      return (data || []).map((r) => [r.name, r.barcode || ""]);
    },
  },
};

function addSheet(wb, def, rows) {
  const ws = wb.addWorksheet(def.sheet);
  ws.columns = def.columns.map((c) => ({ header: c.header, key: c.header, width: c.width }));
  styleHeader(ws.getRow(1));
  (rows || def.sample).forEach((r) => ws.addRow(r));
  return ws;
}

async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mise";
  const info = wb.addWorksheet("READ ME");
  info.columns = [{ width: 100 }];
  [
    "MISE — master data template",
    "",
    "Each tab is a separate master. In Mise you can import/export each tab on its own from the Masters screen.",
    "Importing a tab REPLACES that master with the rows in the file (Barcodes only updates barcodes on matching items).",
    "",
    "ITEMS — unit: kg, g, l, ml, piece. pack_qty: units per purchased pack (5 kg pail = unit kg, pack_qty 5). price: per pack.",
    "CATEGORIES — one name per row.",
    "CONTAINERS — vessel name + empty weight (tare) in g/ml.",
    "RECIPES — one row per ingredient; rows of one recipe share the recipe name. yield = batch output (g/ml). ingredient must be an Item or another Recipe. Cost is auto-calculated from item prices.",
    "BARCODES — item name + barcode; updates barcodes on existing items.",
  ].forEach((t, i) => { const r = info.addRow([t]); if (i === 0) r.font = { bold: true, size: 14 }; });

  for (const key of ["items", "categories", "containers", "recipes", "barcodes"]) addSheet(wb, MASTERS[key]);
  return wb;
}

async function exportOne(type, useLive) {
  const def = MASTERS[type];
  if (!def) throw new Error("Unknown master: " + type);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mise";
  const rows = useLive ? await def.live() : null;
  addSheet(wb, def, rows && rows.length ? rows : def.sample.slice(0, 0));
  return wb.xlsx.writeBuffer();
}

function readSheet(ws) {
  if (!ws) return [];
  const header = ws.getRow(1).values.map((v) => String(v ?? "").trim().toLowerCase());
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = {};
    header.forEach((h, i) => { if (h) obj[h] = row.values[i]; });
    if (Object.values(obj).some((v) => v !== undefined && v !== null && String(v).trim() !== "")) out.push(obj);
  });
  return out;
}
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

async function firstSheetRows(buffer, preferredName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  let ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === preferredName);
  if (!ws) ws = wb.worksheets.find((w) => readSheet(w).length) || wb.worksheets[0];
  return readSheet(ws);
}

async function importOne(type, buffer) {
  const def = MASTERS[type];
  if (!def) throw new Error("Unknown master: " + type);
  const rows = await firstSheetRows(buffer, def.sheet.toLowerCase());
  const warnings = [];
  let n = 0;

  if (type === "items") {
    await supabase.from("items").delete().gte("id", 0);
    const { data: cats } = await supabase.from("categories").select("name");
    const catSet = new Set((cats || []).map((c) => c.name));
    const newCats = [];
    const itemRows = [];
    for (const r of rows) {
      const name = str(r.name); if (!name) continue;
      const unit = str(r.unit) || "g", pack = num(r.pack_qty) || 1, price = num(r.price);
      const cat = str(r.category);
      if (cat && !catSet.has(cat)) { newCats.push({ name: cat }); catSet.add(cat); }
      itemRows.push({ name, category: cat, unit, pack_qty: pack, price, barcode: str(r.barcode), base_unit: baseOf(unit), cost_per_base: itemCostPerBase(price, unit, pack) });
      n++;
    }
    if (newCats.length) await supabase.from("categories").upsert(newCats, { onConflict: "name", ignoreDuplicates: true });
    if (itemRows.length) await supabase.from("items").insert(itemRows);
    await recomputeAllRecipeCosts();
  } else if (type === "categories") {
    await supabase.from("categories").delete().gte("id", 0);
    const catRows = rows.map((r) => str(r.name)).filter(Boolean).map((name) => ({ name }));
    n = catRows.length;
    if (catRows.length) await supabase.from("categories").insert(catRows);
  } else if (type === "containers") {
    await supabase.from("containers").delete().gte("id", 0);
    const contRows = rows.map((r) => ({ name: str(r.name), tare: num(r.tare) })).filter((r) => r.name);
    n = contRows.length;
    if (contRows.length) await supabase.from("containers").insert(contRows);
  } else if (type === "recipes") {
    await supabase.from("recipes").delete().gte("id", 0); // cascades to recipe_lines
    const groups = new Map();
    for (const r of rows) {
      const name = str(r.recipe) || str(r.name); if (!name) continue;
      if (!groups.has(name)) groups.set(name, { yield_qty: num(r.yield), base_unit: str(r.base_unit) || "g", lines: [] });
      const g = groups.get(name);
      if (num(r.yield) && !g.yield_qty) g.yield_qty = num(r.yield);
      const ing = str(r.ingredient); if (ing) g.lines.push({ ingredient: ing, qty: num(r.qty) });
    }
    for (const [name, g] of groups) {
      const { data: newR } = await supabase.from("recipes").insert({ name, yield_qty: g.yield_qty, base_unit: g.base_unit }).select().single();
      if (g.lines.length) await supabase.from("recipe_lines").insert(g.lines.map((ln) => ({ recipe_id: newR.id, ingredient: ln.ingredient, qty: ln.qty })));
      n++;
    }
    await recomputeAllRecipeCosts();
    const { data: allR } = await supabase.from("recipes").select("*");
    const { data: allLines } = await supabase.from("recipe_lines").select("*");
    const { data: allItems } = await supabase.from("items").select("name");
    const { data: allRecipes } = await supabase.from("recipes").select("name");
    const itemNames = new Set((allItems || []).map((i) => i.name.toLowerCase()));
    const recipeNames = new Set((allRecipes || []).map((i) => i.name.toLowerCase()));
    for (const r of allR || []) {
      if (!r.yield_qty) warnings.push(`Recipe "${r.name}" has no yield — cost can't be calculated.`);
    }
    for (const ln of allLines || []) {
      if (!itemNames.has(ln.ingredient.toLowerCase()) && !recipeNames.has(ln.ingredient.toLowerCase()))
        warnings.push(`Recipe ingredient "${ln.ingredient}" not found in Items or Recipes.`);
    }
  } else if (type === "barcodes") {
    for (const r of rows) {
      const name = str(r.name); if (!name) continue;
      const { data } = await supabase.from("items").update({ barcode: str(r.barcode) }).ilike("name", name).select();
      if (data && data.length) n++; else warnings.push(`No item named "${name}" — barcode skipped.`);
    }
  }
  return { type, count: n, warnings };
}

async function importMasters(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const get = (name) => wb.worksheets.find((w) => w.name.trim().toLowerCase() === name);
  const warnings = [];
  const itemRows = readSheet(get("items"));
  const catRows = readSheet(get("categories"));
  const contRows = readSheet(get("containers"));
  const recRows = readSheet(get("recipes"));
  if (!get("items")) warnings.push("No 'Items' tab found.");

  // Delete all (recipes cascade to recipe_lines)
  await supabase.from("recipes").delete().gte("id", 0);
  await supabase.from("items").delete().gte("id", 0);
  await supabase.from("containers").delete().gte("id", 0);
  await supabase.from("categories").delete().gte("id", 0);

  // Categories (merge from both tabs)
  const catSet = new Set();
  for (const r of catRows) { const n = str(r.name); if (n) catSet.add(n); }
  for (const r of itemRows) { const c = str(r.category); if (c) catSet.add(c); }
  if (catSet.size) await supabase.from("categories").insert([...catSet].map((name) => ({ name })));
  const nCat = catSet.size;

  // Items
  const iRows = [];
  for (const r of itemRows) {
    const name = str(r.name); if (!name) continue;
    const unit = str(r.unit) || "g", pack = num(r.pack_qty) || 1, price = num(r.price);
    iRows.push({ name, category: str(r.category), unit, pack_qty: pack, price, barcode: str(r.barcode), base_unit: baseOf(unit), cost_per_base: itemCostPerBase(price, unit, pack) });
  }
  if (iRows.length) await supabase.from("items").insert(iRows);
  const nItems = iRows.length;

  // Containers
  const cRows = contRows.map((r) => ({ name: str(r.name), tare: num(r.tare) })).filter((r) => r.name);
  if (cRows.length) await supabase.from("containers").insert(cRows);
  const nCont = cRows.length;

  // Recipes
  const groups = new Map();
  for (const r of recRows) {
    const name = str(r.recipe); if (!name) continue;
    if (!groups.has(name)) groups.set(name, { yield_qty: num(r.yield), base_unit: str(r.base_unit) || "g", lines: [] });
    const g = groups.get(name);
    if (num(r.yield) && !g.yield_qty) g.yield_qty = num(r.yield);
    const ing = str(r.ingredient); if (ing) g.lines.push({ ingredient: ing, qty: num(r.qty) });
  }
  let nRec = 0;
  for (const [name, g] of groups) {
    const { data: newR } = await supabase.from("recipes").insert({ name, yield_qty: g.yield_qty, base_unit: g.base_unit }).select().single();
    if (g.lines.length) await supabase.from("recipe_lines").insert(g.lines.map((ln) => ({ recipe_id: newR.id, ingredient: ln.ingredient, qty: ln.qty })));
    nRec++;
  }
  await recomputeAllRecipeCosts();
  return { nItems, nCont, nRec, nCat, warnings };
}

async function exportCount(countId) {
  const { data: c } = await supabase.from("counts").select("*, outlets(name)").eq("id", countId).maybeSingle();
  if (!c) return null;
  const outlet = c.outlets ? c.outlets.name : "";
  const { data: lines } = await supabase.from("count_lines").select("*").eq("count_id", countId).order("flagged").order("id");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Stock count");
  ws.mergeCells("A1:I1");
  ws.getCell("A1").value = `${outlet} — ${c.period} stock count`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:I2");
  ws.getCell("A2").value = `Status: ${c.status}    Generated: ${new Date().toLocaleString("en-IN")}`;
  ws.getCell("A2").font = { color: { argb: "FF64748B" } };
  ws.addRow([]);

  const counted = (lines || []).filter((l) => !l.flagged);
  const flagged = (lines || []).filter((l) => l.flagged);
  const asCounted = (l) => (l.in_qty != null && l.in_unit) ? `${l.in_qty} ${l.in_unit}` : (l.container_name ? `gross ${l.measured ?? ""}` : `${l.qty}`);

  const headRow = ws.addRow(["Product", "Type", "Container", "As counted", "Counted qty", "Unit", "Unit cost", "Line value", ""]);
  styleHeader(headRow);
  let total = 0;
  counted.forEach((l, i) => {
    const row = ws.addRow([l.ref_name, l.kind, l.container_name || "", asCounted(l), l.qty, l.unit || "", l.unit_cost, l.value, ""]);
    if (i % 2) row.eachCell((cc) => { cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } }; });
    total += l.value;
  });
  ws.addRow([]);
  const totRow = ws.addRow(["", "", "", "", "", "", "TOTAL", total, ""]);
  totRow.font = { bold: true };

  if (flagged.length) {
    ws.addRow([]);
    const t = ws.addRow(["Items not in master — needs Admin action"]);
    ws.mergeCells(`A${t.number}:I${t.number}`);
    t.getCell(1).font = { bold: true, color: { argb: "FF92400E" } };
    t.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FLAG } };
    const fh = ws.addRow(["Product (as entered)", "Container", "As counted", "Counted qty", "Note"]);
    styleHeader(fh);
    flagged.forEach((l) => ws.addRow([l.ref_name, l.container_name || "", asCounted(l), l.qty, l.note || ""]));
  }
  ws.columns.forEach((col, i) => { col.width = [30, 14, 14, 14, 12, 8, 11, 13, 2][i] || 14; });
  ["G", "H"].forEach((cc) => ws.getColumn(cc).numFmt = '#,##0.00');
  const filename = `${outlet}_${c.period}_stock_count.xlsx`.replace(/[^\w.\-]+/g, "_");
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename };
}

async function exportMasters() { return (await buildTemplate()).xlsx.writeBuffer(); }

module.exports = { buildTemplate, importMasters, importOne, exportOne, exportCount, exportMasters, MASTERS };
