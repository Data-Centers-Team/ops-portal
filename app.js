/* Data Center operations portal — single page app (static hosting + Supabase). The organisation name is stored in the database (settings.brand) and only shown after sign-in. */
const BRAND = () => (S.settings && S.settings.brand) || "Data Centers";
"use strict";
const sb = supabase.createClient(CFG.url, CFG.key, {
  auth: { persistSession: true, storage: window.sessionStorage, autoRefreshToken: true }
});
const TZ = "Africa/Cairo";
const S = { user: null, me: null, sites: [], settings: {}, site: "", people: [] };
const SEV = ["critical", "high", "medium", "low"];
const KINDS = ["server", "storage", "network", "security", "patch", "pdu", "blank", "other"];

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayStr = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDT = t => t ? new Date(t).toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const fmtT = t => t ? new Date(t).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "";
const fmtD = t => t ? new Date(t).toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }) : "";
const age = t => { const m = (Date.now() - new Date(t)) / 60000; return m < 60 ? Math.round(m) + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d"; };
const num = v => v === "" || v === null || v === undefined || isNaN(+v) ? null : +v;
const siteName = id => (S.sites.find(s => s.id === id) || {}).name || id || "All sites";
const canEdit = () => S.me && ["admin", "operator"].includes(S.me.role);
const isAdmin = () => S.me && S.me.role === "admin";
const personName = id => (S.people.find(p => p.id === id) || {}).full_name || "";

function toast(msg, bad) {
  const d = document.createElement("div"); d.textContent = msg; if (bad) d.className = "bad";
  $("#toast").appendChild(d); setTimeout(() => d.remove(), bad ? 6000 : 3000);
}
function niceErr(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "No connection — check the network and try again.";
  if (/JWT|expired/i.test(m)) return "Your session ended. Please sign in again.";
  return m;
}
async function q(p) {
  const { data, error } = await p;
  if (error) { toast(niceErr(error), true); throw error; }
  return data;
}
function modal(html, wide) {
  closeModal();
  const m = document.createElement("div"); m.className = "modal"; m.id = "modal";
  m.innerHTML = `<div class="box ${wide ? "wide" : ""}"><button class="x" data-close>×</button>${html}</div>`;
  m.addEventListener("click", e => { if (e.target === m || e.target.hasAttribute("data-close")) closeModal(); });
  document.body.appendChild(m); return m;
}
function closeModal() { const m = $("#modal"); if (m) m.remove(); }
function sevBadge(s) { return `<span class="badge b-${s}">${esc(s)}</span>`; }
function statusBadge(s) { return `<span class="badge b-${s}">${esc(s.replace("_", " "))}</span>`; }
function siteOptions(sel, withAll) {
  return (withAll ? `<option value="">All sites</option>` : "") +
    S.sites.filter(s => s.active).map(s => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.id)} — ${esc(s.name)}</option>`).join("");
}
function needSite(title) {
  if (S.site) return false;
  $("#view").innerHTML = `<h1>${esc(title)}</h1><div class="card">Choose a site from the menu at the top first.
    <div class="row" style="margin-top:12px">${S.sites.filter(s => s.active).map(s => `<button class="btn" data-site="${esc(s.id)}">${esc(s.id)} — ${esc(s.name)}</button>`).join("")}</div></div>`;
  $$("[data-site]").forEach(b => b.onclick = () => setSite(b.dataset.site));
  return true;
}
function csvDownload(name, rows) {
  if (!rows.length) return toast("Nothing to export");
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(",")].concat(rows.map(r => cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function printHTML(html) { $("#print").innerHTML = html; setTimeout(() => window.print(), 300); }

/* ---------------- photos ---------------- */
async function shrinkPhoto(file, label) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    let max = 1024, qual = 0.6, out = "";
    for (let tries = 0; tries < 5; tries++) {
      const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0, w, h);
      const stamp = `${fmtDT(new Date())}  ${label || ""}`.trim();
      const fs = Math.max(12, Math.round(w / 42));
      g.font = `600 ${fs}px Arial`; const tw = g.measureText(stamp).width;
      g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, h - fs * 1.7, tw + fs, fs * 1.7);
      g.fillStyle = "#fff"; g.fillText(stamp, fs / 2, h - fs * 0.5);
      out = c.toDataURL("image/jpeg", qual);
      if (out.length < 350000) break;
      max = Math.round(max * 0.8); qual = Math.max(0.4, qual - 0.08);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
async function savePhoto(file, kind, label) {
  const data = await shrinkPhoto(file, label);
  const row = await q(sb.from("photos").insert({ kind, data }).select("id").single());
  return { id: row.id, data };
}
const photoCache = {};
async function loadPhotos(ids) {
  ids = [...new Set(ids.filter(Boolean))].filter(id => !(id in photoCache));
  for (let i = 0; i < ids.length; i += 40) {
    const rows = await q(sb.from("photos").select("id,data").in("id", ids.slice(i, i + 40)));
    rows.forEach(r => photoCache[r.id] = r.data);
  }
}
function showImg(src) {
  if (!src) return;
  const d = document.createElement("div"); d.className = "imgv"; d.innerHTML = `<img src="${src}" alt="">`;
  d.onclick = () => d.remove(); document.body.appendChild(d);
}
function camButton(attr) {
  return `<label class="cam" title="Take photo">📷<input type="file" accept="image/*" capture="environment" ${attr}></label>`;
}

/* ---------------- idle sign-out ---------------- */
let idleT = 0;
function bumpIdle() {
  clearTimeout(idleT);
  if (!S.user) return;
  idleT = setTimeout(async () => { await sb.auth.signOut(); toast("Signed out after inactivity"); }, (S.settings.idle_minutes || 15) * 60000);
}
["click", "keydown", "touchstart", "scroll"].forEach(ev => addEventListener(ev, bumpIdle, { passive: true }));

/* ---------------- auth ---------------- */
// WhatsApp number -> international digits (same rule as public.norm_phone in the database)
function normPhone(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (/^01[0125]\d{8}$/.test(d)) return "2" + d;
  if (/^00[1-9]\d{8,13}$/.test(d)) return d.slice(2);
  if (/^[1-9]\d{9,14}$/.test(d)) return d;
  return null;
}
const loginOf = ph => ph + "@ops-portal.app";
const showPhone = ph => !ph ? "" : /^20\d{10}$/.test(ph) ? "0" + ph.slice(2) : "+" + ph;
function loginView(msg) {
  $("#root").innerHTML = `<div class="card login">
    <h1>Operations Portal</h1><div class="sub">Authorised staff only</div>
    ${msg ? `<div class="badge b-bad" style="margin-bottom:12px;white-space:normal">${esc(msg)}</div>` : ""}
    <form id="lf"><input type="tel" id="le" placeholder="WhatsApp number (e.g. 01012345678)" autocomplete="username" inputmode="tel" required>
    <input type="password" id="lp" placeholder="Password" autocomplete="current-password" required>
    <button class="btn pri" style="width:100%;justify-content:center">Sign in</button></form>
    <div class="lock">🔒 Accounts are created by the Data Center admin. Sessions end when the browser closes and after inactivity.
    Every change is recorded in the audit log.</div></div>`;
  $("#lf").onsubmit = async e => {
    e.preventDefault();
    const ph = normPhone($("#le").value);
    if (!ph) return toast("Enter your WhatsApp number, e.g. 01012345678 (or with the country code outside Egypt).", true);
    const b = $("#lf button"); b.disabled = true; b.textContent = "Signing in…";
    const { error } = await sb.auth.signInWithPassword({ email: loginOf(ph), password: $("#lp").value });
    if (error) {
      b.disabled = false; b.textContent = "Sign in";
      toast(/Invalid/i.test(error.message) ? "Wrong number or password" : /banned/i.test(error.message) ? "This account is switched off — contact the Data Center admin." : niceErr(error), true);
    }
  };
}
async function boot(session) {
  S.user = session ? session.user : null;
  if (!S.user) { S.me = null; return loginView(); }
  const me = await sb.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
  if (me.error) return loginView(niceErr(me.error));
  S.me = me.data;
  if (!S.me || !S.me.active) {
    $("#root").innerHTML = `<div class="card login"><h1>Waiting for activation</h1>
      <p class="muted">Your account exists but it is switched off. Contact the Data Center admin.</p>
      <button class="btn" id="lo">Sign out</button></div>`;
    $("#lo").onclick = () => sb.auth.signOut(); return;
  }
  if (S.me.must_change_pw) return passwordView(true);
  const [sites, settings, people] = await Promise.all([
    q(sb.from("sites").select("*").order("sort")),
    q(sb.from("settings").select("*").eq("id", 1).maybeSingle()),
    q(sb.from("profiles").select("id,full_name,role,is_dc,active,site").order("full_name"))
  ]);
  S.sites = sites; S.settings = settings || {}; S.people = people; document.title = BRAND();
  const saved = localStorage.getItem("cib_site");
  S.site = saved !== null && (saved === "" || sites.some(s => s.id === saved)) ? saved : (S.me.site || (sites[0] || {}).id || "");
  shell(); bumpIdle(); route();
}
function passwordView(first) {
  const html = `<h1>${first ? "Choose your password" : "Change password"}</h1>
    <div class="sub">${first ? "You signed in with a temporary password. Choose your own to continue." : ""}</div>
    <form id="pwf"><input type="password" id="p1" placeholder="New password (at least 8 characters)" autocomplete="new-password" minlength="8" required>
    <input type="password" id="p2" placeholder="Repeat new password" autocomplete="new-password" minlength="8" required>
    <button class="btn pri" style="width:100%;justify-content:center">Save password</button></form>
    ${first ? `<button class="btn sm" id="lo" style="margin-top:10px">Sign out</button>` : ""}`;
  let box;
  if (first) { $("#root").innerHTML = `<div class="card login">${html}</div>`; box = $("#root"); const lo = $("#lo"); lo.onclick = () => sb.auth.signOut(); }
  else box = modal(html);
  $("#pwf", box).onsubmit = async e => {
    e.preventDefault();
    const a = $("#p1", box).value, b = $("#p2", box).value;
    if (a.length < 8) return toast("At least 8 characters.", true);
    if (a !== b) return toast("The two passwords are not the same.", true);
    const btn = $("#pwf button", box); btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { btn.disabled = false; return toast(/different|same/i.test(error.message) ? "Choose a password different from the temporary one." : niceErr(error), true); }
    await q(sb.rpc("password_changed"));
    toast("Password saved");
    if (first) boot((await sb.auth.getSession()).data.session); else closeModal();
  };
}
let lastUid;
sb.auth.onAuthStateChange((ev, session) => {
  const uid = session ? session.user.id : null;
  if (uid === lastUid && ev !== "SIGNED_OUT") return;   // token refresh: keep the page as it is
  lastUid = uid; setTimeout(() => boot(session), 0);
});

/* ---------------- shell & routing ---------------- */
const NAV = [["home", "Home"], ["check", "Checklist"], ["mfa", "MFA log"], ["racks", "Racks"], ["issues", "Issues"], ["kpi", "KPIs"], ["admin", "Admin"]];
function shell() {
  $("#root").innerHTML = `<header><div class="hbar">
      <div class="brand">${esc(BRAND())}<small>OPERATIONS PORTAL</small></div>
      <select id="siteSel" aria-label="Site">${siteOptions(S.site, true)}</select>
      <div class="grow"></div>
      <div class="who">${esc(S.me.full_name || showPhone(S.me.phone))}<br><span style="opacity:.7">${esc(S.me.role)}</span></div>
      <button class="hbtn" id="chpw" title="Change password">🔑</button><button class="hbtn" id="logout">Sign out</button></div>
    <nav>${NAV.filter(n => n[0] !== "admin" || isAdmin()).map(n => `<a href="#${n[0]}" data-nav="${n[0]}">${n[1]}<span class="dot hide" id="dot-${n[0]}"></span></a>`).join("")}</nav>
    </header><main id="view"></main>`;
  $("#siteSel").onchange = e => setSite(e.target.value);
  $("#logout").onclick = () => sb.auth.signOut();
  $("#chpw").onclick = () => passwordView(false);
  refreshDots();
}
function setSite(id) { S.site = id; localStorage.setItem("cib_site", id); const s = $("#siteSel"); if (s) s.value = id; route(); }
async function refreshDots() {
  try {
    let qi = sb.from("issues").select("id", { count: "exact", head: true }).neq("status", "closed");
    if (S.site) qi = qi.eq("site", S.site);
    const [iss, wit] = await Promise.all([qi,
      sb.from("mfa_log").select("id", { count: "exact", head: true }).eq("witness_id", S.user.id).is("witness_confirmed_at", null)]);
    const set = (k, n) => { const d = $("#dot-" + k); if (d) { d.textContent = n; d.classList.toggle("hide", !n); } };
    set("issues", iss.count || 0); set("mfa", wit.count || 0);
  } catch (e) { }
}
addEventListener("hashchange", route);
addEventListener("unhandledrejection", e => e.preventDefault());   // errors are already shown as a toast
async function route() {
  if (!S.me || !$("#view")) return;
  closeModal();
  const [name, arg] = (location.hash.slice(1) || "home").split("/");
  $$("nav a").forEach(a => a.classList.toggle("on", a.dataset.nav === (name === "run" ? "check" : name === "rack" ? "racks" : name)));
  $("#view").innerHTML = `<p class="muted">Loading…</p>`;
  const V = { home: viewHome, check: viewCheck, run: viewRun, mfa: viewMfa, racks: viewRacks, rack: viewRack, issues: viewIssues, kpi: viewKpi, admin: viewAdmin };
  try { await (V[name] || viewHome)(arg); }
  catch (e) { console.error(e); $("#view").innerHTML = `<div class="card">Could not load this page. ${esc(niceErr(e))}</div>`; }
  refreshDots();
}

/* ---------------- HOME ---------------- */
async function viewHome() {
  const t = dayStr();
  const from = new Date(t + "T00:00:00+02:00").toISOString();
  let qi = sb.from("issues").select("id,severity,title,site,opened_at,status").neq("status", "closed").order("opened_at", { ascending: false });
  let qr = sb.from("checklist_runs").select("id,site,shift,tech_name,signed_at,started_at").gte("started_at", from).order("started_at", { ascending: false });
  let qm = sb.from("mfa_log").select("id,site,time_in,custodian,purpose,component_id").is("time_out", null);
  let qk = sb.from("rack_usage").select("u_total,used_u,kw_cap,kw_used").eq("active", true);
  if (S.site) { qi = qi.eq("site", S.site); qr = qr.eq("site", S.site); qm = qm.eq("site", S.site); qk = qk.eq("site", S.site); }
  const [iss, runs, open, racks, mine] = await Promise.all([q(qi), q(qr), q(qm), q(qk),
    q(sb.from("mfa_log").select("id,site,time_in,custodian,purpose,created_by").eq("witness_id", S.user.id).is("witness_confirmed_at", null))]);
  const cnt = s => iss.filter(i => i.severity === s).length;
  const uT = racks.reduce((a, r) => a + r.u_total, 0), uU = racks.reduce((a, r) => a + r.used_u, 0);
  const kC = racks.reduce((a, r) => a + (+r.kw_cap || 0), 0), kU = racks.reduce((a, r) => a + (+r.kw_used || 0), 0);
  const hrs = S.settings.mfa_open_hours || 4;
  const late = open.filter(m => Date.now() - new Date(m.time_in) > hrs * 3600000).length;
  $("#view").innerHTML = `<h1>${esc(siteName(S.site))} — ${esc(fmtD(new Date()))}</h1>
    <div class="tiles">
      <div class="tile click ${iss.length ? "bad" : "good"}" data-go="issues"><div class="v">${iss.length}</div><div class="l">Open issues · ${cnt("critical")} critical · ${cnt("high")} high</div></div>
      <div class="tile click ${runs.some(r => r.signed_at) ? "good" : "warn"}" data-go="check"><div class="v">${runs.filter(r => r.signed_at).length}/${runs.length}</div><div class="l">Checklists signed today</div></div>
      <div class="tile click ${late ? "bad" : ""}" data-go="mfa"><div class="v">${open.length}</div><div class="l">MFA sessions still open${late ? ` · ${late} over ${hrs} h` : ""}</div></div>
      <div class="tile click ${mine.length ? "warn" : ""}" data-go="mfa"><div class="v">${mine.length}</div><div class="l">Waiting for your witness confirmation</div></div>
      <div class="tile click" data-go="racks"><div class="v">${uT ? Math.round(uU / uT * 100) : 0}%</div><div class="l">Rack space used (${uU}/${uT} U)</div></div>
      <div class="tile click ${kC && kU / kC > 0.85 ? "warn" : ""}" data-go="racks"><div class="v">${kC ? Math.round(kU / kC * 100) : 0}%</div><div class="l">Rack power planned (${kU.toFixed(1)}/${kC} kW)</div></div>
    </div>
    <h2>Latest open issues</h2>
    ${iss.length ? `<div class="tw"><table class="t"><tr><th>Severity</th><th>Issue</th><th>Site</th><th>Age</th></tr>
      ${iss.slice(0, 8).map(i => `<tr class="click" data-issue="${i.id}"><td>${sevBadge(i.severity)}</td><td>${esc(i.title)}</td><td>${esc(i.site)}</td><td class="nowrap">${age(i.opened_at)}</td></tr>`).join("")}</table></div>`
      : `<div class="card muted">No open issues 👍</div>`}
    <h2>Today's checklists</h2>
    ${runs.length ? `<div class="tw"><table class="t"><tr><th>Site</th><th>Shift</th><th>Technician</th><th>Started</th><th>Status</th></tr>
      ${runs.map(r => `<tr class="click" data-run="${r.id}"><td>${esc(r.site)}</td><td>${esc(r.shift)}</td><td>${esc(r.tech_name)}</td><td>${fmtT(r.started_at)}</td><td>${r.signed_at ? `<span class="badge b-ok">Signed ${fmtT(r.signed_at)}</span>` : `<span class="badge b-wait">In progress</span>`}</td></tr>`).join("")}</table></div>`
      : `<div class="card muted">No checklist started today.${canEdit() ? ` <a href="#check">Start one</a>` : ""}</div>`}`;
  $$("[data-go]").forEach(b => b.onclick = () => location.hash = b.dataset.go);
  $$("[data-issue]").forEach(r => r.onclick = () => openIssue(+r.dataset.issue));
  $$("[data-run]").forEach(r => r.onclick = () => location.hash = "run/" + r.dataset.run);
}

/* ---------------- CHECKLIST ---------------- */
async function viewCheck() {
  if (needSite("Daily checklist")) return;
  const runs = await q(sb.from("checklist_runs").select("*").eq("site", S.site).order("started_at", { ascending: false }).limit(60));
  const h = +new Date().toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false });
  const shift = h >= 7 && h < 15 ? "Morning" : h >= 15 && h < 23 ? "Evening" : "Night";
  $("#view").innerHTML = `<h1>Daily checklist — ${esc(siteName(S.site))}</h1>
    ${canEdit() ? `<div class="card"><form id="nf" class="row">
      <label class="f grow">Technician<input type="text" id="nt" value="${esc(S.me.full_name)}" required></label>
      <label class="f">Shift<select id="ns">${["Morning", "Evening", "Night"].map(s => `<option ${s === shift ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <button class="btn acc">＋ Start checklist</button></form></div>` : ""}
    <h2>Recent checklists</h2>
    ${runs.length ? `<div class="tw"><table class="t"><tr><th>Date</th><th>Shift</th><th>Technician</th><th>Status</th></tr>
    ${runs.map(r => `<tr class="click" data-run="${r.id}"><td class="nowrap">${fmtDT(r.started_at)}</td><td>${esc(r.shift)}</td><td>${esc(r.tech_name)}</td>
      <td>${r.signed_at ? `<span class="badge b-ok">Signed ${fmtDT(r.signed_at)}</span>` : `<span class="badge b-wait">In progress</span>`}</td></tr>`).join("")}</table></div>`
      : `<div class="card muted">No checklists yet.</div>`}`;
  $$("[data-run]").forEach(r => r.onclick = () => location.hash = "run/" + r.dataset.run);
  const nf = $("#nf");
  if (nf) nf.onsubmit = async e => {
    e.preventDefault();
    const r = await q(sb.from("checklist_runs").insert({ site: S.site, shift: $("#ns").value, tech_name: $("#nt").value.trim(), created_by: S.user.id }).select("id").single());
    location.hash = "run/" + r.id;
  };
}

async function viewRun(id) {
  id = +id;
  const run = await q(sb.from("checklist_runs").select("*").eq("id", id).maybeSingle());
  if (!run) { $("#view").innerHTML = `<div class="card">Checklist not found.</div>`; return; }
  const [items, results] = await Promise.all([
    q(sb.from("checklist_items").select("*").eq("active", true).or(`site.is.null,site.eq.${run.site}`).order("sort").order("id")),
    q(sb.from("checklist_results").select("*").eq("run_id", id))]);
  const R = {}; results.forEach(r => R[r.item_id] = r);
  await loadPhotos(results.map(r => r.photo_id));
  const locked = !!run.signed_at && !isAdmin();
  const editable = canEdit() && !locked && (run.created_by === S.user.id || isAdmin());
  const areas = [...new Set(items.map(i => i.area))];
  const itemHTML = it => {
    const r = R[it.id] || {};
    const cls = r.ok === true ? "okk" : r.ok === false ? "bad" : "";
    const ctl = it.kind === "check"
      ? `<div class="seg"><button class="y ${r.ok === true ? "on" : ""}" data-ok="1" ${editable ? "" : "disabled"}>✓ OK</button><button class="n ${r.ok === false ? "on" : ""}" data-ok="0" ${editable ? "" : "disabled"}>✗ Not OK</button></div>`
      : `<input class="read ${r.ok === true ? "okv" : r.ok === false ? "badv" : ""}" type="number" inputmode="decimal" step="any" value="${r.value ?? ""}" placeholder="—" ${editable ? "" : "disabled"}>
         <span class="range">${esc(it.unit || "")}${it.min_ok !== null || it.max_ok !== null ? ` · ok ${it.min_ok ?? "…"}–${it.max_ok ?? "…"}` : ""}</span>`;
    const ph = r.photo_id && photoCache[r.photo_id] ? `<img class="thumb" src="${photoCache[r.photo_id]}" alt="">` : "";
    return `<div class="item ${cls}" data-item="${it.id}">
      <div class="ttl">${esc(it.title)}${it.title_ar ? `<span class="ar">${esc(it.title_ar)}</span>` : ""}${it.photo_required ? `<span class="req">📷 photo required</span>` : ""}</div>
      <div class="ctl">${ctl}</div>
      <div class="extra"><input type="text" class="note" placeholder="Note (optional)" value="${esc(r.note || "")}" ${editable ? "" : "disabled"}>
        ${editable ? camButton('class="camin"') : ""}<span class="ph">${ph}</span></div></div>`;
  };
  $("#view").innerHTML = `<div class="row"><a href="#check" class="btn sm">← Back</a><div class="grow"></div>
      <button class="btn sm" id="prt">🖨 Print / PDF</button>${isAdmin() ? `<button class="btn sm danger" id="del">Delete</button>` : ""}</div>
    <h1 style="margin-top:12px">${esc(run.site)} · ${esc(run.shift)} checklist</h1>
    <div class="muted">${esc(run.tech_name)} · started ${fmtDT(run.started_at)} ·
      ${run.signed_at ? `<span class="badge b-ok">Signed ${fmtDT(run.signed_at)}</span>` : `<span class="badge b-wait">In progress</span>`}
      · <span id="prog"></span></div>
    ${!editable && !run.signed_at ? `<div class="card small" style="margin-top:10px">Only the technician who started this checklist (or an admin) can fill it.</div>` : ""}
    <div id="items">${areas.map(a => { const f = items.find(i => i.area === a); return `<div class="area">${esc(a)}${f && f.area_ar ? `<span class="ar">${esc(f.area_ar)}</span>` : ""}</div>` + items.filter(i => i.area === a).map(itemHTML).join(""); }).join("")}</div>
    ${editable && !run.signed_at ? `<div class="stick"><button class="btn ok" id="sign">✍ Sign & lock checklist</button></div>` : ""}`;

  const prog = () => {
    const done = items.filter(i => R[i.id] && R[i.id].ok !== null && R[i.id].ok !== undefined).length;
    const bad = items.filter(i => R[i.id] && R[i.id].ok === false).length;
    $("#prog").innerHTML = `${done}/${items.length} done${bad ? ` · <b style="color:var(--bad)">${bad} not OK</b>` : ""}`;
  };
  prog();
  const save = async (itemId, patch, el) => {
    const before = R[itemId] ? R[itemId].ok : null;
    const row = await q(sb.from("checklist_results").upsert({ run_id: id, item_id: itemId, ...patch }, { onConflict: "run_id,item_id" }).select().single());
    R[itemId] = row;
    const box = $(`.item[data-item="${itemId}"]`);
    box.classList.remove("okk", "bad", "miss");
    if (row.ok === true) box.classList.add("okk");
    if (row.ok === false) box.classList.add("bad");
    const rd = $(".read", box);
    if (rd) { rd.classList.toggle("okv", row.ok === true); rd.classList.toggle("badv", row.ok === false); }
    if (row.ok === false && before !== false) toast("⚠ Logged as an issue on the Issues board");
    prog();
  };
  if (editable) $$(".item").forEach(box => {
    const itemId = +box.dataset.item;
    $$("[data-ok]", box).forEach(b => b.onclick = async () => {
      $$("[data-ok]", box).forEach(x => x.classList.remove("on")); b.classList.add("on");
      await save(itemId, { ok: b.dataset.ok === "1" }, box);
    });
    const rd = $(".read", box);
    if (rd) rd.onchange = () => save(itemId, { value: num(rd.value) }, box);
    $(".note", box).onchange = e => save(itemId, { note: e.target.value.trim() || null }, box);
    const cam = $(".camin", box);
    if (cam) cam.onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      toast("Saving photo…");
      const it = items.find(i => i.id === itemId);
      const p = await savePhoto(f, "checklist", `${run.site} · ${it.title}`);
      photoCache[p.id] = p.data;
      await save(itemId, { photo_id: p.id }, box);
      $(".ph", box).innerHTML = `<img class="thumb" src="${p.data}" alt="">`;
      $(".ph img", box).onclick = () => showImg(p.data);
      e.target.value = "";
    };
  });
  $$(".ph img").forEach(img => img.onclick = () => showImg(img.src));
  const sign = $("#sign");
  if (sign) sign.onclick = async () => {
    const res = await q(sb.rpc("sign_run", { p_id: id }));
    if (!res.ok) {
      items.forEach(i => {
        const r = R[i.id] || {};
        const miss = r.ok === null || r.ok === undefined || (i.photo_required && !r.photo_id);
        $(`.item[data-item="${i.id}"]`).classList.toggle("miss", miss);
      });
      const first = $(".item.miss"); if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return toast(`Not ready: ${res.missing} item(s) not answered, ${res.photos} required photo(s) missing`, true);
    }
    toast("Checklist signed ✓"); route();
  };
  $("#prt").onclick = () => printRun(run, items, R);
  const del = $("#del");
  if (del) del.onclick = async () => {
    if (!confirm("Delete this checklist and all its answers?")) return;
    await q(sb.from("checklist_runs").delete().eq("id", id)); location.hash = "check";
  };
}
function printRun(run, items, R) {
  printHTML(`<h1>${esc(BRAND())} — Daily Checklist</h1>
    <div class="meta">Site: <b>${esc(siteName(run.site))}</b> · Shift: <b>${esc(run.shift)}</b> · Technician: <b>${esc(run.tech_name)}</b><br>
    Started: ${fmtDT(run.started_at)} · ${run.signed_at ? "Signed: " + fmtDT(run.signed_at) : "NOT SIGNED"}</div>
    <table><tr><th>Area</th><th>Item</th><th>Result</th><th>Value</th><th>Note</th><th>Photo</th></tr>
    ${items.map(i => { const r = R[i.id] || {}; return `<tr><td>${esc(i.area)}</td><td>${esc(i.title)}</td>
      <td>${r.ok === true ? "OK" : r.ok === false ? "<b>NOT OK</b>" : "—"}</td>
      <td>${r.value ?? ""} ${r.value !== null && r.value !== undefined ? esc(i.unit || "") : ""}</td><td>${esc(r.note || "")}</td>
      <td>${r.photo_id && photoCache[r.photo_id] ? `<img src="${photoCache[r.photo_id]}">` : ""}</td></tr>`; }).join("")}</table>
    <p style="margin-top:14px">Printed ${fmtDT(new Date())} by ${esc(S.me.full_name)}</p>`);
}

/* ---------------- MFA ---------------- */
async function viewMfa() {
  if (needSite("MFA key log")) return;
  const to = dayStr(), from = addDays(to, -30);
  const [comps, open, mine] = await Promise.all([
    q(sb.from("mfa_components").select("*").order("system").order("component")),
    q(sb.from("mfa_log").select("*").eq("site", S.site).is("time_out", null).order("time_in")),
    q(sb.from("mfa_log").select("*").eq("witness_id", S.user.id).is("witness_confirmed_at", null).order("time_in"))]);
  const C = {}; comps.forEach(c => C[c.id] = c);
  const live = comps.filter(c => c.active && (!c.site || c.site === S.site));
  const witnesses = S.people.filter(p => p.active && p.is_dc);
  const compName = id => C[id] ? `${C[id].system} — ${C[id].component}` : "#" + id;
  const hrs = S.settings.mfa_open_hours || 4;
  $("#view").innerHTML = `<h1>MFA key operation log — ${esc(siteName(S.site))}</h1>
    ${mine.length ? `<div class="card" style="border-color:var(--warn)"><h3 style="margin-top:0">⏳ Waiting for your confirmation as witness</h3>
      ${mine.map(m => `<div class="row" style="margin:6px 0"><span class="grow">${fmtDT(m.time_in)} · ${esc(compName(m.component_id))} · ${esc(m.purpose)} · custodian ${esc(m.custodian)} · logged by ${esc(personName(m.created_by))}</span>
        <button class="btn sm ok" data-confirm="${m.id}">I witnessed this ✓</button></div>`).join("")}</div><div class="spacer"></div>` : ""}
    ${canEdit() ? `<div class="card"><h3 style="margin-top:0">New entry (entrance)</h3><form id="mf">
      <div class="grid2">
        <label class="f">Key component<select id="mc" required><option value="">Choose…</option>
          ${live.map(c => `<option value="${c.id}">${esc(c.system)} — ${esc(c.component)}</option>`).join("")}</select></label>
        <label class="f">Custodian<input type="text" id="mcu" list="mcl" required placeholder="Name of the key custodian"><datalist id="mcl"></datalist></label>
        <label class="f">Purpose<input type="text" id="mp" list="mpl" required placeholder="e.g. Key loading"><datalist id="mpl">
          ${["Key loading", "Key change", "Key verification", "Safe check", "Audit"].map(x => `<option>${x}</option>`).join("")}</datalist></label>
        <label class="f">Witness (Data Center representative, not the custodian)<select id="mw" required><option value="">Choose…</option>
          ${witnesses.map(p => `<option value="${p.id}" ${p.id === S.user.id ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></label>
      </div>
      <div class="row"><span class="small muted">Optional photo ✱</span>${camButton('id="mph"')}<span id="mphv"></span>
        <div class="grow"></div><button class="btn acc">Log entrance</button></div>
      <div class="small muted" style="margin-top:6px">If the witness is someone else, they confirm from their own login — until then the entry shows ⏳.</div>
    </form></div>` : ""}
    <h2>Open sessions (no exit time yet)</h2>
    ${open.length ? `<div class="tw"><table class="t"><tr><th>In</th><th>Component</th><th>Purpose</th><th>Custodian</th><th>Witness</th><th></th></tr>
      ${open.map(m => `<tr><td class="nowrap">${fmtDT(m.time_in)}${Date.now() - new Date(m.time_in) > hrs * 3600000 ? ` <span class="badge b-bad">over ${hrs} h</span>` : ""}</td>
        <td>${esc(compName(m.component_id))}</td><td>${esc(m.purpose)}</td><td>${esc(m.custodian)}</td>
        <td>${esc(m.witness_name)} ${m.witness_confirmed_at ? "✔" : "⏳"}</td>
        <td>${canEdit() ? `<button class="btn sm" data-out="${m.id}">Log exit</button>` : ""}</td></tr>`).join("")}</table></div>`
      : `<div class="card muted">None.</div>`}
    <h2>Log</h2>
    <div class="row"><label class="f">From<input type="date" id="lf1" value="${from}"></label><label class="f">To<input type="date" id="lf2" value="${to}"></label>
      <div class="grow"></div><button class="btn sm" id="mcsv">⬇ CSV</button><button class="btn sm" id="mprt">🖨 Print / PDF</button></div>
    <div id="mlog"></div>
    <h2>Key component register</h2><div id="mreg"></div>`;

  if (canEdit()) {
    $("#mc").onchange = () => {
      const c = C[$("#mc").value];
      $("#mcl").innerHTML = c ? [c.custodian, c.alternate].filter(x => x && x !== "—").map(x => `<option>${esc(x)}</option>`).join("") : "";
      if (c && c.custodian && c.custodian !== "—") $("#mcu").value = c.custodian;
    };
    let photoId = null;
    $("#mph").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const p = await savePhoto(f, "mfa", `${S.site} · MFA`); photoId = p.id;
      $("#mphv").innerHTML = `<img class="thumb" src="${p.data}" alt="">`; $("#mphv img").onclick = () => showImg(p.data);
    };
    $("#mf").onsubmit = async e => {
      e.preventDefault();
      await q(sb.from("mfa_log").insert({ site: S.site, component_id: +$("#mc").value, custodian: $("#mcu").value.trim(), purpose: $("#mp").value.trim(), witness_id: $("#mw").value, photo_id: photoId, created_by: S.user.id }));
      toast("Entrance logged"); route();
    };
  }
  $$("[data-out]").forEach(b => b.onclick = async () => {
    if (!confirm("Log exit time now?")) return;
    await q(sb.from("mfa_log").update({ time_out: new Date().toISOString() }).eq("id", +b.dataset.out));
    toast("Exit logged"); route();
  });
  $$("[data-confirm]").forEach(b => b.onclick = async () => {
    const ok = await q(sb.rpc("confirm_witness", { p_id: +b.dataset.confirm }));
    toast(ok ? "Confirmed ✓" : "Could not confirm", !ok); route();
  });

  let rows = [];
  const loadLog = async () => {
    const f = $("#lf1").value, t = $("#lf2").value;
    rows = await q(sb.from("mfa_log").select("*").eq("site", S.site)
      .gte("time_in", new Date(f + "T00:00:00+02:00").toISOString()).lt("time_in", new Date(addDays(t, 1) + "T00:00:00+02:00").toISOString())
      .order("time_in", { ascending: false }));
    await loadPhotos(rows.map(r => r.photo_id));
    $("#mlog").innerHTML = rows.length ? `<div class="tw"><table class="t"><tr><th>In</th><th>Out</th><th>Component</th><th>Purpose</th><th>Custodian</th><th>Witness</th><th>Logged by</th><th></th></tr>
      ${rows.map(m => `<tr><td class="nowrap">${fmtDT(m.time_in)}</td><td class="nowrap">${m.time_out ? fmtDT(m.time_out) : `<span class="badge b-wait">open</span>`}</td>
        <td>${esc(compName(m.component_id))}</td><td>${esc(m.purpose)}</td><td>${esc(m.custodian)}</td>
        <td>${esc(m.witness_name)} ${m.witness_confirmed_at ? `<span class="badge b-ok">✔ ${fmtT(m.witness_confirmed_at)}</span>` : `<span class="badge b-wait">⏳</span>`}</td>
        <td>${esc(personName(m.created_by))}</td><td>${m.photo_id && photoCache[m.photo_id] ? `<a href="#" data-ph="${m.photo_id}" title="Photo">✱</a>` : ""}</td></tr>`).join("")}</table></div>`
      : `<div class="card muted">No entries in this period.</div>`;
    $$("[data-ph]").forEach(a => a.onclick = e => { e.preventDefault(); showImg(photoCache[a.dataset.ph]); });
  };
  $("#lf1").onchange = loadLog; $("#lf2").onchange = loadLog;
  await loadLog();
  $("#mcsv").onclick = () => csvDownload(`MFA-log-${S.site}.csv`, rows.map(m => ({
    time_in: fmtDT(m.time_in), time_out: fmtDT(m.time_out), component: compName(m.component_id), purpose: m.purpose,
    custodian: m.custodian, witness: m.witness_name, witness_confirmed: fmtDT(m.witness_confirmed_at), logged_by: personName(m.created_by)
  })));
  $("#mprt").onclick = () => printHTML(`<h1>${esc(BRAND())} — Key Operation Log & Safe Register (MFA)</h1>
    <div class="meta">Site: <b>${esc(siteName(S.site))}</b> · Period ${esc($("#lf1").value)} to ${esc($("#lf2").value)}</div>
    <table><tr><th>Entrance</th><th>Exit</th><th>Key component</th><th>Purpose</th><th>Custodian</th><th>Witness (DC)</th><th>Witness confirmed</th></tr>
    ${rows.length ? rows.map(m => `<tr><td>${fmtDT(m.time_in)}</td><td>${fmtDT(m.time_out)}</td><td>${esc(compName(m.component_id))}</td><td>${esc(m.purpose)}</td>
      <td>${esc(m.custodian)}</td><td>${esc(m.witness_name)}</td><td>${fmtDT(m.witness_confirmed_at) || "PENDING"}</td></tr>`).join("")
      : `<tr><td colspan="7" style="height:28px"></td></tr>`.repeat(8)}</table>
    <p style="margin-top:14px">Printed ${fmtDT(new Date())} by ${esc(S.me.full_name)}</p>`);

  // register
  const reg = () => {
    $("#mreg").innerHTML = `<div class="tw"><table class="t"><tr><th>System</th><th>Component</th><th>Custodian</th><th>Alternate</th><th>Site</th><th>Status</th>${isAdmin() ? "<th></th>" : ""}</tr>
      ${comps.map(c => `<tr><td>${esc(c.system)}</td><td>${esc(c.component)}</td><td>${esc(c.custodian)}</td><td>${esc(c.alternate || "")}</td><td>${esc(c.site || "All")}</td>
        <td>${c.active ? `<span class="badge b-ok">active</span>` : `<span class="badge b-gray">retired</span>`}</td>
        ${isAdmin() ? `<td><button class="btn sm" data-ec="${c.id}">Edit</button></td>` : ""}</tr>`).join("")}</table></div>
      ${isAdmin() ? `<div style="margin-top:8px"><button class="btn sm" data-ec="0">＋ Add component</button></div>` : `<div class="small muted" style="margin-top:6px">Only admins change the register.</div>`}`;
    $$("[data-ec]").forEach(b => b.onclick = () => editComp(+b.dataset.ec ? C[+b.dataset.ec] : null));
  };
  reg();
}
function editComp(c) {
  const m = modal(`<h2 style="margin-top:0">${c ? "Edit" : "Add"} key component</h2><form id="cf"><div class="grid2">
    <label class="f">System<input type="text" id="cs" list="csl" value="${esc(c ? c.system : "")}" required><datalist id="csl">${["ATM", "EBC", "ZMK", "VISA", "Mastercard", "POS", "LMK"].map(x => `<option>${x}</option>`).join("")}</datalist></label>
    <label class="f">Component<input type="text" id="cc" value="${esc(c ? c.component : "Component 1")}" required></label>
    <label class="f">Custodian<input type="text" id="ccu" value="${esc(c ? c.custodian : "")}" required></label>
    <label class="f">Alternate custodian<input type="text" id="ca" value="${esc(c ? c.alternate || "" : "")}"></label>
    <label class="f">Site<select id="cst">${siteOptions(c ? c.site : "", true).replace("All sites", "All sites")}</select></label>
    <label class="f">Status<select id="cac"><option value="1">active</option><option value="0" ${c && !c.active ? "selected" : ""}>retired</option></select></label>
    </div><div class="row"><div class="grow"></div><button class="btn pri">Save</button></div></form>`);
  $("#cf", m).onsubmit = async e => {
    e.preventDefault();
    const row = { system: $("#cs").value.trim(), component: $("#cc").value.trim(), custodian: $("#ccu").value.trim(), alternate: $("#ca").value.trim() || null, site: $("#cst").value || null, active: $("#cac").value === "1" };
    if (c) await q(sb.from("mfa_components").update(row).eq("id", c.id)); else await q(sb.from("mfa_components").insert(row));
    toast("Saved"); closeModal(); route();
  };
}

/* ---------------- RACKS ---------------- */
async function viewRacks() {
  if (needSite("Rack population")) return;
  const racks = await q(sb.from("rack_usage").select("*").eq("site", S.site).order("name"));
  const act = racks.filter(r => r.active);
  const uT = act.reduce((a, r) => a + r.u_total, 0), uU = act.reduce((a, r) => a + r.used_u, 0);
  const kC = act.reduce((a, r) => a + (+r.kw_cap || 0), 0), kU = act.reduce((a, r) => a + (+r.kw_used || 0), 0);
  const bar = (p) => `<div class="bar ${p > 90 ? "b" : p > 75 ? "w" : ""}"><i style="width:${Math.min(100, p)}%"></i></div>`;
  $("#view").innerHTML = `<h1>Rack population — ${esc(siteName(S.site))}</h1>
    <div class="tiles"><div class="tile"><div class="v">${act.length}</div><div class="l">Racks</div></div>
      <div class="tile"><div class="v">${uT ? Math.round(uU / uT * 100) : 0}%</div><div class="l">Space used · ${uU}/${uT} U</div></div>
      <div class="tile"><div class="v">${kC ? Math.round(kU / kC * 100) : 0}%</div><div class="l">Power planned · ${kU.toFixed(1)}/${kC} kW</div></div>
      <div class="tile"><div class="v">${act.reduce((a, r) => a + r.devices, 0)}</div><div class="l">Devices</div></div></div>
    <div class="row" style="margin:14px 0">${isAdmin() ? `<button class="btn acc" id="addr">＋ Add rack</button>` : ""}<div class="grow"></div>
      <input type="text" id="rf" placeholder="Search rack / row / owner"><button class="btn sm" id="rcsv">⬇ Devices CSV</button></div>
    <div class="cards" id="rgrid">${racks.map(r => {
      const up = r.u_total ? Math.round(r.used_u / r.u_total * 100) : 0, kp = r.kw_cap ? Math.round(r.kw_used / r.kw_cap * 100) : 0;
      return `<div class="card rk" data-rack="${r.id}" data-s="${esc((r.name + " " + (r.row_name || "") + " " + (r.owner || "") + " " + r.room).toLowerCase())}">
        <div class="row"><b>${esc(r.name)}</b>${r.active ? "" : `<span class="badge b-gray">inactive</span>`}<div class="grow"></div><span class="small muted">${esc(r.room)}${r.row_name ? " · row " + esc(r.row_name) : ""}</span></div>
        <div class="small" style="margin-top:6px">Space ${r.used_u}/${r.u_total} U (${up}%)</div>${bar(up)}
        <div class="small">Power ${(+r.kw_used).toFixed(1)}${r.kw_cap ? "/" + r.kw_cap : ""} kW${r.kw_cap ? ` (${kp}%)` : ""}</div>${r.kw_cap ? bar(kp) : `<div class="bar"><i style="width:0"></i></div>`}
        <div class="small muted">${r.devices} devices${r.owner ? " · " + esc(r.owner) : ""}</div></div>`;
    }).join("") || `<div class="card muted">No racks yet.${isAdmin() ? " Add the first one." : ""}</div>`}</div>`;
  $$("[data-rack]").forEach(c => c.onclick = () => location.hash = "rack/" + c.dataset.rack);
  $("#rf").oninput = e => { const v = e.target.value.toLowerCase(); $$("[data-rack]").forEach(c => c.classList.toggle("hide", !c.dataset.s.includes(v))); };
  const add = $("#addr"); if (add) add.onclick = () => editRack(null);
  $("#rcsv").onclick = async () => {
    const ids = racks.map(r => r.id); if (!ids.length) return toast("Nothing to export");
    const devs = await q(sb.from("rack_devices").select("*").in("rack_id", ids).order("rack_id").order("u_start"));
    const RN = {}; racks.forEach(r => RN[r.id] = r.name);
    csvDownload(`Rack-population-${S.site}.csv`, devs.map(d => ({ site: S.site, rack: RN[d.rack_id], u_start: d.u_start, u_end: d.u_start + d.u_size - 1, name: d.name, kind: d.kind, kw: d.kw, weight_kg: d.weight_kg, owner: d.owner, serial: d.serial, installed_on: d.installed_on })));
  };
}
function editRack(r) {
  const m = modal(`<h2 style="margin-top:0">${r ? "Edit rack " + esc(r.name) : "Add rack"}</h2><form id="rkf"><div class="grid2">
    <label class="f">Rack name<input type="text" id="rn" value="${esc(r ? r.name : "")}" required></label>
    <label class="f">Room<input type="text" id="rr" value="${esc(r ? r.room : "White space")}"></label>
    <label class="f">Row<input type="text" id="rw" value="${esc(r ? r.row_name || "" : "")}"></label>
    <label class="f">Height (U)<input type="number" id="ru" min="1" max="60" value="${r ? r.u_total : 42}"></label>
    <label class="f">Power capacity (kW)<input type="number" id="rk" step="any" value="${r && r.kw_cap !== null ? r.kw_cap : ""}"></label>
    <label class="f">Weight capacity (kg)<input type="number" id="rwt" step="any" value="${r && r.weight_cap_kg !== null ? r.weight_cap_kg : ""}"></label>
    <label class="f">Owner / business<input type="text" id="ro" value="${esc(r ? r.owner || "" : "")}"></label>
    <label class="f">Status<select id="ra"><option value="1">active</option><option value="0" ${r && !r.active ? "selected" : ""}>inactive</option></select></label>
    </div><label class="f">Note<input type="text" id="rnote" value="${esc(r ? r.note || "" : "")}"></label>
    <div class="row">${r ? `<button type="button" class="btn danger" id="rdel">Delete rack</button>` : ""}<div class="grow"></div><button class="btn pri">Save</button></div></form>`);
  $("#rkf", m).onsubmit = async e => {
    e.preventDefault();
    const row = { site: r ? r.site : S.site, name: $("#rn").value.trim(), room: $("#rr").value.trim() || "White space", row_name: $("#rw").value.trim() || null, u_total: +$("#ru").value || 42, kw_cap: num($("#rk").value), weight_cap_kg: num($("#rwt").value), owner: $("#ro").value.trim() || null, active: $("#ra").value === "1", note: $("#rnote").value.trim() || null };
    if (r) await q(sb.from("racks").update(row).eq("id", r.id)); else await q(sb.from("racks").insert(row));
    toast("Saved"); closeModal(); route();
  };
  const d = $("#rdel"); if (d) d.onclick = async () => {
    if (!confirm(`Delete rack ${r.name} and all its devices?`)) return;
    await q(sb.from("racks").delete().eq("id", r.id)); closeModal(); location.hash = "racks";
  };
}
async function viewRack(id) {
  id = +id;
  const [rk, devs] = await Promise.all([q(sb.from("rack_usage").select("*").eq("id", id).maybeSingle()),
    q(sb.from("rack_devices").select("*").eq("rack_id", id).order("u_start", { ascending: false }))]);
  if (!rk) { $("#view").innerHTML = `<div class="card">Rack not found.</div>`; return; }
  const at = {}; devs.forEach(d => { for (let u = d.u_start; u < d.u_start + d.u_size; u++) at[u] = d; });
  let cells = "";
  for (let u = rk.u_total; u >= 1; u--) {
    const d = at[u];
    if (d && d.u_start + d.u_size - 1 === u) {
      cells += `<div class="u" style="grid-row:span ${d.u_size};height:${22 * d.u_size}px;line-height:${22 * d.u_size}px">${u}</div>
        <div class="dev k-${d.kind}" style="grid-row:span ${d.u_size};height:${22 * d.u_size - 2}px" data-dev="${d.id}" title="${esc(d.name)}"><span>${esc(d.name)}</span><span style="opacity:.8;font-weight:400">${d.kw ? d.kw + " kW" : ""}</span></div>`;
    } else if (!d) cells += `<div class="u">${u}</div><div class="slot" data-u="${u}" title="Free U${u}"></div>`;
  }
  const up = rk.u_total ? Math.round(rk.used_u / rk.u_total * 100) : 0;
  $("#view").innerHTML = `<div class="row"><a href="#racks" class="btn sm">← Racks</a><div class="grow"></div>
      ${isAdmin() ? `<button class="btn sm" id="er">Edit rack</button>` : ""}<button class="btn sm" id="pr">🖨 Print</button></div>
    <h1 style="margin-top:12px">Rack ${esc(rk.name)} <span class="muted small">${esc(rk.site)} · ${esc(rk.room)}${rk.row_name ? " · row " + esc(rk.row_name) : ""}</span></h1>
    <div class="tiles"><div class="tile"><div class="v">${rk.used_u}/${rk.u_total}</div><div class="l">U used (${up}%) · ${rk.u_total - rk.used_u} free</div></div>
      <div class="tile ${rk.kw_cap && rk.kw_used > rk.kw_cap * 0.9 ? "bad" : ""}"><div class="v">${(+rk.kw_used).toFixed(1)}${rk.kw_cap ? "/" + rk.kw_cap : ""}</div><div class="l">kW planned</div></div>
      <div class="tile ${rk.weight_cap_kg && rk.weight_used > rk.weight_cap_kg ? "bad" : ""}"><div class="v">${Math.round(rk.weight_used)}${rk.weight_cap_kg ? "/" + rk.weight_cap_kg : ""}</div><div class="l">kg</div></div>
      <div class="tile"><div class="v">${rk.devices}</div><div class="l">Devices</div></div></div>
    <div class="row" style="align-items:flex-start;margin-top:16px;gap:20px">
      <div><div class="small muted" style="margin-bottom:6px">${canEdit() ? "Tap a free U to add a device, tap a device to edit." : "Front view"}</div><div class="elev">${cells}</div></div>
      <div class="grow" style="min-width:280px"><div class="tw"><table class="t"><tr><th>U</th><th>Device</th><th>Type</th><th>kW</th><th>Owner</th><th>Serial</th></tr>
        ${devs.map(d => `<tr class="click" data-dev="${d.id}"><td class="nowrap">${d.u_start}${d.u_size > 1 ? "–" + (d.u_start + d.u_size - 1) : ""}</td><td>${esc(d.name)}</td><td>${esc(d.kind)}</td><td>${d.kw}</td><td>${esc(d.owner || "")}</td><td>${esc(d.serial || "")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Empty rack</td></tr>`}
      </table></div>${canEdit() ? `<div style="margin-top:8px"><button class="btn acc sm" id="ad">＋ Add device</button></div>` : ""}</div></div>`;
  const D = {}; devs.forEach(d => D[d.id] = d);
  const free = u => !at[u];
  if (canEdit()) {
    $$("[data-u]").forEach(s => s.onclick = () => editDevice(rk, null, +s.dataset.u));
    $$("[data-dev]").forEach(s => s.onclick = () => editDevice(rk, D[s.dataset.dev]));
    $("#ad").onclick = () => { let u = 1; while (u <= rk.u_total && !free(u)) u++; editDevice(rk, null, u <= rk.u_total ? u : 1); };
  }
  const er = $("#er"); if (er) er.onclick = () => editRack(rk);
  $("#pr").onclick = () => printHTML(`<h1>Rack ${esc(rk.name)} — ${esc(siteName(rk.site))}</h1>
    <div class="meta">${esc(rk.room)}${rk.row_name ? " · row " + esc(rk.row_name) : ""} · ${rk.used_u}/${rk.u_total} U · ${(+rk.kw_used).toFixed(1)}${rk.kw_cap ? "/" + rk.kw_cap : ""} kW</div>
    <table><tr><th>U</th><th>Device</th><th>Type</th><th>kW</th><th>kg</th><th>Owner</th><th>Serial</th><th>Installed</th></tr>
    ${devs.map(d => `<tr><td>${d.u_start}${d.u_size > 1 ? "–" + (d.u_start + d.u_size - 1) : ""}</td><td>${esc(d.name)}</td><td>${esc(d.kind)}</td><td>${d.kw}</td><td>${d.weight_kg ?? ""}</td><td>${esc(d.owner || "")}</td><td>${esc(d.serial || "")}</td><td>${esc(d.installed_on || "")}</td></tr>`).join("")}</table>
    <p>Printed ${fmtDT(new Date())} by ${esc(S.me.full_name)}</p>`);
}
function editDevice(rk, d, u) {
  const m = modal(`<h2 style="margin-top:0">${d ? "Edit device" : "Add device"} — rack ${esc(rk.name)}</h2><form id="df"><div class="grid2">
    <label class="f">Device name<input type="text" id="dn" value="${esc(d ? d.name : "")}" required></label>
    <label class="f">Type<select id="dk">${KINDS.map(k => `<option ${d && d.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    <label class="f">Bottom U<input type="number" id="du" min="1" max="${rk.u_total}" value="${d ? d.u_start : u || 1}" required></label>
    <label class="f">Height (U)<input type="number" id="ds" min="1" max="20" value="${d ? d.u_size : 1}" required></label>
    <label class="f">Power (kW)<input type="number" id="dw" step="any" min="0" value="${d ? d.kw : ""}"></label>
    <label class="f">Weight (kg)<input type="number" id="dkg" step="any" value="${d && d.weight_kg !== null ? d.weight_kg : ""}"></label>
    <label class="f">Owner / application<input type="text" id="do" value="${esc(d ? d.owner || "" : "")}"></label>
    <label class="f">Serial<input type="text" id="dsr" value="${esc(d ? d.serial || "" : "")}"></label>
    <label class="f">Installed on<input type="date" id="di" value="${d ? d.installed_on || "" : dayStr()}"></label>
    </div><label class="f">Note<input type="text" id="dno" value="${esc(d ? d.note || "" : "")}"></label>
    <div class="row">${d ? `<button type="button" class="btn danger" id="ddel">Remove from rack</button>` : ""}<div class="grow"></div><button class="btn pri">Save</button></div></form>`);
  $("#df", m).onsubmit = async e => {
    e.preventDefault();
    const row = { rack_id: rk.id, name: $("#dn").value.trim(), kind: $("#dk").value, u_start: +$("#du").value, u_size: +$("#ds").value, kw: num($("#dw").value) || 0, weight_kg: num($("#dkg").value), owner: $("#do").value.trim() || null, serial: $("#dsr").value.trim() || null, installed_on: $("#di").value || null, note: $("#dno").value.trim() || null };
    if (d) await q(sb.from("rack_devices").update(row).eq("id", d.id)); else await q(sb.from("rack_devices").insert(row));
    toast("Saved"); closeModal(); route();
  };
  const del = $("#ddel"); if (del) del.onclick = async () => {
    if (!confirm(`Remove ${d.name} from the rack?`)) return;
    await q(sb.from("rack_devices").delete().eq("id", d.id)); closeModal(); route();
  };
}

/* ---------------- ISSUES ---------------- */
const IF = { status: "active", sev: "", source: "" };
async function viewIssues() {
  let qi = sb.from("issues").select("*").order("opened_at", { ascending: false }).limit(500);
  if (S.site) qi = qi.eq("site", S.site);
  if (IF.status === "active") qi = qi.neq("status", "closed"); else if (IF.status) qi = qi.eq("status", IF.status);
  if (IF.source) qi = qi.eq("source", IF.source);
  const all = await q(qi);
  const list = all.filter(i => !IF.sev || i.severity === IF.sev)
    .sort((a, b) => (a.status === "closed") - (b.status === "closed") || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || new Date(b.opened_at) - new Date(a.opened_at));
  const c = s => all.filter(i => i.severity === s && i.status !== "closed").length;
  const old = all.filter(i => i.status !== "closed" && Date.now() - new Date(i.opened_at) > 7 * 864e5).length;
  $("#view").innerHTML = `<h1>Issues — ${esc(siteName(S.site))}</h1>
    <div class="tiles">${SEV.map(s => `<div class="tile click ${IF.sev === s ? "on" : ""} ${s === "critical" || s === "high" ? (c(s) ? "bad" : "good") : ""}" data-sev="${s}" style="${IF.sev === s ? "border-color:var(--info)" : ""}"><div class="v">${c(s)}</div><div class="l">${s[0].toUpperCase() + s.slice(1)} open</div></div>`).join("")}
      <div class="tile ${old ? "warn" : ""}"><div class="v">${old}</div><div class="l">Open more than 7 days</div></div></div>
    <div class="row" style="margin:14px 0">
      <select id="fs"><option value="active">Open + in progress</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="closed">Closed</option><option value="">All</option></select>
      <select id="fo"><option value="">All sources</option><option value="checklist">Checklist</option><option value="mfa">MFA</option><option value="rack">Racks</option><option value="manual">Manual</option></select>
      ${IF.sev ? `<button class="btn sm" id="fx">✕ ${esc(IF.sev)}</button>` : ""}
      <div class="grow"></div><button class="btn sm" id="icsv">⬇ CSV</button>${canEdit() ? `<button class="btn acc" id="ni">＋ Report issue</button>` : ""}</div>
    ${list.length ? `<div class="tw"><table class="t"><tr><th>#</th><th>Severity</th><th>Issue</th><th>Site</th><th>Source</th><th>Owner</th><th>Opened</th><th>Status</th></tr>
      ${list.map(i => `<tr class="click" data-issue="${i.id}"><td>${i.id}</td><td>${sevBadge(i.severity)}</td><td>${esc(i.title)}${i.photo_id ? " 📷" : ""}</td><td>${esc(i.site)}</td>
        <td>${esc(i.source)}</td><td>${esc(i.owner || "")}</td><td class="nowrap">${fmtDT(i.opened_at)}<br><span class="small muted">${i.status === "closed" ? "closed after " + age(new Date(Date.now() - (new Date(i.closed_at) - new Date(i.opened_at)))) : age(i.opened_at) + " ago"}</span></td>
        <td>${statusBadge(i.status)}</td></tr>`).join("")}</table></div>`
      : `<div class="card muted">No issues match.</div>`}`;
  $("#fs").value = IF.status; $("#fo").value = IF.source;
  $("#fs").onchange = e => { IF.status = e.target.value; route(); };
  $("#fo").onchange = e => { IF.source = e.target.value; route(); };
  $$("[data-sev]").forEach(t => t.onclick = () => { IF.sev = IF.sev === t.dataset.sev ? "" : t.dataset.sev; route(); });
  const fx = $("#fx"); if (fx) fx.onclick = () => { IF.sev = ""; route(); };
  $$("[data-issue]").forEach(r => r.onclick = () => openIssue(+r.dataset.issue));
  const ni = $("#ni"); if (ni) ni.onclick = () => openIssue(0);
  $("#icsv").onclick = () => csvDownload(`Issues-${S.site || "all"}.csv`, list.map(i => ({ id: i.id, site: i.site, severity: i.severity, status: i.status, source: i.source, title: i.title, detail: i.detail, owner: i.owner, opened: fmtDT(i.opened_at), closed: fmtDT(i.closed_at), resolution: i.resolution })));
}
async function openIssue(id) {
  const i = id ? await q(sb.from("issues").select("*").eq("id", id).maybeSingle()) : { site: S.site || (S.sites[0] || {}).id, severity: "medium", status: "open", source: "manual" };
  if (!i) return toast("Issue not found", true);
  if (i.photo_id) await loadPhotos([i.photo_id]);
  const ro = !canEdit();
  let photoId = i.photo_id || null;
  const m = modal(`<h2 style="margin-top:0">${id ? `Issue #${id}` : "Report an issue"}</h2>
    ${id ? `<div class="muted small" style="margin-bottom:10px">${esc(i.source)} · opened ${fmtDT(i.opened_at)} by ${esc(personName(i.opened_by) || "system")}${i.closed_at ? " · closed " + fmtDT(i.closed_at) : ""}</div>` : ""}
    <form id="isf"><label class="f">Title<input type="text" id="it" value="${esc(i.title || "")}" required ${ro ? "disabled" : ""}></label>
    <div class="grid2">
      <label class="f">Site<select id="is" ${ro || id ? "disabled" : ""}>${siteOptions(i.site)}</select></label>
      <label class="f">Severity<select id="iv" ${ro ? "disabled" : ""}>${SEV.map(s => `<option ${s === i.severity ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label class="f">Status<select id="ist" ${ro ? "disabled" : ""}>${["open", "in_progress", "closed"].map(s => `<option value="${s}" ${s === i.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}</select></label>
      <label class="f">Owner<input type="text" id="io" list="iol" value="${esc(i.owner || "")}" ${ro ? "disabled" : ""}><datalist id="iol">${S.people.filter(p => p.active).map(p => `<option>${esc(p.full_name)}</option>`).join("")}</datalist></label>
    </div>
    <label class="f">Details<textarea id="id" ${ro ? "disabled" : ""}>${esc(i.detail || "")}</textarea></label>
    <label class="f">Resolution / action taken<textarea id="ir" ${ro ? "disabled" : ""}>${esc(i.resolution || "")}</textarea></label>
    <div class="row"><span id="iph">${photoId && photoCache[photoId] ? `<img class="thumb" src="${photoCache[photoId]}" alt="">` : ""}</span>
      ${ro ? "" : camButton('id="icam"')}<div class="grow"></div>${ro ? "" : `<button class="btn pri">Save</button>`}</div></form>`);
  const bindImg = () => { const im = $("#iph img"); if (im) im.onclick = () => showImg(im.src); };
  bindImg();
  const cam = $("#icam");
  if (cam) cam.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const p = await savePhoto(f, "issue", `${$("#is").value} · issue`); photoId = p.id; photoCache[p.id] = p.data;
    $("#iph").innerHTML = `<img class="thumb" src="${p.data}" alt="">`; bindImg();
  };
  $("#isf", m).onsubmit = async e => {
    e.preventDefault();
    const row = { title: $("#it").value.trim(), severity: $("#iv").value, status: $("#ist").value, owner: $("#io").value.trim() || null, detail: $("#id").value.trim() || null, resolution: $("#ir").value.trim() || null, photo_id: photoId };
    if (row.status === "closed" && !row.resolution) return toast("Write the resolution before closing", true);
    if (id) await q(sb.from("issues").update(row).eq("id", id));
    else await q(sb.from("issues").insert({ ...row, site: $("#is").value, source: "manual", opened_by: S.user.id }));
    toast("Saved"); closeModal(); route();
  };
}

/* ---------------- KPI DASHBOARD ---------------- */
const KR = { from: addDays(dayStr(), -29), to: dayStr() };
async function viewKpi() {
  const k = await q(sb.rpc("kpi", { p_from: KR.from, p_to: KR.to, p_site: S.site || null }));
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const tile = (v, l, cls = "") => `<div class="tile ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const on = k.open_now || {};
  const html = `<div class="tiles">
      ${tile((k.coverage_pct ?? 0) + "%", `Checklist coverage · ${k.runs_signed} signed of ${k.days * k.sites} site-days`, k.coverage_pct >= 95 ? "good" : k.coverage_pct >= 80 ? "warn" : "bad")}
      ${tile((k.pass_pct ?? "–") + (k.pass_pct !== null ? "%" : ""), `Checks & readings OK · ${k.readings_bad + k.checks_bad} not OK`, k.pass_pct >= 98 ? "good" : "warn")}
      ${tile(k.readings_bad, `Readings out of range (of ${k.readings})`, k.readings_bad ? "bad" : "good")}
      ${tile(k.photos, "Photo evidence captured")}
      ${tile(on.total || 0, `Open issues now · ${on.critical || 0} critical · ${on.high || 0} high`, (on.critical || on.high) ? "bad" : "good")}
      ${tile(k.issues_opened + " / " + k.issues_closed, "Issues opened / closed")}
      ${tile(k.mttr_hours !== null ? k.mttr_hours + " h" : "–", "Mean time to resolve")}
      ${tile(on.older_7d || 0, "Open over 7 days", on.older_7d ? "warn" : "good")}
      ${tile(k.mfa_ops, `MFA operations · avg ${k.mfa_avg_min ?? "–"} min`)}
      ${tile(k.mfa_pending_witness, "MFA witness not confirmed", k.mfa_pending_witness ? "warn" : "good")}
      ${tile(pct(k.u_used, k.u_total) + "%", `Rack space used · ${k.u_used}/${k.u_total} U`)}
      ${tile(pct(k.kw_used, k.kw_cap) + "%", `Rack power planned · ${(+k.kw_used).toFixed(1)}/${k.kw_cap} kW`, pct(k.kw_used, k.kw_cap) > 85 ? "warn" : "")}
    </div>
    <div class="spacer"></div>
    <div class="chart"><h3>Daily activity</h3>${barsChart(k.daily)}
      <div class="legend"><span><i style="background:#1d8a4b"></i>Checklists signed</span><span><i style="background:#c62828"></i>Not OK / out of range</span><span><i style="background:#e8771e"></i>Issues opened</span><span><i style="background:#2563eb"></i>MFA operations</span></div></div>
    <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">
      ${(k.series || []).map(s => `<div class="chart"><h3>${esc(s.title)} <span class="muted small">${esc(s.unit || "")} · ok ${s.min_ok ?? "…"}–${s.max_ok ?? "…"}</span></h3>${lineChart(s, k.daily.map(d => d.d))}</div>`).join("")}
    </div>
    <div class="cards">
      <div class="chart"><h3>Issues by source</h3>${hbars(k.by_source)}</div>
      <div class="chart"><h3>MFA operations by system</h3>${hbars(k.mfa_by_system)}</div>
    </div>`;
  $("#view").innerHTML = `<h1>KPIs — ${esc(siteName(S.site))}</h1>
    <div class="row" style="margin-bottom:12px">
      ${[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["m", "This month"]].map(([v, l]) => `<button class="btn sm" data-r="${v}">${l}</button>`).join("")}
      <input type="date" id="kf" value="${KR.from}"><span>→</span><input type="date" id="kt" value="${KR.to}">
      <div class="grow"></div><button class="btn sm" id="kp">🖨 Print / PDF</button></div>
    <div id="kbody">${html}</div>`;
  $$("[data-r]").forEach(b => b.onclick = () => {
    const t = dayStr(); KR.to = t;
    KR.from = b.dataset.r === "m" ? t.slice(0, 8) + "01" : addDays(t, -(+b.dataset.r - 1)); route();
  });
  $("#kf").onchange = e => { KR.from = e.target.value; route(); };
  $("#kt").onchange = e => { KR.to = e.target.value; route(); };
  $("#kp").onclick = () => printHTML(`<h1>${esc(BRAND())} — KPI report</h1><div class="meta">${esc(siteName(S.site))} · ${KR.from} to ${KR.to} · printed ${fmtDT(new Date())} by ${esc(S.me.full_name)}</div>${html}`);
}
function barsChart(daily) {
  const W = 900, H = 200, P = 26, n = daily.length || 1;
  const max = Math.max(1, ...daily.map(d => Math.max(d.signed, d.bad, d.opened, d.mfa)));
  const bw = (W - P * 2) / n, sub = Math.max(1, (bw - 4) / 4);
  const cols = ["#1d8a4b", "#c62828", "#e8771e", "#2563eb"];
  let s = `<svg viewBox="0 0 ${W} ${H + 24}" role="img"><line x1="${P}" y1="${H}" x2="${W - P}" y2="${H}" stroke="#ccd"/>`;
  s += `<text x="2" y="12" font-size="11" fill="#889">${max}</text>`;
  daily.forEach((d, i) => {
    [d.signed, d.bad, d.opened, d.mfa].forEach((v, j) => {
      const h = v / max * (H - 16);
      if (v) s += `<rect x="${P + i * bw + 2 + j * sub}" y="${H - h}" width="${sub - 0.5}" height="${h}" fill="${cols[j]}"><title>${d.d}: ${v}</title></rect>`;
    });
    if (n <= 31 ? i % Math.ceil(n / 10) === 0 : i % Math.ceil(n / 8) === 0)
      s += `<text x="${P + i * bw + bw / 2}" y="${H + 16}" font-size="11" fill="#667" text-anchor="middle">${d.d.slice(5)}</text>`;
  });
  return s + "</svg>";
}
function lineChart(s, days) {
  const W = 420, H = 150, P = 30;
  const pts = s.points; const vals = pts.flatMap(p => [+p.min, +p.max]).concat([s.min_ok, s.max_ok].filter(v => v !== null).map(Number));
  let lo = Math.min(...vals), hi = Math.max(...vals); if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const n = days.length, X = d => P + (days.indexOf(d) / Math.max(1, n - 1)) * (W - P - 8), Y = v => 8 + (hi - v) / (hi - lo) * (H - 16);
  let o = `<svg viewBox="0 0 ${W} ${H + 18}" role="img">`;
  if (s.min_ok !== null || s.max_ok !== null) {
    const a = Y(s.max_ok !== null ? +s.max_ok : hi), b = Y(s.min_ok !== null ? +s.min_ok : lo);
    o += `<rect x="${P}" y="${a}" width="${W - P - 8}" height="${b - a}" fill="#1d8a4b" opacity=".08"/>`;
  }
  [lo + pad, hi - pad].forEach(v => o += `<text x="2" y="${Y(v) + 4}" font-size="10" fill="#889">${Math.round(v * 10) / 10}</text>`);
  pts.forEach(p => o += `<line x1="${X(p.d)}" x2="${X(p.d)}" y1="${Y(+p.max)}" y2="${Y(+p.min)}" stroke="#9db4dd" stroke-width="3"/>`);
  o += `<polyline fill="none" stroke="#123e7a" stroke-width="2" points="${pts.map(p => X(p.d) + "," + Y(+p.avg)).join(" ")}"/>`;
  pts.forEach(p => {
    const bad = (s.min_ok !== null && +p.min < +s.min_ok) || (s.max_ok !== null && +p.max > +s.max_ok);
    o += `<circle cx="${X(p.d)}" cy="${Y(+p.avg)}" r="3.5" fill="${bad ? "#c62828" : "#123e7a"}"><title>${p.d}: avg ${p.avg} (min ${p.min}, max ${p.max})</title></circle>`;
  });
  o += `<text x="${P}" y="${H + 14}" font-size="10" fill="#667">${days[0].slice(5)}</text><text x="${W - 8}" y="${H + 14}" font-size="10" fill="#667" text-anchor="end">${days[n - 1].slice(5)}</text>`;
  return o + "</svg>";
}
function hbars(obj) {
  const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (!e.length) return `<div class="muted small">No data in this period.</div>`;
  const max = Math.max(...e.map(x => x[1]));
  return `<div class="hbars">${e.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><span><b style="width:${v / max * 100}%"></b></span><span class="right">${v}</span></div>`).join("")}</div>`;
}

/* ---------------- ADMIN ---------------- */
async function refreshPeople() { S.people = await q(sb.from("profiles").select("id,full_name,role,is_dc,active,site").order("full_name")); }
function credsModal(r, isNew) {
  const url = location.origin + location.pathname;
  const msg = `${BRAND()} portal\n${url}\n\nSign in with:\nWhatsApp number: ${showPhone(r.phone)}\nTemporary password: ${r.password}\n\nYou will choose your own password after signing in.`;
  const m = modal(`<h2>${isNew ? "Account created" : "New password"} — ${esc(r.name || "")}</h2>
    <div class="card" style="font-size:16px">Number: <b>${esc(showPhone(r.phone))}</b><br>Temporary password: <b style="font-family:monospace;letter-spacing:1px">${esc(r.password)}</b></div>
    <div class="small muted" style="margin:8px 0">This password is shown only now. They must change it at first sign-in.</div>
    <div class="row"><a class="btn pri" target="_blank" rel="noopener" href="https://wa.me/${esc(r.phone)}?text=${encodeURIComponent(msg)}">Send on WhatsApp</a>
    <button class="btn" id="cpy">Copy message</button><button class="btn" data-close>Done</button></div>`);
  $("#cpy", m).onclick = async () => { try { await navigator.clipboard.writeText(msg); toast("Copied"); } catch (e) { toast("Copy not allowed here — select the text instead", true); } };
}
async function viewAdmin() {
  if (!isAdmin()) { $("#view").innerHTML = `<div class="card">Admins only.</div>`; return; }
  const [people, items, use, audit] = await Promise.all([
    q(sb.from("profiles").select("*").order("created_at")),
    q(sb.from("checklist_items").select("*").order("sort").order("id")),
    q(sb.rpc("data_usage")),
    q(sb.from("audit_log").select("*").order("id", { ascending: false }).limit(150))]);
  const st = S.settings;
  const pctUse = Math.round(use.photo_mb / use.budget_mb * 100);
  $("#view").innerHTML = `<h1>Admin</h1>
    <h2>Users</h2>
    <div class="card" style="margin-bottom:8px"><form id="addu" class="grid2">
      <label class="f">Full name<input type="text" id="u_name" required maxlength="80"></label>
      <label class="f">WhatsApp number<input type="tel" id="u_phone" placeholder="01012345678 or 254712345678" inputmode="tel" required></label>
      <label class="f">Role<select id="u_role"><option value="operator">operator — fills checklists, MFA, racks, issues</option><option value="viewer">viewer — read only</option><option value="admin">admin — everything incl. users</option></select></label>
      <label class="f">Home site<select id="u_site"><option value="">—</option>${S.sites.map(s => `<option>${esc(s.id)}</option>`).join("")}</select></label>
      <label class="f">First password <span class="muted">(leave empty for a random one)</span><input type="text" id="u_pw" minlength="8" autocomplete="off"></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="u_dc" checked> DC rep (may sign as MFA witness)</label>
      <div class="row" style="align-items:flex-end"><button class="btn pri">+ Add person</button></div></form>
      <div class="small muted" style="margin-top:6px">People sign in with their WhatsApp number and password. After adding someone you can send them their login on WhatsApp; they choose their own password the first time.</div></div>
    <div class="tw"><table class="t"><tr><th>Name</th><th>WhatsApp</th><th>Role</th><th>DC rep</th><th>Home site</th><th>Active</th><th></th></tr>
      ${people.map(p => `<tr data-p="${p.id}"><td><input type="text" data-f="full_name" value="${esc(p.full_name)}"></td><td class="small nowrap">${esc(showPhone(p.phone) || p.email || "")}${p.must_change_pw ? ` <span class="badge" title="Has not chosen a password yet">new</span>` : ""}</td>
        <td><select data-f="role">${["admin", "operator", "viewer"].map(r => `<option ${r === p.role ? "selected" : ""}>${r}</option>`).join("")}</select></td>
        <td><input type="checkbox" data-f="is_dc" ${p.is_dc ? "checked" : ""}></td>
        <td><select data-f="site"><option value="">—</option>${S.sites.map(s => `<option ${s.id === p.site ? "selected" : ""}>${esc(s.id)}</option>`).join("")}</select></td>
        <td><input type="checkbox" data-f="active" ${p.active ? "checked" : ""} ${p.id === S.user.id ? "disabled" : ""}></td>
        <td class="nowrap">${p.phone ? `<button class="btn sm" data-reset="${p.id}">Reset password</button>` : ""}${p.id !== S.user.id ? ` <button class="btn sm" data-del="${p.id}" title="Remove">🗑</button>` : ""}</td></tr>`).join("")}</table></div>

    <h2>Checklist items</h2>
    <div class="small muted" style="margin-bottom:6px">Readings outside the OK range open an issue automatically and feed the KPI charts. Leave site empty to use the item at every site.</div>
    <div class="tw"><table class="t"><tr><th>Order</th><th>Area</th><th>Item</th><th>Type</th><th>Unit</th><th>Min OK</th><th>Max OK</th><th>Photo</th><th>Site</th><th>Active</th></tr>
      ${items.map(i => itemRow(i)).join("")}${itemRow({ id: "new", sort: (items.length + 1) * 10, area: "", title: "", kind: "check", active: true })}</table></div>

    <h2>Sites</h2>
    <div class="tw"><table class="t"><tr><th>Code</th><th>Name</th><th>Order</th><th>Active</th></tr>
      ${S.sites.map(s => `<tr data-site-row="${esc(s.id)}"><td><b>${esc(s.id)}</b></td><td><input type="text" data-f="name" value="${esc(s.name)}"></td><td><input type="number" data-f="sort" value="${s.sort}" style="width:70px"></td><td><input type="checkbox" data-f="active" ${s.active ? "checked" : ""}></td></tr>`).join("")}
      <tr data-site-row=""><td><input type="text" data-f="id" placeholder="CODE" style="width:90px"></td><td><input type="text" data-f="name" placeholder="New site name"></td><td><input type="number" data-f="sort" value="${S.sites.length + 1}" style="width:70px"></td><td><button class="btn sm" id="addsite">Add</button></td></tr></table></div>

    <h2>Settings</h2>
    <div class="card"><form id="stf" class="grid2">
      <label class="f">Auto sign-out after idle (minutes)<input type="number" id="s1" min="2" max="240" value="${st.idle_minutes}"></label>
      <label class="f">Photo space budget (MB, free plan max 400)<input type="number" id="s2" min="20" max="400" value="${st.photo_budget_mb}"></label>
      <label class="f">Keep photos for (days)<input type="number" id="s3" min="7" max="3650" value="${st.photo_keep_days}"></label>
      <label class="f">Rack power alert at (% of capacity)<input type="number" id="s4" min="50" max="100" value="${st.rack_kw_alert_pct}"></label>
      <label class="f">MFA session flagged after (hours)<input type="number" id="s5" min="1" max="72" value="${st.mfa_open_hours}"></label>
      <div class="row" style="align-items:flex-end"><button class="btn pri">Save settings</button></div></form></div>

    <h2>Database space</h2>
    <div class="card"><div class="row"><b>${use.db_mb} MB</b><span class="muted">used of the 500 MB free plan</span></div>
      <div class="bar ${use.db_mb > 420 ? "b" : use.db_mb > 350 ? "w" : ""}"><i style="width:${Math.min(100, use.db_mb / 5)}%"></i></div>
      <div class="small">Photos: ${use.photo_mb} MB (${use.photos}) of ${use.budget_mb} MB budget (${pctUse}%) — oldest photos are removed first when full. Logs are never removed.</div>
      <div class="small muted" style="margin-top:6px">${use.runs} checklists · ${use.results} answers · ${use.issues} issues · ${use.mfa} MFA entries · ${use.devices} rack devices · ${use.audit} audit records</div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="bk">⬇ Full backup (JSON, without photos)</button><button class="btn sm" id="bkp">⬇ Backup with photos</button></div></div>

    <h2>Audit log <span class="small muted">(last 150 changes)</span></h2>
    <div class="tw"><table class="t"><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr>
      ${audit.map(a => `<tr><td class="nowrap">${fmtDT(a.at)}</td><td>${esc(a.by_name || "system")}</td><td>${esc(a.op.toLowerCase())} ${esc(a.tbl)} #${esc(a.row_id)}</td>
        <td class="small" style="max-width:420px;word-break:break-word">${esc(JSON.stringify(a.change).slice(0, 220))}</td></tr>`).join("")}</table></div>`;

  $$("[data-p]").forEach(tr => $$("[data-f]", tr).forEach(inp => inp.onchange = async () => {
    const v = inp.type === "checkbox" ? inp.checked : inp.value || (inp.dataset.f === "site" ? null : "");
    await q(sb.from("profiles").update({ [inp.dataset.f]: v }).eq("id", tr.dataset.p));
    toast(inp.dataset.f === "active" && v ? "Switched on — use Reset password to send them a new password" : "Saved"); await refreshPeople();
  }));
  $("#addu").onsubmit = async e => {
    e.preventDefault();
    const ph = normPhone($("#u_phone").value);
    if (!ph) return toast("Enter a valid WhatsApp number, e.g. 01012345678 (with the country code outside Egypt).", true);
    const pw = $("#u_pw").value.trim();
    if (pw && pw.length < 8) return toast("The password must be at least 8 characters.", true);
    const b = $("#addu button"); b.disabled = true;
    try {
      const r = await q(sb.rpc("admin_create_user", { p_phone: ph, p_name: $("#u_name").value.trim(), p_role: $("#u_role").value,
        p_is_dc: $("#u_dc").checked, p_site: $("#u_site").value || null, p_password: pw || null }));
      await refreshPeople(); await route(); credsModal(r, true);
    } finally { b.disabled = false; }
  };
  $$("[data-reset]").forEach(b => b.onclick = async () => {
    const p = people.find(x => x.id === b.dataset.reset);
    if (!confirm(`Give ${p.full_name} a new temporary password? Their current password stops working.`)) return;
    const r = await q(sb.rpc("admin_reset_password", { p_id: p.id, p_password: null }));
    await route(); credsModal(r, false);
  });
  $$("[data-del]").forEach(b => b.onclick = async () => {
    const p = people.find(x => x.id === b.dataset.del);
    if (!confirm(`Remove ${p.full_name} (${showPhone(p.phone)})?\nIf they have checklists or MFA entries, the account is switched off instead so the logs keep their name.`)) return;
    const r = await q(sb.rpc("admin_remove_user", { p_id: p.id }));
    toast(r === "deleted" ? "Account deleted" : "Account switched off — logs kept"); await refreshPeople(); route();
  });
  $$("[data-item-row]").forEach(tr => $$("[data-f]", tr).forEach(inp => inp.onchange = async () => {
    const id = tr.dataset.itemRow;
    const row = {};
    $$("[data-f]", tr).forEach(x => { const f = x.dataset.f; row[f] = x.type === "checkbox" ? x.checked : ["min_ok", "max_ok", "sort"].includes(f) ? num(x.value) : (x.value.trim() || null); });
    row.sort = row.sort ?? 0; row.area = row.area || "General";
    if (id === "new") {
      if (!row.title) return;
      await q(sb.from("checklist_items").insert(row)); toast("Item added"); route();
    } else { await q(sb.from("checklist_items").update(row).eq("id", +id)); toast("Saved"); }
  }));
  $$("[data-site-row]").forEach(tr => {
    const id = tr.dataset.siteRow;
    if (id) $$("[data-f]", tr).forEach(inp => inp.onchange = async () => {
      await q(sb.from("sites").update({ [inp.dataset.f]: inp.type === "checkbox" ? inp.checked : inp.dataset.f === "sort" ? +inp.value : inp.value.trim() }).eq("id", id));
      S.sites = await q(sb.from("sites").select("*").order("sort")); toast("Saved");
    });
  });
  $("#addsite").onclick = async () => {
    const tr = $('[data-site-row=""]'); const id = $('[data-f="id"]', tr).value.trim().toUpperCase(), name = $('[data-f="name"]', tr).value.trim();
    if (!id || !name) return toast("Code and name needed", true);
    await q(sb.from("sites").insert({ id, name, sort: +$('[data-f="sort"]', tr).value || 0 }));
    S.sites = await q(sb.from("sites").select("*").order("sort")); shell(); route();
  };
  $("#stf").onsubmit = async e => {
    e.preventDefault();
    const row = { idle_minutes: +$("#s1").value, photo_budget_mb: +$("#s2").value, photo_keep_days: +$("#s3").value, rack_kw_alert_pct: +$("#s4").value, mfa_open_hours: +$("#s5").value };
    await q(sb.from("settings").update(row).eq("id", 1)); Object.assign(S.settings, row); bumpIdle(); toast("Settings saved");
  };
  const backup = async withPhotos => {
    toast("Preparing backup…");
    const tables = ["sites", "profiles", "settings", "checklist_items", "checklist_runs", "checklist_results", "racks", "rack_devices", "issues", "mfa_components", "mfa_log", "audit_log"];
    if (withPhotos) tables.push("photos");
    const out = { exported_at: new Date().toISOString(), by: S.me.full_name };
    for (const t of tables) {
      out[t] = [];
      for (let from = 0; ; from += 1000) {
        const rows = await q(sb.from(t).select("*").order("id").range(from, from + 999));
        out[t].push(...rows); if (rows.length < 1000) break;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
    a.download = `DC-backup-${dayStr()}${withPhotos ? "-photos" : ""}.json`; a.click();
  };
  $("#bk").onclick = () => backup(false);
  $("#bkp").onclick = () => backup(true);
}
function itemRow(i) {
  return `<tr data-item-row="${i.id}">
    <td><input type="number" data-f="sort" value="${i.sort ?? ""}" style="width:64px"></td>
    <td><input type="text" data-f="area" value="${esc(i.area || "")}" placeholder="Area" style="width:150px"><input type="text" data-f="area_ar" dir="rtl" value="${esc(i.area_ar || "")}" placeholder="المنطقة (عربي)" style="width:150px;margin-top:4px"></td>
    <td><input type="text" data-f="title" value="${esc(i.title || "")}" placeholder="${i.id === "new" ? "＋ New item — type and press Enter" : ""}" style="min-width:220px"><input type="text" data-f="title_ar" dir="rtl" value="${esc(i.title_ar || "")}" placeholder="البند (عربي)" style="min-width:220px;margin-top:4px"></td>
    <td><select data-f="kind"><option value="check" ${i.kind === "check" ? "selected" : ""}>OK / not OK</option><option value="reading" ${i.kind === "reading" ? "selected" : ""}>Reading</option></select></td>
    <td><input type="text" data-f="unit" value="${esc(i.unit || "")}" style="width:60px"></td>
    <td><input type="number" step="any" data-f="min_ok" value="${i.min_ok ?? ""}" style="width:70px"></td>
    <td><input type="number" step="any" data-f="max_ok" value="${i.max_ok ?? ""}" style="width:70px"></td>
    <td><input type="checkbox" data-f="photo_required" ${i.photo_required ? "checked" : ""}></td>
    <td><select data-f="site"><option value="">All</option>${S.sites.map(s => `<option ${s.id === i.site ? "selected" : ""}>${esc(s.id)}</option>`).join("")}</select></td>
    <td><input type="checkbox" data-f="active" ${i.active ? "checked" : ""}></td></tr>`;
}
