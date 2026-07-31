"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { supabase, DATA_DIR, factor, baseOf, itemCostPerBase, resolveRecipeCost, recomputeAllRecipeCosts, cleanEmptyCategories, ensureAdmin } = require("./db");
const { buildTemplate, importMasters, importOne, exportOne, exportCount, exportMasters, MASTERS } = require("./excel");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const secretPath = path.join(DATA_DIR, ".jwtsecret");
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (fs.existsSync(secretPath)) JWT_SECRET = fs.readFileSync(secretPath, "utf8");
  else { JWT_SECRET = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(secretPath, JWT_SECRET); }
}
const COOKIE = "mise_token";
const secureCookie = process.env.SECURE_COOKIE === "1";

// Wraps async route handlers so thrown errors reach Express error handler
const wr = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---- auth middleware ---- */
function auth(req, res, next) {
  const tok = req.cookies[COOKIE];
  if (!tok) return res.status(401).json({ error: "Not signed in" });
  let p;
  try { p = jwt.verify(tok, JWT_SECRET); }
  catch { return res.status(401).json({ error: "Session expired" }); }
  if (p.username !== undefined) {
    // New token with full claims — no DB call needed
    req.user = { id: p.uid, username: p.username, role: p.role, name: p.name, outlet_id: p.outlet_id || null };
    return next();
  }
  // Old token (only uid+role) — fall back to DB lookup once until re-login
  supabase.from("users").select("id,username,role,name,outlet_id").eq("id", p.uid).maybeSingle()
    .then(({ data: u }) => {
      if (!u) return res.status(401).json({ error: "Session invalid" });
      req.user = u;
      next();
    })
    .catch(() => res.status(500).json({ error: "Server error" }));
}
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}
const pubUser = (u) => ({ id: u.id, username: u.username, role: u.role, name: u.name, outlet_id: u.outlet_id });

/* ---- auth routes ---- */
app.post("/api/login", wr(async (req, res) => {
  const { username, password } = req.body || {};
  const { data: u } = await supabase.from("users").select("*").eq("username", String(username || "").trim()).maybeSingle();
  if (!u || !(await bcrypt.compare(String(password || ""), u.password_hash)))
    return res.status(401).json({ error: "Wrong username or password" });
  const token = jwt.sign(
    { uid: u.id, role: u.role, username: u.username, name: u.name, outlet_id: u.outlet_id || null },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookie, maxAge: 30 * 864e5 });
  res.json({ user: pubUser(u) });
}));

app.post("/api/logout", (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

app.get("/api/me", auth, wr(async (req, res) => {
  let outlet_name = null;
  if (req.user.outlet_id) {
    const { data: o } = await supabase.from("outlets").select("name").eq("id", req.user.outlet_id).maybeSingle();
    outlet_name = o ? o.name : null;
  }
  res.json({ user: { ...pubUser(req.user), outlet_name } });
}));

app.post("/api/me/password", auth, wr(async (req, res) => {
  const { current, next: np } = req.body || {};
  const { data: u } = await supabase.from("users").select("*").eq("id", req.user.id).single();
  if (!bcrypt.compareSync(String(current || ""), u.password_hash)) return res.status(400).json({ error: "Current password is wrong" });
  if (!np || String(np).length < 4) return res.status(400).json({ error: "New password too short" });
  await supabase.from("users").update({ password_hash: bcrypt.hashSync(String(np), 10) }).eq("id", u.id);
  res.json({ ok: true });
}));

/* ---- catalog ---- */
app.get("/api/catalog", auth, wr(async (req, res) => {
  const [{ data: items }, { data: recipes }, { data: containers }] = await Promise.all([
    supabase.from("items").select("name,category,unit,pack_qty,price,barcode,base_unit,cost_per_base").order("name"),
    supabase.from("recipes").select("name,base_unit,cost_per_base,yield_qty").order("name"),
    supabase.from("containers").select("id,name,tare").order("name"),
  ]);
  res.json({ items: items || [], recipes: recipes || [], containers: containers || [] });
}));

/* ---- masters ---- */
app.get("/api/masters", auth, adminOnly, wr(async (req, res) => {
  const [{ data: items }, { data: categories }, { data: containers }, { data: recipesRaw }] = await Promise.all([
    supabase.from("items").select("*").order("name"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("containers").select("*").order("name"),
    supabase.from("recipes").select("*, lines:recipe_lines(ingredient,qty)").order("name"),
  ]);
  const recipes = (recipesRaw || []).map((r) => ({ ...r, lines: r.lines || [] }));
  res.json({ items: items || [], categories: categories || [], containers: containers || [], recipes });
}));

app.get("/api/masters/template", auth, adminOnly, wr(async (req, res) => {
  const wb = await buildTemplate();
  res.setHeader("Content-Disposition", 'attachment; filename="mise_master_template.xlsx"');
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await wb.xlsx.write(res); res.end();
}));

app.get("/api/masters/export", auth, adminOnly, wr(async (req, res) => {
  const buf = await exportMasters();
  res.setHeader("Content-Disposition", 'attachment; filename="mise_masters_export.xlsx"');
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.end(Buffer.from(buf));
}));

app.post("/api/masters/upload", auth, adminOnly, upload.single("file"), wr(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const result = await importMasters(req.file.buffer);
    revalueAllCounts().catch((e) => console.error("[revalueAllCounts]", e.message));
    res.json(result);
  } catch (e) { res.status(400).json({ error: "Could not read that file: " + e.message }); }
}));

app.get("/api/masters/:type/export", auth, adminOnly, wr(async (req, res) => {
  const type = req.params.type;
  if (!MASTERS[type]) return res.status(404).send("Unknown master");
  const category = req.query.category ? String(req.query.category).trim() : null;
  const buf = await exportOne(type, true, { category });
  const catSuffix = category ? `_${category.replace(/[^a-zA-Z0-9]+/g, "_")}` : "";
  res.setHeader("Content-Disposition", `attachment; filename="mise_${type}${catSuffix}.xlsx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.end(Buffer.from(buf));
}));

app.get("/api/masters/:type/template", auth, adminOnly, wr(async (req, res) => {
  const type = req.params.type;
  if (!MASTERS[type]) return res.status(404).send("Unknown master");
  const wb = new (require("exceljs").Workbook)();
  const def = MASTERS[type];
  const ws = wb.addWorksheet(def.sheet);
  ws.columns = def.columns.map((c) => ({ header: c.header, key: c.header, width: c.width }));
  def.sample.forEach((r) => ws.addRow(r));
  res.setHeader("Content-Disposition", `attachment; filename="mise_${type}_template.xlsx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await wb.xlsx.write(res); res.end();
}));

app.post("/api/masters/:type/import", auth, adminOnly, upload.single("file"), wr(async (req, res) => {
  const type = req.params.type;
  if (!MASTERS[type]) return res.status(404).json({ error: "Unknown master" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const result = await importOne(type, req.file.buffer);
    if (type === "items") await cleanEmptyCategories();
    if (type === "items" || type === "recipes") {
      revalueAllCounts().catch((e) => console.error("[revalueAllCounts]", e.message));
    }
    res.json(result);
  } catch (e) { res.status(400).json({ error: "Could not read that file: " + e.message }); }
}));

/* ---- recipe CRUD ---- */
app.get("/api/recipes/:id", auth, adminOnly, wr(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [{ data: recipe }, { data: lines }] = await Promise.all([
    supabase.from("recipes").select("*").eq("id", id).single(),
    supabase.from("recipe_lines").select("ingredient,qty").eq("recipe_id", id).order("id"),
  ]);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  res.json({ ...recipe, lines: lines || [] });
}));

app.post("/api/recipes", auth, adminOnly, wr(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const yield_qty = parseFloat(req.body.yield_qty) || 0;
  const base_unit = String(req.body.base_unit || "g").trim();
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!name) return res.status(400).json({ error: "Recipe name is required" });
  if (!yield_qty) return res.status(400).json({ error: "Yield must be greater than zero" });

  const { data: ex } = await supabase.from("recipes").select("id").ilike("name", name).maybeSingle();
  if (ex) {
    await supabase.from("recipe_lines").delete().eq("recipe_id", ex.id);
    await supabase.from("recipes").delete().eq("id", ex.id);
  }
  const { data: newR } = await supabase.from("recipes").insert({ name, yield_qty, base_unit }).select().single();
  const lineRows = lines
    .map((ln) => ({ recipe_id: newR.id, ingredient: String(ln.ingredient || "").trim(), qty: parseFloat(ln.qty) || 0 }))
    .filter((ln) => ln.ingredient);
  if (lineRows.length) await supabase.from("recipe_lines").insert(lineRows);

  const cpb = await resolveRecipeCost(name);
  if (cpb > 0) await supabase.from("recipes").update({ cost_per_base: cpb }).eq("id", newR.id);
  await recomputeAllRecipeCosts();
  res.json({ id: newR.id, name, yield_qty, base_unit, warnings: [] });
}));

app.put("/api/recipes/:id", auth, adminOnly, wr(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = String(req.body.name || "").trim();
  const yield_qty = parseFloat(req.body.yield_qty) || 0;
  const base_unit = String(req.body.base_unit || "g").trim();
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!name) return res.status(400).json({ error: "Recipe name is required" });
  if (!yield_qty) return res.status(400).json({ error: "Yield must be greater than zero" });
  const lineRows = lines
    .map((ln) => ({ recipe_id: id, ingredient: String(ln.ingredient || "").trim(), qty: parseFloat(ln.qty) || 0 }))
    .filter((ln) => ln.ingredient);
  if (!lineRows.length) return res.status(400).json({ error: "At least one ingredient is required" });
  console.log(`[PUT /api/recipes/${id}] updating with ${lineRows.length} lines:`, lineRows.map(l => l.ingredient).join(", "));
  await supabase.from("recipes").update({ name, yield_qty, base_unit }).eq("id", id);
  await supabase.from("recipe_lines").delete().eq("recipe_id", id);
  const { data: inserted, error: insertErr } = await supabase.from("recipe_lines").insert(lineRows).select();
  if (insertErr || !inserted || inserted.length !== lineRows.length) {
    console.error(`[PUT /api/recipes/${id}] insert failed — error:`, insertErr, "inserted:", inserted?.length, "expected:", lineRows.length);
    return res.status(500).json({ error: `Ingredient save failed — expected ${lineRows.length} lines but got ${inserted?.length ?? 0}` });
  }
  console.log(`[PUT /api/recipes/${id}] saved ${inserted.length} lines OK`);
  const cpb = await resolveRecipeCost(name);
  await supabase.from("recipes").update({ cost_per_base: cpb }).eq("id", id);
  await recomputeAllRecipeCosts();
  res.json({ id, name, yield_qty, base_unit, cost_per_base: cpb, savedLines: inserted.length });
}));

app.delete("/api/recipes/:id", auth, adminOnly, wr(async (req, res) => {
  await supabase.from("recipe_lines").delete().eq("recipe_id", req.params.id);
  await supabase.from("recipes").delete().eq("id", req.params.id);
  await recomputeAllRecipeCosts();
  res.json({ ok: true });
}));

/* ---- item CRUD ---- */
function normalizeUnit(u) {
  const v = (String(u || "").trim() || "gm").toLowerCase();
  if (v === "g" || v === "gram" || v === "grams") return "gm";
  if (v === "l" || v === "litre" || v === "liter") return "ltr";
  return v;
}
function itemPayload(b) {
  const name = String(b.name || "").trim();
  const unit = normalizeUnit(b.unit);
  const pack_qty = parseFloat(b.pack_qty) || 1;
  const price = parseFloat(b.price) || 0;
  return { name, category: String(b.category || "").trim(), unit, pack_qty, price, barcode: String(b.barcode || "").trim(), base_unit: baseOf(unit), cost_per_base: itemCostPerBase(price, unit, pack_qty) };
}

app.post("/api/items", auth, adminOnly, wr(async (req, res) => {
  const p = itemPayload(req.body);
  if (!p.name) return res.status(400).json({ error: "Item name is required" });
  if (p.category) await supabase.from("categories").upsert({ name: p.category }, { onConflict: "name", ignoreDuplicates: true });
  const { data: r, error } = await supabase.from("items").insert(p).select().single();
  if (error) return res.status(400).json({ error: "An item with that name already exists" });
  await recomputeAllRecipeCosts();
  res.json(r);
}));

app.put("/api/items/:id", auth, adminOnly, wr(async (req, res) => {
  const p = itemPayload(req.body);
  if (!p.name) return res.status(400).json({ error: "Item name is required" });
  if (p.category) await supabase.from("categories").upsert({ name: p.category }, { onConflict: "name", ignoreDuplicates: true });
  const { error } = await supabase.from("items").update(p).eq("id", req.params.id);
  if (error) return res.status(400).json({ error: "An item with that name already exists" });
  await Promise.all([recomputeAllRecipeCosts(), cleanEmptyCategories()]);
  revalueAllCounts().catch((e) => console.error("[revalueAllCounts]", e.message));
  res.json({ id: parseInt(req.params.id, 10), ...p });
}));

app.delete("/api/items/:id", auth, adminOnly, wr(async (req, res) => {
  await supabase.from("items").delete().eq("id", req.params.id);
  await Promise.all([recomputeAllRecipeCosts(), cleanEmptyCategories()]);
  res.json({ ok: true });
}));

app.put("/api/items/:id/barcode", auth, adminOnly, wr(async (req, res) => {
  const { data: it } = await supabase.from("items").select("*").eq("id", req.params.id).maybeSingle();
  if (!it) return res.status(404).json({ error: "Item not found" });
  const barcode = String(req.body.barcode || "").trim();
  await supabase.from("items").update({ barcode }).eq("id", req.params.id);
  res.json({ id: it.id, name: it.name, barcode });
}));

/* ---- containers & categories ---- */
app.post("/api/containers", auth, adminOnly, wr(async (req, res) => {
  const name = String(req.body.name || "").trim(); const tare = parseFloat(req.body.tare) || 0;
  if (!name) return res.status(400).json({ error: "Name required" });
  const unit = (String(req.body.unit || "g").trim() || "g").toLowerCase();
  const { data: r, error } = await supabase.from("containers").insert({ name, tare, unit }).select().single();
  if (error) return res.status(400).json({ error: "A container with that name exists" });
  res.json(r);
}));

app.delete("/api/containers/:id", auth, adminOnly, wr(async (req, res) => {
  await supabase.from("containers").delete().eq("id", req.params.id); res.json({ ok: true });
}));

app.put("/api/containers/:id", auth, adminOnly, wr(async (req, res) => {
  const name = String(req.body.name || "").trim(); const tare = parseFloat(req.body.tare) || 0;
  const unit = (String(req.body.unit || "g").trim() || "g").toLowerCase();
  if (!name) return res.status(400).json({ error: "Name required" });
  const { error } = await supabase.from("containers").update({ name, tare, unit }).eq("id", req.params.id);
  if (error) return res.status(400).json({ error: "A container with that name exists" });
  res.json({ id: parseInt(req.params.id, 10), name, tare, unit });
}));

app.delete("/api/masters/clear", auth, adminOnly, wr(async (req, res) => {
  const type = req.query.type;
  if (!["items", "recipes", "containers", "categories"].includes(type))
    return res.status(400).json({ error: "Invalid type" });
  if (type === "recipes") {
    await supabase.from("recipe_lines").delete().gt("id", 0);
    await supabase.from("recipes").delete().gt("id", 0);
  } else {
    await supabase.from(type).delete().gt("id", 0);
  }
  if (type === "items") await recomputeAllRecipeCosts();
  res.json({ ok: true });
}));

app.post("/api/categories", auth, adminOnly, wr(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name required" });
  const { data: r, error } = await supabase.from("categories").insert({ name }).select().single();
  if (error) return res.status(400).json({ error: "That category exists" });
  res.json(r);
}));

app.delete("/api/categories/:id", auth, adminOnly, wr(async (req, res) => {
  await supabase.from("categories").delete().eq("id", req.params.id); res.json({ ok: true });
}));

app.put("/api/categories/:id", auth, adminOnly, wr(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name required" });
  const { error } = await supabase.from("categories").update({ name }).eq("id", req.params.id);
  if (error) return res.status(400).json({ error: "That category exists" });
  res.json({ id: parseInt(req.params.id, 10), name });
}));

/* ---- outlets & users ---- */
app.get("/api/outlets", auth, wr(async (req, res) => {
  if (req.user.role === "admin") {
    const { data } = await supabase.from("outlets").select("*").order("name");
    return res.json(data || []);
  }
  const { data } = await supabase.from("outlets").select("*").eq("id", req.user.outlet_id);
  res.json(data || []);
}));

app.post("/api/outlets", auth, adminOnly, wr(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name required" });
  const { data: r, error } = await supabase.from("outlets").insert({ name }).select().single();
  if (error) return res.status(400).json({ error: "An outlet with that name already exists" });
  res.json(r);
}));

app.delete("/api/outlets/:id", auth, adminOnly, wr(async (req, res) => {
  const id = req.params.id;
  const { data: o } = await supabase.from("outlets").select("id").eq("id", id).maybeSingle();
  if (!o) return res.status(404).json({ error: "Outlet not found" });
  // Explicit cascade: count_lines → counts → unlink users → outlet
  const { data: counts, error: ce } = await supabase.from("counts").select("id").eq("outlet_id", id);
  if (ce) return res.status(500).json({ error: "counts: " + ce.message });
  const countIds = (counts || []).map((c) => c.id);
  if (countIds.length) {
    const { error: cle } = await supabase.from("count_lines").delete().in("count_id", countIds);
    if (cle) return res.status(500).json({ error: "count_lines: " + cle.message });
  }
  const { error: de } = await supabase.from("counts").delete().eq("outlet_id", id);
  if (de) return res.status(500).json({ error: "delete counts: " + de.message });
  const { error: ue } = await supabase.from("users").update({ outlet_id: null }).eq("outlet_id", id);
  if (ue) return res.status(500).json({ error: "unlink users: " + ue.message });
  const { error: oe } = await supabase.from("outlets").delete().eq("id", id);
  if (oe) return res.status(500).json({ error: "delete outlet: " + oe.message });
  res.json({ ok: true });
}));

app.get("/api/users", auth, adminOnly, wr(async (req, res) => {
  const { data } = await supabase.from("users")
    .select("id,username,name,outlet_id,outlets(name)")
    .eq("role", "manager")
    .order("username");
  res.json((data || []).map((u) => ({ id: u.id, username: u.username, name: u.name, outlet_id: u.outlet_id, outlet_name: u.outlets ? u.outlets.name : null })));
}));

app.post("/api/users", auth, adminOnly, wr(async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim();
  const outlet_id = parseInt(req.body.outlet_id, 10);
  if (!username || password.length < 4 || !outlet_id) return res.status(400).json({ error: "Username, password (4+ chars) and outlet are required" });
  const { data: outlet } = await supabase.from("outlets").select("id").eq("id", outlet_id).maybeSingle();
  if (!outlet) return res.status(400).json({ error: "Outlet not found" });
  const { data: r, error } = await supabase.from("users")
    .insert({ username, password_hash: bcrypt.hashSync(password, 10), role: "manager", name, outlet_id })
    .select().single();
  if (error) return res.status(400).json({ error: "That username is taken" });
  res.json({ id: r.id, username, name, outlet_id });
}));

app.post("/api/users/:id/password", auth, adminOnly, wr(async (req, res) => {
  const pw = String(req.body.password || "");
  if (pw.length < 4) return res.status(400).json({ error: "Password too short" });
  const { data } = await supabase.from("users").update({ password_hash: bcrypt.hashSync(pw, 10) }).eq("id", req.params.id).eq("role", "manager").select();
  res.json({ ok: (data || []).length > 0 });
}));

app.delete("/api/users/:id", auth, adminOnly, wr(async (req, res) => {
  await supabase.from("users").delete().eq("id", req.params.id).eq("role", "manager");
  res.json({ ok: true });
}));

/* ---- counts ---- */
function canSeeCount(user, c) { return user.role === "admin" || String(c.outlet_id) === String(user.outlet_id); }

function valueLine(raw, itemsMap, recipesMap, containersMap) {
  const kind = raw.kind;
  let container_name = raw.container_name || null, container_tare = 0;
  if (container_name) container_tare = containersMap[container_name.toLowerCase()] || 0;
  const isContainer = !!container_name;
  const in_qty = parseFloat(raw.qty != null ? raw.qty : raw.measured) || 0;
  let in_unit = raw.unit || null;
  const packMode = kind === "unopened" && (!in_unit || /^pack/i.test(in_unit));
  if (packMode) in_unit = "pack";

  const base = in_qty * factor(in_unit);
  let qty;
  if (isContainer) qty = Math.max(0, base - container_tare);
  else if (packMode) qty = in_qty;
  else qty = base;

  const refLow = (raw.ref_name || "").toLowerCase();
  let unit = "", unit_cost = 0, value = 0, flagged = 0, note = raw.note || null;

  if (kind === "notinmaster") { flagged = 1; unit = isContainer ? "g" : (in_unit || ""); }
  else if (kind === "unopened") {
    const it = itemsMap[refLow];
    if (packMode) { unit = "pack"; unit_cost = it ? it.price : 0; }
    else { unit = it ? it.base_unit : "g"; unit_cost = it ? it.cost_per_base : 0; }
    value = qty * unit_cost;
  } else if (kind === "opened") {
    const it = itemsMap[refLow];
    unit = it ? it.base_unit : "g"; unit_cost = it ? it.cost_per_base : 0; value = qty * unit_cost;
  } else if (kind === "processed") {
    const rc = recipesMap[refLow];
    const it = rc ? null : itemsMap[refLow];
    unit = rc ? rc.base_unit : (it ? it.base_unit : "g");
    unit_cost = rc ? rc.cost_per_base : (it ? it.cost_per_base : 0);
    value = qty * unit_cost;
  }
  const measured = isContainer ? base : null;
  return { kind, ref_name: raw.ref_name, container_name, container_tare, measured, in_qty, in_unit, qty, unit, unit_cost, value, flagged, note };
}

async function revalueAllCounts() {
  const [{ data: allItems }, { data: allRecipes }, { data: allContainers }] = await Promise.all([
    supabase.from("items").select("name,base_unit,cost_per_base,price"),
    supabase.from("recipes").select("name,base_unit,cost_per_base"),
    supabase.from("containers").select("name,tare"),
  ]);
  const itemsMap = {};
  for (const it of allItems || []) itemsMap[it.name.toLowerCase()] = it;
  const recipesMap = {};
  for (const rc of allRecipes || []) recipesMap[rc.name.toLowerCase()] = rc;
  const containersMap = {};
  for (const ct of allContainers || []) containersMap[ct.name.toLowerCase()] = ct.tare;

  const PAGE = 1000;
  const allLines = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await supabase.from("count_lines").select("*").range(offset, offset + PAGE - 1);
    if (!data || !data.length) break;
    allLines.push(...data);
    if (data.length < PAGE) break;
  }
  if (!allLines.length) return;

  const countTotals = {};
  const lineUpdates = [];
  for (const line of allLines) {
    if (!countTotals[line.count_id]) countTotals[line.count_id] = 0;
    if (line.flagged) continue;
    const v = valueLine(
      { kind: line.kind, ref_name: line.ref_name, container_name: line.container_name, qty: line.in_qty, unit: line.in_unit, measured: line.measured, note: line.note },
      itemsMap, recipesMap, containersMap
    );
    lineUpdates.push({ id: line.id, count_id: line.count_id, unit_cost: v.unit_cost, value: v.value, qty: v.qty, unit: v.unit, container_tare: v.container_tare });
    countTotals[line.count_id] += v.value;
  }

  for (let i = 0; i < lineUpdates.length; i += 50) {
    await Promise.all(lineUpdates.slice(i, i + 50).map((u) =>
      supabase.from("count_lines").update({ unit_cost: u.unit_cost, value: u.value, qty: u.qty, unit: u.unit, container_tare: u.container_tare }).eq("id", u.id)
    ));
  }
  const countIds = Object.keys(countTotals);
  for (let i = 0; i < countIds.length; i += 50) {
    await Promise.all(countIds.slice(i, i + 50).map((id) =>
      supabase.from("counts").update({ total_value: countTotals[id], updated_at: new Date().toISOString() }).eq("id", id)
    ));
  }
  console.log(`[revalueAllCounts] ${lineUpdates.length} lines, ${countIds.length} counts`);
}

app.get("/api/counts", auth, wr(async (req, res) => {
  let query = supabase.from("counts")
    .select("*, outlets(name), users(username)")
    .order("period", { ascending: false });
  if (req.user.role !== "admin") query = query.eq("outlet_id", req.user.outlet_id);
  const { data } = await query;
  res.json((data || []).map((c) => ({
    ...c,
    outlet_name: c.outlets ? c.outlets.name : null,
    by_user: c.users ? c.users.username : null,
    outlets: undefined, users: undefined,
  })));
}));

app.get("/api/counts/current", auth, wr(async (req, res) => {
  const outlet_id = req.user.role === "admin" ? parseInt(req.query.outlet_id, 10) : req.user.outlet_id;
  const period = String(req.query.period || new Date().toISOString().slice(0, 7));
  if (!outlet_id) return res.status(400).json({ error: "Outlet required" });
  const { data: c } = await supabase.from("counts").select("*").eq("outlet_id", outlet_id).eq("period", period).eq("status", "open").maybeSingle();
  if (!c) return res.json(null);
  const { data: lines } = await supabase.from("count_lines").select("*").eq("count_id", c.id).order("id");
  res.json({ ...c, lines: lines || [] });
}));

app.post("/api/counts", auth, wr(async (req, res) => {
  const outlet_id = req.user.role === "admin" ? parseInt(req.body.outlet_id, 10) : req.user.outlet_id;
  const period = String(req.body.period || new Date().toISOString().slice(0, 7));
  if (!outlet_id) return res.status(400).json({ error: "Outlet required" });
  const counted_by = String(req.body.counted_by || "").trim() || null;
  let { data: c, error } = await supabase.from("counts").insert({ outlet_id, period, label: String(req.body.label || ""), created_by: req.user.id, counted_by }).select().single();
  if (error && error.message && error.message.includes("counted_by")) {
    // column not yet migrated — insert without it
    ({ data: c, error } = await supabase.from("counts").insert({ outlet_id, period, label: String(req.body.label || ""), created_by: req.user.id }).select().single());
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...c, lines: [] });
}));

app.get("/api/counts/:id", auth, wr(async (req, res) => {
  const { data: c } = await supabase.from("counts").select("*").eq("id", req.params.id).maybeSingle();
  if (!c) return res.status(404).json({ error: "Not found" });
  if (!canSeeCount(req.user, c)) return res.status(403).json({ error: "Forbidden" });
  const { data: lines } = await supabase.from("count_lines").select("*").eq("count_id", c.id).order("id");
  res.json({ ...c, lines: lines || [] });
}));

app.put("/api/counts/:id", auth, wr(async (req, res) => {
  const { data: c } = await supabase.from("counts").select("*").eq("id", req.params.id).maybeSingle();
  if (!c) return res.status(404).json({ error: "Not found" });
  if (!canSeeCount(req.user, c)) return res.status(403).json({ error: "Forbidden" });
  if (c.status !== "open") return res.status(400).json({ error: "Count is completed and locked" });

  const rawLines = Array.isArray(req.body.lines) ? req.body.lines : [];

  // Batch-fetch all reference data needed for line valuation
  const [{ data: allItems }, { data: allRecipes }, { data: allContainers }] = await Promise.all([
    supabase.from("items").select("name,base_unit,cost_per_base,price"),
    supabase.from("recipes").select("name,base_unit,cost_per_base"),
    supabase.from("containers").select("name,tare"),
  ]);
  const itemsMap = {};
  for (const it of allItems || []) itemsMap[it.name.toLowerCase()] = it;
  const recipesMap = {};
  for (const rc of allRecipes || []) recipesMap[rc.name.toLowerCase()] = rc;
  const containersMap = {};
  for (const ct of allContainers || []) containersMap[ct.name.toLowerCase()] = ct.tare;

  let sum = 0;
  const processedLines = [];
  for (const raw of rawLines) {
    if (!raw || !raw.ref_name) continue;
    const v = valueLine(raw, itemsMap, recipesMap, containersMap);
    processedLines.push({ count_id: c.id, ...v });
    sum += v.value;
  }

  const shouldComplete = req.body.complete === true;
  const countUpdate = { total_value: sum, updated_at: new Date().toISOString() };
  if (shouldComplete) countUpdate.status = "completed";

  await Promise.all([
    supabase.from("count_lines").delete().eq("count_id", c.id),
  ]);
  const [insertResult] = await Promise.all([
    processedLines.length ? supabase.from("count_lines").insert(processedLines) : Promise.resolve(),
    supabase.from("counts").update(countUpdate).eq("id", c.id),
  ]);

  // Return computed lines directly — no extra SELECT needed
  res.json({ ok: true, total_value: sum, status: shouldComplete ? "completed" : "open", lines: processedLines.map(({ count_id, ...l }) => l) });
}));

app.post("/api/counts/:id/complete", auth, wr(async (req, res) => {
  const { data: c } = await supabase.from("counts").select("*").eq("id", req.params.id).maybeSingle();
  if (!c || !canSeeCount(req.user, c)) return res.status(404).json({ error: "Not found" });
  await supabase.from("counts").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", c.id);
  res.json({ ok: true });
}));

app.post("/api/counts/:id/reopen", auth, adminOnly, wr(async (req, res) => {
  await supabase.from("counts").update({ status: "open" }).eq("id", req.params.id);
  res.json({ ok: true });
}));

app.delete("/api/counts/:id", auth, wr(async (req, res) => {
  const { data: c } = await supabase.from("counts").select("*").eq("id", req.params.id).maybeSingle();
  if (!c || !canSeeCount(req.user, c)) return res.status(403).json({ error: "Not found or forbidden" });
  await supabase.from("counts").delete().eq("id", req.params.id);
  res.json({ ok: true });
}));

app.get("/api/counts/:id/export", auth, wr(async (req, res) => {
  const { data: c } = await supabase.from("counts").select("*").eq("id", req.params.id).maybeSingle();
  if (!c || !canSeeCount(req.user, c)) return res.status(404).send("Not found");
  const out = await exportCount(c.id);
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.end(Buffer.from(out.buffer));
}));

/* ---- 404 + error handlers ---- */
app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

/* ---- static frontend ---- */
const PUB = path.join(__dirname, "..", "public");
app.use(express.static(PUB));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(PUB, "index.html")));

const PORT = process.env.PORT || 8080;
ensureAdmin()
  .then(() => app.listen(PORT, () => {
    console.log(`Mise running on http://localhost:${PORT}`);
    recomputeAllRecipeCosts()
      .then(() => console.log("[startup] recipe costs refreshed"))
      .catch((e) => console.error("[startup] cost refresh failed:", e.message));
    cleanEmptyCategories()
      .then(() => console.log("[startup] empty categories cleaned"))
      .catch((e) => console.error("[startup] category cleanup failed:", e.message));
  }))
  .catch((err) => { console.error("Startup failed:", err); process.exit(1); });
