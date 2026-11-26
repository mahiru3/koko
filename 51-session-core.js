import { ref, onValue } from "./51-session-fb.js?v=4k";
import { renderSpeaker } from "./51-session-chat.js?v=4k";
import { queueRender } from "./51-session-board.js?v=4k";
import { renderCharList, renderCharDetail } from "./51-session-chars.js?v=4k";

export const $ = (id) => document.getElementById(id);

export const params = new URLSearchParams(location.search);

export const ROOM_RE = /^[a-z0-9-]{4,40}$/;

export const LOG_LIMIT = 300;

export const UNIT = 24;

export const PAD = 6;

export const CHAR_Z = 100;

export const FG_Z = 1;

export const CH_TABS = [["main", "メイン"], ["info", "情報"], ["talk", "雑談"]];

export const CHECK_RE = /^(\s*S?(?:CCB?|CC|1D100)\s*(?:\(\d+\))?\s*<=\s*)([^\s　]+)/i;

export const MOBILE = matchMedia("(max-width: 800px)");

export const S = {
  db: null, uid: null, roomId: "", name: "", color: "#4a90d9",
  loader: null, system: null, calc: null, systemId: "DiceBot",
  meta: {}, vars: {}, chars: {}, items: {}, markers: {}, roomMarkers: {}, scenes: {}, notes: {}, effects: {}, assetSel: new Set(),
  assets: new Map(), nodes: new Map(),
  zoom: 1, origin: { x: 0, y: 0 }, drag: null, renderQueued: false, fitted: false,
  speaker: "", selChar: "", palettes: [], palSel: "",
  pid: "", libSets: new Map(), libFiles: new Map(), libSubs: new Set(), mySets: {}, showAllChars: false,
  isKP: false, isOwner: false, kpOpen: true, selItem: "", selMarker: "", off: { x: 0, y: 0 }, created: "", metaSeen: false, players: {}, online: {},
  kp: {}, kpLoaded: false, kpOff: null, tagView: "", assetView: "*", foldersMade: false,
  chatTab: "main", msgs: [], unread: {}, popReady: false, bonus: null, palPlace: {}, palPick: -1, palClosed: new Set(), cbOrder: [], wins: {}, winZ: 60, colOrder: [], popPc: false
};

export function applyTheme() {
  const light = localStorage.getItem("s51-theme") === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  const b = $("themeBtn");
  if (b) b.textContent = light ? "ダーク" : "ライト";
}

export function kpCheck() {
  const m = S.meta || {};
  return !!S.pid && (m.owner === S.pid || !!(m.kps && m.kps[S.pid]));
}

export function visibleChar(c) {
  return !!c && (!c.kpOnly || S.isKP);
}

export function isStand(c) {
  return !!c && c.kind === "stand";
}

export function canEdit(c) {
  return !!c && (S.isKP || c.owner === S.pid);
}

export function visBase(c) {
  return isStand(c) && c.parent && S.chars[c.parent] ? S.chars[c.parent] : c;
}

export function showsParams(c) {
  return visBase(c).showParams !== false;
}

export function showsOther(c) {
  const b = visBase(c);
  return b.showOther !== undefined ? b.showOther !== false : !b.hideStatus;
}

export function canSeeParams(c) {
  return !!c && (S.isKP || c.owner === S.pid || showsParams(c));
}

export function canSeeOther(c) {
  return !!c && (S.isKP || c.owner === S.pid || showsOther(c));
}

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function blurInput() {
  const a = document.activeElement;
  if (a && a !== document.body && a.matches("input, textarea, select")) a.blur();
}

export function setStatus(text, bad) {
  $("status").textContent = text;
  $("status").classList.toggle("bad", !!bad);
}

export function randomId(n) {
  const c = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (v) => c[v % c.length]).join("");
}

export function newKey() {
  return Date.now().toString(36) + randomId(6);
}

export function libSet(pid, sid) {
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

export function libFile(pid, fk) {
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

export function faceList(c) {
  if (!c) return [];
  if (c.set && c.set.pid && c.set.sid) {
    const st = libSet(c.set.pid, c.set.sid);
    return st && Array.isArray(st.faces)
      ? st.faces.filter((f) => f && f.file).map((f) => ({ label: f.label || "", key: "lib:" + c.set.pid + "/" + f.file }))
      : [];
  }
  return (Array.isArray(c.faces) ? c.faces : []).map((f) => ({ label: f.label || "", key: f.icon || "" }));
}

export function charIcon(c) {
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

export function src(key) {
  if (!key) return "";
  if (typeof key === "string" && key.startsWith("lib:")) {
    const [pid, fk] = key.slice(4).split("/");
    return pid && fk ? libFile(pid, fk) : "";
  }
  if (typeof key === "string" && (key.startsWith("data:image/") || key.startsWith("https://"))) return key;
  return S.assets.get(key) || "";
}

export function rp(path) {
  return ref(S.db, "rooms/" + S.roomId + (path ? "/" + path : ""));
}

export function curSceneId() {
  const sid = S.meta && S.meta.sceneId;
  return sid && S.scenes[sid] ? sid : "";
}

export function objBase(kind) {
  if (kind !== "markers") return kind;
  const sid = curSceneId();
  return sid ? "scenes/" + sid + "/markers" : "markers";
}

export function objPath(kind, id) {
  return objBase(kind) + "/" + id;
}

export function syncMarkers() {
  const sid = curSceneId();
  S.markers = (sid ? S.scenes[sid].markers : S.roomMarkers) || {};
}

export function sorted(obj, by) {
  return Object.entries(obj || {}).sort((a, b) => ((a[1][by] ?? 0) - (b[1][by] ?? 0)) || a[0].localeCompare(b[0]));
}

export function isPc() {
  return !MOBILE.matches;
}

export function onlinePids() {
  const set0 = new Set();
  Object.values(S.online).forEach((m) => { if (m && m.pid) set0.add(m.pid); });
  return set0;
}

export function playerName(pid) {
  const p = S.players[pid];
  return p && p.name ? p.name : "";
}

export function speakerChar() {
  return S.speaker && S.chars[S.speaker] ? S.chars[S.speaker] : null;
}

export function charByName(name) {
  const hit = Object.entries(S.chars).find(([, c]) => c.name === name && !isStand(c));
  return hit ? hit[0] : "";
}
