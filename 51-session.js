import { firebaseConfig } from "./51-session-config.js";
import {
  initializeApp, getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
  getDatabase, ref, push, set, update, remove, onValue, onChildAdded, onChildChanged, onChildRemoved,
  query, limitToLast, serverTimestamp, onDisconnect, connectDatabaseEmulator
} from "./51-session-fb.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM_RE = /^[a-z0-9-]{4,40}$/;
const LOG_LIMIT = 300;
const PIECE_PX = 160;
const BOARD_W = 2000;
const BOARD_H = 1200;

const state = {
  db: null,
  uid: null,
  roomId: "",
  name: "",
  color: "#4a90d9",
  loader: null,
  system: null,
  systemId: "DiceBot",
  dragging: null,
  pieces: new Map(),
  pendingImg: null
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
  const a = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(a, (v) => c[v % c.length]).join("");
}

function safeImg(src) {
  return typeof src === "string" && (src.startsWith("data:image/") || src.startsWith("https://")) ? src : "";
}

function configReady() {
  return firebaseConfig.apiKey && firebaseConfig.databaseURL;
}

function initJoin() {
  $("joinRoom").value = params.get("room") || "";
  $("joinName").value = localStorage.getItem("s51-name") || "";
  $("joinColor").value = localStorage.getItem("s51-color") || "#4a90d9";
  $("newRoom").addEventListener("click", () => { $("joinRoom").value = randomId(10); });
  $("joinBtn").addEventListener("click", join);
  $("joinName").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  if (!configReady() && !params.has("emu")) {
    $("joinMsg").textContent = "51-session-config.js に Firebase の設定を貼り付けてください。";
    $("joinBtn").disabled = true;
  }
}

async function join() {
  const roomId = $("joinRoom").value.trim().toLowerCase();
  const name = $("joinName").value.trim();
  if (!ROOM_RE.test(roomId)) { $("joinMsg").textContent = "部屋IDは半角英数字とハイフンで4〜40文字です。"; return; }
  if (!name) { $("joinMsg").textContent = "名前を入力してください。"; return; }
  state.roomId = roomId;
  state.name = name;
  state.color = $("joinColor").value;
  localStorage.setItem("s51-name", name);
  localStorage.setItem("s51-color", state.color);
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
  const cfg = params.has("emu")
    ? { apiKey: "demo-key", projectId: "demo-s51", databaseURL: "http://127.0.0.1:9000/?ns=demo-s51" }
    : firebaseConfig;
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  state.db = getDatabase(app);
  if (params.has("emu")) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(state.db, "127.0.0.1", 9000);
  }
  await signInAnonymously(auth);
  await new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { if (u) { state.uid = u.uid; off(); resolve(); } });
  });
  const url = new URL(location.href);
  url.searchParams.set("room", state.roomId);
  history.replaceState(null, "", url);
  $("join").hidden = true;
  $("room").hidden = false;
  $("roomLabel").textContent = "部屋: " + state.roomId;
  startRoom();
}

function rp(path) {
  return ref(state.db, "rooms/" + state.roomId + (path ? "/" + path : ""));
}

function startRoom() {
  initTabs();
  initSystems();
  initPresence();
  initChat();
  initPalette();
  initBoard();
  initPieceForm();
  $("copyUrl").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setStatus("URLをコピーしました");
    } catch (e) {
      prompt("このURLを共有してください", location.href);
    }
  });
}

function initTabs() {
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
  });
}

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
  if (name === "chat") scrollLog(true);
}

function initSystems() {
  state.loader = new BCDiceLite.LiteLoader();
  const sel = $("systemSel");
  state.loader.listAvailableGameSystems()
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"))
    .forEach((info) => {
      const o = el("option", "", info.name);
      o.value = info.id;
      sel.append(o);
    });
  sel.addEventListener("change", () => set(rp("meta/system"), sel.value));
  onValue(rp("meta/system"), (snap) => loadSystem(snap.val() || "DiceBot"));
}

async function loadSystem(id) {
  try {
    state.system = await state.loader.dynamicLoad(id);
    state.systemId = id;
    $("systemSel").value = id;
  } catch (e) {
    state.system = await state.loader.dynamicLoad("DiceBot");
    state.systemId = "DiceBot";
    $("systemSel").value = "DiceBot";
  }
}

function initPresence() {
  const mine = rp("members/" + state.uid);
  onValue(ref(state.db, ".info/connected"), (snap) => {
    if (snap.val() === true) {
      setStatus("接続中");
      onDisconnect(mine).remove().then(() =>
        set(mine, { name: state.name, color: state.color, t: serverTimestamp() })
      );
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
      li.append(dot, el("span", "", (m.name || "?") + (c.key === state.uid ? "（自分）" : "")));
      list.append(li);
    });
    $("memberCount").textContent = "接続 " + n + "人";
  });
}

function initChat() {
  const input = $("chatInput");
  $("sendBtn").addEventListener("click", () => sendChat(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendChat(input.value);
    }
  });
  onChildAdded(query(rp("messages"), limitToLast(LOG_LIMIT)), (snap) => renderMessage(snap.key, snap.val()));
}

function rollDice(text) {
  if (!state.system) return null;
  const first = text.split("\n")[0];
  try {
    return state.system.eval(first);
  } catch (e) {
    return null;
  }
}

function resultClass(r) {
  if (r.critical) return "critical";
  if (r.fumble) return "fumble";
  if (r.success) return "success";
  if (r.failure) return "failure";
  return "";
}

async function sendChat(raw) {
  const text = raw.replace(/\s+$/, "");
  if (!text) return;
  const r = rollDice(text);
  const msg = {
    uid: state.uid,
    name: state.name,
    color: state.color,
    text: text.slice(0, 2000),
    t: serverTimestamp()
  };
  if (r) {
    msg.dice = String(r.text).slice(0, 2000);
    msg.res = resultClass(r);
    msg.sys = state.systemId;
    if (r.secret) msg.secret = true;
  }
  $("chatInput").value = "";
  try {
    await push(rp("messages"), msg);
  } catch (e) {
    $("chatInput").value = text;
    setStatus("送信失敗: " + e.message, true);
  }
}

function nearBottom() {
  const log = $("log");
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

function scrollLog(force) {
  const log = $("log");
  if (force || nearBottom()) log.scrollTop = log.scrollHeight;
}

function renderMessage(key, m) {
  if (!m) return;
  const stick = nearBottom();
  const li = el("li", "msg-item");
  li.dataset.key = key;
  const head = el("div", "who", m.name || "?");
  head.style.color = m.color || "#ccc";
  const time = el("span", "time", m.t ? new Date(m.t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "");
  head.append(time);
  li.append(head);
  const hidden = m.secret && m.uid !== state.uid;
  if (hidden) {
    li.append(el("div", "dice secret", "シークレットダイス"));
  } else {
    li.append(el("div", "text", m.text || ""));
    if (m.dice) li.append(el("div", "dice " + (m.res || ""), (m.secret ? "[S] " : "") + m.dice));
  }
  const log = $("log");
  log.append(li);
  while (log.children.length > LOG_LIMIT) log.firstElementChild.remove();
  if (stick || m.uid === state.uid) scrollLog(true);
}

function paletteKey() {
  return "s51-palette-" + state.roomId;
}

function initPalette() {
  const ta = $("paletteText");
  ta.value = localStorage.getItem(paletteKey()) ?? localStorage.getItem("s51-palette-last") ?? "//SAN=50\nCC<=50 【目星】\nCC<={SAN} 【SANチェック】\n1D100\n2D6";
  ta.addEventListener("input", () => {
    localStorage.setItem(paletteKey(), ta.value);
    localStorage.setItem("s51-palette-last", ta.value);
    renderPalette();
  });
  renderPalette();
}

function parsePalette(src) {
  const vars = {};
  const lines = [];
  src.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\/\/([^=]+)=(.*)$/);
    if (m) vars[m[1].trim()] = m[2].trim();
    else if (line.trim()) lines.push(line);
  });
  const expand = (s) => {
    let out = s;
    for (let i = 0; i < 5; i++) {
      const next = out.replace(/\{([^{}]+)\}/g, (all, k) => (k in vars ? vars[k] : all));
      if (next === out) break;
      out = next;
    }
    return out.replace(/\\n/g, "\n");
  };
  return lines.map(expand);
}

function renderPalette() {
  const list = $("paletteList");
  list.replaceChildren();
  parsePalette($("paletteText").value).forEach((cmd) => {
    const li = el("li");
    const fill = el("button", "pal-text", cmd);
    fill.type = "button";
    fill.title = "クリックで入力欄へ";
    fill.addEventListener("click", () => {
      $("chatInput").value = cmd;
      showTab("chat");
      $("chatInput").focus();
    });
    const go = el("button", "pal-go", "▶");
    go.type = "button";
    go.title = "そのまま送信";
    go.addEventListener("click", () => sendChat(cmd));
    li.append(fill, go);
    list.append(li);
  });
}

function initBoard() {
  const board = $("board");
  board.style.width = BOARD_W + "px";
  board.style.height = BOARD_H + "px";
  const q = rp("pieces");
  onChildAdded(q, (s) => upsertPiece(s.key, s.val()));
  onChildChanged(q, (s) => upsertPiece(s.key, s.val()));
  onChildRemoved(q, (s) => removePieceEl(s.key));
}

function upsertPiece(id, p) {
  if (!p) return;
  let node = state.pieces.get(id);
  if (!node) {
    node = el("div", "piece");
    node.dataset.id = id;
    node.append(el("div", "face"), el("div", "label"));
    bindDrag(node);
    $("board").append(node);
    state.pieces.set(id, node);
  }
  const face = node.querySelector(".face");
  const src = safeImg(p.img);
  face.replaceChildren();
  face.style.background = src ? "transparent" : (p.color || "#888");
  if (src) {
    const img = el("img");
    img.src = src;
    img.alt = "";
    img.draggable = false;
    face.append(img);
  } else {
    face.textContent = (p.name || "?").slice(0, 1);
  }
  node.querySelector(".label").textContent = p.name || "";
  if (state.dragging !== id) {
    node.style.left = (p.x || 0) + "px";
    node.style.top = (p.y || 0) + "px";
  }
  renderPieceList();
}

function removePieceEl(id) {
  const node = state.pieces.get(id);
  if (node) node.remove();
  state.pieces.delete(id);
  renderPieceList();
}

function bindDrag(node) {
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    state.dragging = node.dataset.id;
    sx = e.clientX; sy = e.clientY;
    ox = parseFloat(node.style.left) || 0;
    oy = parseFloat(node.style.top) || 0;
    moved = false;
    node.classList.add("drag");
  });
  node.addEventListener("pointermove", (e) => {
    if (state.dragging !== node.dataset.id) return;
    const x = Math.max(0, Math.min(BOARD_W - 40, ox + e.clientX - sx));
    const y = Math.max(0, Math.min(BOARD_H - 40, oy + e.clientY - sy));
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 2) moved = true;
    node.style.left = x + "px";
    node.style.top = y + "px";
  });
  const end = () => {
    if (state.dragging !== node.dataset.id) return;
    state.dragging = null;
    node.classList.remove("drag");
    if (moved) {
      update(rp("pieces/" + node.dataset.id), {
        x: Math.round(parseFloat(node.style.left)),
        y: Math.round(parseFloat(node.style.top))
      }).catch((err) => setStatus("駒の保存失敗: " + err.message, true));
    }
  };
  node.addEventListener("pointerup", end);
  node.addEventListener("pointercancel", end);
}

function initPieceForm() {
  $("pieceFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    state.pendingImg = null;
    if (!f) { $("pieceMsg").textContent = ""; return; }
    try {
      state.pendingImg = await shrinkImage(f, PIECE_PX);
      $("pieceMsg").textContent = "画像を圧縮しました（約" + Math.ceil(state.pendingImg.length / 1024) + "KB）";
    } catch (err) {
      $("pieceMsg").textContent = "画像を読み込めませんでした";
    }
  });
  $("pieceAdd").addEventListener("click", addPiece);
}

async function shrinkImage(file, max) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  let url = c.toDataURL("image/webp", 0.8);
  if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/png");
  return url;
}

async function addPiece() {
  const name = $("pieceName").value.trim() || "駒";
  const wrap = $("boardWrap");
  const p = {
    name: name.slice(0, 30),
    color: $("pieceColor").value,
    x: Math.round(wrap.scrollLeft + 40 + Math.random() * 80),
    y: Math.round(wrap.scrollTop + 40 + Math.random() * 80),
    owner: state.uid
  };
  if (state.pendingImg) p.img = state.pendingImg;
  try {
    await push(rp("pieces"), p);
    $("pieceName").value = "";
    $("pieceFile").value = "";
    state.pendingImg = null;
    $("pieceMsg").textContent = "追加しました";
  } catch (err) {
    $("pieceMsg").textContent = "追加に失敗しました: " + err.message;
  }
}

function renderPieceList() {
  const list = $("pieceList");
  list.replaceChildren();
  state.pieces.forEach((node, id) => {
    const li = el("li");
    li.append(el("span", "", node.querySelector(".label").textContent || "（名前なし）"));
    const del = el("button", "del", "削除");
    del.type = "button";
    del.addEventListener("click", () => {
      if (confirm("この駒を削除しますか？")) remove(rp("pieces/" + id));
    });
    li.append(del);
    list.append(li);
  });
}

initJoin();
