"use strict";
/* ============================ Mise SPA ============================ */
const $ = (id) => document.getElementById(id);

/* ============================ Theme ============================ */
function initTheme() {
  const t = localStorage.getItem("mise-theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("mise-theme", next);
  document.querySelector('meta[name="theme-color"]').content = next === "light" ? "#f1f5f9" : "#020617";
}
const app = $("app");
const S = { me: null, catalog: { items: [], recipes: [], containers: [] }, nav: "count" };

const api = async (url, opts = {}) => {
  const res = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401 && !opts.noAuthRedirect) { S.me = null; renderLogin(); throw new Error("unauth"); }
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || "Request failed");
  return body;
};
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inr = (n) => "₹" + (Math.round((+n + Number.EPSILON) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = (n) => "₹" + Math.round(+n || 0).toLocaleString("en-IN");
const qf = (n) => (Math.round((+n + Number.EPSILON) * 100) / 100).toLocaleString("en-IN");
const thisPeriod = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const dispDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
const monthName = (period) => { const [y, m] = String(period || "").split("-"); if (!y || !m) return period || ""; return new Date(+y, +m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }); };
const countTitle = (c) => (c && c.label && /^\d{4}-\d{2}-\d{2}$/.test(c.label)) ? dispDate(c.label) : monthName(c && c.period);
function parseManualDate(s) {
  s = (s || "").trim();
  let m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/); // DD-MM-YYYY
  if (m) { const d = +m[1], mo = +m[2], y = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; return null; }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // YYYY-MM-DD
  if (m) { const y = +m[1], mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  return null;
}
let toastT;
const toast = (msg, bad) => {
  let t = $("toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.className = "fixed left-1/2 bottom-5 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-sm shadow-xl border pop-in " + (bad ? "bg-red-950 border-red-800 text-red-200" : "bg-emerald-950 border-emerald-800 text-emerald-200");
  t.textContent = (bad ? "⚠️ " : "✅ ") + msg; t.style.display = "block";
  clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = "none"), 2400);
};

const I = {
  scan: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8"/></svg>',
  cam: '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  x: '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  down: '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  plus: '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
};

/* ============================ Login ============================ */
function renderLogin() {
  app.innerHTML = `
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-sm fadein">
      <div class="flex items-center gap-2 justify-center mb-8">
        <div class="w-10 h-10 rounded-xl grad-logo flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-pink-500/10">M</div>
        <div><div class="text-2xl font-semibold leading-none">Mise</div><div class="text-xs text-slate-500">Month-end stock count 📦</div></div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div><label class="text-xs uppercase tracking-wide text-slate-400">Username</label>
          <input id="lu" autocomplete="username" class="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500/40"></div>
        <div><label class="text-xs uppercase tracking-wide text-slate-400">Password</label>
          <input id="lp" type="password" autocomplete="current-password" class="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500/40"></div>
        <div id="lerr" class="text-sm text-red-400 hidden"></div>
        <button id="lbtn" class="btn-pop w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg py-2.5">Sign in</button>
      </div>
      <p class="text-center text-xs text-slate-600 mt-4">Outlet managers use the login your admin gave you.</p>
    </div>
  </div>`;
  const go = async () => {
    const u = $("lu").value.trim(), p = $("lp").value;
    const el = $("lerr");
    const showErr = (m) => { el.textContent = m; el.classList.remove("hidden"); };
    el.classList.add("hidden");
    if (!u || !p) return showErr("Enter correct credentials, Capicheeee");
    try {
      const r = await api("/api/login", { method: "POST", noAuthRedirect: true, body: JSON.stringify({ username: u, password: p }) });
      S.me = r.user; await boot();
    } catch (e) { showErr("Enter correct credentials, Capicheeee"); }
  };
  $("lbtn").onclick = go;
  $("lp").onkeydown = (e) => { if (e.key === "Enter") go(); };
  $("lu").focus();
}

/* ============================ Shell ============================ */
function shell(content) {
  const admin = S.me.role === "admin";
  const tabs = admin
    ? [["count", "🧮", "Stock taking"], ["counts", "🗂️", "Saved counts"], ["masters", "📚", "Masters"], ["barcodes", "🔖", "Barcodes"], ["outlets", "🏬", "Outlets & logins"], ["settings", "⚙️", "Settings"]]
    : [["count", "🧮", "Stock taking"], ["counts", "🗂️", "My counts"], ["settings", "⚙️", "Settings"]];
  const navHtml = tabs.map(([id, emoji, label]) =>
    `<button data-nav="${id}" title="${label}" class="btn-pop px-3 py-2 rounded-lg text-sm whitespace-nowrap ${S.nav === id ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30" : "text-slate-400 hover:bg-slate-800"}">${emoji}<span class="hidden sm:inline"> ${label}</span></button>`).join("");
  app.innerHTML = `
  <div class="min-h-screen">
    <header class="sticky top-0 z-30 bg-slate-900/90 backdrop-blur border-b border-slate-800">
      <div class="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg grad-logo flex items-center justify-center text-white font-bold text-sm shadow-md shadow-pink-500/10">M</div><span class="font-semibold">Mise</span></div>
        <div class="flex items-center gap-3 text-sm">
          <span class="hidden sm:inline text-slate-400 max-w-[8rem] truncate">${esc(S.me.name || S.me.username)}</span>
          <span class="text-[10px] px-2 py-0.5 rounded ${admin ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}">${admin ? "Admin" : "Manager"}</span>
          <button id="theme-toggle" title="Toggle light/dark" class="w-8 h-8 flex items-center justify-center rounded-lg text-base hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors">${document.documentElement.getAttribute("data-theme") === "light" ? "☀️" : "🌙"}</button>
          <button id="logout" class="text-slate-500 hover:text-slate-300 text-sm">Sign out</button>
        </div>
      </div>
      <nav class="max-w-3xl mx-auto px-3 pb-2 flex gap-1.5 overflow-x-auto">${navHtml}</nav>
    </header>
    <main class="max-w-3xl mx-auto px-4 py-5 fadein">${content}</main>
  </div>`;
  app.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => { S.nav = b.dataset.nav; route(); }));
  $("logout").onclick = async () => { await api("/api/logout", { method: "POST" }); S.me = null; renderLogin(); };
  $("theme-toggle").onclick = () => { toggleTheme(); $("theme-toggle").textContent = document.documentElement.getAttribute("data-theme") === "light" ? "☀️" : "🌙"; };
}

async function boot() {
  try { const me = await api("/api/me"); S.me = me.user; }
  catch { return renderLogin(); }
  try { S.catalog = await api("/api/catalog"); } catch {}
  if (S.me.role !== "admin") S.nav = "count";
  route();
}
function route() {
  if (S.nav === "count") return renderCount();
  if (S.nav === "counts") return renderCountsList();
  if (S.nav === "masters") return renderMasters();
  if (S.nav === "barcodes") return renderBarcodes();
  if (S.nav === "outlets") return renderOutlets();
  if (S.nav === "settings") return renderSettings();
}

/* ============================ Stock taking ============================ */
const CT = { current: null, lines: [], computed: [], addKind: "unopened" };
const KIND_STYLE = {
  unopened: { emoji: "📦", active: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30", text: "text-sky-300" },
  opened: { emoji: "🥣", active: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30", text: "text-violet-300" },
  processed: { emoji: "🍲", active: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30", text: "text-emerald-300" },
  notinmaster: { emoji: "❓", active: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30", text: "text-rose-300" },
};
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  $("savestate") && ($("savestate").textContent = "Saving…");
  saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  if (!CT.current) return;
  try {
    const r = await api("/api/counts/" + CT.current.id, { method: "PUT", body: JSON.stringify({ lines: CT.lines }) });
    CT.computed = r.lines; CT.current.total_value = r.total_value;
    $("savestate") && ($("savestate").textContent = "Saved");
    renderCountTotals();
  } catch (e) { $("savestate") && ($("savestate").textContent = "Save failed"); toast(e.message, true); }
}

async function renderCount() {
  const admin = S.me.role === "admin";
  let outlets = [];
  try { outlets = await api("/api/outlets"); } catch {}
  const outletPicker = admin
    ? `<select id="cf-outlet" class="w-full sm:w-auto bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select>`
    : `<span class="px-3 py-2 text-sm text-slate-200">${esc(S.me.outlet_name || "Your outlet")}</span>`;
  if (!admin && !S.me.outlet_id) {
    return shell(`<div class="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-400">Your login isn't linked to an outlet yet. Ask your admin to assign one.</div>`);
  }
  shell(`
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
      <div class="text-sm font-medium mb-3">Start or resume a count</div>
      <div class="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-2">
        <div class="flex flex-col w-full sm:w-auto"><label class="text-[11px] text-slate-400 mb-0.5">Outlet</label>${outletPicker}</div>
        <div class="flex flex-col w-full sm:w-auto">
          <label class="text-[11px] text-teal-400 mb-0.5">Count date <span class="text-slate-500 font-normal">— type it, or tap 📅</span></label>
          <div class="relative flex items-center">
            <input id="cf-date-text" type="text" inputmode="numeric" placeholder="DD-MM-YYYY" value="${dispDate(today())}"
              class="w-full sm:w-40 bg-slate-950 border-2 border-teal-500/70 focus:border-teal-400 focus:outline-none rounded-lg pl-3 pr-10 py-2 text-sm text-teal-200 placeholder:text-teal-700/70">
            <div class="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md bg-fuchsia-500/20 flex items-center justify-center text-sm pointer-events-none">📅</div>
            <input id="cf-date" type="date" value="${today()}"
              class="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 opacity-0 cursor-pointer">
          </div>
        </div>
        <button id="cf-go" class="btn-pop w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg px-4 py-2 text-sm">Start count</button>
      </div>
      <div id="cf-date-err" class="text-xs text-rose-400 mt-1.5 hidden">Hmm, that doesn't look like a valid date — try DD-MM-YYYY.</div>
      <p class="text-xs text-slate-500 mt-2">Counts auto-save and are filed by month. Pick any date in the same month to pick up where you left off.</p>
    </div>
    <div id="count-area"></div>`);
  const syncFromManual = () => {
    const parsed = parseManualDate($("cf-date-text").value);
    const ok = !!parsed;
    $("cf-date-text").classList.toggle("border-rose-500", !ok);
    $("cf-date-err").classList.toggle("hidden", ok);
    if (ok) $("cf-date").value = parsed;
    return ok;
  };
  const syncFromCalendar = () => { $("cf-date-text").value = dispDate($("cf-date").value); $("cf-date-text").classList.remove("border-rose-500"); $("cf-date-err").classList.add("hidden"); };
  $("cf-date-text").onchange = syncFromManual;
  $("cf-date-text").onkeydown = (e) => { if (e.key === "Enter") syncFromManual(); };
  $("cf-date").onchange = syncFromCalendar;
  $("cf-go").onclick = () => { if (syncFromManual()) openCount(); else toast("Enter a valid date (DD-MM-YYYY)", true); };
}

async function openCount() {
  const admin = S.me.role === "admin";
  const outlet_id = admin ? parseInt($("cf-outlet").value, 10) : S.me.outlet_id;
  const dateVal = ($("cf-date") && $("cf-date").value) || today();
  const period = (dateVal || "").slice(0, 7) || thisPeriod();
  try {
    const c = await api("/api/counts", { method: "POST", body: JSON.stringify({ outlet_id, period, label: dateVal }) });
    CT.current = c; CT.computed = c.lines || [];
    CT.lines = (c.lines || []).map((l) => ({ kind: l.kind, ref_name: l.ref_name, container_name: l.container_name, qty: (l.in_qty != null ? l.in_qty : l.qty), unit: l.in_unit || undefined, note: l.note }));
    if (c.status === "completed") { renderCompletedCount(c); return; }
    renderCountWorkspace();
  } catch (e) { toast(e.message, true); }
}

function renderCompletedCount(c) {
  $("count-area").innerHTML = `<div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
    <div class="flex items-center justify-between mb-2"><div class="font-medium">${esc(countTitle(c))} — completed</div>
      <a href="/api/counts/${c.id}/export" class="text-sm text-amber-300">Export Excel</a></div>
    <div class="text-sm text-slate-400">This count is completed and locked. Total ${inr(c.total_value)}.</div>
    ${S.me.role === "admin" ? `<button id="reopen" class="mt-3 text-xs text-slate-300 underline">Reopen for editing</button>` : ""}
  </div>`;
  if ($("reopen")) $("reopen").onclick = async () => { await api("/api/counts/" + c.id + "/reopen", { method: "POST" }); openCount(); };
}

function renderCountWorkspace() {
  const c = CT.current;
  $("count-area").innerHTML = `
    <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-4">
      <div class="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div><div class="font-medium">${esc(countTitle(c))} count</div><div id="savestate" class="text-[11px] text-slate-500">Saved</div></div>
        <div class="text-right"><div class="text-[11px] text-slate-500 uppercase">Total</div><div id="ct-total" class="text-lg font-semibold text-amber-300 num">${inr(c.total_value || 0)}</div></div>
      </div>
      <div class="p-3">
        <div class="flex gap-1.5 mb-3 overflow-x-auto">
          ${[["unopened", "Unopened (scan)"], ["opened", "Opened"], ["processed", "Processed / recipe"], ["notinmaster", "Not in master"]]
            .map(([k, l]) => `<button data-kind="${k}" class="addtab btn-pop px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${CT.addKind === k ? KIND_STYLE[k].active : "bg-slate-800 text-slate-300"}">${KIND_STYLE[k].emoji} ${l}</button>`).join("")}
        </div>
        <div id="add-panel"></div>
      </div>
    </div>
    <div id="lines-wrap"></div>
    <div class="flex gap-2 mt-4">
      <a href="/api/counts/${c.id}/export" class="btn-pop flex-1 text-center bg-slate-800 hover:bg-slate-700 rounded-lg py-2.5 text-sm">${I.down} <span class="align-middle">Export Excel</span></a>
      <button id="complete" class="btn-pop flex-1 bg-emerald-600 hover:bg-emerald-500 rounded-lg py-2.5 text-sm">🎉 Mark complete</button>
    </div>`;
  app.querySelectorAll(".addtab").forEach((b) => (b.onclick = () => { CT.addKind = b.dataset.kind; renderCountWorkspace(); }));
  $("complete").onclick = async () => {
    await saveNow(); await api("/api/counts/" + c.id + "/complete", { method: "POST" });
    toast("Count marked complete"); openCount();
  };
  renderAddPanel(); renderLines();
}

function renderCountTotals() { if ($("ct-total")) $("ct-total").textContent = inr(CT.current.total_value || 0); }

function searchBox(id, placeholder, pool, onPick) {
  // pool: [{name, sub}]
  setTimeout(() => {
    const input = $(id), list = $(id + "-list");
    if (!input) return;
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const res = (q ? pool.filter((p) => p.name.toLowerCase().includes(q)) : pool).slice(0, 8);
      list.innerHTML = res.map((p) => `<button data-name="${esc(p.name)}" class="opt w-full text-left px-3 py-2 hover:bg-slate-800 text-sm flex justify-between"><span>${esc(p.name)}</span><span class="text-slate-500 text-xs">${esc(p.sub || "")}</span></button>`).join("") || `<div class="px-3 py-2 text-sm text-slate-500">No match</div>`;
      list.classList.toggle("hidden", !input.value);
      list.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { input.value = b.dataset.name; list.classList.add("hidden"); onPick(b.dataset.name); }));
    };
    input.oninput = draw; input.onfocus = draw;
    input.onblur = () => setTimeout(() => list.classList.add("hidden"), 200);
  }, 0);
  return `<div class="relative"><input id="${id}" autocomplete="off" placeholder="${placeholder}" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500/40">
    <div id="${id}-list" class="hidden absolute z-20 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-xl max-h-64 overflow-y-auto"></div></div>`;
}

function containerSelect(id) {
  return `<select id="${id}" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5">
    <option value="">— direct (no container) —</option>
    ${S.catalog.containers.map((c) => `<option value="${esc(c.name)}" data-tare="${c.tare}">${esc(c.name)} (tare ${c.tare})</option>`).join("")}</select>`;
}

const UNIT_OPTS = [["kg", "Kg"], ["g", "Grams"], ["ml", "Ml"], ["ltr", "Ltr"], ["pcs", "Pcs"], ["qty", "Qty"]];
const PACK_OPT = ["pack", "Pack"];
function unitSelect(id, def, cls, opts) {
  opts = opts || UNIT_OPTS;
  const defVal = def || opts[0][0];
  return `<select ${id ? `id="${id}"` : ""} class="${cls || ""} bg-slate-950 border border-slate-700 rounded-lg px-2 py-2.5">
    ${opts.map(([v, l]) => `<option value="${v}" ${v === defVal ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}
function baseUnitOf(name) {
  const it = S.catalog.items.find((i) => i.name.toLowerCase() === String(name || "").toLowerCase());
  if (it) return it.base_unit;
  const r = S.catalog.recipes.find((x) => x.name.toLowerCase() === String(name || "").toLowerCase());
  return r ? r.base_unit : "g";
}
const unitDropdownDefault = (base) => (base === "pc" ? "pcs" : base);
const factorJS = (u) => { u = String(u || "").toLowerCase(); return (u === "kg" || u === "l" || u === "ltr" || u === "litre" || u === "liter") ? 1000 : 1; };
const costOf = (name) => {
  const n = String(name || "").toLowerCase();
  const it = S.catalog.items.find((i) => i.name.toLowerCase() === n); if (it) return it.cost_per_base;
  const r = S.catalog.recipes.find((x) => x.name.toLowerCase() === n); return r ? r.cost_per_base : null;
};
function mImport(type) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".xlsx,.xls";
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      const r = await fetch("/api/masters/" + type + "/import", { method: "POST", body: fd, credentials: "same-origin" });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Import failed");
      S.catalog = await api("/api/catalog");
      toast(`Imported ${d.count} ${type}` + (d.warnings && d.warnings.length ? ` · ${d.warnings.length} warning(s)` : ""));
      if (d.warnings && d.warnings.length) alert("Import warnings:\n\n" + d.warnings.join("\n"));
      route();
    } catch (e) { toast(e.message, true); }
  };
  inp.click();
}
const ieButtons = (type) => `<div class="flex gap-2">
  <a href="/api/masters/${type}/export" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 text-xs">${I.down} <span class="align-middle">Export</span></a>
  <button data-imp="${type}" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 text-xs">Import</button></div>`;
function wireImports() { app.querySelectorAll("[data-imp]").forEach((b) => (b.onclick = () => mImport(b.dataset.imp))); }

function addLine(line) {
  if (!line.ref_name) { toast("Pick or type a product", true); return; }
  CT.lines.push(line); renderLines(); scheduleSave(); toast("Added to count");
}

function renderAddPanel() {
  const p = $("add-panel"); const k = CT.addKind;
  const itemsPool = S.catalog.items.map((i) => ({ name: i.name, sub: i.category || i.unit }));
  const procPool = [...S.catalog.recipes.map((r) => ({ name: r.name, sub: "recipe" })), ...S.catalog.items.map((i) => ({ name: i.name, sub: "item" }))];

  if (k === "unopened") {
    p.innerHTML = `
      <div class="space-y-3">
        <div class="flex gap-2"><div class="relative flex-1">
          <input id="bc" placeholder="Scan or type barcode" class="w-full bg-slate-950 border border-slate-700 rounded-lg pl-3 pr-3 py-2.5 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40">
        </div><button id="bc-cam" class="bg-slate-800 px-3 rounded-lg">${I.cam}</button></div>
        <div id="bc-video"></div>
        <div id="bc-match" class="text-sm text-slate-400">Or search by name:</div>
        ${searchBox("u-name", "Item name", itemsPool, () => updUNet())}
        <div><label class="text-xs text-slate-400">Quantity</label>
          <div class="flex gap-2">
            <input id="u-qty" type="number" inputmode="decimal" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5">
            ${unitSelect("u-unit", "pack", "", [PACK_OPT, ...UNIT_OPTS])}
            <button id="u-add" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg px-4 py-2.5">${I.plus}</button>
          </div>
          <div id="u-net" class="text-xs text-slate-500 mt-1"></div>
        </div>
      </div>`;
    const updUNet = () => {
      const el = $("u-net"); if (!el) return;
      const q = parseFloat($("u-qty").value) || 0, u = $("u-unit").value;
      if (u === "pack") { el.textContent = "Valued at pack price × quantity"; return; }
      const baseU = baseUnitOf($("u-name").value);
      el.textContent = (u === "kg" || u === "ltr") ? `= ${qf(q * factorJS(u))} ${baseU} · valued at unit cost` : "Valued at unit cost";
    };
    const onBarcode = (code) => {
      const it = S.catalog.items.find((i) => (i.barcode || "") === code.trim());
      if (it) { $("u-name").value = it.name; $("bc-match").innerHTML = `<span class="text-emerald-400">Matched: ${esc(it.name)}</span>`; $("u-qty").focus(); }
      else $("bc-match").innerHTML = `<span class="text-amber-400">No item with barcode ${esc(code)} — search by name or use "Not in master".</span>`;
    };
    $("bc").onkeydown = (e) => { if (e.key === "Enter" && $("bc").value.trim()) { onBarcode($("bc").value); $("bc").value = ""; } };
    $("bc-cam").onclick = () => startCamera($("bc-video"), (code) => onBarcode(code));
    $("u-qty").oninput = updUNet; $("u-unit").onchange = updUNet; updUNet();
    $("u-add").onclick = () => { addLine({ kind: "unopened", ref_name: $("u-name").value.trim(), qty: parseFloat($("u-qty").value) || 0, unit: $("u-unit").value }); $("u-name").value = ""; $("u-qty").value = ""; $("u-unit").value = "pack"; updUNet(); };
    return;
  }
  if (k === "opened" || k === "processed") {
    const pool = k === "opened" ? itemsPool : procPool;
    const updNet = () => {
      const el = $(k + "-net"); if (!el) return;
      const cont = $(k + "-cont"); const hasC = cont.value;
      const q = parseFloat(($(k + "-qty") || {}).value) || 0;
      const u = (($(k + "-unit") || {}).value) || "g";
      const base = q * factorJS(u);
      const baseU = baseUnitOf($(k + "-name").value);
      if (hasC) {
        const tare = parseFloat(cont.selectedOptions[0].dataset.tare) || 0;
        el.textContent = `Container tare ${tare} → net ${qf(Math.max(0, base - tare))} ${baseU}`;
      } else el.textContent = (u === "kg" || u === "ltr") ? `= ${qf(base)} ${baseU}` : "";
    };
    const setUnitDefault = (nm) => { const us = $(k + "-unit"); if (us) us.value = unitDropdownDefault(baseUnitOf(nm)); updNet(); };
    p.innerHTML = `
      <div class="space-y-3">
        ${searchBox(k + "-name", k === "opened" ? "Search opened item" : "Search recipe or item", pool, setUnitDefault)}
        <div><label class="text-xs text-slate-400">Stored in</label>${containerSelect(k + "-cont")}</div>
        <div id="${k}-qtywrap"></div>
        <button id="${k}-add" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg px-4 py-2.5">${I.plus} <span class="align-middle">Add to count</span></button>
      </div>`;
    const drawQty = () => {
      const hasC = $(k + "-cont").value;
      const def = unitDropdownDefault(baseUnitOf($(k + "-name").value));
      $(k + "-qtywrap").innerHTML = `
        <label class="text-xs text-slate-400">${hasC ? "Gross weight (item + container)" : "Quantity"}</label>
        <div class="flex gap-2">
          <input id="${k}-qty" type="number" inputmode="decimal" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5">
          ${unitSelect(k + "-unit", def)}
        </div>
        <div id="${k}-net" class="text-xs text-slate-500 mt-1"></div>`;
      $(k + "-qty").oninput = updNet; $(k + "-unit").onchange = updNet; updNet();
    };
    $(k + "-cont").onchange = drawQty; drawQty();
    $(k + "-add").onclick = () => {
      const cont = $(k + "-cont").value;
      addLine({ kind: k, ref_name: $(k + "-name").value.trim(), container_name: cont || null, qty: parseFloat($(k + "-qty").value) || 0, unit: $(k + "-unit").value });
      $(k + "-name").value = ""; $(k + "-cont").value = ""; drawQty();
    };
    return;
  }
  // not in master
  p.innerHTML = `
    <div class="space-y-3">
      <div class="text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">For items on the shelf that aren't in the master. Captured with no value and flagged for Admin.</div>
      <input id="n-name" placeholder="Item name (as you see it)" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5">
      <div><label class="text-xs text-slate-400">Stored in</label>${containerSelect("n-cont")}</div>
      <div id="n-qtywrap"></div>
      <input id="n-note" placeholder="Note for admin (optional)" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm">
      <button id="n-add" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg px-4 py-2.5">${I.plus} <span class="align-middle">Add flagged item</span></button>
    </div>`;
  const drawQ = () => {
    const hasC = $("n-cont").value;
    $("n-qtywrap").innerHTML = `
      <label class="text-xs text-slate-400">${hasC ? "Gross weight (item + container)" : "Quantity"}</label>
      <div class="flex gap-2">
        <input id="n-qty" type="number" inputmode="decimal" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5">
        ${unitSelect("n-unit", "g")}
      </div>`;
  };
  $("n-cont").onchange = drawQ; drawQ();
  $("n-add").onclick = () => {
    const cont = $("n-cont").value;
    addLine({ kind: "notinmaster", ref_name: $("n-name").value.trim(), container_name: cont || null, qty: parseFloat($("n-qty").value) || 0, unit: $("n-unit").value, note: $("n-note").value.trim() });
    $("n-name").value = ""; $("n-note").value = ""; $("n-cont").value = ""; drawQ();
  };
}

function renderLines() {
  const wrap = $("lines-wrap"); if (!wrap) return;
  if (!CT.lines.length) { wrap.innerHTML = `<div class="text-center text-slate-600 text-sm py-8">No lines yet. Add items above.</div>`; return; }
  const kindLabel = { unopened: "Unopened", opened: "Opened", processed: "Processed", notinmaster: "Not in master" };
  wrap.innerHTML = `<div class="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
    ${CT.lines.map((l, i) => {
      const cp = CT.computed[i] || {};
      const inU = cp.in_unit, inQ = cp.in_qty;
      const ks = KIND_STYLE[l.kind] || KIND_STYLE.unopened;
      let detail;
      if (l.container_name) {
        detail = `${esc(l.container_name)} · gross ${qf(inQ != null ? inQ : 0)} ${esc(inU || "")} → net ${qf(cp.qty || 0)} ${esc(cp.unit || "")}`;
      } else if (l.kind === "unopened" && (!inU || inU === "pack")) {
        detail = `${qf(cp.qty != null ? cp.qty : l.qty || 0)} pack(s)`;
      } else if (inU && inQ != null) {
        const conv = cp.unit && String(inU).toLowerCase() !== String(cp.unit).toLowerCase();
        detail = conv ? `${qf(inQ)} ${esc(inU)} → ${qf(cp.qty)} ${esc(cp.unit)}` : `${qf(inQ)} ${esc(inU)}`;
      } else {
        detail = `${qf(cp.qty != null ? cp.qty : l.qty || 0)} ${esc(cp.unit || l.unit || "")}`;
      }
      return `<div class="flex items-center justify-between px-3 py-2.5">
        <div class="min-w-0"><div class="text-sm text-slate-100 truncate">${esc(l.ref_name)} <span class="text-[10px] ${ks.text}">${ks.emoji} ${kindLabel[l.kind]}</span></div>
          <div class="text-xs text-slate-500 truncate">${detail}</div></div>
        <div class="flex items-center gap-3 shrink-0">
          <div class="text-sm num ${l.kind === "notinmaster" ? "text-slate-600" : "text-amber-300"}">${l.kind === "notinmaster" ? "—" : inr(cp.value || 0)}</div>
          <button data-del="${i}" class="text-slate-600 hover:text-red-400">${I.trash}</button></div>
      </div>`;
    }).join("")}</div>`;
  wrap.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { CT.lines.splice(+b.dataset.del, 1); renderLines(); scheduleSave(); }));
}

async function startCamera(container, onCode) {
  if (!("BarcodeDetector" in window)) { container.innerHTML = `<div class="text-xs text-amber-400">Camera scanning isn't supported in this browser — type the barcode instead.</div>`; return; }
  container.innerHTML = `<video autoplay muted playsinline class="w-full rounded-lg border border-slate-700 max-h-56 object-cover"></video><button id="cam-stop" class="text-xs text-slate-400 mt-1">Stop camera</button>`;
  const video = container.querySelector("video");
  let stream, raf, stop = false;
  try {
    const det = new window.BarcodeDetector();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream; await video.play();
    const tick = async () => {
      if (stop) return;
      try { const codes = await det.detect(video); if (codes[0]) { onCode(codes[0].rawValue); cleanup(); return; } } catch {}
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch { container.innerHTML = `<div class="text-xs text-amber-400">Couldn't open the camera. Type the barcode instead.</div>`; }
  function cleanup() { stop = true; cancelAnimationFrame(raf); stream && stream.getTracks().forEach((t) => t.stop()); container.innerHTML = ""; }
  const sb = container.querySelector("#cam-stop"); if (sb) sb.onclick = cleanup;
}

/* ============================ Saved counts ============================ */
async function renderCountsList() {
  let rows = []; try { rows = await api("/api/counts"); } catch {}
  const admin = S.me.role === "admin";
  shell(`<div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm min-w-[480px]"><thead class="bg-slate-950/50 text-slate-400 text-xs uppercase">
      <tr><th class="text-left px-3 py-2">Date</th><th class="text-left px-3 py-2">Outlet</th><th class="text-left px-3 py-2">Status</th><th class="text-right px-3 py-2">Total</th><th></th></tr></thead>
    <tbody class="divide-y divide-slate-800">
    ${rows.map((c) => `<tr>
      <td class="px-3 py-2">${esc(countTitle(c))}</td><td class="px-3 py-2 text-slate-300">${esc(c.outlet_name)}</td>
      <td class="px-3 py-2">${c.status === "completed" ? '<span class="text-emerald-400">Completed</span>' : '<span class="text-amber-400">Open</span>'}</td>
      <td class="px-3 py-2 text-right num">${inr(c.total_value)}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button data-cont="${c.id}" data-outlet="${c.outlet_id}" data-period="${esc(c.period)}" class="text-emerald-300 hover:text-emerald-200 text-xs">Continue</button>
        <a href="/api/counts/${c.id}/export" class="text-amber-300 text-xs ml-3">Export</a>
        ${admin ? `<button data-del="${c.id}" class="text-slate-600 hover:text-red-400 text-xs ml-3">Delete</button>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="5" class="px-3 py-8 text-center text-slate-500">No counts yet.</td></tr>`}
    </tbody></table></div></div>`);
  app.querySelectorAll("[data-cont]").forEach((b) => (b.onclick = () => continueCount(parseInt(b.dataset.outlet, 10), b.dataset.period)));
  app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this count permanently?")) return;
    await api("/api/counts/" + b.dataset.del, { method: "DELETE" }); toast("Deleted"); renderCountsList();
  }));
}

async function continueCount(outlet_id, period) {
  S.nav = "count";
  await renderCount();
  const op = $("cf-outlet"); if (op && outlet_id) op.value = String(outlet_id);
  const pp = $("cf-date"); if (pp && period) { pp.value = period + "-01"; const pm = $("cf-date-text"); if (pm) pm.value = dispDate(pp.value); }
  openCount();
}

/* ============================ Admin: Upload ============================ */
function renderUpload() {
  shell(`
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div class="text-sm font-medium">Upload master data</div>
      <p class="text-sm text-slate-400">Download the template, fill the Items, Categories, Containers and Recipes tabs, then upload it here. Uploading replaces the current masters. Counts already saved keep their own values.</p>
      <div class="flex flex-wrap gap-2">
        <a href="/api/masters/template" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-2 text-sm">${I.down} <span class="align-middle">Download template</span></a>
        <a href="/api/masters/export" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-2 text-sm">${I.down} <span class="align-middle">Export current masters</span></a>
      </div>
      <div class="border-2 border-dashed border-slate-700 rounded-xl p-6 text-center">
        <input id="file" type="file" accept=".xlsx,.xls" class="hidden">
        <button id="pick" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg px-4 py-2 text-sm">Choose Excel file</button>
        <div id="fname" class="text-sm text-slate-500 mt-2">No file selected</div>
      </div>
      <div id="upres"></div>
    </div>`);
  $("pick").onclick = () => $("file").click();
  $("file").onchange = async () => {
    const f = $("file").files[0]; if (!f) return;
    $("fname").textContent = f.name;
    const fd = new FormData(); fd.append("file", f);
    try {
      const r = await fetch("/api/masters/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      S.catalog = await api("/api/catalog");
      $("upres").innerHTML = `<div class="bg-emerald-500/10 text-emerald-300 rounded-lg p-3 text-sm">Imported ${data.nItems} items, ${data.nCat} categories, ${data.nCont} containers, ${data.nRec} recipes.</div>
        ${data.warnings && data.warnings.length ? `<div class="bg-amber-500/10 text-amber-300 rounded-lg p-3 text-sm mt-2"><div class="font-medium mb-1">Warnings</div>${data.warnings.map((w) => `<div>• ${esc(w)}</div>`).join("")}</div>` : ""}`;
      toast("Masters updated");
    } catch (e) { $("upres").innerHTML = `<div class="bg-red-500/10 text-red-300 rounded-lg p-3 text-sm">${esc(e.message)}</div>`; }
  };
}

/* ============================ Admin: Masters view ============================ */
async function renderMasters() {
  let m; try { m = await api("/api/masters"); } catch (e) { return shell(`<div class="text-slate-400">${esc(e.message)}</div>`); }
  const card = (title, count, io, body) => `<div class="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
    <div class="flex items-center justify-between mb-3"><div class="text-sm font-medium">${title} <span class="text-slate-500">(${count})</span></div>${io}</div>${body}</div>`;
  const tbl = (head, rows) => `<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="text-slate-400 text-xs uppercase"><tr>${head.map((h) => `<th class="text-left px-2 py-1.5">${h}</th>`).join("")}</tr></thead>
    <tbody class="divide-y divide-slate-800">${rows || `<tr><td class="px-2 py-4 text-slate-500" colspan="${head.length}">Empty — add below or import.</td></tr>`}</tbody></table></div>`;

  const ings = [...m.items.map((i) => i.name), ...m.recipes.map((r) => r.name)];

  shell(`
    <p class="text-sm text-slate-400 mb-4">Each master has its own Excel <b>Export</b> and <b>Import</b>. Importing replaces that master (Barcodes only updates barcodes on matching items).</p>

    ${card("Items", m.items.length, ieButtons("items"),
      tbl(["Name", "Category", "Unit", "Pack", "Price", "Cost/base", "Barcode", ""],
        m.items.map((i) => `<tr><td class="px-2 py-1.5">${esc(i.name)}</td><td class="px-2 py-1.5 text-slate-400">${esc(i.category)}</td><td class="px-2 py-1.5">${esc(i.unit)}</td><td class="px-2 py-1.5 num">${i.pack_qty}</td><td class="px-2 py-1.5 num">${inr(i.price)}</td><td class="px-2 py-1.5 num text-amber-300">${inr(i.cost_per_base)}/${esc(i.base_unit)}</td><td class="px-2 py-1.5 font-mono text-xs">${esc(i.barcode)}</td><td class="px-2 py-1.5 text-right whitespace-nowrap"><button data-itemedit='${esc(JSON.stringify(i))}' class="text-amber-300 text-xs">Edit</button><button data-itemdel="${i.id}" class="text-slate-600 hover:text-red-400 text-xs ml-2">Del</button></td></tr>`).join("")) +
      `<div class="mt-3 border-t border-slate-800 pt-3">
        <div id="it-mode" class="text-xs text-amber-300 mb-2">Add a new item</div>
        <datalist id="it-cats">${m.categories.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>
        <div class="grid sm:grid-cols-3 gap-2 mb-2">
          <input id="it-name" placeholder="Name" class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm">
          <input id="it-cat" list="it-cats" placeholder="Category" class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm">
          <select id="it-unit" class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm">${["kg", "g", "l", "ml", "piece"].map((u) => `<option value="${u}">${u}</option>`).join("")}</select>
          <input id="it-pack" type="number" inputmode="decimal" placeholder="Pack qty (units per pack)" class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm">
          <input id="it-price" type="number" inputmode="decimal" placeholder="Price per pack" class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm">
          <input id="it-bc" placeholder="Barcode (optional)" class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm">
        </div>
        <div class="flex gap-2"><button id="it-save" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg px-4 py-1.5 text-sm">Save item</button><button id="it-clear" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 text-sm">Clear</button></div>
      </div>`)}

    ${card("Recipes", m.recipes.length, ieButtons("recipes"),
      tbl(["Recipe", "Yield", "Cost/unit", "Ingredients", ""],
        m.recipes.map((r) => `<tr><td class="px-2 py-1.5">${esc(r.name)}</td><td class="px-2 py-1.5 num">${qf(r.yield_qty)} ${esc(r.base_unit)}</td><td class="px-2 py-1.5 num text-amber-300">${inr(r.cost_per_base)}/${esc(r.base_unit)}</td><td class="px-2 py-1.5 text-slate-400 text-xs">${r.lines.map((l) => esc(l.ingredient) + " " + qf(l.qty)).join(", ")}</td><td class="px-2 py-1.5 text-right"><button data-recedit='${esc(JSON.stringify(r))}' class="text-amber-300 text-xs">Edit</button><button data-recdel="${r.id}" class="text-slate-600 hover:text-red-400 text-xs ml-2">Del</button></td></tr>`).join("")))}

    <div class="bg-slate-900 border border-amber-800/40 rounded-xl p-4 mb-4">
      <div class="text-sm font-medium mb-1 text-amber-300">Add / update a recipe</div>
      <p class="text-xs text-slate-400 mb-3">Cost is calculated live from your Items prices. Example — Orange sauce: Red sauce 300 g, Garlic 50 g, Olive oil 20 g.</p>
      <div class="grid sm:grid-cols-3 gap-2 mb-3">
        <input id="rb-name" placeholder="Recipe name" class="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
        <input id="rb-yield" type="number" inputmode="decimal" placeholder="Batch yield" class="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
        ${unitSelect("rb-unit", "g")}
      </div>
      <datalist id="rb-ings">${ings.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <div id="rb-rows" class="space-y-2 mb-2"></div>
      <div class="flex flex-wrap gap-2 mb-3">
        <button id="rb-addrow" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 text-xs">+ ingredient</button>
        <button id="rb-ex1" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 text-xs">Example: Orange sauce</button>
        <button id="rb-ex2" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 text-xs">Example: Sugar syrup</button>
      </div>
      <div id="rb-cost" class="text-sm mb-3 text-slate-400"></div>
      <button id="rb-save" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg px-4 py-2 text-sm">Save recipe</button>
    </div>

    <div class="grid sm:grid-cols-2 gap-4">
      ${card("Containers", m.containers.length, ieButtons("containers"),
        tbl(["Name", "Tare", ""], m.containers.map((c) => `<tr><td class="px-2 py-1.5">${esc(c.name)}</td><td class="px-2 py-1.5 num">${c.tare}</td><td class="px-2 py-1.5 text-right whitespace-nowrap"><button data-contedit='${esc(JSON.stringify(c))}' class="text-amber-300 text-xs">Edit</button><button data-contdel="${c.id}" class="text-slate-600 hover:text-red-400 text-xs ml-2">Del</button></td></tr>`).join("")) +
        `<div class="flex gap-2 mt-3"><input id="ct-name" placeholder="Name" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"><input id="ct-tare" type="number" placeholder="Tare" class="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"><button id="ct-add" class="bg-amber-500 text-slate-950 rounded-lg px-3 text-sm">${I.plus}</button></div>`)}

      ${card("Categories", m.categories.length, ieButtons("categories"),
        tbl(["Name", ""], m.categories.map((c) => `<tr><td class="px-2 py-1.5">${esc(c.name)}</td><td class="px-2 py-1.5 text-right whitespace-nowrap"><button data-catedit='${esc(JSON.stringify(c))}' class="text-amber-300 text-xs">Edit</button><button data-catdel="${c.id}" class="text-slate-600 hover:text-red-400 text-xs ml-2">Del</button></td></tr>`).join("")) +
        `<div class="flex gap-2 mt-3"><input id="cat-name" placeholder="New category" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"><button id="cat-add" class="bg-amber-500 text-slate-950 rounded-lg px-3 text-sm">${I.plus}</button></div>`)}
    </div>`);

  wireImports();

  /* ----- recipe builder behaviour ----- */
  const rowsBox = $("rb-rows");
  function recompute() {
    const yq = parseFloat($("rb-yield").value) || 0; let batch = 0; const unknown = [];
    rowsBox.querySelectorAll(".rb-row").forEach((row) => {
      const ing = row.querySelector(".rb-ing").value.trim(); if (!ing) return;
      const q = parseFloat(row.querySelector(".rb-qty").value) || 0;
      const u = row.querySelector(".rb-u").value;
      const c = costOf(ing);
      if (c == null) { unknown.push(ing); return; }
      batch += q * factorJS(u) * c;
    });
    const per = yq > 0 ? batch / yq : 0;
    $("rb-cost").innerHTML = `Batch cost <b class="text-amber-300">${inr(batch)}</b> · cost/unit <b class="text-amber-300">${inr(per)}/${esc($("rb-unit").value)}</b>` +
      (unknown.length ? ` · <span class="text-amber-400">not priced: ${esc(unknown.join(", "))}</span>` : "");
  }
  function addRow(ing, qty, u) {
    const row = document.createElement("div");
    row.className = "rb-row flex flex-wrap gap-2";
    row.innerHTML = `<input class="rb-ing flex-1 min-w-[8rem] bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm" list="rb-ings" placeholder="Ingredient (item or recipe)" value="${esc(ing || "")}">
      <input class="rb-qty w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm" type="number" inputmode="decimal" placeholder="Qty" value="${qty != null ? qty : ""}">
      ${unitSelect("", u || "g", "rb-u")}
      <button class="rb-del text-slate-600 hover:text-red-400 px-1">${I.x}</button>`;
    rowsBox.appendChild(row);
    row.querySelectorAll("input,select").forEach((el) => (el.oninput = recompute));
    row.querySelector(".rb-del").onclick = () => { row.remove(); recompute(); };
    recompute();
  }
  $("rb-addrow").onclick = () => addRow();
  $("rb-yield").oninput = recompute; $("rb-unit").oninput = recompute;
  const loadExample = (name, yq, rows) => { $("rb-name").value = name; $("rb-yield").value = yq; $("rb-unit").value = "g"; rowsBox.innerHTML = ""; rows.forEach((r) => addRow(r[0], r[1], r[2])); };
  $("rb-ex1").onclick = () => loadExample("Orange sauce", 370, [["Red sauce", 300, "g"], ["Garlic", 50, "g"], ["Olive oil", 20, "g"]]);
  $("rb-ex2").onclick = () => loadExample("Sugar syrup", 130, [["Sugar", 100, "g"], ["Water", 20, "g"], ["Citric acid", 10, "g"]]);
  addRow();
  $("rb-save").onclick = async () => {
    const name = $("rb-name").value.trim(); const yq = parseFloat($("rb-yield").value) || 0;
    if (!name) return toast("Recipe name required", true);
    if (!yq) return toast("Yield must be more than zero", true);
    const lines = [];
    rowsBox.querySelectorAll(".rb-row").forEach((row) => {
      const ing = row.querySelector(".rb-ing").value.trim(); if (!ing) return;
      const q = parseFloat(row.querySelector(".rb-qty").value) || 0;
      const u = row.querySelector(".rb-u").value;
      lines.push({ ingredient: ing, qty: q * factorJS(u) });
    });
    try {
      const r = await api("/api/recipes", { method: "POST", body: JSON.stringify({ name, yield_qty: yq, base_unit: $("rb-unit").value, lines }) });
      S.catalog = await api("/api/catalog");
      toast(`Saved "${name}" — ${inr(r.cost_per_base)}/${r.base_unit}`);
      if (r.warnings && r.warnings.length) alert("Saved with notes:\n\n" + r.warnings.join("\n"));
      renderMasters();
    } catch (e) { toast(e.message, true); }
  };

  app.querySelectorAll("[data-recedit]").forEach((b) => (b.onclick = () => {
    const r = JSON.parse(b.dataset.recedit);
    loadExample(r.name, r.yield_qty, r.lines.map((l) => [l.ingredient, l.qty, r.base_unit]));
    $("rb-name").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  app.querySelectorAll("[data-recdel]").forEach((b) => (b.onclick = async () => { if (!confirm("Delete this recipe?")) return; await api("/api/recipes/" + b.dataset.recdel, { method: "DELETE" }); S.catalog = await api("/api/catalog"); renderMasters(); }));

  /* ----- item add / edit ----- */
  let editItemId = null;
  const fillItem = (it) => {
    editItemId = it ? it.id : null;
    $("it-name").value = it ? it.name : "";
    $("it-cat").value = it ? (it.category || "") : "";
    $("it-unit").value = it ? it.unit : "kg";
    $("it-pack").value = it ? it.pack_qty : "";
    $("it-price").value = it ? it.price : "";
    $("it-bc").value = it ? (it.barcode || "") : "";
    $("it-mode").textContent = it ? `Editing: ${it.name}` : "Add a new item";
  };
  $("it-save").onclick = async () => {
    const body = { name: $("it-name").value, category: $("it-cat").value, unit: $("it-unit").value, pack_qty: $("it-pack").value, price: $("it-price").value, barcode: $("it-bc").value };
    if (!body.name.trim()) return toast("Item name required", true);
    try {
      await api(editItemId ? "/api/items/" + editItemId : "/api/items", { method: editItemId ? "PUT" : "POST", body: JSON.stringify(body) });
      S.catalog = await api("/api/catalog"); toast(editItemId ? "Item updated" : "Item added"); renderMasters();
    } catch (e) { toast(e.message, true); }
  };
  $("it-clear").onclick = () => fillItem(null);
  app.querySelectorAll("[data-itemedit]").forEach((b) => (b.onclick = () => { fillItem(JSON.parse(b.dataset.itemedit)); $("it-name").scrollIntoView({ behavior: "smooth", block: "center" }); $("it-name").focus(); }));
  app.querySelectorAll("[data-itemdel]").forEach((b) => (b.onclick = async () => { if (!confirm("Delete this item?")) return; await api("/api/items/" + b.dataset.itemdel, { method: "DELETE" }); S.catalog = await api("/api/catalog"); renderMasters(); }));

  /* ----- containers add / edit ----- */
  let editContId = null;
  $("ct-add").onclick = async () => {
    try {
      await api(editContId ? "/api/containers/" + editContId : "/api/containers", { method: editContId ? "PUT" : "POST", body: JSON.stringify({ name: $("ct-name").value, tare: $("ct-tare").value }) });
      S.catalog = await api("/api/catalog"); renderMasters();
    } catch (e) { toast(e.message, true); }
  };
  app.querySelectorAll("[data-contedit]").forEach((b) => (b.onclick = () => { const c = JSON.parse(b.dataset.contedit); editContId = c.id; $("ct-name").value = c.name; $("ct-tare").value = c.tare; $("ct-name").focus(); }));
  app.querySelectorAll("[data-contdel]").forEach((b) => (b.onclick = async () => { await api("/api/containers/" + b.dataset.contdel, { method: "DELETE" }); S.catalog = await api("/api/catalog"); renderMasters(); }));

  /* ----- categories add / edit ----- */
  let editCatId = null;
  $("cat-add").onclick = async () => {
    try {
      await api(editCatId ? "/api/categories/" + editCatId : "/api/categories", { method: editCatId ? "PUT" : "POST", body: JSON.stringify({ name: $("cat-name").value }) });
      renderMasters();
    } catch (e) { toast(e.message, true); }
  };
  app.querySelectorAll("[data-catedit]").forEach((b) => (b.onclick = () => { const c = JSON.parse(b.dataset.catedit); editCatId = c.id; $("cat-name").value = c.name; $("cat-name").focus(); }));
  app.querySelectorAll("[data-catdel]").forEach((b) => (b.onclick = async () => { await api("/api/categories/" + b.dataset.catdel, { method: "DELETE" }); renderMasters(); }));
}

/* ============================ Admin: Barcodes ============================ */
// Shared render options. CODE128 encodes any item value and is read by the
// in-app camera scanner (BarcodeDetector) and standard handheld scanners.
const BC_OPTS = { format: "CODE128", displayValue: true, height: 50, fontSize: 13, margin: 8, background: "#ffffff", lineColor: "#000000" };
// Deterministic code for an item that has none yet — stable across regenerations.
const bcCodeFor = (it) => it.barcode || ("M" + String(it.id).padStart(7, "0"));
function drawBarcode(el, value, opts) {
  if (!window.JsBarcode) { el.replaceWith(Object.assign(document.createElement("span"), { className: "text-xs text-amber-400", textContent: "barcode lib not loaded" })); return; }
  try { window.JsBarcode(el, value, { ...BC_OPTS, ...(opts || {}) }); } catch { /* invalid value — leave blank */ }
}
function downloadBarcode(value, label) {
  if (!window.JsBarcode) return toast("Barcode library still loading — try again", true);
  const c = document.createElement("canvas");
  try { window.JsBarcode(c, value, { ...BC_OPTS, height: 90, fontSize: 18, margin: 12 }); }
  catch { return toast("Couldn't render that barcode", true); }
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = "barcode_" + String(label || value).replace(/[^a-z0-9]+/gi, "_") + ".png";
  a.click();
}
function printAllBarcodes() {
  if (!window.JsBarcode) return toast("Barcode library still loading — try again", true);
  const withBc = S.catalog.items.filter((i) => i.barcode);
  if (!withBc.length) return toast("No barcodes yet — generate some first", true);
  const cards = withBc.map((i) => {
    const c = document.createElement("canvas");
    try { window.JsBarcode(c, i.barcode, { ...BC_OPTS, height: 70, fontSize: 14, margin: 8 }); } catch { return ""; }
    return `<div class="card"><div class="nm">${esc(i.name)}</div><img src="${c.toDataURL("image/png")}"></div>`;
  }).join("");
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print barcodes", true);
  w.document.write(`<!doctype html><html><head><title>Mise barcodes</title><style>
    body{font-family:system-ui,sans-serif;margin:12px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .card{border:1px solid #ddd;border-radius:8px;padding:8px;text-align:center;page-break-inside:avoid}
    .nm{font-size:12px;font-weight:600;margin-bottom:4px}
    .card img{max-width:100%}
    @media print{.card{border-color:#999}}
  </style></head><body><div class="grid">${cards}</div>
  <script>window.onload=function(){setTimeout(function(){window.print();},200);};<\/script></body></html>`);
  w.document.close();
}
function renderBarcodes() {
  const items = S.catalog.items;
  shell(`<div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div class="text-sm text-slate-400">Generate, assign or scan barcodes. Generated codes are saved to the item, so scanning one pulls up its data.</div>
      <div class="flex gap-2">
        <button id="ba-genall" class="bg-sky-600 hover:bg-sky-500 text-white rounded-lg px-3 py-1.5 text-xs">${I.scan} <span class="align-middle">Generate missing</span></button>
        <button id="ba-printall" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 text-xs">${I.down} <span class="align-middle">Print all</span></button>
        ${ieButtons("barcodes")}
      </div>
    </div>
    <div class="bg-slate-900 border border-amber-800/40 rounded-xl p-4 mb-4">
      <div id="ba-mode" class="text-sm font-medium mb-2 text-amber-300">Assign a barcode</div>
      ${searchBox("ba-name", "Search item", items.map((i) => ({ name: i.name, sub: i.barcode || "no barcode" })), () => baPick())}
      <div class="flex gap-2 mt-2">
        <input id="ba-code" placeholder="Barcode" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 font-mono">
        <button id="ba-scan" class="bg-slate-800 hover:bg-slate-700 rounded-lg px-3">${I.cam}<span class="align-middle ml-1 text-sm">Scan</span></button>
        <button id="ba-save" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg px-4 text-sm">Save</button>
      </div>
      <div id="ba-video" class="mt-2"></div>
      <div id="ba-msg" class="text-xs text-slate-500 mt-2"></div>
    </div>
    <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div class="overflow-x-auto"><table class="w-full text-sm min-w-[480px]"><thead class="bg-slate-950/50 text-slate-400 text-xs uppercase"><tr><th class="text-left px-3 py-2">Item</th><th class="text-left px-3 py-2">Unit</th><th class="text-left px-3 py-2">Label</th><th class="px-3 py-2"></th></tr></thead>
      <tbody class="divide-y divide-slate-800">${items.map((i) => `<tr><td class="px-3 py-2">${esc(i.name)}<div class="font-mono text-[10px] text-slate-500">${esc(i.barcode || "no barcode")}</div></td><td class="px-3 py-2 font-mono text-xs ${i.barcode ? "" : "text-slate-600"}">${esc(i.unit)}</td><td class="px-3 py-2">${i.barcode ? `<canvas data-thumb="${esc(i.barcode)}" class="bg-white rounded p-0.5"></canvas>` : '<span class="text-slate-600 text-xs">—</span>'}</td><td class="px-3 py-2 text-right whitespace-nowrap">${i.barcode ? `<button data-bcdl="${i.id}" class="text-emerald-300 text-xs">Download</button>` : `<button data-bcgen="${i.id}" class="text-sky-300 text-xs">Generate</button>`}<button data-bcedit='${esc(JSON.stringify({ id: i.id, name: i.name, barcode: i.barcode }))}' class="text-amber-300 text-xs ml-2">Edit</button>${i.barcode ? `<button data-bcclear="${i.id}" class="text-slate-600 hover:text-red-400 text-xs ml-2">Clear</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="px-3 py-6 text-center text-slate-500">No items. Add items in Masters first.</td></tr>`}</tbody></table></div></div>`);
  app.querySelectorAll("canvas[data-thumb]").forEach((c) => drawBarcode(c, c.dataset.thumb, { height: 34, fontSize: 11, margin: 4 }));
  wireImports();

  const findItem = () => S.catalog.items.find((x) => x.name.toLowerCase() === $("ba-name").value.trim().toLowerCase());
  function baPick() { const it = findItem(); $("ba-code").value = it && it.barcode ? it.barcode : ""; if (it) $("ba-msg").textContent = `Editing ${it.name}`; }
  const saveBarcode = async (it, code) => {
    await api("/api/items/" + it.id + "/barcode", { method: "PUT", body: JSON.stringify({ barcode: code }) });
    S.catalog = await api("/api/catalog"); toast(`Barcode ${code ? "saved" : "cleared"} for ${it.name}`); renderBarcodes();
  };
  $("ba-save").onclick = async () => {
    const it = findItem(); if (!it) return toast("Pick an item first", true);
    try { await saveBarcode(it, $("ba-code").value.trim()); } catch (e) { toast(e.message, true); }
  };
  $("ba-printall").onclick = printAllBarcodes;
  $("ba-genall").onclick = async () => {
    const missing = S.catalog.items.filter((i) => !i.barcode);
    if (!missing.length) return toast("Every item already has a barcode");
    if (!confirm(`Generate barcodes for ${missing.length} item(s) without one?`)) return;
    try {
      for (const it of missing) await api("/api/items/" + it.id + "/barcode", { method: "PUT", body: JSON.stringify({ barcode: bcCodeFor(it) }) });
      S.catalog = await api("/api/catalog"); toast(`Generated ${missing.length} barcode(s)`); renderBarcodes();
    } catch (e) { toast(e.message, true); }
  };
  app.querySelectorAll("[data-bcgen]").forEach((b) => (b.onclick = async () => {
    const it = S.catalog.items.find((x) => x.id === parseInt(b.dataset.bcgen, 10));
    if (it) { try { await saveBarcode(it, bcCodeFor(it)); } catch (e) { toast(e.message, true); } }
  }));
  app.querySelectorAll("[data-bcdl]").forEach((b) => (b.onclick = () => {
    const it = S.catalog.items.find((x) => x.id === parseInt(b.dataset.bcdl, 10));
    if (it) downloadBarcode(it.barcode, it.name);
  }));
  $("ba-scan").onclick = () => startCamera($("ba-video"), async (code) => {
    $("ba-code").value = code;
    const it = findItem();
    if (it) { try { await saveBarcode(it, code); } catch (e) { toast(e.message, true); } }
    else $("ba-msg").innerHTML = `<span class="text-amber-400">Scanned ${esc(code)} — pick an item above, then Save.</span>`;
  });
  app.querySelectorAll("[data-bcedit]").forEach((b) => (b.onclick = () => {
    const it = JSON.parse(b.dataset.bcedit);
    $("ba-name").value = it.name; $("ba-code").value = it.barcode || ""; $("ba-mode").textContent = `Editing barcode: ${it.name}`;
    $("ba-mode").scrollIntoView({ behavior: "smooth", block: "center" }); $("ba-code").focus();
  }));
  app.querySelectorAll("[data-bcclear]").forEach((b) => (b.onclick = async () => {
    const it = S.catalog.items.find((x) => x.id === parseInt(b.dataset.bcclear, 10));
    if (it) { try { await saveBarcode(it, ""); } catch (e) { toast(e.message, true); } }
  }));
}

/* ============================ Admin: Outlets & logins ============================ */
async function renderOutlets() {
  let outlets = [], users = [];
  try { outlets = await api("/api/outlets"); users = await api("/api/users"); } catch {}
  shell(`
    <div class="grid md:grid-cols-2 gap-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="text-sm font-medium mb-3">Outlets</div>
        <div class="space-y-1 mb-3 text-sm">${outlets.map((o) => `<div class="text-slate-300">${esc(o.name)}</div>`).join("") || '<div class="text-slate-500">None yet</div>'}</div>
        <div class="flex gap-2"><input id="o-name" placeholder="New outlet name" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"><button id="o-add" class="bg-amber-500 text-slate-950 rounded-lg px-3">${I.plus}</button></div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="text-sm font-medium mb-3">Create outlet login</div>
        <div class="space-y-2">
          <input id="u-uname" placeholder="Login username (unique)" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
          <input id="u-pw" placeholder="Password" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
          <input id="u-name2" placeholder="Manager name (optional)" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
          <select id="u-outlet" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"><option value="">Assign to outlet…</option>${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select>
          <button id="u-add2" class="w-full bg-amber-500 text-slate-950 font-medium rounded-lg py-2 text-sm">Create login</button>
        </div>
      </div>
    </div>
    <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-4">
      <div class="px-4 py-3 text-sm font-medium border-b border-slate-800">Outlet logins</div>
      <div class="overflow-x-auto"><table class="w-full text-sm min-w-[380px]"><thead class="bg-slate-950/50 text-slate-400 text-xs uppercase"><tr><th class="text-left px-3 py-2">Username</th><th class="text-left px-3 py-2">Name</th><th class="text-left px-3 py-2">Outlet</th><th></th></tr></thead>
      <tbody class="divide-y divide-slate-800">${users.map((u) => `<tr><td class="px-3 py-2 font-mono text-xs">${esc(u.username)}</td><td class="px-3 py-2 text-slate-300">${esc(u.name || "")}</td><td class="px-3 py-2 text-slate-400">${esc(u.outlet_name || "—")}</td>
        <td class="px-3 py-2 text-right whitespace-nowrap"><button data-pw="${u.id}" class="text-amber-300 text-xs">Reset pw</button><button data-del="${u.id}" class="text-slate-600 hover:text-red-400 text-xs ml-3">Delete</button></td></tr>`).join("") || `<tr><td colspan="4" class="px-3 py-6 text-center text-slate-500">No logins yet.</td></tr>`}</tbody></table></div>
    </div>`);
  $("o-add").onclick = async () => { try { await api("/api/outlets", { method: "POST", body: JSON.stringify({ name: $("o-name").value }) }); toast("Outlet added"); renderOutlets(); } catch (e) { toast(e.message, true); } };
  $("u-add2").onclick = async () => {
    try { await api("/api/users", { method: "POST", body: JSON.stringify({ username: $("u-uname").value, password: $("u-pw").value, name: $("u-name2").value, outlet_id: $("u-outlet").value }) }); toast("Login created"); renderOutlets(); }
    catch (e) { toast(e.message, true); }
  };
  app.querySelectorAll("[data-pw]").forEach((b) => (b.onclick = async () => { const p = prompt("New password (min 4 chars):"); if (!p) return; await api("/api/users/" + b.dataset.pw + "/password", { method: "POST", body: JSON.stringify({ password: p }) }); toast("Password reset"); }));
  app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (!confirm("Delete this login?")) return; await api("/api/users/" + b.dataset.del, { method: "DELETE" }); renderOutlets(); }));
}

/* ============================ Settings ============================ */
function renderSettings() {
  shell(`<div class="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md">
    <div class="text-sm font-medium mb-3">Change your password</div>
    <div class="space-y-2">
      <input id="cur" type="password" placeholder="Current password" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
      <input id="np" type="password" placeholder="New password" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
      <button id="pwbtn" class="bg-amber-500 text-slate-950 font-medium rounded-lg px-4 py-2 text-sm">Update password</button>
    </div></div>`);
  $("pwbtn").onclick = async () => { try { await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: $("cur").value, next: $("np").value }) }); toast("Password updated"); $("cur").value = ""; $("np").value = ""; } catch (e) { toast(e.message, true); } };
}

/* ============================ start ============================ */
initTheme();
boot();
