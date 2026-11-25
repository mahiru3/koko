import { firebaseConfig } from "./51-session-config.js";
import {
  initializeApp, getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
  getDatabase, ref, push, set, update, remove, onValue, onChildAdded,
  query, limitToLast, serverTimestamp, onDisconnect, connectDatabaseEmulator
} from "./51-session-fb.js";
import { parseTekeyJson, renderPalette, expandVars } from "./51-session-palette.js";
import { readRoomZip, compressImage, assetKey } from "./51-session-import.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM_RE = /^[a-z0-9-]{4,40}$/;
const LOG_LIMIT = 300;
const UNIT = 24;
const PAD = 6;

const S = {
  db: null, uid: null, roomId: "", name: "", color: "#4a90d9",
  loader: null, system: null, calc: null, systemId: "DiceBot",
  meta: {}, vars: {}, chars: {}, items: {}, markers: {}, scenes: {}, notes: {},
  assets: new Map(), nodes: new Map(),
  zoom: 1, origin: { x: 0, y: 0 }, drag: null, renderQueued: false, fitted: false,
  speaker: "", selChar: "", palettes: [], palSel: ""
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setStatus(text, bad) {
  $("status").textContent = text;
  $("status").classList.toggle("bad", !!bad);
}

function randomId(n) {
  const c = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (v) => c[v % c.length]).join("");
}

function newKey() {
  return Date.now().toString(36) + randomId(6);
}

function src(key) {
  if (!key) return "";
  if (typeof key === "string" && (key.startsWith("data:image/") || key.startsWith("https://"))) return key;
  return S.assets.get(key) || "";
}

function rp(path) {
  return ref(S.db, "rooms/" + S.roomId + (path ? "/" + path : ""));
}

function sorted(obj, by) {
  return Object.entries(obj || {}).sort((a, b) => ((a[1][by] ?? 0) - (b[1][by] ?? 0)) || a[0].localeCompare(b[0]));
}

function initJoin() {
  $("joinRoom").value = params.get("room") || "";
  $("joinName").value = localStorage.getItem("s51-name") || "";
  $("joinColor").value = localStorage.getItem("s51-color") || "#4a90d9";
  $("newRoom").addEventListener("click", () => { $("joinRoom").value = randomId(10); });
  $("joinBtn").addEventListener("click", join);
  $("joinName").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  if (!(firebaseConfig.apiKey && firebaseConfig.databaseURL) && !params.has("emu")) {
    $("joinMsg").textContent = "51-session-config.js に Firebase の設定を貼り付けてください。";
    $("joinBtn").disabled = true;
  }
}

async function join() {
  const roomId = $("joinRoom").value.trim().toLowerCase();
  const name = $("joinName").value.trim();
  if (!ROOM_RE.test(roomId)) { $("joinMsg").textContent = "部屋IDは半角英数字とハイフンで4〜40文字です。"; return; }
  if (!name) { $("joinMsg").textContent = "名前を入力してください。"; return; }
  Object.assign(S, { roomId, name, color: $("joinColor").value });
  localStorage.setItem("s51-name", name);
  localStorage.setItem("s51-color", S.color);
  $("joinBtn").disabled = true;
  $("joinMsg").textContent = "接続中…";
  try {
    await connect();
  } catch (err) {
    $("joinBtn").disabled = false;
    $("joinMsg").textContent = "接続に失敗しました: " + err.message;
  }
}

async function connect() {
  const emu = params.has("emu");
  const app = initializeApp(emu ? { apiKey: "demo-key", projectId: "demo-s51", databaseURL: "http://127.0.0.1:9000/?ns=demo-s51" } : firebaseConfig);
  const auth = getAuth(app);
  S.db = getDatabase(app);
  if (emu) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(S.db, "127.0.0.1", 9000);
  }
  await signInAnonymously(auth);
  await new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { if (u) { S.uid = u.uid; off(); resolve(); } });
  });
  const url = new URL(location.href);
  url.searchParams.set("room", S.roomId);
  history.replaceState(null, "", url);
  $("join").hidden = true;
  $("room").hidden = false;
  $("roomLabel").textContent = S.roomId;
  startRoom();
}

async function startRoom() {
  initTabs();
  await initSystems();
  initPresence();
  initChat();
  initBoard();
  initChars();
  initPalettes();
  initRoomTab();
  $("copyUrl").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); setStatus("URLをコピーしました"); }
    catch (e) { prompt("このURLを共有してください", location.href); }
  });
  onChildAdded(rp("assets"), (s) => { S.assets.set(s.key, s.val()); queueRender(); updateAssetInfo(); });
  onValue(rp("meta"), (s) => {
    S.meta = s.val() || {};
    S.vars = S.meta.vars || {};
    const b = S.meta.board || {};
    const sig = [b.fieldW, b.fieldH, b.fg, S.meta.fieldMult].join("|");
    if (sig !== S.boardSig) { S.boardSig = sig; S.fitted = false; }
    if ((S.meta.system || "DiceBot") !== S.systemId) loadSystem(S.meta.system || "DiceBot");
    $("fieldMult").value = String(S.meta.fieldMult || 4);
    $("gridShow").checked = !!(S.meta.board && S.meta.board.displayGrid);
    renderVars();
    queueRender();
  });
  const watch = (name, after) => onValue(rp(name), (s) => { S[name] = s.val() || {}; if (after) after(); queueRender(); });
  watch("chars", () => { renderCharList(); renderSpeaker(); renderCharDetail(); renderPaletteTabs(); });
  watch("items");
  watch("markers");
  watch("scenes", renderScenes);
  watch("notes", renderNotes);
}

function initTabs() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
}

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
  if (name === "chat") scrollLog(true);
}

async function initSystems() {
  S.loader = new BCDiceLite.LiteLoader();
  S.calc = await S.loader.dynamicLoad("DiceBot");
  const sel = $("systemSel");
  S.loader.listAvailableGameSystems()
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"))
    .forEach((info) => { const o = el("option", "", info.name); o.value = info.id; sel.append(o); });
  sel.addEventListener("change", () => set(rp("meta/system"), sel.value));
  await loadSystem("DiceBot");
}

async function loadSystem(id) {
  try { S.system = await S.loader.dynamicLoad(id); S.systemId = id; }
  catch (e) { S.system = S.calc; S.systemId = "DiceBot"; }
  $("systemSel").value = S.systemId;
}

function initPresence() {
  const mine = rp("members/" + S.uid);
  onValue(ref(S.db, ".info/connected"), (snap) => {
    if (snap.val() === true) {
      setStatus("接続中");
      onDisconnect(mine).remove().then(() => set(mine, { name: S.name, color: S.color, t: serverTimestamp() }));
    } else {
      setStatus("切断（再接続待ち）", true);
    }
  });
  onValue(rp("members"), (snap) => {
    const list = $("memberList");
    list.replaceChildren();
    let n = 0;
    snap.forEach((c) => {
      n++;
      const m = c.val() || {};
      const li = el("li");
      const dot = el("span", "dot");
      dot.style.background = m.color || "#888";
      li.append(dot, el("span", "", (m.name || "?") + (c.key === S.uid ? "（自分）" : "")));
      list.append(li);
    });
    $("memberCount").textContent = n + "人";
  });
}

function speakerChar() {
  return S.speaker && S.chars[S.speaker] ? S.chars[S.speaker] : null;
}

function charByName(name) {
  const hit = Object.entries(S.chars).find(([, c]) => c.name === name);
  return hit ? hit[0] : "";
}

function lookupVars(c) {
  const v = {};
  Object.entries(S.vars || {}).forEach(([k, val]) => { v[k] = /^[\s　]*$/.test(val) ? "" : val; });
  if (c) {
    (c.params || []).forEach((p) => { if (p.label) v[p.label] = String(p.value); });
    (c.status || []).forEach((s) => { if (s.label) v[s.label] = String(s.value); });
  }
  return v;
}

function initChat() {
  const input = $("chatInput");
  $("sendBtn").addEventListener("click", () => submit(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); }
  });
  $("speaker").addEventListener("change", () => { S.speaker = $("speaker").value; localStorage.setItem("s51-speaker-" + S.roomId, S.speaker); renderPaletteTabs(); });
  S.speaker = localStorage.getItem("s51-speaker-" + S.roomId) || "";
  onChildAdded(query(rp("messages"), limitToLast(LOG_LIMIT)), (snap) => renderMessage(snap.val()));
}

function renderSpeaker() {
  const sel = $("speaker");
  sel.replaceChildren();
  const me = el("option", "", S.name + "（プレイヤー）");
  me.value = "";
  sel.append(me);
  sorted(S.chars, "order").forEach(([id, c]) => { const o = el("option", "", c.name || "（名前なし）"); o.value = id; sel.append(o); });
  if (S.speaker && !S.chars[S.speaker]) S.speaker = "";
  sel.value = S.speaker;
}

async function submit(raw) {
  const text = raw.replace(/\s+$/, "");
  if (!text) return;
  $("chatInput").value = "";
  try {
    await sendChat(text, S.speaker);
  } catch (e) {
    $("chatInput").value = text;
    setStatus("送信失敗: " + e.message, true);
  }
}

function lastNumber(t) {
  const m = String(t).match(/(-?\d+)\s*$/);
  return m ? parseInt(m[1], 10) : NaN;
}

function evalNumber(expr) {
  const e = expr.trim();
  if (/^-?\d+$/.test(e)) return { n: parseInt(e, 10), detail: "" };
  const r = /d/i.test(e) ? S.calc.eval(e) : S.calc.eval("C(" + e + ")");
  if (!r) return { n: NaN, detail: "" };
  return { n: lastNumber(r.text), detail: r.text };
}

async function statusCommand(line, charId) {
  const m = line.match(/^:([^\s+\-=*\/　]+)\s*([+\-=])\s*([^\s　]*)/);
  if (!m) return null;
  const c = S.chars[charId];
  if (!c) return { error: "ステータスを変えるには発言キャラを選んでください" };
  const label = m[1];
  const v = evalNumber(m[3] || "0");
  if (Number.isNaN(v.n)) return { error: "値を計算できませんでした: " + m[3] };
  const st = (c.status || []).map((s) => ({ ...s }));
  let idx = st.findIndex((s) => s.label === label);
  const pr = (c.params || []).map((p) => ({ ...p }));
  const pidx = pr.findIndex((p) => p.label === label);
  let before;
  let after;
  if (idx < 0 && pidx >= 0) {
    before = parseInt(pr[pidx].value, 10) || 0;
    after = m[2] === "=" ? v.n : m[2] === "+" ? before + v.n : before - v.n;
    pr[pidx].value = String(after);
    await update(rp("chars/" + charId), { params: pr });
  } else {
    if (idx < 0) { st.push({ label, value: 0, max: 0 }); idx = st.length - 1; }
    before = +st[idx].value || 0;
    after = m[2] === "=" ? v.n : m[2] === "+" ? before + v.n : before - v.n;
    st[idx].value = after;
    await update(rp("chars/" + charId), { status: st });
  }
  return { text: "[ " + (c.name || "") + " ] " + label + " : " + before + " → " + after + (v.detail ? "（" + v.detail + "）" : "") };
}

function rollDice(text) {
  if (!S.system) return null;
  const first = text.split("\n")[0].replace(/　/g, " ");
  try { return S.system.eval(first); } catch (e) { return null; }
}

function resultClass(r) {
  if (r.critical) return "critical";
  if (r.fumble) return "fumble";
  if (r.success) return "success";
  if (r.failure) return "failure";
  return "";
}

async function postSystem(text) {
  await push(rp("messages"), { uid: S.uid, name: "system", color: "#888888", text: text.slice(0, 2000), sys: true, t: serverTimestamp() });
}

async function sendChat(rawText, charId) {
  const c = S.chars[charId] || null;
  let text = rawText;
  let icon = c ? c.icon || "" : "";
  if (c && Array.isArray(c.faces)) {
    const face = c.faces.find((f) => f.label && f.label.startsWith("@") && text.includes(f.label));
    if (face) { icon = face.icon || icon; text = text.replace(face.label, "").trim() || text; }
  }
  const expanded = expandVars(text, lookupVars(c));
  const first = expanded.split("\n")[0].trim();

  if (/^\/scene(\s|$)/.test(first)) {
    const name = first.replace(/^\/scene\s*/, "").trim();
    const hit = Object.entries(S.scenes).find(([, s]) => (s.name || "") === name);
    if (!hit) { await postSystem("シーン「" + name + "」が見つかりません"); return; }
    await applyScene(hit[0]);
    return;
  }
  if (/^\/var\s/.test(text.split("\n")[0])) {
    const m = text.split("\n")[0].match(/^\/var\s+(\S+)\s?(.*)$/);
    if (m) {
      await set(rp("meta/vars/" + assetKey(m[1])), m[2] === "" ? "　" : m[2]);
      await postSystem("ルーム変数 " + m[1] + " を「" + m[2] + "」にしました");
    }
    return;
  }

  const msg = {
    uid: S.uid,
    name: (c ? c.name : S.name) || S.name,
    color: c ? c.color || S.color : S.color,
    text: expanded.slice(0, 2000),
    t: serverTimestamp()
  };
  if (icon) msg.icon = icon;
  if (first.startsWith(":")) {
    const r = await statusCommand(first, charId);
    if (r) {
      msg.dice = r.error || r.text;
      msg.res = r.error ? "failure" : "";
      await push(rp("messages"), msg);
      return;
    }
  }
  const r = rollDice(expanded);
  if (r) {
    msg.dice = String(r.text).slice(0, 2000);
    msg.res = resultClass(r);
    msg.sys2 = S.systemId;
    if (r.secret) msg.secret = true;
  }
  await push(rp("messages"), msg);
}

function nearBottom() {
  const log = $("log");
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

function scrollLog(force) {
  const log = $("log");
  if (force || nearBottom()) log.scrollTop = log.scrollHeight;
}

function renderMessage(m) {
  if (!m) return;
  const stick = nearBottom();
  const li = el("li", "msg-item" + (m.sys ? " sys" : ""));
  const body = el("div", "msg-body");
  if (m.icon) {
    const im = el("img", "avatar");
    im.alt = "";
    im.dataset.asset = m.icon;
    im.src = src(m.icon);
    li.append(im);
  }
  const head = el("div", "who", m.name || "?");
  head.style.color = m.color || "#ccc";
  head.append(el("span", "time", m.t ? new Date(m.t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : ""));
  body.append(head);
  if (m.secret && m.uid !== S.uid) {
    body.append(el("div", "dice secret", "シークレットダイス"));
  } else {
    body.append(el("div", "text", m.text || ""));
    if (m.dice) body.append(el("div", "dice " + (m.res || ""), (m.secret ? "[S] " : "") + m.dice));
  }
  li.append(body);
  const log = $("log");
  log.append(li);
  while (log.children.length > LOG_LIMIT) log.firstElementChild.remove();
  if (stick || m.uid === S.uid) scrollLog(true);
}

function refreshAvatars() {
  document.querySelectorAll("img[data-asset]").forEach((im) => {
    const s = src(im.dataset.asset);
    if (s && im.src !== s) im.src = s;
  });
}

function fieldRect() {
  const b = S.meta.board || {};
  const mult = S.meta.fieldMult || 4;
  const w = (b.fieldW || 16) * mult;
  const h = (b.fieldH || 9) * mult;
  return { x: -w / 2, y: -h / 2, w, h };
}

function initBoard() {
  $("zoomIn").addEventListener("click", () => setZoom(S.zoom * 1.25));
  $("zoomOut").addEventListener("click", () => setZoom(S.zoom / 1.25));
  $("zoomFit").addEventListener("click", fitField);
  window.addEventListener("resize", () => { if (!S.drag) queueRender(); });
}

function setZoom(z, keepCenter) {
  const wrap = $("boardWrap");
  const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / S.zoom;
  const cy = (wrap.scrollTop + wrap.clientHeight / 2) / S.zoom;
  S.zoom = Math.max(0.15, Math.min(4, z));
  $("zoomLabel").textContent = Math.round(S.zoom * 100) + "%";
  layoutSizer();
  if (keepCenter !== false) {
    wrap.scrollLeft = cx * S.zoom - wrap.clientWidth / 2;
    wrap.scrollTop = cy * S.zoom - wrap.clientHeight / 2;
  }
}

function fitField() {
  const wrap = $("boardWrap");
  const f = fieldRect();
  const z = Math.min(wrap.clientWidth / ((f.w + 2) * UNIT), wrap.clientHeight / ((f.h + 2) * UNIT));
  setZoom(z, false);
  wrap.scrollLeft = (f.x + S.origin.x + f.w / 2) * UNIT * S.zoom - wrap.clientWidth / 2;
  wrap.scrollTop = (f.y + S.origin.y + f.h / 2) * UNIT * S.zoom - wrap.clientHeight / 2;
}

function layoutSizer() {
  const board = $("board");
  board.style.transform = "scale(" + S.zoom + ")";
  $("sizer").style.width = parseFloat(board.style.width || 0) * S.zoom + "px";
  $("sizer").style.height = parseFloat(board.style.height || 0) * S.zoom + "px";
}

function queueRender() {
  if (S.renderQueued) return;
  S.renderQueued = true;
  requestAnimationFrame(() => { S.renderQueued = false; renderBoard(); refreshAvatars(); });
}

function boardObjects() {
  const list = [];
  Object.entries(S.items).forEach(([id, o]) => { if (o.visible !== false) list.push({ kind: "items", id, o }); });
  Object.entries(S.markers).forEach(([id, o]) => list.push({ kind: "markers", id, o }));
  Object.entries(S.chars).forEach(([id, o]) => { if (o.active !== false) list.push({ kind: "chars", id, o }); });
  return list;
}

function renderBoard() {
  if (S.drag) return;
  const f = fieldRect();
  const objs = boardObjects();
  let minX = f.x, minY = f.y, maxX = f.x + f.w, maxY = f.y + f.h;
  objs.forEach(({ o }) => {
    minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + (o.w || 1)); maxY = Math.max(maxY, o.y + (o.h || 1));
  });
  S.origin = { x: -minX + PAD, y: -minY + PAD };
  const board = $("board");
  board.style.width = (maxX - minX + PAD * 2) * UNIT + "px";
  board.style.height = (maxY - minY + PAD * 2) * UNIT + "px";
  layoutSizer();

  const b = S.meta.board || {};
  const wrap = $("boardWrap");
  const bg = src(b.bg);
  wrap.style.backgroundImage = bg ? "url(\"" + bg + "\")" : "";
  wrap.style.backgroundColor = b.bgColor || "";
  const field = $("field");
  field.style.left = (f.x + S.origin.x) * UNIT + "px";
  field.style.top = (f.y + S.origin.y) * UNIT + "px";
  field.style.width = f.w * UNIT + "px";
  field.style.height = f.h * UNIT + "px";
  const fg = src(b.fg);
  field.style.backgroundImage = fg ? "url(\"" + fg + "\")" : "";
  board.classList.toggle("grid", !!b.displayGrid);
  board.style.backgroundSize = (b.gridSize || 2) * UNIT + "px " + (b.gridSize || 2) * UNIT + "px";

  const seen = new Set();
  objs.forEach((obj) => { seen.add(obj.kind + ":" + obj.id); drawObject(obj); });
  S.nodes.forEach((node, key) => { if (!seen.has(key)) { node.remove(); S.nodes.delete(key); } });

  if (!S.fitted && wrap.clientWidth > 0) { S.fitted = true; fitField(); }
}

function drawObject({ kind, id, o }) {
  const key = kind + ":" + id;
  let node = S.nodes.get(key);
  if (!node) {
    node = el("div", "obj obj-" + kind);
    node.dataset.kind = kind;
    node.dataset.id = id;
    const img = el("img", "obj-img");
    img.alt = "";
    img.draggable = false;
    node.append(img);
    if (kind === "chars") node.append(el("div", "face-fallback"), el("div", "label"), el("div", "bars"));
    bindPointer(node);
    $("board").append(node);
    S.nodes.set(key, node);
  }
  node.style.left = (o.x + S.origin.x) * UNIT + "px";
  node.style.top = (o.y + S.origin.y) * UNIT + "px";
  node.style.width = (o.w || 1) * UNIT + "px";
  node.style.height = (o.h || 1) * UNIT + "px";
  node.style.zIndex = String(Math.round(o.z || 0) + (kind === "chars" ? 1000 : 0));
  node.classList.toggle("locked", !!o.locked);
  node.classList.toggle("clickable", !!o.click);
  node.title = kind === "markers" ? (o.text || "") : (o.memo || "");
  const img = node.querySelector(".obj-img");
  const s = src(kind === "items" && o.closed ? o.cover : (kind === "chars" ? o.icon : o.img));
  if (img.getAttribute("src") !== s) { if (s) img.src = s; else img.removeAttribute("src"); }
  img.hidden = !s;
  if (kind === "chars") {
    const fb = node.querySelector(".face-fallback");
    fb.hidden = !!s;
    fb.textContent = (o.name || "?").slice(0, 1);
    fb.style.background = o.color || "#888";
    node.querySelector(".label").textContent = o.name || "";
    const bars = node.querySelector(".bars");
    bars.replaceChildren();
    if (!o.hideStatus) {
      (o.status || []).slice(0, 4).forEach((st) => {
        const row = el("div", "sbar");
        const fill = el("span", "bar-fill");
        const pct = st.max > 0 ? Math.max(0, Math.min(100, (st.value / st.max) * 100)) : 100;
        fill.style.width = pct + "%";
        row.append(fill, el("span", "bar-text", st.label + " " + st.value + (st.max ? "/" + st.max : "")));
        bars.append(row);
      });
    }
  } else if (kind === "markers" && !s && o.text) {
    node.dataset.text = o.text.split("\n")[0];
  }
}

function bindPointer(node) {
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, active = false;
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { kind, id } = node.dataset;
    const o = S[kind][id];
    if (!o) return;
    e.preventDefault();
    e.stopPropagation();
    active = true;
    moved = false;
    sx = e.clientX; sy = e.clientY;
    ox = o.x; oy = o.y;
    if (!o.locked) {
      node.setPointerCapture(e.pointerId);
      S.drag = { kind, id };
      node.classList.add("drag");
    }
  });
  node.addEventListener("pointermove", (e) => {
    if (!active || !S.drag || S.drag.id !== node.dataset.id) return;
    const dx = (e.clientX - sx) / S.zoom / UNIT;
    const dy = (e.clientY - sy) / S.zoom / UNIT;
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
    node.style.left = (ox + dx + S.origin.x) * UNIT + "px";
    node.style.top = (oy + dy + S.origin.y) * UNIT + "px";
  });
  const end = (e, cancel) => {
    if (!active) return;
    active = false;
    const { kind, id } = node.dataset;
    const o = S[kind][id];
    const wasDrag = !!S.drag;
    S.drag = null;
    node.classList.remove("drag");
    if (wasDrag && moved && !cancel) {
      const nx = Math.round(ox + (e.clientX - sx) / S.zoom / UNIT);
      const ny = Math.round(oy + (e.clientY - sy) / S.zoom / UNIT);
      update(rp(kind + "/" + id), { x: nx, y: ny }).catch((err) => setStatus("保存失敗: " + err.message, true));
    } else if (!moved && !cancel && o) {
      onObjectClick(kind, id, o);
    }
    queueRender();
  };
  node.addEventListener("pointerup", (e) => end(e, false));
  node.addEventListener("pointercancel", (e) => end(e, true));
}

function onObjectClick(kind, id, o) {
  if (o.click) {
    sendChat(o.click, S.speaker).catch((err) => setStatus("送信失敗: " + err.message, true));
    return;
  }
  if (kind === "chars") {
    S.selChar = id;
    renderCharList();
    renderCharDetail();
    showTab("chars");
  }
}

async function applyScene(id) {
  const sc = S.scenes[id];
  if (!sc) return;
  const b = { ...(S.meta.board || {}), bg: sc.bg || "", fg: sc.fg || "", fieldW: sc.fieldW || 16, fieldH: sc.fieldH || 9, gridSize: sc.gridSize || 2, displayGrid: !!sc.displayGrid };
  await update(rp(""), { "meta/board": b, "meta/sceneId": id, markers: sc.markers || null });
  await postSystem("シーン「" + (sc.name || "（名前なし）") + "」に切り替えました");
}

function renderScenes() {
  const list = $("sceneList");
  list.replaceChildren();
  const entries = sorted(S.scenes, "order");
  if (!entries.length) list.append(el("li", "empty", "シーンはまだありません（room.zip を読み込むと入ります）"));
  entries.forEach(([id, sc]) => {
    const li = el("li");
    const th = el("img", "thumb");
    th.alt = "";
    th.dataset.asset = sc.fg || sc.bg || "";
    th.src = src(th.dataset.asset);
    const name = el("span", "", sc.name || "（名前なし）");
    const go = el("button", "primary", "切替");
    go.type = "button";
    go.addEventListener("click", () => applyScene(id));
    if (S.meta.sceneId === id) li.classList.add("current");
    li.append(th, name, go);
    list.append(li);
  });
}

function renderNotes() {
  const box = $("noteList");
  box.replaceChildren();
  const entries = sorted(S.notes, "order");
  if (!entries.length) box.append(el("p", "msg", "メモはまだありません"));
  entries.forEach(([, n], i) => {
    const d = el("details", "note acc-color-" + ((i % 4) + 1));
    d.append(el("summary", "", n.name || "（無題）"));
    const pre = el("div", "note-text", n.text || "");
    d.append(pre);
    box.append(d);
  });
}

function renderVars() {
  const list = $("varList");
  list.replaceChildren();
  const entries = Object.entries(S.vars || {});
  if (!entries.length) list.append(el("li", "", "なし（/var 名前 値 で作成）"));
  entries.forEach(([k, v]) => list.append(el("li", "", "{" + k + "} = " + (/^[\s　]*$/.test(v) ? "（空）" : v))));
}

function initChars() {
  $("pieceAdd").addEventListener("click", addChar);
  $("cdSpeak").addEventListener("click", () => {
    S.speaker = S.selChar;
    localStorage.setItem("s51-speaker-" + S.roomId, S.speaker);
    renderSpeaker();
    renderPaletteTabs();
    showTab("chat");
  });
  $("cdDelete").addEventListener("click", () => {
    if (S.selChar && confirm("このキャラを削除しますか？")) { remove(rp("chars/" + S.selChar)); S.selChar = ""; }
  });
  const field = (id, key, conv) => $(id).addEventListener("change", () => {
    if (!S.selChar) return;
    const v = conv ? conv($(id)) : $(id).value;
    update(rp("chars/" + S.selChar), { [key]: v });
  });
  field("cdName", "name");
  field("cdColor", "color");
  field("cdActive", "active", (e) => e.checked);
  field("cdHide", "hideStatus", (e) => e.checked);
  field("cdMemo", "memo");
  field("cdCommands", "commands");
  $("cdAddStatus").addEventListener("click", () => {
    const c = S.chars[S.selChar]; if (!c) return;
    const label = prompt("ステータス名（例: HP）"); if (!label) return;
    update(rp("chars/" + S.selChar), { status: [...(c.status || []), { label, value: 0, max: 0 }] });
  });
  $("cdAddParam").addEventListener("click", () => {
    const c = S.chars[S.selChar]; if (!c) return;
    const label = prompt("パラメータ名（例: STR）"); if (!label) return;
    update(rp("chars/" + S.selChar), { params: [...(c.params || []), { label, value: "0" }] });
  });
  $("pieceFile").addEventListener("change", () => { $("pieceMsg").textContent = $("pieceFile").files[0] ? "画像を選びました" : ""; });
}

async function uploadAsset(file, max) {
  const url = await compressImage(await file.arrayBuffer(), file.type || "image/png", max);
  const key = "u" + newKey();
  await set(rp("assets/" + key), url);
  return key;
}

async function addChar() {
  const name = $("pieceName").value.trim() || "キャラ";
  const f = fieldRect();
  const c = {
    name: name.slice(0, 60), color: $("pieceColor").value,
    x: Math.round(f.x + 2 + Math.random() * 4), y: Math.round(f.y + 2 + Math.random() * 4), z: 100,
    w: 2, h: 2, status: [{ label: "HP", value: 10, max: 10 }, { label: "MP", value: 10, max: 10 }, { label: "SAN", value: 50, max: 99 }],
    params: [], commands: "", memo: "", active: true, order: Date.now()
  };
  try {
    $("pieceAdd").disabled = true;
    if ($("pieceFile").files[0]) { $("pieceMsg").textContent = "画像を圧縮中…"; c.icon = await uploadAsset($("pieceFile").files[0], 512); }
    const r = await push(rp("chars"), c);
    S.selChar = r.key;
    $("pieceName").value = "";
    $("pieceFile").value = "";
    $("pieceMsg").textContent = "追加しました";
  } catch (err) {
    $("pieceMsg").textContent = "追加に失敗しました: " + err.message;
  } finally {
    $("pieceAdd").disabled = false;
  }
}

function renderCharList() {
  const list = $("charList");
  list.replaceChildren();
  sorted(S.chars, "order").forEach(([id, c]) => {
    const li = el("li", id === S.selChar ? "current" : "");
    const th = el("img", "thumb round");
    th.alt = "";
    th.dataset.asset = c.icon || "";
    th.src = src(c.icon);
    const name = el("span", "", (c.name || "（名前なし）") + (c.active === false ? "（盤外）" : ""));
    li.append(th, name);
    li.addEventListener("click", () => { S.selChar = id; renderCharList(); renderCharDetail(); });
    list.append(li);
  });
}

function renderCharDetail() {
  const c = S.chars[S.selChar];
  $("charDetail").hidden = !c;
  if (!c) return;
  const keep = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  keep("cdName", c.name || "");
  keep("cdColor", c.color || "#888888");
  keep("cdMemo", c.memo || "");
  keep("cdCommands", c.commands || "");
  $("cdActive").checked = c.active !== false;
  $("cdHide").checked = !!c.hideStatus;

  const faces = $("cdFaces");
  faces.replaceChildren();
  (c.faces || []).forEach((fc) => {
    const b = el("button", "face-btn");
    b.type = "button";
    b.title = (fc.label || "") + "（クリックで駒の画像にする）";
    const im = el("img");
    im.alt = "";
    im.dataset.asset = fc.icon || "";
    im.src = src(fc.icon);
    b.append(im, el("span", "", fc.label || "-"));
    b.addEventListener("click", () => update(rp("chars/" + S.selChar), { icon: fc.icon || "" }));
    faces.append(b);
  });

  const rows = (tbodyId, arr, key, withMax) => {
    const tb = $(tbodyId);
    tb.replaceChildren();
    (arr || []).forEach((s, i) => {
      const tr = el("tr");
      tr.append(el("th", "", s.label));
      const vIn = el("input");
      vIn.value = s.value;
      vIn.inputMode = withMax ? "numeric" : "text";
      vIn.addEventListener("change", () => {
        const next = (S.chars[S.selChar][key] || []).map((x) => ({ ...x }));
        next[i].value = withMax ? (parseInt(vIn.value, 10) || 0) : vIn.value;
        update(rp("chars/" + S.selChar), { [key]: next });
      });
      const td = el("td");
      td.append(vIn);
      tr.append(td);
      if (withMax) {
        const mIn = el("input");
        mIn.value = s.max;
        mIn.inputMode = "numeric";
        mIn.addEventListener("change", () => {
          const next = (S.chars[S.selChar][key] || []).map((x) => ({ ...x }));
          next[i].max = parseInt(mIn.value, 10) || 0;
          update(rp("chars/" + S.selChar), { [key]: next });
        });
        const td2 = el("td");
        td2.append(mIn);
        tr.append(td2);
      }
      const del = el("button", "del", "×");
      del.type = "button";
      del.addEventListener("click", () => {
        const next = (S.chars[S.selChar][key] || []).filter((_, j) => j !== i);
        update(rp("chars/" + S.selChar), { [key]: next });
      });
      const td3 = el("td");
      td3.append(del);
      tr.append(td3);
      tb.append(tr);
    });
  };
  rows("cdStatus", c.status, "status", true);
  rows("cdParams", c.params, "params", false);
}

function palStoreKey() {
  return "s51-pal-" + S.roomId;
}

function savePalettes() {
  localStorage.setItem(palStoreKey(), JSON.stringify(S.palettes));
}

function initPalettes() {
  try { S.palettes = JSON.parse(localStorage.getItem(palStoreKey()) || "[]"); } catch (e) { S.palettes = []; }
  if (!S.palettes.length) {
    S.palettes = [{ id: "p0", label: "自分用", name: "", stock: "###よく使う\nCCB<=50 【目星】\nCCB<=50 【聞き耳】\n1d100<={SAN} 【正気度ロール】\n###\n:SAN-1\n:HP-1" }];
    savePalettes();
  }
  S.palSel = S.palettes[0].id;
  $("tekeyFile").addEventListener("change", async (e) => {
    let added = 0;
    for (const f of e.target.files) {
      try { const list = parseTekeyJson(JSON.parse(await f.text())); S.palettes.push(...list); added += list.length; }
      catch (err) { $("palMsg").textContent = f.name + " を読めませんでした"; }
    }
    if (added) { savePalettes(); S.palSel = S.palettes[S.palettes.length - added].id; $("palMsg").textContent = added + "個のパレットを読み込みました"; }
    e.target.value = "";
    renderPaletteTabs();
  });
  $("palNew").addEventListener("click", () => {
    const p = { id: "p" + newKey(), label: "新規", name: "", stock: "" };
    S.palettes.push(p);
    S.palSel = p.id;
    savePalettes();
    $("palEditor").hidden = false;
    renderPaletteTabs();
  });
  $("palEdit").addEventListener("click", () => { $("palEditor").hidden = !$("palEditor").hidden; renderPaletteTabs(); });
  $("palDel").addEventListener("click", () => {
    const i = S.palettes.findIndex((p) => p.id === S.palSel);
    if (i < 0 || !confirm("このパレットを削除しますか？")) return;
    S.palettes.splice(i, 1);
    S.palSel = S.palettes[0] ? S.palettes[0].id : "";
    savePalettes();
    renderPaletteTabs();
  });
  const bindEdit = (id, key) => $(id).addEventListener("input", () => {
    const p = S.palettes.find((x) => x.id === S.palSel);
    if (!p) return;
    p[key] = $(id).value;
    savePalettes();
    if (key === "stock") renderPaletteView(); else renderPaletteTabs();
  });
  bindEdit("palLabel", "label");
  bindEdit("palName", "name");
  bindEdit("palStock", "stock");
  renderPaletteTabs();
}

function allPalettes() {
  const list = S.palettes.map((p) => ({ ...p, local: true }));
  const c = speakerChar();
  if (c && c.commands) list.push({ id: "char:" + S.speaker, label: "駒: " + (c.name || ""), name: c.name || "", stock: c.commands, local: false });
  return list;
}

function renderPaletteTabs() {
  const box = $("palTabs");
  box.replaceChildren();
  const list = allPalettes();
  if (!list.find((p) => p.id === S.palSel) && list[0]) S.palSel = list[0].id;
  list.forEach((p) => {
    const b = el("button", p.id === S.palSel ? "on" : "", p.label || "（無題）");
    b.type = "button";
    b.addEventListener("click", () => { S.palSel = p.id; renderPaletteTabs(); });
    box.append(b);
  });
  const cur = list.find((p) => p.id === S.palSel);
  const editable = cur && cur.local;
  $("palEdit").disabled = !editable;
  $("palDel").disabled = !editable;
  if (!editable) $("palEditor").hidden = true;
  if (editable && !$("palEditor").hidden) {
    if (document.activeElement !== $("palLabel")) $("palLabel").value = cur.label;
    if (document.activeElement !== $("palName")) $("palName").value = cur.name;
    if (document.activeElement !== $("palStock")) $("palStock").value = cur.stock;
  }
  renderPaletteView();
}

function renderPaletteView() {
  const cur = allPalettes().find((p) => p.id === S.palSel);
  const view = $("palView");
  if (!cur) { view.replaceChildren(); return; }
  const who = () => (cur.name && charByName(cur.name)) || S.speaker;
  renderPalette(cur.stock, view, el, {
    fill: (cmd) => { $("chatInput").value = cmd; showTab("chat"); $("chatInput").focus(); },
    send: (cmd) => sendChat(cmd, who()).catch((err) => setStatus("送信失敗: " + err.message, true))
  });
}

function initRoomTab() {
  $("zipFile").addEventListener("change", importZip);
  $("fieldMult").addEventListener("change", () => set(rp("meta/fieldMult"), parseInt($("fieldMult").value, 10)).then(() => { S.fitted = false; queueRender(); }));
  $("gridShow").addEventListener("change", () => set(rp("meta/board/displayGrid"), $("gridShow").checked));
  const img = (id, key) => $(id).addEventListener("change", async () => {
    const f = $(id).files[0];
    if (!f) return;
    const k = await uploadAsset(f, 1600);
    await set(rp("meta/board/" + key), k);
    $(id).value = "";
  });
  img("bgFile", "bg");
  img("fgFile", "fg");
}

function updateAssetInfo() {
  let total = 0;
  S.assets.forEach((v) => { total += (v || "").length; });
  $("assetInfo").textContent = "画像 " + S.assets.size + "枚・約" + (total / 1024 / 1024).toFixed(1) + "MB（無料枠の保存容量は1GB）";
}

async function importZip(e) {
  const file = e.target.files[0];
  if (!file) return;
  const msg = $("zipMsg");
  $("zipFile").disabled = true;
  try {
    msg.textContent = "読み込み中…";
    const data = await readRoomZip(file, (t) => { msg.textContent = t; });
    const keys = Object.keys(data.assets);
    for (let i = 0; i < keys.length; i++) {
      msg.textContent = "画像をアップロード中 " + (i + 1) + "/" + keys.length;
      await set(rp("assets/" + keys[i]), data.assets[keys[i]]);
    }
    msg.textContent = "盤面データを書き込み中…";
    const replace = $("zipReplace").checked;
    const up = {};
    const put = (name, obj) => {
      if (replace) up[name] = Object.keys(obj).length ? obj : null;
      else Object.entries(obj).forEach(([k, v]) => { up[name + "/" + k] = v; });
    };
    put("chars", data.chars);
    put("items", data.items);
    put("markers", data.markers);
    put("scenes", data.scenes);
    put("notes", data.notes);
    up["meta/board"] = data.board;
    up["meta/sceneId"] = null;
    if (Object.keys(data.vars).length) {
      if (replace) up["meta/vars"] = data.vars;
      else Object.entries(data.vars).forEach(([k, v]) => { up["meta/vars/" + k] = v; });
    }
    if (data.usesCCB && S.systemId === "DiceBot") up["meta/system"] = "Cthulhu";
    await update(rp(""), up);
    S.fitted = false;
    queueRender();
    msg.textContent = "読み込み完了：キャラ" + Object.keys(data.chars).length + "・パネル" + Object.keys(data.items).length + "・シーン" + Object.keys(data.scenes).length + "・メモ" + Object.keys(data.notes).length + "・画像" + keys.length;
    await postSystem(S.name + " が room.zip を読み込みました");
  } catch (err) {
    msg.textContent = "読み込みに失敗しました: " + err.message;
  } finally {
    $("zipFile").disabled = false;
    $("zipFile").value = "";
  }
}

initJoin();
