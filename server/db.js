"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---- unit + costing helpers ---- */
function baseOf(unit) {
  const u = String(unit || "").toLowerCase();
  if (["kg", "g", "gram", "grams", "gm"].includes(u)) return "g";
  if (["l", "ltr", "litre", "liter", "ml"].includes(u)) return "ml";
  return "pc";
}
function factor(unit) {
  const u = String(unit || "").toLowerCase();
  return ["kg", "l", "ltr", "litre", "liter"].includes(u) ? 1000 : 1;
}
function itemCostPerBase(price, unit, packQty) {
  const denom = factor(unit) * (packQty || 1);
  return denom > 0 ? price / denom : 0;
}

async function resolveRecipeCost(recipeName, seen = new Set()) {
  if (seen.has(recipeName)) return 0;
  seen.add(recipeName);
  const { data: r } = await supabase.from("recipes").select("*").ilike("name", recipeName).maybeSingle();
  if (!r) return 0;
  const { data: lines } = await supabase.from("recipe_lines").select("*").eq("recipe_id", r.id);
  let total = 0;
  for (const ln of lines || []) {
    const { data: item } = await supabase.from("items").select("cost_per_base").ilike("name", ln.ingredient).maybeSingle();
    if (item) total += item.cost_per_base * ln.qty;
    else total += (await resolveRecipeCost(ln.ingredient, new Set(seen))) * ln.qty;
  }
  return r.yield_qty > 0 ? total / r.yield_qty : 0;
}

async function fetchAllRows(table, columns) {
  const PAGE = 1000;
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function recomputeAllRecipeCosts() {
  const [recipes, lines, items] = await Promise.all([
    fetchAllRows("recipes", "id, name, yield_qty"),
    fetchAllRows("recipe_lines", "recipe_id, ingredient, qty"),
    fetchAllRows("items", "name, cost_per_base"),
  ]);
  if (!recipes || !recipes.length) return;

  const itemCostMap = new Map();
  for (const it of items || []) itemCostMap.set(it.name.trim().toLowerCase(), it.cost_per_base || 0);

  const linesByRecipeId = new Map();
  for (const ln of lines || []) {
    if (!linesByRecipeId.has(ln.recipe_id)) linesByRecipeId.set(ln.recipe_id, []);
    linesByRecipeId.get(ln.recipe_id).push(ln);
  }
  const recipeByName = new Map();
  for (const r of recipes) recipeByName.set(r.name.trim().toLowerCase(), r);

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

  const updates = recipes.map((r) => ({ id: r.id, cost_per_base: resolve(r.name) }));
  for (let i = 0; i < updates.length; i += 50) {
    await Promise.all(updates.slice(i, i + 50).map((u) =>
      supabase.from("recipes").update({ cost_per_base: u.cost_per_base }).eq("id", u.id)
    ));
  }
  console.log(`[recomputeAllRecipeCosts] updated ${updates.length} recipes`);
}

async function cleanEmptyCategories() {
  const [{ data: cats }, { data: items }] = await Promise.all([
    supabase.from("categories").select("id, name"),
    supabase.from("items").select("category"),
  ]);
  const used = new Set((items || []).map((i) => i.category).filter(Boolean));
  const empty = (cats || []).filter((c) => !used.has(c.name));
  if (empty.length) {
    await supabase.from("categories").delete().in("id", empty.map((c) => c.id));
    console.log(`[cleanEmptyCategories] removed ${empty.length}: ${empty.map((c) => c.name).join(", ")}`);
  }
}

async function ensureAdmin() {
  const { count } = await supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "admin");
  if (count > 0) return;
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString("hex");
  const hash = bcrypt.hashSync(pw, 10);
  await supabase.from("users").insert({ username: "admin", password_hash: hash, role: "admin", name: "Administrator" });
  const msg = `\n========================================\n  MISE — initial admin login created\n  username: admin\n  password: ${pw}\n  (change it after first login)\n========================================\n`;
  console.log(msg);
  try { fs.writeFileSync(path.join(DATA_DIR, "ADMIN_CREDENTIALS.txt"), msg); } catch {}
}

module.exports = { supabase, baseOf, factor, itemCostPerBase, resolveRecipeCost, recomputeAllRecipeCosts, cleanEmptyCategories, ensureAdmin, DATA_DIR };
