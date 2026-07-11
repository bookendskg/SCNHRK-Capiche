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

  if (type === "recipes" && useLive) {
    const { data: rcs } = await supabase.from("recipes").select("name, yield_qty, base_unit, cost_per_base").order("name");
    const ws2 = wb.addWorksheet("Recipe Costs");
    ws2.columns = [
      { header: "recipe", key: "recipe", width: 30 },
      { header: "yield", key: "yield", width: 10 },
      { header: "base_unit", key: "base_unit", width: 10 },
      { header: "cost_per_unit", key: "cost_per_unit", width: 16 },
      { header: "total_batch_cost", key: "total_batch_cost", width: 18 },
    ];
    styleHeader(ws2.getRow(1));
    for (const [i, r] of (rcs || []).entries()) {
      const total = (r.cost_per_base || 0) * (r.yield_qty || 0);
      const row = ws2.addRow([r.name, r.yield_qty, r.base_unit, r.cost_per_base || 0, total]);
      if (i % 2) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } }; });
    }
    ws2.getColumn("cost_per_unit").numFmt = "₹#,##0.00";
    ws2.getColumn("total_batch_cost").numFmt = "₹#,##0.00";
  }

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

async function computeAndSaveRecipeCosts(insertedRecipes, allLineRows) {
  if (!insertedRecipes.length) return;
  // Paginate to bypass Supabase's 1000-row server cap
  const allItems = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from("items").select("name, cost_per_base").range(off, off + 999);
    if (!data || !data.length) break;
    allItems.push(...data);
    if (data.length < 1000) break;
  }
  const itemCostMap = new Map();
  for (const it of allItems) itemCostMap.set(it.name.trim().toLowerCase(), it.cost_per_base || 0);

  const linesByRecipeId = new Map();
  for (const ln of allLineRows) {
    if (!linesByRecipeId.has(ln.recipe_id)) linesByRecipeId.set(ln.recipe_id, []);
    linesByRecipeId.get(ln.recipe_id).push(ln);
  }
  const recipeByName = new Map();
  for (const r of insertedRecipes) recipeByName.set(r.name.trim().toLowerCase(), r);

  const costCache = new Map();
  function resolve(name, seen = new Set()) {
    const key = name.trim().toLowerCase();
    if (costCache.has(key)) return costCache.get(key);
    if (seen.has(key)) return 0;
    seen.add(key);
    const r = recipeByName.get(key);
    if (!r) return 0;
    let total = 0;
    for (const ln of linesByRecipeId.get(r.id) || []) {
      const ingKey = ln.ingredient.trim().toLowerCase();
      if (itemCostMap.has(ingKey)) total += itemCostMap.get(ingKey) * ln.qty;
      else total += resolve(ln.ingredient, new Set(seen)) * ln.qty;
    }
    const cost = r.yield_qty > 0 ? total / r.yield_qty : 0;
    costCache.set(key, cost);
    return cost;
  }

  const updates = insertedRecipes.map((r) => ({ id: r.id, cost_per_base: resolve(r.name) }));
  const nonZero = updates.filter((u) => u.cost_per_base > 0);
  console.log(`[computeRecipeCosts] ${updates.length} recipes, ${nonZero.length} with non-zero cost, items loaded: ${itemCostMap.size}`);
  // Parallel updates in batches of 50 — more reliable than upsert
  for (let i = 0; i < updates.length; i += 50) {
    await Promise.all(updates.slice(i, i + 50).map((u) =>
      supabase.from("recipes").update({ cost_per_base: u.cost_per_base }).eq("id", u.id)
    ));
  }
  console.log(`[computeRecipeCosts] done`);
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
      const unit = str(r.unit).toLowerCase() || "g", pack = num(r.pack_qty) || 1, price = num(r.price);
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
    // Batch insert all recipes (chunked to stay under Supabase row limits)
    const recipeRows = [...groups.keys()].map((name) => {
      const g = groups.get(name);
      return { name, yield_qty: g.yield_qty, base_unit: g.base_unit };
    });
    const insertedRecipes = [];
    for (let i = 0; i < recipeRows.length; i += 500) {
      const { data } = await supabase.from("recipes").insert(recipeRows.slice(i, i + 500)).select();
      insertedRecipes.push(...(data || []));
    }
    n = insertedRecipes.length;
    // Batch insert all lines
    const allLineRows = [];
    for (const newR of insertedRecipes) {
      const g = groups.get(newR.name);
      if (g && g.lines.length) allLineRows.push(...g.lines.map((ln) => ({ recipe_id: newR.id, ingredient: ln.ingredient, qty: ln.qty })));
    }
    for (let i = 0; i < allLineRows.length; i += 500) {
      await supabase.from("recipe_lines").insert(allLineRows.slice(i, i + 500));
    }
    // Compute and save costs in-memory — fast, no per-recipe round-trips
    await computeAndSaveRecipeCosts(insertedRecipes, allLineRows);
    // Validation warnings
    const { data: allItems } = await supabase.from("items").select("name");
    const { data: allRecipes } = await supabase.from("recipes").select("name");
    const itemNames = new Set((allItems || []).map((i) => i.name.toLowerCase()));
    const recipeNames = new Set((allRecipes || []).map((i) => i.name.toLowerCase()));
    const seenIngredients = new Set(allLineRows.map((ln) => ln.ingredient.toLowerCase()));
    for (const r of insertedRecipes) {
      if (!r.yield_qty) warnings.push(`Recipe "${r.name}" has no yield — cost can't be calculated.`);
    }
    for (const ing of seenIngredients) {
      if (!itemNames.has(ing) && !recipeNames.has(ing))
        warnings.push(`Ingredient "${ing}" not found in Items or Recipes.`);
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
    const unit = str(r.unit).toLowerCase() || "g", pack = num(r.pack_qty) || 1, price = num(r.price);
    iRows.push({ name, category: str(r.category), unit, pack_qty: pack, price, barcode: str(r.barcode), base_unit: baseOf(unit), cost_per_base: itemCostPerBase(price, unit, pack) });
  }
  if (iRows.length) await supabase.from("items").insert(iRows);
  const nItems = iRows.length;

  // Containers
  const cRows = contRows.map((r) => ({ name: str(r.name), tare: num(r.tare) })).filter((r) => r.name);
  if (cRows.length) await supabase.from("containers").insert(cRows);
  const nCont = cRows.length;

  // Recipes — batch insert all at once
  const groups = new Map();
  for (const r of recRows) {
    const name = str(r.recipe); if (!name) continue;
    if (!groups.has(name)) groups.set(name, { yield_qty: num(r.yield), base_unit: str(r.base_unit) || "g", lines: [] });
    const g = groups.get(name);
    if (num(r.yield) && !g.yield_qty) g.yield_qty = num(r.yield);
    const ing = str(r.ingredient); if (ing) g.lines.push({ ingredient: ing, qty: num(r.qty) });
  }
  const recipeRows = [...groups.keys()].map((name) => {
    const g = groups.get(name);
    return { name, yield_qty: g.yield_qty, base_unit: g.base_unit };
  });
  const insertedRecipes = [];
  for (let i = 0; i < recipeRows.length; i += 500) {
    const { data } = await supabase.from("recipes").insert(recipeRows.slice(i, i + 500)).select();
    insertedRecipes.push(...(data || []));
  }
  const nRec = insertedRecipes.length;
  const allLineRows = [];
  for (const newR of insertedRecipes) {
    const g = groups.get(newR.name);
    if (g && g.lines.length) allLineRows.push(...g.lines.map((ln) => ({ recipe_id: newR.id, ingredient: ln.ingredient, qty: ln.qty })));
  }
  for (let i = 0; i < allLineRows.length; i += 500) {
    await supabase.from("recipe_lines").insert(allLineRows.slice(i, i + 500));
  }
  await computeAndSaveRecipeCosts(insertedRecipes, allLineRows);
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
