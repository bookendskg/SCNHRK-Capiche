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

async function recomputeAllRecipeCosts() {
  const { data: recipes } = await supabase.from("recipes").select("name");
  for (const r of recipes || []) {
    const cpb = await resolveRecipeCost(r.name);
    await supabase.from("recipes").update({ cost_per_base: cpb }).ilike("name", r.name);
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

module.exports = { supabase, baseOf, factor, itemCostPerBase, resolveRecipeCost, recomputeAllRecipeCosts, ensureAdmin, DATA_DIR };
