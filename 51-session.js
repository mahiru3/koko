import { firebaseConfig } from "./51-session-config.js?v=4d";
import {
  initializeApp, getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
  getDatabase, ref, push, set, update, remove, onValue, onChildAdded,
  onChildRemoved, query, limitToLast, serverTimestamp, onDisconnect, connectDatabaseEmulator
} from "./51-session-fb.js?v=4d";
import { parseTekeyJson, renderPalette, expandVars, moveLine } from "./51-session-palette.js?v=4d";
import { readRoomZip, compressImage, assetKey, parseCharJson, normLabel } from "./51-session-import.js?v=4d";
import { ensureProfile } from "./51-session-id.js?v=4d";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM_RE = /^[a-z0-9-]{4,40}$/;
const LOG_LIMIT = 300;
const UNIT = 24;
const PAD = 6;
const CHAR_Z = 100;
const FG_Z = 1;
const CH_TABS = [["main", "メイン"], ["info", "情報"], ["talk", "雑談"]];
const CHECK_RE = /^(\s*S?(?:CCB?|CC|1D100)\s*(?:\(\d+\))?\s*<=\s*)([^\s　]+)/i;
const MOBILE = matchMedia("(max-width: 800px)");

const S = {
  db: null, uid: null, roomId: "", name: "", color: "#4a90d9",
  loader: null, system: null, calc: null, systemId: "DiceBot",
  meta: {}, vars: {}, chars: {}, items: {}, markers: {}, scenes: {}, notes: {},
  assets: new Map(), nodes: new Map(),
  zoom: 1, origin: { x: 0, y: 0 }, drag: null, renderQueued: false, fitted: false,
  speaker: "", selChar: "", palettes: [], palSel: "",
  pid: "", libSets: new Map(), libFiles: new Map(), libSubs: new Set(), mySets: {}, showAllChars: false,
  isKP: false, isOwner: false, kpOpen: true, selItem: "", selMarker: "", off: { x: 0, y: 0 }, created: "", metaSeen: false, players: {}, online: {},
  chatTab: "main", msgs: [], unread: {}, popReady: false, bonus: null, palPlace: {}, palPick: -1, palClosed: new Set(), cbOrder: [], wins: {}, winZ: 60, colOrder: [], popPc: false
};

function applyTheme() {
  const light = localStorage.getItem("s51-theme") === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  const b = $("themeBtn");
  if (b) b.textContent = light ? "ダーク" : "ライト";
}

function kpCheck() {
  const m = S.meta || {};
  return !!S.pid && (m.owner === S.pid || !!(m.kps && m.kps[S.pid]));
}

function visibleChar(c) {
  return !!c && (!c.kpOnly || S.isKP);
}

function isStand(c) {
  return !!c && c.kind === "stand";
}

function canEdit(c) {
  return !!c && (S.isKP || c.owner === S.pid);
}

function visBase(c) {
  return isStand(c) && c.parent && S.chars[c.parent] ? S.chars[c.parent] : c;
}

function showsParams(c) {
  return visBase(c).showParams !== false;
}

function showsOther(c) {
  const b = visBase(c);
  return b.showOther !== undefined ? b.showOther !== false : !b.hideStatus;
}

function canSeeParams(c) {
  return !!c && (S.isKP || c.owner === S.pid || showsParams(c));
}

function canSeeOther(c) {
  return !!c && (S.isKP || c.owner === S.pid || showsOther(c));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function blurInput() {
  const a = document.activeElement;
  if (a && a !== document.body && a.matches("input, textarea, select")) a.blur();
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

function libSet(pid, sid) {
  const k = pid + "/" + sid;
  if (!S.libSubs.has("s:" + k)) {
    S.libSubs.add("s:" + k);
    onValue(ref(S.db, "lib/" + pid + "/sets/" + sid), (s) => {
      S.libSets.set(k, s.val());
      queueRender();
      renderSpeaker();
      renderCharList();
      renderCharDetail();
    });
  }
  return S.libSets.get(k) || null;
}

function libFile(pid, fk) {
  const k = pid + "/" + fk;
  if (!S.libSubs.has("f:" + k)) {
    S.libSubs.add("f:" + k);
    onValue(ref(S.db, "lib/" + pid + "/files/" + fk + "/data"), (s) => {
      S.libFiles.set(k, s.val() || "");
      queueRender();
    });
  }
  return S.libFiles.get(k) || "";
}

function faceList(c) {
  if (!c) return [];
  if (c.set && c.set.pid && c.set.sid) {
    const st = libSet(c.set.pid, c.set.sid);
    return st && Array.isArray(st.faces)
      ? st.faces.filter((f) => f && f.file).map((f) => ({ label: f.label || "", key: "lib:" + c.set.pid + "/" + f.file }))
      : [];
  }
  return (Array.isArray(c.faces) ? c.faces : []).map((f) => ({ label: f.label || "", key: f.icon || "" }));
}

function charIcon(c) {
  if (!c) return "";
  const fl = faceList(c);
  const parent = isStand(c) && c.parent ? S.chars[c.parent] : null;
  const face = parent ? parent.face : c.face;
  if (fl.length) {
    const f = fl.find((x) => x.label && x.label === face) || (c.set || parent ? fl[0] : null);
    if (f && f.key) return f.key;
  }
  return c.icon || "";
}

function src(key) {
  if (!key) return "";
  if (typeof key === "string" && key.startsWith("lib:")) {
    const [pid, fk] = key.slice(4).split("/");
    return pid && fk ? libFile(pid, fk) : "";
  }
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
  if (params.has("kicked")) $("joinMsg").textContent = "KPにこの部屋から外されました。もう一度入室できます。";
  $("joinName").value = localStorage.getItem("s51-name") || "";
  $("joinColor").value = localStorage.getItem("s51-color") || "#4a90d9";
  $("newRoom").addEventListener("click", () => { $("joinRoom").value = randomId(10); S.created = $("joinRoom").value; });
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
  S.pid = (await ensureProfile(S.db, S.uid)).pid;
  const url = new URL(location.href);
  url.searchParams.set("room", S.roomId);
  url.searchParams.delete("kicked");
  history.replaceState(null, "", url);
  $("join").hidden = true;
  $("room").hidden = false;
  $("roomLabel").textContent = S.roomId;
  $("meName").textContent = S.name;
  $("meName").style.color = S.color;
  startRoom();
}

async function startRoom() {
  initTabs();
  initKeep();
  initWindows();
  initPaste();
  await initSystems();
  initPresence().catch((e) => setStatus("参加者の登録に失敗しました: " + e.message, true));
  initChat();
  initBoard();
  initChars();
  initPalettes();
  initRoomTab();
  $("copyUrl").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); setStatus("URLをコピーしました"); }
    catch (e) { prompt("このURLを共有してください", location.href); }
  });
  onChildAdded(rp("assets"), (s) => { S.assets.set(s.key, s.val()); queueRender(); updateAssetInfo(); queueAssetUi(); });
  onChildRemoved(rp("assets"), (s) => { S.assets.delete(s.key); queueRender(); updateAssetInfo(); queueAssetUi(); });
  $("ctBonus").addEventListener("change", () => {
    const n = Math.max(1, Math.min(99, parseInt($("ctBonus").value, 10) || 20));
    $("ctBonus").value = n;
    set(rp("meta/ctBonus"), n);
  });
  onValue(rp("meta"), (s) => {
    const raw = s.val();
    if (!raw && S.metaSeen) setStatus("この部屋は削除されたか、空になりました", true);
    if (raw) S.metaSeen = true;
    S.meta = raw || {};
    if (!S.meta.owner && S.created && S.created === S.roomId) { S.created = ""; set(rp("meta/owner"), S.pid); }
    const kp = kpCheck();
    S.isOwner = !!S.pid && S.meta.owner === S.pid;
    if (kp !== S.isKP) { S.isKP = kp; renderCharList(); renderSpeaker(); renderCharDetail(); }
    renderPlayers();
    applyKpLayout();
    renderBoardPickers();
    renderObjLists();
    S.vars = S.meta.vars || {};
    const b = S.meta.board || {};
    const sig = [b.fieldW, b.fieldH, b.fg, S.meta.fieldMult].join("|");
    if (sig !== S.boardSig) { S.boardSig = sig; S.fitted = false; }
    if ((S.meta.system || "DiceBot") !== S.systemId) loadSystem(S.meta.system || "DiceBot");
    $("fieldMult").value = String(S.meta.fieldMult || 4);
    $("gridShow").checked = !!(S.meta.board && S.meta.board.displayGrid);
    if (document.activeElement !== $("ctBonus")) $("ctBonus").value = ctBonus();
    if (S.chanReady) chansChanged();
    renderBonus();
    renderVars();
    queueRender();
  });
  const watch = (name, after) => onValue(rp(name), (s) => { S[name] = s.val() || {}; if (after) after(); queueRender(); });
  watch("chars", () => { renderCharList(); renderSpeaker(); renderCharDetail(); renderPaletteTabs(); renderPlayers(); });
  onValue(ref(S.db, "lib/" + S.pid + "/sets"), (s) => { S.mySets = s.val() || {}; renderCharDetail(); });
  watch("items", renderObjLists);
  watch("markers", renderObjLists);
  watch("scenes", renderScenes);
  watch("notes", renderNotes);
}

function initTabs() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("kpToggle").addEventListener("click", () => {
    S.kpOpen = !S.kpOpen;
    localStorage.setItem("s51-kpopen", S.kpOpen ? "1" : "");
    applyKpLayout();
  });
  S.kpOpen = localStorage.getItem("s51-kpopen") !== "";
}

function showTab(name) {
  const panel = $("tab-" + name);
  if (!panel) return;
  const side = panel.closest(".side");
  side.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  side.querySelectorAll(".panel").forEach((p) => { p.hidden = p !== panel; });
  if (name === "chat") scrollLog(true);
}

function initKeep() {
  document.querySelectorAll("details[data-keep]").forEach((d) => {
    const k = "s51-open-" + d.dataset.keep;
    const v = localStorage.getItem(k);
    if (v !== null) d.open = v === "1";
    d.addEventListener("toggle", () => localStorage.setItem(k, d.open ? "1" : "0"));
  });
}

function isPc() {
  return !MOBILE.matches;
}

function winNode(k) {
  return $(k === "kp" ? "kpSide" : "plSide");
}

function saveWins() {
  localStorage.setItem("s51-wins", JSON.stringify(S.wins));
}

function fixPlTab() {
  if (isPc() && !$("tab-chat").hidden) showTab("palette");
}

function applyWins() {
  const pc = isPc();
  fixPlTab();
  ["kp", "pl"].forEach((k) => {
    const node = winNode(k);
    const w = pc && S.wins[k];
    node.classList.toggle("floating", !!w);
    if (w) {
      const vw = innerWidth;
      const vh = innerHeight;
      w.w = Math.max(260, Math.min(w.w, vw));
      w.h = Math.max(200, Math.min(w.h, vh - 8));
      w.x = Math.max(0, Math.min(w.x, vw - 80));
      w.y = Math.max(0, Math.min(w.y, vh - w.h));
      Object.assign(node.style, { left: w.x + "px", top: w.y + "px", width: w.w + "px", height: w.h + "px" });
    } else {
      Object.assign(node.style, { left: "", top: "", width: "", height: "", zIndex: "" });
    }
  });
  const room = $("room");
  room.classList.toggle("kp-float", pc && !!S.wins.kp);
  room.classList.toggle("pl-float", pc && !!S.wins.pl);
  $("layoutReset").hidden = !(pc && (S.wins.kp || S.wins.pl));
  queueRender();
}

function initWindows() {
  try { S.wins = JSON.parse(localStorage.getItem("s51-wins") || "{}") || {}; } catch (e) { S.wins = {}; }
  $("layoutReset").addEventListener("click", () => { S.wins = {}; saveWins(); applyWins(); });
  MOBILE.addEventListener("change", applyWins);
  window.addEventListener("resize", () => { if (isPc() && (S.wins.kp || S.wins.pl)) applyWins(); });
  document.querySelectorAll(".grip").forEach((g) => {
    const k = g.dataset.win;
    const node = winNode(k);
    let st = null;
    g.addEventListener("pointerdown", (e) => {
      if (!isPc() || e.button !== 0) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      if (!S.wins[k]) { S.wins[k] = { x: r.left, y: r.top, w: r.width, h: Math.min(r.height, Math.round(innerHeight * 0.7)) }; applyWins(); }
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: S.wins[k].x, oy: S.wins[k].y };
      node.style.zIndex = String(++S.winZ);
      g.setPointerCapture(e.pointerId);
    });
    g.addEventListener("pointermove", (e) => {
      if (!st || st.id !== e.pointerId) return;
      S.wins[k].x = st.ox + e.clientX - st.x;
      S.wins[k].y = st.oy + e.clientY - st.y;
      node.style.left = S.wins[k].x + "px";
      node.style.top = S.wins[k].y + "px";
    });
    const end = (e) => {
      if (!st || st.id !== e.pointerId) return;
      st = null;
      applyWins();
      saveWins();
    };
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
    node.addEventListener("pointerdown", () => { if (node.classList.contains("floating")) node.style.zIndex = String(++S.winZ); });
    let t = 0;
    new ResizeObserver(() => {
      const w = S.wins[k];
      if (!w || !node.classList.contains("floating")) return;
      const r = node.getBoundingClientRect();
      if (Math.abs(r.width - w.w) < 1 && Math.abs(r.height - w.h) < 1) return;
      w.w = r.width;
      w.h = r.height;
      clearTimeout(t);
      t = setTimeout(saveWins, 300);
    }).observe(node);
  });
  applyWins();
}

function applyKpLayout() {
  const show = S.isKP && S.kpOpen;
  $("kpSide").hidden = !show;
  $("room").classList.toggle("kp-open", show);
  $("kpToggle").hidden = !S.isKP;
  $("kpToggle").classList.toggle("on", show);
  $("kpBadge").hidden = !S.isKP;
  $("kpBadge").textContent = S.isOwner ? "KP" : "KP権限";
  $("kpClaim").hidden = !!S.meta.owner;
  $("systemSel").disabled = !S.isKP;
  document.querySelectorAll(".owner-only").forEach((n) => { n.hidden = !S.isOwner; });
  document.querySelectorAll(".owner-note").forEach((n) => { n.hidden = S.isOwner; });
  queueRender();
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

async function initPresence() {
  const mine = rp("members/" + S.uid);
  await remove(rp("kick/" + S.pid)).catch(() => {});
  await update(rp("players/" + S.pid), { name: S.name, color: S.color, t: serverTimestamp() });
  onValue(ref(S.db, ".info/connected"), (snap) => {
    if (snap.val() === true) {
      setStatus("接続中");
      onDisconnect(mine).remove().then(() => set(mine, { name: S.name, color: S.color, pid: S.pid, t: serverTimestamp() }));
    } else {
      setStatus("切断（再接続待ち）", true);
    }
  });
  onValue(rp("kick/" + S.pid), async (snap) => {
    if (!snap.val()) return;
    await remove(rp("kick/" + S.pid)).catch(() => {});
    await remove(mine).catch(() => {});
    location.href = location.pathname + "?room=" + encodeURIComponent(S.roomId) + "&kicked=1";
  });
  onValue(rp("members"), (snap) => { S.online = snap.val() || {}; renderPlayers(); });
  onValue(rp("players"), (snap) => { S.players = snap.val() || {}; renderPlayers(); renderCharList(); renderCharDetail(); });
}

function onlinePids() {
  const set0 = new Set();
  Object.values(S.online).forEach((m) => { if (m && m.pid) set0.add(m.pid); });
  return set0;
}

function playerName(pid) {
  const p = S.players[pid];
  return p && p.name ? p.name : "";
}

function renderPlayers() {
  const list = $("memberList");
  if (!list) return;
  list.replaceChildren();
  const on = onlinePids();
  const rows = Object.entries(S.players).map(([pid, p]) => ({ pid, name: p.name || "?", color: p.color, t: p.t || 0 }));
  Object.values(S.online).forEach((m) => {
    if (m && !m.pid && m.name) rows.push({ pid: "", name: m.name, color: m.color, t: m.t || 0 });
  });
  rows.sort((a, b) => a.t - b.t);
  rows.forEach((p) => {
    const li = el("li", "player" + (p.pid && !on.has(p.pid) ? " away" : ""));
    const head = el("div", "player-head");
    const dot = el("span", "dot");
    dot.style.background = p.color || "#888";
    const isOwner = p.pid && S.meta.owner === p.pid;
    const hasKp = !!(p.pid && S.meta.kps && S.meta.kps[p.pid]);
    head.append(dot, el("span", "player-name", p.name + (isOwner ? "（KP）" : hasKp ? "（KP権限）" : "") + (p.pid === S.pid ? "（自分）" : "")), el("span", "player-state", !p.pid || on.has(p.pid) ? "接続中" : "オフライン"));
    if (S.isOwner && p.pid && !isOwner) {
      const g = el("button", "mini" + (hasKp ? " on" : ""), hasKp ? "権限を戻す" : "KP権限を渡す");
      g.type = "button";
      g.addEventListener("click", () => toggleKp(p.pid, !hasKp));
      head.append(g);
    }
    if (S.isKP && p.pid && p.pid !== S.pid && !isOwner) {
      const kick = el("button", "mini del", "外す");
      kick.type = "button";
      kick.addEventListener("click", () => removePlayer(p.pid));
      head.append(kick);
    }
    li.append(head);
    if (S.isKP && p.pid) {
      const own = sorted(S.chars, "order").filter(([, c]) => c.owner === p.pid);
      li.append(own.length ? charVisList(own) : el("div", "player-chars", "駒なし"));
    }
    list.append(li);
  });
  if (S.isKP) {
    const free = sorted(S.chars, "order").filter(([, c]) => !c.owner || !S.players[c.owner]);
    if (free.length) {
      const li = el("li", "player");
      li.append(el("div", "player-head", "持ち主なし（KP管理）"), charVisList(free));
      list.append(li);
    }
  }
  $("memberCount").textContent = Object.keys(S.online).length + "人";
}

function charVisList(entries) {
  const box = el("div", "player-chars");
  entries.forEach(([id, c]) => {
    const row = el("div", "vis-row");
    row.append(el("span", "vis-name", (c.name || "（名前なし）") + (isStand(c) ? "（立ち絵）" : "")));
    if (!isStand(c)) {
      const btn = (label, on, patch) => {
        const b = el("button", "mini vis" + (on ? " on" : ""), label + "：" + (on ? "表示" : "非表示"));
        b.type = "button";
        b.title = "ほかのPLに見せるかどうか（持ち主とKPには常に見えます）";
        b.addEventListener("click", () => update(rp("chars/" + id), patch(!on)).catch((e) => setStatus("保存失敗: " + e.message, true)));
        row.append(b);
      };
      btn("パラメータ", showsParams(c), (v) => ({ showParams: v }));
      btn("ほか", showsOther(c), (v) => ({ showOther: v, hideStatus: null }));
    }
    box.append(row);
  });
  return box;
}

async function toggleKp(pid, on) {
  if (!S.isOwner) return;
  const name = playerName(pid) || "この参加者";
  if (on && !confirm(name + " にKP権限を渡しますか？\n（KPパレット・/var・パネル編集・駒の持ち主変更・参加者を外す、ができるようになります。部屋の削除と権限の付け外しはできません）")) return;
  await set(rp("meta/kps/" + pid), on ? true : null);
  await postSystem(name + (on ? " にKP権限を渡しました" : " のKP権限を戻しました"));
}

async function removePlayer(pid) {
  if (!S.isKP) return;
  const name = playerName(pid) || "この参加者";
  if (!confirm(name + " を部屋から外しますか？\n・参加者一覧から消えます\n・接続中なら入室前の画面に戻ります（もう一度入室はできます）\n・その人の駒は残り、持ち主なし（KP管理）になります")) return;
  if (S.meta.owner === pid) return;
  const up = { ["players/" + pid]: null };
  if (S.isOwner && S.meta.kps && S.meta.kps[pid]) up["meta/kps/" + pid] = null;
  Object.entries(S.chars).forEach(([id, c]) => { if (c.owner === pid) up["chars/" + id + "/owner"] = null; });
  if (onlinePids().has(pid)) up["kick/" + pid] = Date.now();
  await update(rp(""), up);
  await postSystem(name + " を部屋から外しました");
}

function speakerChar() {
  return S.speaker && S.chars[S.speaker] ? S.chars[S.speaker] : null;
}

function charByName(name) {
  const hit = Object.entries(S.chars).find(([, c]) => c.name === name && !isStand(c));
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
  S.speaker = localStorage.getItem("s51-speaker-" + S.roomId) || "";
  try { S.cbOrder = JSON.parse(localStorage.getItem("s51-cborder-" + S.roomId) || "[]"); } catch (e) { S.cbOrder = []; }
  try { S.palPlace = JSON.parse(localStorage.getItem("s51-palplace-" + S.roomId) || "{}"); } catch (e) { S.palPlace = {}; }
  const q = query(rp("messages"), limitToLast(LOG_LIMIT));
  onChildAdded(q, (snap) => renderMessage(snap.val()));
  onValue(q, () => { S.popReady = true; }, { onlyOnce: true });
  renderBonus();
  initChatDock();
  S.chanReady = true;
  chansChanged();
}

function initChatDock() {
  try { S.colOrder = JSON.parse(localStorage.getItem("s51-cols") || "[]"); } catch (e) { S.colOrder = []; }
  $("chanAdd").addEventListener("click", addChan);
  S.popPc = localStorage.getItem("s51-popup") === "1";
  $("popToggle").checked = S.popPc;
  $("popToggle").addEventListener("change", () => { S.popPc = $("popToggle").checked; localStorage.setItem("s51-popup", S.popPc ? "1" : "0"); });
  const h = parseInt(localStorage.getItem("s51-chath"), 10);
  setChatH(h > 0 ? h : 240);
  const sp = $("chatSplit");
  let st = null;
  sp.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    st = { id: e.pointerId, y: e.clientY, h: S.chatH };
    sp.setPointerCapture(e.pointerId);
  });
  sp.addEventListener("pointermove", (e) => { if (st && st.id === e.pointerId) setChatH(st.h - (e.clientY - st.y)); });
  const end = (e) => {
    if (!st || st.id !== e.pointerId) return;
    st = null;
    localStorage.setItem("s51-chath", String(S.chatH));
    queueRender();
  };
  sp.addEventListener("pointerup", end);
  sp.addEventListener("pointercancel", end);
  buildChatCols();
}

function setChatH(h) {
  S.chatH = Math.max(120, Math.min(Math.round(innerHeight * 0.75), Math.round(h)));
  $("room").style.setProperty("--chat-h", S.chatH + "px");
}

function chans() {
  const custom = Object.entries((S.meta && S.meta.chans) || {})
    .filter(([, c]) => c && c.name)
    .sort((a, b) => (a[1].t || 0) - (b[1].t || 0) || a[0].localeCompare(b[0]))
    .map(([k, c]) => [k, String(c.name)]);
  return CH_TABS.concat(custom);
}

function isChan(k) {
  return chans().some(([x]) => x === k);
}

function colKeys() {
  const all = chans().map(([k]) => k);
  const out = ["main"];
  S.colOrder.forEach((k) => { if (k !== "main" && all.includes(k) && !out.includes(k)) out.push(k); });
  all.forEach((k) => { if (!out.includes(k)) out.push(k); });
  return out;
}

function chansChanged() {
  const sig = JSON.stringify([chans(), S.isKP]);
  if (sig === S.chanSig) return;
  S.chanSig = sig;
  if (!isChan(S.chatTab)) S.chatTab = "main";
  buildChatCols();
  buildChatTabs();
  buildPlaceOptions();
}

function buildChatTabs() {
  const nav = $("chatTabs");
  nav.replaceChildren();
  colKeys().forEach((k) => {
    const b = el("button", "", tabName(k));
    b.type = "button";
    b.dataset.ch = k;
    b.addEventListener("click", () => switchChatTab(k));
    nav.append(b);
  });
  renderChatTabs();
  if ($("log").dataset.ch !== S.chatTab) switchChatTab(S.chatTab);
}

function buildPlaceOptions() {
  const sel = $("palPlace");
  const v = sel.value;
  sel.replaceChildren();
  const none = el("option", "", "未指定（最後に書き込んだ列）");
  none.value = "";
  sel.append(none);
  colKeys().forEach((k) => { const o = el("option", "", tabName(k)); o.value = k; sel.append(o); });
  sel.value = v;
  S.palSig = "";
  renderPaletteTabs();
}

async function addChan() {
  if (!S.isKP) return;
  const name = (prompt("追加するタブの名前") || "").trim().slice(0, 20);
  if (!name) return;
  const k = "c" + newKey();
  await set(rp("meta/chans/" + k), { name, t: Date.now() });
  await postSystem("チャットのタブ「" + name + "」を追加しました");
}

async function renameChan(k) {
  const cur = tabName(k);
  const name = (prompt("タブの新しい名前", cur) || "").trim().slice(0, 20);
  if (!name || name === cur) return;
  await set(rp("meta/chans/" + k + "/name"), name);
}

async function deleteChan(k) {
  const name = tabName(k);
  if (!confirm("タブ「" + name + "」を削除しますか？\n（このタブの発言は表示されなくなります）")) return;
  await set(rp("meta/chans/" + k), null);
  await postSystem("チャットのタブ「" + name + "」を削除しました");
}

function buildChatCols() {
  const box = $("chatCols");
  const drafts = {};
  box.querySelectorAll(".chat-col").forEach((c) => { const t = c.querySelector("textarea"); if (t && t.value) drafts[c.dataset.ch] = t.value; });
  box.replaceChildren();
  $("chanAdd").hidden = !S.isKP;
  let drag = "";
  colKeys().forEach((k) => {
    const col = el("div", "chat-col");
    col.dataset.ch = k;
    const head = el("div", "chat-col-head");
    head.append(el("span", "chat-col-name", tabName(k)));
    if (S.isKP && !CH_TABS.some(([x]) => x === k)) {
      const rn = el("button", "mini", "名前");
      rn.type = "button";
      rn.addEventListener("click", () => renameChan(k));
      const dl = el("button", "mini del", "削除");
      dl.type = "button";
      dl.addEventListener("click", () => deleteChan(k));
      head.append(rn, dl);
    }
    if (k === "main") {
      head.title = "メインは左端に固定";
      head.classList.add("fixed");
    } else {
      head.draggable = true;
      head.title = "ドラッグで並べ替え";
    }
    col.addEventListener("dragover", (e) => { if (drag && drag !== k && k !== "main") { e.preventDefault(); col.classList.add("drop"); } });
    head.addEventListener("dragstart", (e) => { drag = k; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); col.classList.add("dragging"); });
    head.addEventListener("dragend", () => { drag = ""; col.classList.remove("dragging"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop");
      if (!drag || drag === k || k === "main") return;
      S.colOrder = colKeys();
      const a = S.colOrder.indexOf(drag);
      const t = S.colOrder.indexOf(k);
      S.colOrder.splice(a, 1);
      S.colOrder.splice(t, 0, drag);
      drag = "";
      localStorage.setItem("s51-cols", JSON.stringify(S.colOrder));
      buildChatCols();
    });
    const log = el("ol", "log col-log");
    S.msgs.filter((m) => tabOf(m) === k).forEach((m) => log.append(messageNode(m)));
    const who = el("div", "col-who");
    const send = el("div", "send");
    const ta = el("textarea");
    ta.rows = 2;
    ta.value = drafts[k] || "";
    ta.placeholder = tabName(k) + "に発言　Enterで送信・Shift+Enterで改行";
    const go = el("button", "primary", "送信");
    go.type = "button";
    const fire = async () => {
      const text = ta.value.replace(/\s+$/, "");
      if (!text) return;
      ta.value = "";
      S.chatTab = k;
      markLastCol();
      try { await sendChat(text, S.speaker, k); } catch (err) { ta.value = text; setStatus("送信失敗: " + err.message, true); }
    };
    go.addEventListener("click", fire);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); fire(); } });
    send.append(ta, go);
    col.append(head, log, who, send);
    box.append(col);
    log.scrollTop = log.scrollHeight;
  });
  renderColWho();
  markLastCol();
}

function markLastCol() {
  document.querySelectorAll(".chat-col").forEach((c) => c.classList.toggle("last", c.dataset.ch === S.chatTab));
}

function renderColWho() {
  const c = speakerChar();
  document.querySelectorAll(".col-who").forEach((w) => {
    w.textContent = "発言キャラ：" + (c ? c.name || "（名前なし）" : S.name) + "（チャパレタブで切替）";
  });
}

function tabOf(m) {
  return (m && m.tab) || "main";
}

function tabName(k) {
  const t = chans().find(([x]) => x === k);
  return t ? t[1] : "メイン";
}

function switchChatTab(k) {
  S.chatTab = k;
  markLastCol();
  S.unread[k] = false;
  renderChatTabs();
  const log = $("log");
  log.dataset.ch = k;
  log.replaceChildren();
  S.msgs.filter((m) => tabOf(m) === k).forEach((m) => log.append(messageNode(m)));
  scrollLog(true);
}

function renderChatTabs() {
  $("chatTabs").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.ch === S.chatTab);
    b.classList.toggle("unread", !!S.unread[b.dataset.ch] && b.dataset.ch !== S.chatTab);
  });
}

function ctBonus() {
  const n = parseInt(S.meta && S.meta.ctBonus, 10);
  return n > 0 ? n : 20;
}

function ctStatus(c) {
  if (!c) return null;
  const st = (c.status || []).find((s) => normLabel(s.label) === "CT");
  return st ? st : null;
}

function renderBonus() {
  ["chatBonus", "palBonus"].forEach((mid) => {
    const box = $(mid);
    if (!box) return;
    box.replaceChildren();
    box.append(el("span", "bonus-title", "次の判定"));
    [10, 20, 30].forEach((n) => {
      const on = !!S.bonus && !S.bonus.ct && S.bonus.n === n;
      const b = el("button", "mini" + (on ? " on" : ""), "＋" + n);
      b.type = "button";
      b.title = "次のCCB判定1回だけ、目標値に＋" + n + "します（もう一度押すと取り消し）";
      b.addEventListener("click", () => { S.bonus = on ? null : { n, ct: false }; renderBonus(); });
      box.append(b);
    });
    const c = speakerChar();
    const ct = ctStatus(c);
    const n = ctBonus();
    const onCt = !!S.bonus && S.bonus.ct;
    const cb = el("button", "mini ct" + (onCt ? " on" : ""), "CT使用（＋" + n + "）" + (ct ? "残り" + ct.value : ""));
    cb.type = "button";
    cb.disabled = !onCt && (!ct || !(+ct.value > 0) || !canEdit(c));
    cb.title = !c ? "発言キャラを選んでください" : !ct ? "発言キャラのステータスに「CT」がありません" : !(+ct.value > 0) ? "CTが0なので使えません" : "CTを1減らして、次のCCB判定1回だけ＋" + n + "します（判定を送ったときに減ります）";
    cb.addEventListener("click", () => { S.bonus = onCt ? null : { n, ct: true }; renderBonus(); });
    box.append(cb);
    if (S.bonus) {
      box.append(el("span", "bonus-on", "＋" + S.bonus.n + (S.bonus.ct ? "（CT）" : "") + " 待機中"));
      const x = el("button", "mini", "×");
      x.type = "button";
      x.title = "取り消す";
      x.addEventListener("click", () => { S.bonus = null; renderBonus(); });
      box.append(x);
    }
  });
}

function renderMyStatus() {
  const c = speakerChar();
  ["myStatus", "palStatus"].forEach((mid) => {
    const box = $(mid);
    if (!box) return;
    box.replaceChildren();
    const list = c && !isStand(c) ? c.status || [] : [];
    box.hidden = !list.length;
    list.forEach((st) => {
      const chip = el("span", "st-chip", st.label + " " + st.value + (st.max ? "/" + st.max : ""));
      box.append(chip);
    });
  });
}

function setSpeaker(id) {
  if (S.bonus && S.bonus.ct && id !== S.speaker) S.bonus = null;
  S.speaker = id;
  localStorage.setItem("s51-speaker-" + S.roomId, id);
  const c = S.chars[id];
  if (c && c.commands) S.palSel = "char:" + id;
  renderSpeaker();
  renderPaletteTabs();
}

function speakerEntries() {
  const list = sorted(S.chars, "order")
    .filter(([id, c]) => !isStand(c) && visibleChar(c) && ((S.isKP && S.showAllChars) || c.owner === S.pid || (id === S.speaker && canEdit(c))));
  const pos = (id) => { const i = S.cbOrder.indexOf(id); return i < 0 ? 1e9 : i; };
  return list.map((e, i) => [e, i]).sort((a, b) => (pos(a[0][0]) - pos(b[0][0])) || (a[1] - b[1])).map((x) => x[0]);
}

function moveSpeakerOrder(from, to) {
  const ids = speakerEntries().map(([id]) => id);
  const a = ids.indexOf(from);
  const b = ids.indexOf(to);
  if (a < 0 || b < 0 || a === b) return;
  ids.splice(a, 1);
  ids.splice(b, 0, from);
  S.cbOrder = ids.concat(S.cbOrder.filter((x) => !ids.includes(x)));
  localStorage.setItem("s51-cborder-" + S.roomId, JSON.stringify(S.cbOrder));
  renderSpeaker();
}

function renderSpeaker() {
  if (S.speaker && !S.chars[S.speaker]) S.speaker = "";
  const entries = speakerEntries();
  ["charBar", "palChars"].forEach((bid) => {
    const bar = $(bid);
    if (!bar) return;
    bar.replaceChildren();
    let drag = "";
    const mk = (id, name, icon, color) => {
      const b = el("button", "cb" + (S.speaker === id ? " on" : ""));
      b.type = "button";
      b.title = name;
      if (icon) {
        const im = el("img");
        im.alt = "";
        im.draggable = false;
        im.dataset.asset = icon;
        im.src = src(icon);
        b.append(im);
      } else {
        const f = el("span", "cb-fb", (name || "?").slice(0, 1));
        f.style.background = color || "#888";
        b.append(f);
      }
      b.append(el("span", "cb-name", name));
      b.addEventListener("click", () => setSpeaker(id));
      if (id && isPc()) {
        b.draggable = true;
        b.addEventListener("dragstart", (e) => { drag = id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); });
        b.addEventListener("dragover", (e) => { if (drag && drag !== id) { e.preventDefault(); b.classList.add("drop"); } });
        b.addEventListener("dragleave", () => b.classList.remove("drop"));
        b.addEventListener("drop", (e) => { e.preventDefault(); b.classList.remove("drop"); if (drag) moveSpeakerOrder(drag, id); drag = ""; });
        b.addEventListener("dragend", () => { drag = ""; });
      }
      bar.append(b);
    };
    mk("", S.name, "", S.color);
    entries.forEach(([id, c]) => mk(id, c.name || "（名前なし）", charIcon(c), c.color));
    if (S.isKP) {
      const t = el("button", "cb-toggle", S.showAllChars ? "自分のだけ" : "全キャラ");
      t.type = "button";
      t.addEventListener("click", () => { S.showAllChars = !S.showAllChars; renderSpeaker(); });
      bar.append(t);
    }
  });
  renderMyStatus();
  renderBonus();
  renderColWho();
}

async function submit(raw) {
  const text = raw.replace(/\s+$/, "");
  if (!text) return;
  $("chatInput").value = "";
  try {
    await sendChat(text, S.speaker, S.chatTab);
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
  if (!canEdit(c)) return { error: "ほかの人の駒のステータスは変えられません" };
  const label = m[1];
  const v = evalNumber(m[3] || "0");
  if (Number.isNaN(v.n)) return { error: "値を計算できませんでした: " + m[3] };
  const st = (c.status || []).map((s) => ({ ...s }));
  const key = normLabel(label);
  let idx = st.findIndex((s) => normLabel(s.label) === key);
  const pr = (c.params || []).map((p) => ({ ...p }));
  const pidx = pr.findIndex((p) => normLabel(p.label) === key);
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
  const shown = idx >= 0 ? st[idx].label : pidx >= 0 ? pr[pidx].label : label;
  return { text: "[ " + (c.name || "") + " ] " + shown + " : " + before + " → " + after + (v.detail ? "（" + v.detail + "）" : "") };
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
  await push(rp("messages"), { uid: S.uid, name: "system", color: "#888888", text: text.slice(0, 2000), sys: true, tab: "main", t: serverTimestamp() });
}

async function sendChat(rawText, charId0, place) {
  const charId = S.chars[charId0] && canEdit(S.chars[charId0]) ? charId0 : "";
  const c = S.chars[charId] || null;
  let text = rawText;
  let icon = charIcon(c);
  if (c) {
    let hit = null;
    faceList(c)
      .filter((f) => f.label && f.label.startsWith("@"))
      .sort((a, b) => b.label.length - a.label.length)
      .forEach((f) => {
        if (text.includes(f.label)) {
          text = text.split(f.label).join("");
          if (!hit) hit = f;
        }
      });
    if (hit) {
      icon = hit.key || icon;
      text = text.replace(/^[ \u3000]+/, "").replace(/[ \u3000]+$/, "");
      await update(rp("chars/" + charId), { face: hit.label });
      if (!text.trim()) return;
    }
  }
  let used = null;
  if (S.bonus && CHECK_RE.test(text.split("\n")[0])) {
    const ct = S.bonus.ct ? ctStatus(c) : null;
    if (S.bonus.ct && !(ct && +ct.value > 0 && canEdit(c))) {
      setStatus("CTが使えないため、ボーナスなしで振りました（発言キャラのCTを確認してください）", true);
    } else {
      used = S.bonus;
      const lines = text.split("\n");
      lines[0] = lines[0].replace(CHECK_RE, (a, head, target) => head + target + "+" + used.n);
      text = lines.join("\n");
    }
  }
  const expanded = expandVars(text, lookupVars(c));
  const first = expanded.split("\n")[0].trim();

  if (/^\/scene(\s|$)/.test(first)) {
    if (!S.isKP) { setStatus("シーンの切替はKPとKP権限の人だけができます", true); return; }
    const name = first.replace(/^\/scene\s*/, "").trim();
    const hit = Object.entries(S.scenes).find(([, s]) => (s.name || "") === name);
    if (!hit) { await postSystem("シーン「" + name + "」が見つかりません"); return; }
    await applyScene(hit[0]);
    return;
  }
  if (/^\/var\s/.test(text.split("\n")[0])) {
    const m = text.split("\n")[0].match(/^\/var\s+(\S+)\s?(.*)$/);
    if (m && !S.isKP) { setStatus("ルーム変数（/var）はKPとKP権限の人だけが変更できます", true); return; }
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
    tab: isChan(place) ? place : isChan(S.chatTab) ? S.chatTab : "main",
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
  if (used && r) {
    S.bonus = null;
    renderBonus();
    if (used.ct) {
      const st = (c.status || []).map((x) => ({ ...x }));
      const i = st.findIndex((x) => normLabel(x.label) === "CT");
      const before = +st[i].value || 0;
      st[i].value = before - 1;
      await update(rp("chars/" + charId), { status: st });
      msg.dice = (msg.dice + "\n［CT使用 ＋" + used.n + "：" + st[i].label + " " + before + " → " + (before - 1) + "］").slice(0, 2000);
    }
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

function messageNode(m) {
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
  return li;
}

function renderMessage(m) {
  if (!m) return;
  S.msgs.push(m);
  if (S.msgs.length > LOG_LIMIT) S.msgs.shift();
  const k = tabOf(m);
  const col = document.querySelector(".chat-col[data-ch='" + k + "'] .col-log");
  if (col) {
    const stick = col.scrollHeight - col.scrollTop - col.clientHeight < 80;
    col.append(messageNode(m));
    while (col.children.length > LOG_LIMIT) col.firstElementChild.remove();
    if (stick || m.uid === S.uid) col.scrollTop = col.scrollHeight;
  }
  if (k === S.chatTab) {
    const stick = nearBottom();
    const log = $("log");
    log.append(messageNode(m));
    while (log.children.length > LOG_LIMIT) log.firstElementChild.remove();
    if (stick || m.uid === S.uid) scrollLog(true);
  } else if (S.popReady) {
    S.unread[k] = true;
    renderChatTabs();
  }
  if (S.popReady && m.uid !== S.uid && !m.sys && (!isPc() || S.popPc)) popMessage(m);
}

function popMessage(m) {
  const box = $("popups");
  const p = el("div", "pop");
  if (m.icon) {
    const im = el("img", "avatar");
    im.alt = "";
    im.dataset.asset = m.icon;
    im.src = src(m.icon);
    p.append(im);
  }
  const body = el("div", "pop-body");
  const who = el("div", "who", (tabOf(m) !== "main" ? "［" + tabName(tabOf(m)) + "］" : "") + (m.name || "?"));
  who.style.color = m.color || "#ccc";
  const hidden = m.secret && m.uid !== S.uid;
  const t = hidden ? "シークレットダイス" : [m.text || "", m.dice || ""].filter(Boolean).join("\n");
  body.append(who, el("div", "pop-text", t.length > 140 ? t.slice(0, 140) + "…" : t));
  const x = el("button", "pop-x", "×");
  x.type = "button";
  x.title = "閉じる";
  x.addEventListener("click", (e) => { e.stopPropagation(); p.remove(); });
  p.append(body, x);
  p.addEventListener("click", () => {
    p.remove();
    if (!isPc()) { showTab("chat"); switchChatTab(tabOf(m)); return; }
    const col = document.querySelector(".chat-col[data-ch='" + tabOf(m) + "']");
    if (col) { col.classList.remove("flash"); void col.offsetWidth; col.classList.add("flash"); }
  });
  box.append(p);
  const max = isPc() ? 3 : 1;
  while (box.children.length > max) box.firstElementChild.remove();
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
  const wrap = $("boardWrap");
  $("zoomIn").addEventListener("click", () => setZoom(S.zoom * 1.25));
  $("zoomOut").addEventListener("click", () => setZoom(S.zoom / 1.25));
  $("zoomFit").addEventListener("click", fitField);
  window.addEventListener("resize", () => { if (!S.drag) queueRender(); });
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const step = Math.max(-3, Math.min(3, -e.deltaY / (e.deltaMode === 1 ? 3 : 100)));
    setZoom(S.zoom * Math.pow(1.15, step), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  let pan = null;
  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || (e.button !== 0 && e.button !== 1)) return;
    if (e.target.closest(".obj, .popup")) return;
    e.preventDefault();
    blurInput();
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add("panning");
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!pan || pan.id !== e.pointerId) return;
    wrap.scrollLeft = pan.sl - (e.clientX - pan.x);
    wrap.scrollTop = pan.st - (e.clientY - pan.y);
  });
  const stop = (e) => {
    if (!pan || pan.id !== e.pointerId) return;
    pan = null;
    wrap.classList.remove("panning");
  };
  wrap.addEventListener("pointerup", stop);
  wrap.addEventListener("pointercancel", stop);
}

function setZoom(z, at) {
  const wrap = $("boardWrap");
  const p = at && typeof at === "object" ? at : { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
  const bx = (wrap.scrollLeft + p.x - S.off.x) / S.zoom;
  const by = (wrap.scrollTop + p.y - S.off.y) / S.zoom;
  S.zoom = Math.max(0.1, Math.min(5, z));
  $("zoomLabel").textContent = Math.round(S.zoom * 100) + "%";
  layoutSizer();
  if (at !== false) {
    wrap.scrollLeft = bx * S.zoom + S.off.x - p.x;
    wrap.scrollTop = by * S.zoom + S.off.y - p.y;
  }
}

function fitField() {
  const wrap = $("boardWrap");
  const f = fieldRect();
  const z = Math.min(wrap.clientWidth / ((f.w + 2) * UNIT), wrap.clientHeight / ((f.h + 2) * UNIT));
  setZoom(z, false);
  wrap.scrollLeft = (f.x + S.origin.x + f.w / 2) * UNIT * S.zoom + S.off.x - wrap.clientWidth / 2;
  wrap.scrollTop = (f.y + S.origin.y + f.h / 2) * UNIT * S.zoom + S.off.y - wrap.clientHeight / 2;
}

function layoutSizer() {
  const board = $("board");
  const wrap = $("boardWrap");
  const w = parseFloat(board.style.width || 0) * S.zoom;
  const h = parseFloat(board.style.height || 0) * S.zoom;
  const vw = wrap.clientWidth;
  const vh = wrap.clientHeight;
  S.off = { x: vw, y: vh };
  board.style.transform = "scale(" + S.zoom + ")";
  board.style.left = S.off.x + "px";
  board.style.top = S.off.y + "px";
  $("sizer").style.width = w + vw * 2 + "px";
  $("sizer").style.height = h + vh * 2 + "px";
}

function queueRender() {
  if (S.renderQueued) return;
  S.renderQueued = true;
  requestAnimationFrame(() => { S.renderQueued = false; renderBoard(); refreshAvatars(); });
}

function boardObjects() {
  const list = [];
  Object.entries(S.items).forEach(([id, o]) => { if (o.visible !== false || S.isKP) list.push({ kind: "items", id, o }); });
  Object.entries(S.markers).forEach(([id, o]) => list.push({ kind: "markers", id, o }));
  Object.entries(S.chars).forEach(([id, o]) => { if (o.active !== false && visibleChar(o)) list.push({ kind: "chars", id, o }); });
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
  field.style.zIndex = String(cssZ(FG_Z, true));
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
    node.addEventListener("contextmenu", (e) => {
      const { kind: k, id: oid } = node.dataset;
      if (k === "chars") {
        e.preventDefault();
        S.selChar = oid;
        showTab("chars");
        renderCharList();
        renderCharDetail();
      } else if (S.isKP) {
        e.preventDefault();
        selectObj(k, oid);
      }
    });
    $("board").append(node);
    S.nodes.set(key, node);
  }
  node.style.left = (o.x + S.origin.x) * UNIT + "px";
  node.style.top = (o.y + S.origin.y) * UNIT + "px";
  node.style.width = (o.w || 1) * UNIT + "px";
  node.style.height = (o.h || 1) * UNIT + "px";
  node.style.zIndex = String(cssZ(o.z, kind === "chars" && isStand(o)));
  node.classList.toggle("locked", !!o.locked);
  node.classList.toggle("stand", kind === "chars" && isStand(o));
  node.classList.toggle("hidden-obj", kind === "items" && o.visible === false);
  node.classList.toggle("kp-only", kind === "chars" && !!o.kpOnly);
  node.classList.toggle("clickable", !!o.click);
  node.title = kind === "markers" ? (o.text || "") : (o.memo || "");
  const img = node.querySelector(".obj-img");
  const s = src(kind === "items" && o.closed ? o.cover : (kind === "chars" ? charIcon(o) : o.img));
  if (img.getAttribute("src") !== s) { if (s) img.src = s; else img.removeAttribute("src"); }
  img.hidden = !s;
  if (kind === "chars") {
    const fb = node.querySelector(".face-fallback");
    fb.hidden = !!s;
    fb.textContent = (o.name || "?").slice(0, 1);
    fb.style.background = o.color || "#888";
    node.querySelector(".label").textContent = isStand(o) ? "" : o.name || "";
    const bars = node.querySelector(".bars");
    bars.replaceChildren();
    if (!isStand(o) && canSeeOther(o)) {
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
  let sx = 0, sy = 0, ox = 0, oy = 0, sl = 0, st = 0, moved = false, active = false, mode = "";
  const wrap = $("boardWrap");
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { kind, id } = node.dataset;
    const o = S[kind][id];
    if (!o) return;
    e.preventDefault();
    e.stopPropagation();
    blurInput();
    active = true;
    moved = false;
    sx = e.clientX; sy = e.clientY;
    ox = o.x; oy = o.y;
    sl = wrap.scrollLeft; st = wrap.scrollTop;
    node.setPointerCapture(e.pointerId);
    if (o.locked || (kind !== "chars" && !S.isKP)) {
      mode = e.pointerType === "touch" ? "" : "pan";
      if (mode) wrap.classList.add("panning");
    } else {
      mode = "drag";
      S.drag = { kind, id };
      node.classList.add("drag");
    }
  });
  node.addEventListener("pointermove", (e) => {
    if (!active) return;
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
    if (mode === "pan") {
      wrap.scrollLeft = sl - (e.clientX - sx);
      wrap.scrollTop = st - (e.clientY - sy);
      return;
    }
    if (mode !== "drag" || !S.drag || S.drag.id !== node.dataset.id) return;
    const dx = (e.clientX - sx) / S.zoom / UNIT;
    const dy = (e.clientY - sy) / S.zoom / UNIT;
    node.style.left = (ox + dx + S.origin.x) * UNIT + "px";
    node.style.top = (oy + dy + S.origin.y) * UNIT + "px";
  });
  const end = (e, cancel) => {
    if (!active) return;
    active = false;
    const { kind, id } = node.dataset;
    const o = S[kind][id];
    const wasDrag = mode === "drag" && !!S.drag;
    S.drag = null;
    mode = "";
    node.classList.remove("drag");
    wrap.classList.remove("panning");
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
    sendChat(o.click, S.speaker, S.chatTab).catch((err) => setStatus("送信失敗: " + err.message, true));
    return;
  }
  if (kind === "chars") {
    S.selChar = id;
    if (o.owner === S.pid) setSpeaker(id);
    renderCharList();
    renderCharDetail();
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

function noteColor(n, i) {
  const c = parseInt(n.color, 10);
  return c >= 1 && c <= 4 ? c : (i % 4) + 1;
}

function renderNotes() {
  const box = $("noteList");
  const ae = document.activeElement;
  if (ae && box.contains(ae) && ae.matches("input, textarea, select")) return;
  const open = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.id));
  box.replaceChildren();
  const entries = sorted(S.notes, "order");
  if (!entries.length) box.append(el("p", "msg", "テキストはまだありません（room.zip のメモもここに入ります）"));
  entries.forEach(([id, n], i) => {
    const d = el("details", "note acc-color-" + noteColor(n, i));
    d.dataset.id = id;
    if (open.has(id)) d.open = true;
    d.append(el("summary", "", n.name || "（無題）"));
    const title = el("input");
    title.value = n.name || "";
    title.placeholder = "見出し";
    title.addEventListener("change", () => update(rp("notes/" + id), { name: title.value.slice(0, 100) }));
    const color = el("select");
    ["青", "緑", "橙", "紫"].forEach((lab, k) => { const o = el("option", "", lab); o.value = String(k + 1); color.append(o); });
    color.value = String(noteColor(n, i));
    color.addEventListener("change", () => update(rp("notes/" + id), { color: parseInt(color.value, 10) }));
    const text = el("textarea", "note-edit");
    text.rows = 8;
    text.value = n.text || "";
    text.addEventListener("change", () => update(rp("notes/" + id), { text: text.value }));
    const up = el("button", "mini", "↑");
    up.type = "button";
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      const prev = entries[i - 1];
      update(rp("notes"), { [id + "/order"]: prev[1].order ?? i - 1, [prev[0] + "/order"]: n.order ?? i });
    });
    const del = el("button", "mini del", "削除");
    del.type = "button";
    del.addEventListener("click", () => { if (confirm("「" + (n.name || "無題") + "」を削除しますか？")) remove(rp("notes/" + id)); });
    const row = el("div", "row");
    row.append(title, color, up, del);
    d.append(row, text);
    box.append(d);
  });
}

function addNote() {
  const max = Object.values(S.notes).reduce((m, n) => Math.max(m, +n.order || 0), 0);
  push(rp("notes"), { name: "新しいテキスト", text: "", color: 1, order: max + 1 }).then((r) => {
    renderNotes();
    const d = $("noteList").querySelector("details[data-id='" + r.key + "']");
    if (d) d.open = true;
  });
}

function imagePicker(box, cur, onPick) {
  const wasOpen = !!box.querySelector("details[open]");
  box.replaceChildren();
  const head = el("div", "pick-head");
  const th = el("img", "thumb");
  th.alt = "";
  th.dataset.asset = cur || "";
  th.src = src(cur);
  th.hidden = !cur;
  head.append(th, el("span", "msg", cur ? "" : "画像なし"));
  const up = el("label", "file-btn", "アップロード");
  const fi = el("input");
  fi.type = "file";
  fi.accept = "image/*";
  fi.addEventListener("change", async () => {
    const f = fi.files[0];
    if (!f) return;
    try { onPick(await uploadAsset(f, 1600)); } catch (e) { setStatus("アップロードに失敗しました: " + e.message, true); }
  });
  up.append(fi);
  const none = el("button", "mini", "画像なし");
  none.type = "button";
  none.addEventListener("click", () => onPick(""));
  head.append(up, none);
  const d = el("details", "pick-list");
  d.append(el("summary", "", "部屋の画像から選ぶ（" + S.assets.size + "枚）"));
  const grid = el("div", "pick-grid");
  const fill = () => {
    if (grid.childElementCount) return;
    [...S.assets.keys()].forEach((k) => {
      const b = el("button", "pick-item" + (k === cur ? " on" : ""));
      b.type = "button";
      const im = el("img");
      im.alt = "";
      im.loading = "lazy";
      im.src = src(k);
      b.append(im);
      b.addEventListener("click", () => onPick(k));
      grid.append(b);
    });
  };
  d.addEventListener("toggle", () => { if (d.open) fill(); });
  d.append(grid);
  if (wasOpen) { d.open = true; fill(); }
  box.append(head, d);
}

function renderBoardPickers() {
  if (!S.isKP) return;
  const b = S.meta.board || {};
  imagePicker($("bgPick"), b.bg || "", (k) => set(rp("meta/board/bg"), k || null));
  imagePicker($("fgPick"), b.fg || "", (k) => set(rp("meta/board/fg"), k || null));
}

const OBJ_FIELDS = {
  items: [["memo", "名前（メモ）", "text"], ["x", "X", "num"], ["y", "Y", "num"], ["w", "幅", "num"], ["h", "高さ", "num"], ["z", "レイヤー", "z"], ["click", "クリックアクション（クリックで発言する文字）", "area"], ["locked", "固定（動かせなくする）", "check"], ["visible", "表示する", "check"]],
  markers: [["text", "文字", "area"], ["x", "X", "num"], ["y", "Y", "num"], ["w", "幅", "num"], ["h", "高さ", "num"], ["z", "レイヤー", "z"], ["click", "クリックアクション（クリックで発言する文字）", "area"], ["locked", "固定（動かせなくする）", "check"]]
};

function objLabel(kind, o) {
  const t = kind === "items" ? o.memo || o.click : o.text || o.click;
  return String(t || "（名前なし）").split("\n")[0].slice(0, 30);
}

function renderObjLists() {
  if (!S.isKP) return;
  [["items", "itemList", "selItem"], ["markers", "markerList", "selMarker"]].forEach(([kind, listId, selKey]) => {
    const list = $(listId);
    list.replaceChildren();
    Object.entries(S[kind]).sort((a, b) => (+b[1].z || 0) - (+a[1].z || 0)).forEach(([id, o]) => {
      const li = el("li", id === S[selKey] ? "current" : "");
      const th = el("img", "thumb");
      th.alt = "";
      th.dataset.asset = o.img || "";
      th.src = src(o.img);
      th.hidden = !th.src;
      const tags = (o.locked ? "（固定）" : "") + (o.visible === false ? "（非表示）" : "");
      li.append(th, el("span", "", objLabel(kind, o) + tags), el("span", "z-tag", "L" + Math.round(+o.z || 0)));
      li.addEventListener("click", () => { S[selKey] = id === S[selKey] ? "" : id; renderObjLists(); renderObjEditor(kind, true); });
      list.append(li);
    });
    if (!list.childElementCount) list.append(el("li", "empty", "まだありません"));
  });
  renderObjEditor("items");
  renderObjEditor("markers");
}

function renderObjEditor(kind, force) {
  const box = $(kind === "items" ? "itemEditor" : "markerEditor");
  const id = kind === "items" ? S.selItem : S.selMarker;
  const o = S[kind][id];
  box.hidden = !o;
  if (!o) { box.replaceChildren(); box.dataset.id = ""; return; }
  const ae = document.activeElement;
  if (!force && box.dataset.id === id && ae && box.contains(ae) && ae.matches("input, textarea, select")) return;
  box.dataset.id = id;
  box.replaceChildren();
  const save = (patch) => update(rp(kind + "/" + id), patch).catch((e) => setStatus("保存失敗: " + e.message, true));
  const pick = el("div", "img-pick");
  imagePicker(pick, o.img || "", (k) => save({ img: k }));
  const f0 = el("div", "field");
  f0.append(el("span", "", "画像"), pick);
  box.append(f0);
  const grid = el("div", "obj-grid");
  OBJ_FIELDS[kind].forEach(([key, label, type]) => {
    if (type === "check") {
      const lab = el("label", "check");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = key === "visible" ? o.visible !== false : !!o[key];
      cb.addEventListener("change", () => save({ [key]: cb.checked }));
      lab.append(cb, document.createTextNode(label));
      box.append(lab);
      return;
    }
    const lab = el("label", "field" + (type === "num" || type === "z" ? " small" : ""));
    lab.append(el("span", "", label));
    const inp = el(type === "area" ? "textarea" : "input");
    if (type === "area") inp.rows = 2;
    if (type === "num" || type === "z") { inp.type = "number"; inp.inputMode = "numeric"; }
    if (type === "z") { inp.min = "-100"; inp.max = "999"; lab.title = "-100〜999（大きいほど上。前景は1、駒は100〜200）"; }
    inp.value = o[key] ?? (type === "z" || type === "num" ? 0 : "");
    inp.addEventListener("change", () => {
      let v = inp.value;
      if (type === "num") v = Math.round(+v || 0);
      if (key === "w" || key === "h") v = Math.max(1, Math.min(200, v));
      if (type === "z") v = Math.max(-100, Math.min(999, Math.round(+v || 0)));
      if (type === "num" || type === "z") inp.value = v;
      save({ [key]: v });
    });
    lab.append(inp);
    (type === "num" || type === "z" ? grid : box).append(lab);
  });
  box.insertBefore(grid, box.children[1]);
  const row = el("div", "row wrap");
  const center = el("button", "", "盤面の中央へ");
  center.type = "button";
  center.addEventListener("click", () => save(centerPos(o.w || 1, o.h || 1)));
  const dup = el("button", "", "複製");
  dup.type = "button";
  dup.addEventListener("click", async () => {
    const r = await push(rp(kind), { ...o, x: (o.x || 0) + 1, y: (o.y || 0) + 1 });
    if (kind === "items") S.selItem = r.key; else S.selMarker = r.key;
    renderObjLists();
  });
  const del = el("button", "del", "削除");
  del.type = "button";
  del.addEventListener("click", () => {
    if (!confirm("「" + objLabel(kind, o) + "」を削除しますか？")) return;
    remove(rp(kind + "/" + id));
    if (kind === "items") S.selItem = ""; else S.selMarker = "";
  });
  row.append(center, dup, del);
  box.append(row);
}

async function addObj(kind) {
  const base = { ...centerPos(8, 6), w: 8, h: 6, z: 50, img: "", click: "", locked: false };
  const o = kind === "items" ? { ...base, type: "object", memo: "新しいパネル", visible: true } : { ...base, text: "新しいマーカー" };
  const r = await push(rp(kind), o);
  if (kind === "items") S.selItem = r.key; else S.selMarker = r.key;
  renderObjLists();
  renderObjEditor(kind, true);
}

function selectObj(kind, id) {
  if (!S.isKP) return;
  if (!S.kpOpen) { S.kpOpen = true; applyKpLayout(); }
  showTab("room");
  const box = $(kind === "items" ? "itemEditor" : "markerEditor");
  const d = box.closest("details");
  if (d) d.open = true;
  if (kind === "items") S.selItem = id; else S.selMarker = id;
  renderObjLists();
  renderObjEditor(kind, true);
  box.scrollIntoView({ block: "nearest" });
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
    setSpeaker(S.selChar);
    showTab("chat");
  });
  $("cdSet").addEventListener("change", () => {
    if (!S.selChar) return;
    const v = $("cdSet").value;
    if (v === "__keep") return;
    update(rp("chars/" + S.selChar), { set: v ? { pid: S.pid, sid: v } : null, face: null });
  });
  $("cdSize").addEventListener("change", () => {
    if (!S.selChar) return;
    const n = Math.max(1, Math.min(64, parseInt($("cdSize").value, 10) || 1));
    update(rp("chars/" + S.selChar), { w: n, h: n });
  });
  $("charImport").addEventListener("click", () => importChars($("charJson").value));
  $("charJsonFile").addEventListener("change", async (e) => {
    for (const f of e.target.files) await importChars(await f.text());
    e.target.value = "";
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
  $("cdShowParams").addEventListener("change", () => { if (S.selChar && S.isKP) update(rp("chars/" + S.selChar), { showParams: $("cdShowParams").checked }); });
  $("cdShowOther").addEventListener("change", () => { if (S.selChar && S.isKP) update(rp("chars/" + S.selChar), { showOther: $("cdShowOther").checked, hideStatus: null }); });
  field("cdLock", "locked", (e) => e.checked);
  $("cdOwner").addEventListener("change", () => {
    if (!S.selChar || !S.isKP) return;
    const owner = $("cdOwner").value || null;
    const up = { ["chars/" + S.selChar + "/owner"]: owner };
    Object.entries(S.chars).forEach(([id, c]) => { if (isStand(c) && c.parent === S.selChar) up["chars/" + id + "/owner"] = owner; });
    update(rp(""), up);
  });
  $("cdLayer").addEventListener("change", () => {
    if (!S.selChar) return;
    const n = Math.max(100, Math.min(200, parseInt($("cdLayer").value, 10) || CHAR_Z));
    $("cdLayer").value = n;
    update(rp("chars/" + S.selChar), { z: n });
  });
  field("cdKpOnly", "kpOnly", (e) => e.checked);
  $("dupType").addEventListener("change", () => { $("dupSize").value = $("dupType").value === "stand" ? "16" : "4"; });
  $("dupBtn").addEventListener("click", duplicateChar);
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

function centerPos(w, h, i) {
  return { x: Math.round(-w / 2) + (i || 0) * 2, y: Math.round(-h / 2) + (i || 0) * 2 };
}

function cssZ(z, low) {
  const n = Math.max(-100, Math.min(999, Math.round(Number.isFinite(+z) ? +z : 0)));
  return (n + 101) * 2 + (low ? 0 : 1);
}

async function duplicateChar() {
  const src0 = S.chars[S.selChar];
  if (!src0) return;
  const kind = $("dupType").value;
  const n = Math.max(1, Math.min(64, parseInt($("dupSize").value, 10) || 4));
  const parentId = isStand(src0) ? src0.parent : S.selChar;
  const base = {
    name: kind === "stand" ? (src0.name || "").slice(0, 60) : (src0.name || "").slice(0, 56) + "（複製）",
    color: src0.color || "#888888", icon: src0.icon || "", faces: src0.faces || [], set: src0.set || null, face: src0.face || null,
    ...centerPos(n, n), z: CHAR_Z, w: n, h: n, owner: S.pid, active: true, order: Date.now(),
    kpOnly: !!src0.kpOnly, locked: false, showParams: showsParams(src0), showOther: showsOther(src0)
  };
  const c = kind === "stand"
    ? { ...base, kind: "stand", parent: parentId, status: [], params: [], commands: "", memo: "" }
    : { ...base, kind: "char", status: src0.status || [], params: src0.params || [], commands: src0.commands || "", memo: src0.memo || "" };
  const r = await push(rp("chars"), c);
  S.selChar = r.key;
  renderCharList();
  renderCharDetail();
  $("dupMsg").textContent = (kind === "stand" ? "立ち絵駒" : "キャラ駒") + "を作りました（盤面の中央）";
}

async function addChar() {
  const name = $("pieceName").value.trim() || "キャラ";
  const c = {
    name: name.slice(0, 60), color: $("pieceColor").value,
    ...centerPos(4, 4), z: CHAR_Z,
    w: 4, h: 4, kind: "char", owner: S.pid, status: [{ label: "HP", value: 10, max: 10 }, { label: "MP", value: 10, max: 10 }, { label: "SAN", value: 50, max: 99 }],
    params: [], commands: "", memo: "", active: true, order: Date.now(), showParams: false, showOther: false
  };
  try {
    $("pieceAdd").disabled = true;
    if ($("pieceFile").files[0]) { $("pieceMsg").textContent = "画像を圧縮中…"; c.icon = await uploadAsset($("pieceFile").files[0], 512); }
    const r = await push(rp("chars"), c);
    S.selChar = r.key;
    setSpeaker(r.key);
    renderCharList();
    renderCharDetail();
    $("pieceName").value = "";
    $("pieceFile").value = "";
    $("pieceMsg").textContent = "追加しました";
  } catch (err) {
    $("pieceMsg").textContent = "追加に失敗しました: " + err.message;
  } finally {
    $("pieceAdd").disabled = false;
  }
}

async function fetchImage(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) throw new Error("画像ではありません");
    return await compressImage(await blob.arrayBuffer(), blob.type, 1024);
  } finally {
    clearTimeout(timer);
  }
}

function newSetId() {
  const used = new Set(Object.values(S.mySets || {}).map((x) => x.id));
  for (let i = 0; i < 50; i++) {
    const id = randomId(3).replace(/[^a-z]/g, "x");
    if (!used.has(id)) return id;
  }
  return randomId(5);
}

async function importImages(c, say) {
  const list = [];
  if (c.iconUrl) list.push({ label: "@通常", url: c.iconUrl });
  (c.faceUrls || []).forEach((f) => { if (!list.some((x) => x.label === f.label)) list.push(f); });
  if (!list.length) return {};
  const faces = [];
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    say(c.name + " の画像を取り込み中 " + (i + 1) + "/" + list.length);
    try {
      const data = await fetchImage(list[i].url);
      const r = await push(ref(S.db, "lib/" + S.pid + "/files"), { name: (c.name + "-" + list[i].label.slice(1)).slice(0, 80) + ".webp", data, t: serverTimestamp() });
      faces.push({ label: list[i].label, file: r.key });
    } catch (e) {
      failed++;
    }
  }
  if (failed === 0) {
    const id = newSetId();
    const r = await push(ref(S.db, "lib/" + S.pid + "/sets"), { id, faces, order: Date.now() });
    S.mySets[r.key] = { id, faces };
    return { set: { pid: S.pid, sid: r.key }, saved: "マイ画像に保存（ID: " + id + "）" };
  }
  if (faces.length) {
    const up = {};
    faces.forEach((f) => { up["lib/" + S.pid + "/files/" + f.file] = null; });
    await update(ref(S.db), up);
  }
  return { saved: "画像は取り込めませんでした。マイ画像から差分セットを作って設定してください" };
}

async function importChars(text, say) {
  const msg = $("charImportMsg");
  const tell = say || ((t) => { msg.textContent = t; });
  if (!text.trim()) { tell("貼り付けるか、ファイルを選んでください"); return false; }
  let list;
  try { list = parseCharJson(text); }
  catch (e) { tell("読み込めませんでした（JSONの形ではないようです）"); return false; }
  if (!list.length) { tell("キャラのデータが見つかりませんでした"); return false; }
  let last = "";
  const notes = [];
  for (let i = 0; i < list.length; i++) {
    const { iconUrl, faceUrls, ...base } = list[i];
    const img = await importImages(list[i], tell);
    if (img.saved) notes.push(img.saved);
    const c = {
      ...base, ...centerPos(base.w, base.h, i), z: CHAR_Z, kind: "char",
      active: true, showParams: false, showOther: false, owner: S.pid, order: Date.now() + i
    };
    if (img.set) c.set = img.set;
    last = (await push(rp("chars"), c)).key;
  }
  S.selChar = last;
  setSpeaker(last);
  renderCharList();
  renderCharDetail();
  $("charJson").value = "";
  tell(list.map((c) => c.name).join("、") + " を盤面の中央に取り込みました" + (notes.length ? "。" + [...new Set(notes)].join("。") : ""));
  return true;
}

function initPaste() {
  document.addEventListener("paste", (e) => {
    const t = e.target;
    if (t && (t.closest("input, textarea, select, [contenteditable]"))) return;
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const types = [...cd.types];
    const texts = [];
    types.filter((ty) => ty !== "Files").forEach((ty) => {
      const t = cd.getData(ty) || "";
      texts.push(t);
      if (/html/.test(ty)) texts.push(new DOMParser().parseFromString(t, "text/html").documentElement.textContent || "");
    });
    const json = texts.map((t) => t.match(/[\[{][\s\S]*[\]}]/)).find((m) => m && /"(name|data|status|commands)"/.test(m[0]));
    if (!json) {
      const head = (cd.getData("text/plain") || "").slice(0, 30);
      setStatus("駒のデータが見つかりませんでした（形式: " + (types.join(", ") || "なし") + (head ? "／中身: " + head : "") + "）", true);
      return;
    }
    importChars(json[0], (m) => setStatus(m)).catch((err) => setStatus("取り込みに失敗しました: " + err.message, true));
  });
}

function renderCharList() {
  const list = $("charList");
  list.replaceChildren();
  sorted(S.chars, "order").filter(([, c]) => visibleChar(c)).forEach(([id, c]) => {
    const li = el("li", id === S.selChar ? "current" : "");
    const th = el("img", "thumb round");
    th.alt = "";
    th.dataset.asset = charIcon(c);
    th.src = src(th.dataset.asset);
    const who = c.owner === S.pid ? "（自分）" : S.isKP ? "（" + (playerName(c.owner) || "持ち主なし") + "）" : "";
    const tags = (isStand(c) ? "（立ち絵）" : "") + who + (c.kpOnly ? "（KPのみ）" : "") + (c.locked ? "（固定）" : "");
    const name = el("span", "", (c.name || "（名前なし）") + tags);
    const off = c.active === false;
    li.classList.toggle("off", off);
    li.append(th, name);
    if (canEdit(c)) {
      const tg = el("button", "mini" + (off ? " primary" : ""), off ? "戻す" : "下げる");
      tg.type = "button";
      tg.title = off ? "盤面に戻す" : "盤面から下げる";
      tg.addEventListener("click", (e) => { e.stopPropagation(); update(rp("chars/" + id), { active: off }); });
      li.append(tg);
    }
    li.addEventListener("click", () => { S.selChar = id; renderCharList(); renderCharDetail(); });
    list.append(li);
  });
}

function renderCharDetail() {
  const c = visibleChar(S.chars[S.selChar]) ? S.chars[S.selChar] : null;
  $("charDetail").hidden = !c;
  if (!c) return;
  const stand = isStand(c);
  const seeP = canSeeParams(c);
  const seeO = canSeeOther(c);
  const edit = canEdit(c);
  document.querySelectorAll("#charDetail input, #charDetail select, #charDetail textarea, #charDetail .st button, #cdAddStatus, #cdAddParam").forEach((n) => {
    if (!n.closest(".dup")) n.disabled = !edit;
  });
  $("cdDelete").hidden = !edit;
  $("cdReadonly").hidden = edit;
  document.querySelectorAll("#charDetail .char-only").forEach((n) => { n.hidden = stand; });
  document.querySelectorAll("#charDetail .kp-only-ui").forEach((n) => { n.hidden = !S.isKP; });
  $("cdShowParams").closest("label").hidden = stand || !S.isKP;
  $("cdShowOther").closest("label").hidden = stand || !S.isKP;
  $("cdStatusBox").hidden = stand || !seeO;
  $("cdParamBox").hidden = stand || !seeP;
  $("cdCmdField").hidden = stand || !seeO;
  $("cdFaceBox").hidden = !seeO;
  const hid = [!stand && !seeP ? "パラメータ" : "", !seeO ? (stand ? "差分" : "ステータス・チャパレ・差分") : ""].filter(Boolean);
  $("cdHiddenNote").hidden = !hid.length;
  $("cdHiddenNote").textContent = "この駒の" + hid.join("と") + "は隠されています";
  const parent = stand && c.parent ? S.chars[c.parent] : null;
  $("cdParent").hidden = !stand;
  $("cdSpeak").hidden = stand || !edit;
  $("cdParent").textContent = parent ? "「" + (parent.name || "") + "」の発言で表情が切り替わります" : "元のキャラ駒が見つかりません（表情は切り替わりません）";
  $("cdLock").checked = !!c.locked;
  const os = $("cdOwner");
  if (document.activeElement !== os) {
    os.replaceChildren();
    const none = el("option", "", "なし（KP管理）");
    none.value = "";
    os.append(none);
    Object.entries(S.players).sort((a, b) => (a[1].t || 0) - (b[1].t || 0)).forEach(([pid, p]) => {
      const o = el("option", "", (p.name || "?") + (pid === S.pid ? "（自分）" : ""));
      o.value = pid;
      os.append(o);
    });
    if (c.owner && !S.players[c.owner]) {
      const o = el("option", "", "一覧にいない人");
      o.value = c.owner;
      os.append(o);
    }
    os.value = c.owner || "";
  }
  if (document.activeElement !== $("cdLayer")) $("cdLayer").value = Number.isFinite(+c.z) ? Math.round(+c.z) : CHAR_Z;
  $("cdKpOnly").checked = !!c.kpOnly;
  const keep = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  keep("cdName", c.name || "");
  keep("cdColor", c.color || "#888888");
  keep("cdMemo", c.memo || "");
  keep("cdCommands", c.commands || "");
  $("cdActive").checked = c.active !== false;
  if (document.activeElement !== $("cdSize")) $("cdSize").value = c.w || 1;
  const setSel = $("cdSet");
  setSel.replaceChildren();
  const none = el("option", "", "なし（駒に直接入れた画像）");
  none.value = "";
  setSel.append(none);
  Object.entries(S.mySets || {}).sort((a, b) => (a[1].order || 0) - (b[1].order || 0)).forEach(([k, st]) => {
    const o = el("option", "", st.id + "（" + (st.faces || []).length + "枚）");
    o.value = k;
    setSel.append(o);
  });
  if (c.set && c.set.pid !== S.pid) {
    const o = el("option", "", "ほかの人のセット");
    o.value = "__keep";
    setSel.append(o);
    setSel.value = "__keep";
  } else {
    setSel.value = c.set ? c.set.sid : "";
  }
  $("cdShowParams").checked = showsParams(c);
  $("cdShowOther").checked = showsOther(c);

  const faces = $("cdFaces");
  faces.replaceChildren();
  const faceOwner = parent ? c.parent : S.selChar;
  const curFace = parent ? parent.face : c.face;
  faceList(c).forEach((fc) => {
    const b = el("button", "face-btn" + (fc.label && fc.label === curFace ? " on" : ""));
    b.type = "button";
    b.title = (fc.label || "") + "（クリックでこの表情にする）";
    const im = el("img");
    im.alt = "";
    im.dataset.asset = fc.key || "";
    im.src = src(fc.key);
    b.append(im, el("span", "", fc.label || "-"));
    b.disabled = !canEdit(S.chars[faceOwner]);
    b.addEventListener("click", () => update(rp("chars/" + faceOwner), { face: fc.label || null }));
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

function savePalPlace() {
  localStorage.setItem("s51-palplace-" + S.roomId, JSON.stringify(S.palPlace));
}

function initPalettes() {
  try { S.palettes = JSON.parse(localStorage.getItem(palStoreKey()) || "[]"); } catch (e) { S.palettes = []; }
  if (!S.palettes.length) {
    S.palettes = [{ id: "p0", label: "自分用", name: "", place: "", stock: "###よく使う\nCCB<=50 【目星】\nCCB<=50 【聞き耳】\n1d100<={SAN} 【正気度ロール】\n###\n:SAN-1\n:HP-1" }];
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
    const p = { id: "p" + newKey(), label: "新規", name: "", place: "", stock: "" };
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
  $("palSave").addEventListener("click", () => {
    const names = { main: "メイン", info: "情報", talk: "雑談" };
    const data = { palettes: S.palettes.map((p, i) => ({ label: p.label, name: p.name, stock: p.stock, order: i, place: names[p.place] || "" })) };
    const a = el("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "koko-chatpalette-" + S.roomId + ".json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $("palMsg").textContent = "チャパレをファイルに書き出しました";
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
  $("palPlace").addEventListener("change", () => {
    const v = $("palPlace").value;
    const p = S.palettes.find((x) => x.id === S.palSel);
    if (p) { p.place = v; savePalettes(); } else { S.palPlace[S.palSel] = v; savePalPlace(); }
  });
  $("palSend").addEventListener("click", () => sendPalInput());
  $("palInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendPalInput(); }
  });
  renderPaletteTabs();
}

function curPalette() {
  return allPalettes().find((p) => p.id === S.palSel) || null;
}

function palWho(cur) {
  if (!cur) return S.speaker;
  return cur.id.startsWith("char:") ? cur.id.slice(5) : (cur.name && charByName(cur.name)) || S.speaker;
}

function palSendTo(cmd) {
  const cur = curPalette();
  const place = cur ? cur.place || "" : "";
  return sendChat(cmd, palWho(cur), place || S.chatTab).catch((err) => setStatus("送信失敗: " + err.message, true));
}

async function sendPalInput() {
  const v = $("palInput").value.replace(/\s+$/, "");
  if (!v) return;
  $("palInput").value = "";
  await palSendTo(v);
}

function allPalettes() {
  const list = S.palettes.map((p) => ({ ...p, local: true }));
  const c = speakerChar();
  if (c && c.commands) {
    const id = "char:" + S.speaker;
    list.push({ id, label: "駒: " + (c.name || ""), name: c.name || "", stock: c.commands, place: S.palPlace[id] || "", local: false, edit: canEdit(c) });
  }
  return list;
}

function renderPaletteTabs() {
  const box = $("palTabs");
  box.replaceChildren();
  const list = allPalettes();
  if (!list.find((p) => p.id === S.palSel) && list[0]) S.palSel = list[0].id;
  let drag = "";
  list.forEach((p) => {
    const b = el("button", p.id === S.palSel ? "on" : "", p.label || "（無題）");
    b.type = "button";
    b.addEventListener("click", () => { if (S.palSel !== p.id) S.palPick = -1; S.palSel = p.id; renderPaletteTabs(); });
    if (p.local && isPc()) {
      b.draggable = true;
      b.addEventListener("dragstart", (e) => { drag = p.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); });
      b.addEventListener("dragover", (e) => { if (drag && drag !== p.id) { e.preventDefault(); b.classList.add("drop"); } });
      b.addEventListener("dragleave", () => b.classList.remove("drop"));
      b.addEventListener("drop", (e) => {
        e.preventDefault();
        b.classList.remove("drop");
        const a = S.palettes.findIndex((x) => x.id === drag);
        const t = S.palettes.findIndex((x) => x.id === p.id);
        drag = "";
        if (a < 0 || t < 0 || a === t) return;
        const [x] = S.palettes.splice(a, 1);
        S.palettes.splice(t, 0, x);
        savePalettes();
        renderPaletteTabs();
      });
      b.addEventListener("dragend", () => { drag = ""; });
    }
    box.append(b);
  });
  const cur = list.find((p) => p.id === S.palSel);
  const editable = cur && cur.local;
  $("palEdit").disabled = !editable;
  $("palDel").disabled = !editable;
  $("palPlace").disabled = !cur;
  if (document.activeElement !== $("palPlace")) $("palPlace").value = cur ? cur.place || "" : "";
  if (!editable) $("palEditor").hidden = true;
  if (editable && !$("palEditor").hidden) {
    if (document.activeElement !== $("palLabel")) $("palLabel").value = cur.label;
    if (document.activeElement !== $("palName")) $("palName").value = cur.name;
    if (document.activeElement !== $("palStock")) $("palStock").value = cur.stock;
  }
  renderPaletteView();
}

function movePaletteLine(from, to) {
  const cur = curPalette();
  if (!cur) return;
  const next = moveLine(cur.stock, from, to);
  if (next === cur.stock) return;
  S.palPick = -1;
  if (cur.local) {
    const p = S.palettes.find((x) => x.id === cur.id);
    p.stock = next;
    savePalettes();
    if (!$("palEditor").hidden && document.activeElement !== $("palStock")) $("palStock").value = next;
    renderPaletteView();
  } else if (cur.edit) {
    update(rp("chars/" + cur.id.slice(5)), { commands: next }).catch((e) => setStatus("保存失敗: " + e.message, true));
  }
}

function renderPaletteView() {
  const cur = curPalette();
  const view = $("palView");
  $("palInput").placeholder = isPc() ? "行を選ぶとここに入ります（ダブルクリックですぐ送信）" : "行をタップするとすぐ送信します";
  if (!cur) { view.replaceChildren(); S.palSig = ""; return; }
  const sig = [cur.id, cur.stock, S.palPick, isPc(), cur.local || cur.edit].join("\u0001");
  if (sig === S.palSig && view.childElementCount) return;
  S.palSig = sig;
  renderPalette(cur.stock, view, el, {
    closed: S.palClosed,
    picked: S.palPick,
    movable: isPc() && (cur.local || cur.edit),
    tapSend: () => !isPc(),
    select: (cmd, li) => { S.palPick = li; $("palInput").value = cmd; },
    send: (cmd) => palSendTo(cmd),
    move: movePaletteLine
  });
}

function initRoomTab() {
  $("zipFile").addEventListener("change", importZip);
  $("fieldMult").addEventListener("change", () => set(rp("meta/fieldMult"), parseInt($("fieldMult").value, 10)).then(() => { S.fitted = false; queueRender(); }));
  $("gridShow").addEventListener("change", () => set(rp("meta/board/displayGrid"), $("gridShow").checked));
  $("kpClaim").addEventListener("click", async () => {
    if (S.meta.owner) return;
    if (!confirm("この部屋のKPになりますか？（あとから変更はできません）")) return;
    await set(rp("meta/owner"), S.pid);
    await postSystem(S.name + " がこの部屋のKPになりました");
  });
  $("assetsDelAll").addEventListener("click", deleteRoomAssets);
  $("noteAdd").addEventListener("click", addNote);
  $("itemAdd").addEventListener("click", () => addObj("items"));
  $("markerAdd").addEventListener("click", () => addObj("markers"));
  $("roomDelete").addEventListener("click", deleteRoom);
}

async function deleteRoomAssets() {
  if (!S.isKP) return;
  const keys = [...S.assets.keys()];
  if (!keys.length) { $("adminMsg").textContent = "部屋の画像はありません"; return; }
  if (!confirm("この部屋の画像 " + keys.length + "枚 を全部削除しますか？\n（room.zipの背景・パネル・駒の画像が表示されなくなります。マイ画像は消えません）")) return;
  const up = {};
  keys.forEach((k) => { up["assets/" + k] = null; });
  try {
    await update(rp(""), up);
    $("adminMsg").textContent = keys.length + "枚の画像を削除しました";
    await postSystem(S.name + " が部屋の画像を全部削除しました");
  } catch (e) {
    $("adminMsg").textContent = "削除に失敗しました: " + e.message;
  }
}

async function deleteRoom() {
  if (!S.isOwner) return;
  const typed = prompt("部屋そのものを削除します。チャットのログ・駒・画像・シーンがすべて消え、元に戻せません。\n削除するなら部屋ID「" + S.roomId + "」を入力してください");
  if (typed === null) return;
  if (typed.trim() !== S.roomId) { $("adminMsg").textContent = "部屋IDが違うため削除しませんでした"; return; }
  try {
    await remove(rp(""));
    localStorage.removeItem("s51-pal-" + S.roomId);
    localStorage.removeItem("s51-speaker-" + S.roomId);
    location.href = location.pathname;
  } catch (e) {
    $("adminMsg").textContent = "削除に失敗しました（ルールが古い可能性があります）: " + e.message;
  }
}

function queueAssetUi() {
  clearTimeout(S.assetUiT);
  S.assetUiT = setTimeout(() => { renderBoardPickers(); renderObjLists(); }, 300);
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

document.body.classList.add("booted");
applyTheme();
$("themeBtn").addEventListener("click", () => {
  localStorage.setItem("s51-theme", document.documentElement.dataset.theme === "light" ? "dark" : "light");
  applyTheme();
});
initJoin();
