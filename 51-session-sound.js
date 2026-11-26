import { push, set, update, onValue, onChildAdded } from "./51-session-fb.js?v=4l";
import { mediaConfig } from "./51-session-config.js?v=4l";
import { $, S, R, SP, dbr, el, setStatus, src, restricted, tabScene } from "./51-session-core.js?v=4l";
import { isChan } from "./51-session-chat.js?v=4l";
import { playPath } from "./51-session-scene.js?v=4l";

const AUDIO_RE = /\.(mp3|ogg|wav|m4a|aac|opus)$/i;

export function soundUrl(name) {
  if (!name) return "";
  return mediaConfig.soundBase + String(name).split("/").map(encodeURIComponent).join("/");
}

export function vol() {
  if (!S.vol) {
    let v = {};
    try { v = JSON.parse(localStorage.getItem("s51-vol") || "{}"); } catch { v = {}; }
    S.vol = { bgm: typeof v.bgm === "number" ? v.bgm : 50, se: typeof v.se === "number" ? v.se : 70, bgmMute: !!v.bgmMute, seMute: !!v.seMute };
  }
  return S.vol;
}

function saveVol() {
  localStorage.setItem("s51-vol", JSON.stringify(S.vol));
}

function level(kind, itemVol) {
  const v = vol();
  if (v[kind + "Mute"]) return 0;
  const iv = typeof itemVol === "number" ? itemVol : 100;
  return Math.max(0, Math.min(1, (v[kind] / 100) * (iv / 100)));
}

export function initSound() {
  S.bgmSlots = { 1: null, 2: null };
  S.fxSubs = {};
  S.soundReady = true;
  const btn = $("soundBtn");
  const panel = $("soundPanel");
  btn.addEventListener("click", () => { panel.hidden = !panel.hidden; });
  document.addEventListener("pointerdown", (e) => { if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) panel.hidden = true; });
  const v = vol();
  [["bgm", "volBgm", "muteBgm"], ["se", "volSe", "muteSe"]].forEach(([k, r, m]) => {
    $(r).value = String(v[k]);
    $(m).checked = v[k + "Mute"];
    $(r).addEventListener("input", () => { v[k] = +$(r).value; saveVol(); refreshVolumes(); paintSoundBtn(); });
    $(m).addEventListener("change", () => { v[k + "Mute"] = $(m).checked; saveVol(); refreshVolumes(); paintSoundBtn(); });
  });
  paintSoundBtn();
  const unlock = () => {
    if (S.audioOk) return;
    S.audioOk = true;
    $("soundHint").hidden = true;
    Object.values(S.bgmSlots).forEach((p) => { if (p && p.audio && p.audio.paused) p.audio.play().catch(() => {}); });
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
  watchFx();
  applyBgm();
}

function paintSoundBtn() {
  const v = vol();
  $("soundBtn").textContent = v.bgmMute && v.seMute ? "🔇" : "🔊";
}

function refreshVolumes() {
  Object.values(S.bgmSlots || {}).forEach((p) => { if (p && p.audio) p.audio.volume = level("bgm", (S.bgms[p.id] || {}).volume); });
}

export function soundListsChanged() {
  refreshVolumes();
  applyBgm();
  if (S.fxRender) S.fxRender();
}

export async function loadSoundList(force) {
  if (S.soundList && !force) return S.soundList;
  if (S.soundLoading) return S.soundLoading;
  S.soundLoading = (async () => {
    try {
      const r = await fetch(mediaConfig.soundList, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "sound フォルダーが見つかりません" : "一覧を読めませんでした（" + r.status + "）");
      const j = await r.json();
      const list = (Array.isArray(j) ? j : []).filter((f) => f && (f.type || "file") === "file" && AUDIO_RE.test(f.name || "")).map((f) => f.name).sort((a, b) => a.localeCompare(b, "ja"));
      S.soundList = list;
      S.soundErr = "";
    } catch (e) {
      S.soundList = S.soundList || [];
      S.soundErr = e.message || "一覧を読めませんでした";
    }
    S.soundLoading = null;
    return S.soundList;
  })();
  return S.soundLoading;
}

export function playState(k) {
  if (restricted(k)) return (S.sChans[k] && S.sChans[k].play) || {};
  return (S.meta && S.meta.play && S.meta.play[k || "main"]) || {};
}

function hasPlay(k) {
  const p = playState(k);
  return !!(p[1] || p[2]);
}

export function bgmTab() {
  const t = S.chatTab;
  return t && t !== "main" && (tabScene(t) || hasPlay(t)) ? t : "main";
}

export function applyBgm() {
  if (!S.soundReady) return;
  const st = playState(bgmTab());
  [1, 2].forEach((slot) => {
    const want = st[slot] && S.bgms[st[slot].id] && S.bgms[st[slot].id].file ? st[slot].id : "";
    const cur = S.bgmSlots[slot];
    if (cur && cur.id === want && cur.file === S.bgms[want].file) {
      cur.audio.volume = level("bgm", S.bgms[want].volume);
      return;
    }
    if (cur) { cur.audio.pause(); cur.audio.src = ""; S.bgmSlots[slot] = null; }
    if (!want) return;
    const b = S.bgms[want];
    const audio = new Audio(soundUrl(b.file));
    audio.loop = true;
    audio.volume = level("bgm", b.volume);
    S.bgmSlots[slot] = { id: want, file: b.file, audio };
    audio.play().catch(() => { if (!S.audioOk) $("soundHint").hidden = false; });
  });
  if (S.fxRender) S.fxRender();
}

export function nowPlaying(slot) {
  const p = S.bgmSlots && S.bgmSlots[slot];
  return p ? p.id : "";
}

export function setBgm(tab, slot, id) {
  const k = tab && isChan(tab) ? tab : "main";
  const path = playPath(k) + "/" + slot;
  return set(dbr(path), id ? { id, t: Date.now() } : null).catch((e) => setStatus("BGMを変えられませんでした: " + e.message, true));
}

export function playSe(id, local) {
  const s = (local ? local : S.ses[id]);
  if (!s || !s.file) return;
  const a = new Audio(soundUrl(s.file));
  a.volume = level("se", s.volume);
  a.play().catch(() => { if (!S.audioOk) $("soundHint").hidden = false; });
}

export function showCutin(id, local) {
  const f = local ? local : S.effects[id];
  if (!f) return;
  const box = $("cutins");
  const node = el("div", "cutin");
  const u = src(f.img);
  if (u) {
    const im = el("img");
    im.alt = "";
    im.src = u;
    node.append(im);
  } else {
    node.append(el("div", "cutin-name", f.name || ""));
  }
  box.append(node);
  requestAnimationFrame(() => node.classList.add("show"));
  if (f.sound) {
    const a = new Audio(soundUrl(f.sound));
    a.volume = level("se", f.volume);
    a.play().catch(() => {});
  }
  const ms = Math.max(500, Math.min(60000, +f.playtime || 3000));
  setTimeout(() => { node.classList.remove("show"); setTimeout(() => node.remove(), 400); }, ms);
}

function fxPath(tab) {
  return restricted(tab) ? SP("sfx/" + tab) : R("fx");
}

export function sendFx(tab, kind, id) {
  const k = tab && isChan(tab) ? tab : "main";
  const path = fxPath(k);
  const r = push(dbr(path));
  const up = { [r.key]: { kind, id, tab: k, t: Date.now() } };
  const sub = S.fxSubs && S.fxSubs[path];
  if (sub) Object.entries(sub.seen).forEach(([key, t]) => { if (Date.now() - t > 60000) up[key] = null; });
  return update(dbr(path), up).catch((e) => setStatus("演出を送れませんでした: " + e.message, true));
}

export function watchFx() {
  if (!S.soundReady || !S.db) return;
  const want = new Set([R("fx")]);
  Object.keys(S.sChans || {}).forEach((k) => want.add(SP("sfx/" + k)));
  Object.keys(S.fxSubs).forEach((p) => {
    if (want.has(p)) return;
    S.fxSubs[p].off.forEach((f) => f());
    delete S.fxSubs[p];
  });
  want.forEach((p) => {
    if (S.fxSubs[p]) return;
    const sub = { ready: false, seen: {}, off: [] };
    sub.off.push(onChildAdded(dbr(p), (snap) => {
      const e = snap.val();
      if (!e) return;
      sub.seen[snap.key] = +e.t || Date.now();
      if (!sub.ready) return;
      if (e.kind === "se") playSe(e.id);
      if (e.kind === "cut") showCutin(e.id);
    }, () => {}));
    sub.off.push(onValue(dbr(p), () => { sub.ready = true; }, () => {}));
    S.fxSubs[p] = sub;
  });
}

function nameHits(text, name) {
  if (!name) return false;
  const at = /^[@＠]/.test(name);
  let i = text.indexOf(name);
  while (i >= 0) {
    if (at || i === 0 || !/[@＠]/.test(text[i - 1])) return true;
    i = text.indexOf(name, i + 1);
  }
  return false;
}

export function fireTriggers(text, tab) {
  if (!text || !S.soundReady) return;
  const hits = (obj) => Object.entries(obj || {}).filter(([, v]) => v && nameHits(text, String(v.name || "").trim()));
  hits(S.effects).forEach(([id]) => sendFx(tab, "cut", id));
  hits(S.ses).forEach(([id]) => sendFx(tab, "se", id));
  hits(S.bgms).forEach(([id, b]) => setBgm(tab, b.slot === 2 ? 2 : 1, id));
}
