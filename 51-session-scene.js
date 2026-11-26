import { get, set, update, onValue } from "./51-session-fb.js?v=4l";
import { $, S, R, SP, dbr, el, setStatus, sceneTab, scenePath, tabScene, restricted, stageTab, curSceneId, viewBoard, syncMarkers } from "./51-session-core.js?v=4l";
import { postSystem, tabName, tabColor, colKeys, tabLabel } from "./51-session-chat.js?v=4l";
import { queueRender } from "./51-session-board.js?v=4l";
import { renderScenes, renderObjLists, renderBoardPickers, queueAssetUi } from "./51-session-kp.js?v=4l";
import { applyBgm, watchFx } from "./51-session-sound.js?v=4l";

export function curPath(k) {
  if (!k || k === "main") return R("meta/sceneId");
  return restricted(k) ? SP("chans/" + k + "/scene") : R("meta/tabScenes/" + k);
}

export function playPath(k) {
  return restricted(k) ? SP("chans/" + k + "/play") : R("meta/play/" + (k || "main"));
}

export function mergeScenes() {
  const out = {};
  const loc = {};
  Object.entries(S.pubScenes || {}).forEach(([k, v]) => { if (v) { out[k] = v; loc[k] = "p"; } });
  Object.entries(S.sScenes || {}).forEach(([k, v]) => { if (v) { out[k] = v; loc[k] = "s"; } });
  S.scenes = out;
  S.sceneLoc = loc;
  renderScenes();
  renderSceneEditor();
  queueAssetUi();
  stageCheck(true);
}

export function watchSecretScenes() {
  if (!S.db || !S.roomId) return;
  if (S.isKP && !S.sScOffKp) {
    S.sScOffKp = onValue(dbr(SP("scenes")), (s) => { S.sScenesKp = s.val() || {}; rebuildSecret(); }, () => { S.sScOffKp = null; S.sScenesKp = {}; rebuildSecret(); });
  } else if (!S.isKP && S.sScOffKp) {
    S.sScOffKp();
    S.sScOffKp = null;
    S.sScenesKp = {};
  }
  if (!S.sScSubs) S.sScSubs = {};
  const want = new Set();
  if (!S.isKP) Object.values(S.sChans || {}).forEach((c) => { if (c && c.scene) want.add(c.scene); });
  Object.keys(S.sScSubs).forEach((sid) => {
    if (want.has(sid)) return;
    S.sScSubs[sid].off();
    delete S.sScSubs[sid];
  });
  want.forEach((sid) => {
    if (S.sScSubs[sid]) return;
    const sub = { val: null };
    sub.off = onValue(dbr(SP("scenes/" + sid)), (s) => { sub.val = s.val(); rebuildSecret(); }, () => { sub.val = null; rebuildSecret(); });
    S.sScSubs[sid] = sub;
  });
  rebuildSecret();
}

function rebuildSecret() {
  const o = { ...(S.sScenesKp || {}) };
  Object.entries(S.sScSubs || {}).forEach(([sid, sub]) => { if (sub.val) o[sid] = sub.val; });
  const sig = JSON.stringify(o);
  if (sig === S.sScSig) return;
  S.sScSig = sig;
  S.sScenes = o;
  mergeScenes();
}

export function stageCheck(force) {
  const st = stageTab();
  const sid = curSceneId();
  const b = viewBoard();
  const sig = [st, sid, b.fieldW, b.fieldH, b.fg, S.meta && S.meta.fieldMult].join("|");
  if (sig !== S.stageSig) {
    if (S.stageSig !== undefined) S.selMarker = "";
    S.stageSig = sig;
    S.fitted = false;
    force = true;
  }
  if (force) {
    syncMarkers();
    renderObjLists();
    renderBoardPickers();
    const g = $("gridShow");
    if (g) g.checked = !!b.displayGrid;
    queueRender();
  }
  applyBgm();
  watchFx();
}

export async function applyScene(id) {
  const sc = S.scenes[id];
  if (!sc) return;
  const k = sceneTab(sc);
  const up = { [curPath(k)]: id };
  if (k === "main") up[R("meta/board")] = { ...(S.meta.board || {}), bg: sc.bg || "", fg: sc.fg || "", fieldW: sc.fieldW || 16, fieldH: sc.fieldH || 9, gridSize: sc.gridSize || 2, displayGrid: !!sc.displayGrid };
  const play = {};
  if (sc.bgm1 && S.bgms[sc.bgm1]) play[1] = { id: sc.bgm1, t: Date.now() };
  if (sc.bgm2 && S.bgms[sc.bgm2]) play[2] = { id: sc.bgm2, t: Date.now() };
  up[playPath(k)] = Object.keys(play).length ? play : null;
  try {
    await update(dbr(""), up);
    await postSystem("シーン「" + (sc.name || "（名前なし）") + "」に切り替えました", k);
  } catch (e) {
    setStatus("シーンを切り替えられませんでした: " + e.message, true);
  }
}

export function clearCurrent(ids) {
  const up = {};
  ids.forEach((id) => {
    const sc = S.scenes[id];
    if (!sc) return;
    const k = sceneTab(sc);
    if (tabScene(k) === id) up[curPath(k)] = null;
  });
  return up;
}

export async function moveSceneTab(sid, to) {
  const sc = S.scenes[sid];
  if (!sc) return;
  const from = sceneTab(sc);
  if (from === to) return;
  const obj = JSON.parse(JSON.stringify(sc));
  if (to === "main") delete obj.tab; else obj.tab = to;
  const oldPath = scenePath(sid);
  const newPath = (restricted(to) ? SP : R)("scenes/" + sid);
  const up = {};
  if (oldPath !== newPath) { up[oldPath] = null; up[newPath] = obj; } else up[newPath + "/tab"] = to === "main" ? null : to;
  if (tabScene(from) === sid) up[curPath(from)] = null;
  try {
    await update(dbr(""), up);
  } catch (e) {
    setStatus("シーンのタブを変えられませんでした: " + e.message, true);
  }
}

export async function restrictTab(k) {
  if (!S.isKP || k === "main" || restricted(k)) return;
  const name = tabName(k);
  if (!confirm("タブ「" + name + "」の見られる人を絞りますか？\n・このタブの発言とシーンを、チェックを入れた人とKPだけが読める場所へ移します\n・チェックを入れるまでは、KPだけが見られます\n・あとから「全員」に戻せます")) return;
  try {
    const color = tabColor(k);
    const cur = tabScene(k);
    const play = S.meta.play && S.meta.play[k];
    const def = { name, t: Date.now(), open: false };
    if (color) def.color = color;
    if (cur) def.scene = cur;
    if (play) def.play = play;
    await set(dbr(SP("chans/" + k)), def);
    const all = (await get(dbr(R("messages")))).val() || {};
    const mv = {};
    const up = {};
    Object.entries(all).forEach(([key, m]) => {
      if (m && m.tab === k) { mv[key] = m; up[R("messages/" + key)] = null; }
    });
    if (Object.keys(mv).length) await update(dbr(SP("msgs/" + k)), mv);
    Object.entries(S.pubScenes || {}).forEach(([sid, sc]) => {
      if (sc && sceneTab(sc) === k) { up[R("scenes/" + sid)] = null; up[SP("scenes/" + sid)] = sc; }
    });
    up[R("meta/hidden/" + k)] = true;
    up[R("meta/tabScenes/" + k)] = null;
    up[R("meta/play/" + k)] = null;
    if (S.meta.chans && S.meta.chans[k]) { up[R("meta/chans/" + k)] = null; up[R("meta/tabColors/" + k)] = null; }
    await update(dbr(""), up);
  } catch (e) {
    setStatus("見られる人を絞れませんでした: " + e.message, true);
  }
}

export async function releaseScenes(k) {
  const up = {};
  Object.entries(S.sScenes || {}).forEach(([sid, sc]) => {
    if (!sc || sceneTab(sc) !== k) return;
    const o = JSON.parse(JSON.stringify(sc));
    delete o.tab;
    up[SP("scenes/" + sid)] = null;
    up[R("scenes/" + sid)] = o;
  });
  if (Object.keys(up).length) await update(dbr(""), up);
}

export function sceneCount(k) {
  return Object.values(S.scenes).filter((sc) => sceneTab(sc) === k).length;
}

export function renderSceneEditor() {
  const box = $("sceneEditor");
  if (!box || !S.isKP) return;
  const sid = S.selScene;
  const sc = S.scenes[sid];
  box.hidden = !sc;
  if (!sc) { box.replaceChildren(); return; }
  const ae = document.activeElement;
  if (box.dataset.id === sid && ae && box.contains(ae) && ae.matches("input, select")) return;
  box.dataset.id = sid;
  box.replaceChildren();
  const save = (patch) => update(dbr(scenePath(sid)), patch).catch((e) => setStatus("保存失敗: " + e.message, true));
  const nameLab = el("label", "field");
  nameLab.append(el("span", "", "名前"));
  const name = el("input");
  name.value = sc.name || "";
  name.addEventListener("change", () => save({ name: name.value.slice(0, 100) }));
  nameLab.append(name);
  const tabLab = el("label", "field");
  tabLab.append(el("span", "", "どのタブのシーンか"));
  const tab = el("select");
  colKeys().forEach((k) => { const o = el("option", "", tabLabel(k)); o.value = k; tab.append(o); });
  tab.value = sceneTab(sc);
  tab.addEventListener("change", () => moveSceneTab(sid, tab.value));
  tabLab.append(tab);
  box.append(nameLab, tabLab);
  [["bgm1", "BGM 1"], ["bgm2", "BGM 2"]].forEach(([key, label]) => {
    const lab = el("label", "field");
    lab.append(el("span", "", label));
    const sel = el("select");
    const none = el("option", "", "なし");
    none.value = "";
    sel.append(none);
    Object.entries(S.bgms || {}).sort((a, b) => (+a[1].order || 0) - (+b[1].order || 0)).forEach(([k, b]) => { const o = el("option", "", b.name || "（名前なし）"); o.value = k; sel.append(o); });
    sel.value = sc[key] && S.bgms[sc[key]] ? sc[key] : "";
    sel.addEventListener("change", () => save({ [key]: sel.value || null }));
    lab.append(sel);
    box.append(lab);
  });
  box.append(el("p", "msg", "切り替えると、このシーンのタブの盤面とBGMが変わります。BGMがないシーンに切り替えると曲は止まります"));
}
