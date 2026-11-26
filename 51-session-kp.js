import { ref, get, push, set, update, remove, onValue } from "./51-session-fb.js?v=4l";
import { readRoomZip } from "./51-session-import.js?v=4l";
import { $, CH_TABS, S, isStand, showsParams, showsOther, el, setStatus, newKey, src, rp, sorted, onlinePids, playerName, curSceneId, objBase, objPath, dbr, R, SP, scenePath, sceneTab, tabScene, restricted, stageTab, viewBoard } from "./51-session-core.js?v=4l";
import { showTab, applyKpLayout } from "./51-session-layout.js?v=4l";
import { colKeys, tabColor, tabName, postSystem, tabLabel, rerenderLog, tabOf } from "./51-session-chat.js?v=4l";
import { queueRender, uploadAsset, centerPos } from "./51-session-board.js?v=4l";
import { deleteSecret, isOpen, isSecret, memberBoxes, removeAllSecrets, renameSecret, setOpen, setSecretColor } from "./51-session-secret.js?v=4l";
import { applyScene, clearCurrent, renderSceneEditor, restrictTab, sceneCount } from "./51-session-scene.js?v=4l";
import { listState, orderedEntries, checkedIds, clearChecked, initListBar, renderRows, isEditing } from "./51-session-list.js?v=4l";

export function renderPlayers() {
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

export function charVisList(entries) {
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

export async function toggleKp(pid, on) {
  if (!S.isOwner) return;
  const name = playerName(pid) || "この参加者";
  if (on && !confirm(name + " にKP権限を渡しますか？\n（KPパレット・/var・パネル編集・駒の持ち主変更・参加者を外す、ができるようになります。部屋の削除と権限の付け外しはできません）")) return;
  await set(rp("meta/kps/" + pid), on ? true : null);
  await postSystem(name + (on ? " にKP権限を渡しました" : " のKP権限を戻しました"));
}

export async function removePlayer(pid) {
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

export function renderLogDelOptions() {
  const sel = $("logDelTab");
  if (!sel || document.activeElement === sel) return;
  const v = sel.value;
  sel.replaceChildren();
  const all = el("option", "", "すべてのタブ（秘匿タブも）");
  all.value = "*";
  sel.append(all);
  colKeys().forEach((k) => { const o = el("option", "", tabLabel(k) + "だけ"); o.value = k; sel.append(o); });
  sel.value = [...sel.options].some((o) => o.value === v) ? v : "*";
}

export async function deleteLogs() {
  if (!S.isOwner) return;
  const k = $("logDelTab").value || "*";
  const label = k === "*" ? "すべてのタブ（秘匿タブも）" : "タブ「" + tabName(k) + "」";
  const typed = prompt(label + "のチャットログを削除します。元に戻せません。\n削除するなら「削除」と入力してください");
  if (typed === null) return;
  if (typed.trim() !== "削除") { $("adminMsg").textContent = "「削除」と入力されなかったので削除しませんでした"; return; }
  try {
    if (k === "*") {
      await update(ref(S.db), {
        ["rooms/" + S.roomId + "/messages"]: null,
        ["rooms/" + S.roomId + "/sdopen"]: null,
        ["secrets/" + S.roomId + "/msgs"]: null,
        ["secrets/" + S.roomId + "/sdice"]: null
      });
    } else if (isSecret(k)) {
      await set(ref(S.db, "secrets/" + S.roomId + "/msgs/" + k), null);
    } else {
      const all = (await get(rp("messages"))).val() || {};
      const up = {};
      Object.entries(all).forEach(([key, m]) => { if ((m && m.tab) === k || (k === "main" && m && !m.tab)) up[key] = null; });
      if (Object.keys(up).length) await update(rp("messages"), up);
    }
    S.msgs = k === "*" ? [] : S.msgs.filter((m) => tabOf(m) !== k);
    rerenderLog();
    await postSystem("チャットのログを削除しました（" + label + "）");
    $("adminMsg").textContent = "ログを削除しました";
  } catch (e) {
    $("adminMsg").textContent = "削除できませんでした: " + e.message;
  }
}

export function renderChanList() {
  renderLogDelOptions();
  const ul = $("chanList");
  if (!ul || !S.isKP) return;
  if (ul.contains(document.activeElement) && document.activeElement.matches("input:not([type=checkbox])")) return;
  ul.replaceChildren();
  colKeys().forEach((k) => {
    const sec = isSecret(k);
    const li = el("li", "chan-row" + (sec ? " secret" : ""));
    const name = el("span", "chan-name", tabLabel(k));
    const col = el("input");
    col.type = "color";
    col.value = tabColor(k) || "#4a90d9";
    col.title = "タブの色";
    col.addEventListener("change", () => (sec ? setSecretColor(k, col.value) : set(rp("meta/tabColors/" + k), col.value)));
    const clr = el("button", "mini", "色なし");
    clr.type = "button";
    clr.hidden = !tabColor(k);
    clr.addEventListener("click", () => (sec ? setSecretColor(k, null) : set(rp("meta/tabColors/" + k), null)));
    li.append(name, col, clr);
    if (k !== "main") {
      const lab = el("label", "check all-check");
      const all = el("input");
      all.type = "checkbox";
      all.checked = !sec || isOpen(k);
      all.addEventListener("change", () => {
        if (!sec) { all.checked = true; restrictTab(k); return; }
        setOpen(k, all.checked);
      });
      lab.append(all, document.createTextNode("全員が見られる"));
      li.append(lab);
    }
    if (!CH_TABS.some(([x]) => x === k)) {
      const rn = el("button", "mini", "名前");
      rn.type = "button";
      rn.addEventListener("click", () => (sec ? renameSecret(k) : renameChan(k)));
      const dl = el("button", "mini del", "削除");
      dl.type = "button";
      dl.addEventListener("click", () => (sec ? deleteSecret(k) : deleteChan(k)));
      li.append(rn, dl);
    }
    if (sec) {
      const mb = memberBoxes(k);
      mb.classList.toggle("dim", isOpen(k));
      li.append(mb);
    }
    ul.append(li);
  });
}

export async function addChan() {
  if (!S.isKP) return;
  const name = (prompt("追加するタブの名前") || "").trim().slice(0, 20);
  if (!name) return;
  const k = "c" + newKey();
  await set(rp("meta/chans/" + k), { name, t: Date.now() });
  await postSystem("チャットのタブ「" + name + "」を追加しました");
}

export async function renameChan(k) {
  const cur = tabName(k);
  const name = (prompt("タブの新しい名前", cur) || "").trim().slice(0, 20);
  if (!name || name === cur) return;
  await set(rp("meta/chans/" + k + "/name"), name);
}

export async function deleteChan(k) {
  const name = tabName(k);
  const n = sceneCount(k);
  if (!confirm("タブ「" + name + "」を削除しますか？\n（このタブの発言は表示されなくなります）" + (n ? "\nこのタブのシーン " + n + "件は、メインのシーンになります" : ""))) return;
  const up = { [R("meta/chans/" + k)]: null, [R("meta/tabScenes/" + k)]: null, [R("meta/play/" + k)]: null };
  Object.entries(S.pubScenes || {}).forEach(([sid, sc]) => { if (sc && sc.tab === k) up[R("scenes/" + sid + "/tab")] = null; });
  await update(dbr(""), up);
  await postSystem("チャットのタブ「" + name + "」を削除しました");
}

export function renderScenes() {
  renderRows($("sceneList"), "scenes", orderedEntries(S.scenes), {
    empty: "シーンはまだありません（room.zip を読み込むと入ります）",
    search: (id, sc) => sc.name || "",
    toggleOnClick: true,
    onReorder: (ids) => saveOrder(scenePath, ids),
    onOpen: (id) => { S.selScene = S.selScene === id ? "" : id; renderScenes(); renderSceneEditor(); },
    fill: (li, id, sc) => {
      const key = sc.fg || sc.bg || "";
      const go = el("button", "primary", "切替");
      go.type = "button";
      go.addEventListener("click", () => applyScene(id));
      const k = sceneTab(sc);
      li.classList.toggle("current", tabScene(k) === id);
      li.classList.toggle("picked", S.selScene === id);
      const name = el("span", "lst-name", sc.name || "（名前なし）");
      if (k !== "main") {
        const chip = el("span", "tag-chip tab-chip", tabLabel(k));
        chip.style.setProperty("--tab-c", tabColor(k) || "var(--accent)");
        name.append(chip);
      }
      li.append(thumbOf(key), name, go);
    }
  });
}

export function thumbOf(k) {
  const u = src(k);
  if (!u) return el("span", "thumb thumb-none", "なし");
  const th = el("img", "thumb");
  th.alt = "";
  th.dataset.asset = k;
  th.src = u;
  return th;
}

export function at(base) {
  return (id) => base + "/" + id;
}

export function saveOrder(pathOf, ids) {
  const up = {};
  ids.forEach((id, i) => { up[pathOf(id) + "/order"] = i; });
  return update(dbr(""), up).catch((e) => setStatus("並べ替えを保存できませんでした: " + e.message, true));
}

function listNames(ids, label) {
  return ids.slice(0, 8).map((id) => "・" + label(id)).join("\n") + (ids.length > 8 ? "\n…ほか" + (ids.length - 8) + "件" : "");
}

export async function deleteMany(name, pathOf, ids, label, what, extra) {
  if (!confirm(what + " " + ids.length + "件 を削除しますか？\n" + listNames(ids, label))) return false;
  const up = {};
  ids.forEach((id) => { up[pathOf(id)] = null; });
  Object.assign(up, extra || {});
  try {
    await update(dbr(""), up);
    clearChecked(name);
    return true;
  } catch (e) {
    setStatus("削除できませんでした: " + e.message, true);
    return false;
  }
}

export async function duplicateMany(name, pathOf, objs, ids, tweak) {
  const all = listState(name).ul._all;
  const order = [];
  const made = [];
  const up = {};
  all.forEach((id) => {
    order.push(pathOf(id));
    if (!ids.includes(id) || !objs[id]) return;
    const parent = pathOf(id).replace(/\/[^/]+$/, "");
    const k = push(dbr(parent)).key;
    const np = parent + "/" + k;
    up[np] = tweak ? tweak(JSON.parse(JSON.stringify(objs[id]))) : JSON.parse(JSON.stringify(objs[id]));
    order.push(np);
    made.push([id, k]);
  });
  order.forEach((p, i) => { if (up[p]) up[p].order = i; else up[p + "/order"] = i; });
  try {
    await update(dbr(""), up);
    const st = listState(name);
    st.checked.clear();
    made.forEach(([, k]) => st.checked.add(k));
    return made;
  } catch (e) {
    setStatus("複製できませんでした: " + e.message, true);
    return [];
  }
}

export function noteColor(n, i) {
  const c = parseInt(n.color, 10);
  return c >= 1 && c <= 4 ? c : (i % 4) + 1;
}

export function renderNotes() {
  const box = $("noteList");
  const ae = document.activeElement;
  if (ae && box.contains(ae) && ae.matches("input, textarea, select")) return;
  const open = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.id));
  let i = -1;
  renderRows(box, "notes", orderedEntries(S.notes), {
    empty: "テキストはまだありません（room.zip のメモもここに入ります）",
    search: (id, n) => (n.name || "") + " " + (n.text || ""),
    onReorder: (ids) => saveOrder(at(R("notes")), ids),
    fill: (li, id, n) => {
      i++;
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
      const del = el("button", "mini del", "削除");
      del.type = "button";
      del.addEventListener("click", () => { if (confirm("「" + (n.name || "無題") + "」を削除しますか？")) remove(rp("notes/" + id)); });
      const row = el("div", "row");
      row.append(title, color, del);
      d.append(row, text);
      li.append(d);
    }
  });
}

export function addNote() {
  const max = Object.values(S.notes).reduce((m, n) => Math.max(m, +n.order || 0), 0);
  push(rp("notes"), { name: "新しいテキスト", text: "", color: 1, order: max + 1 }).then((r) => {
    renderNotes();
    const d = $("noteList").querySelector("details[data-id='" + r.key + "']");
    if (d) d.open = true;
  });
}

function initListBars() {
  initListBar($("sceneBar"), "scenes", {
    placeholder: "検索（シーン名・ID）",
    onChange: renderScenes,
    actions: [
      { label: "選択を複製", run: (ids) => duplicateMany("scenes", scenePath, S.scenes, ids).then(renderScenes) },
      { label: "選択を削除", cls: "del", run: (ids) => deleteMany("scenes", scenePath, ids, (id) => (S.scenes[id] && S.scenes[id].name) || "（名前なし）", "シーン", clearCurrent(ids)) }
    ]
  });
  initListBar($("noteBar"), "notes", {
    placeholder: "検索（見出し・本文・ID）",
    onChange: renderNotes,
    actions: [
      { label: "選択を複製", run: (ids) => duplicateMany("notes", at(R("notes")), S.notes, ids).then(renderNotes) },
      { label: "選択を削除", cls: "del", run: (ids) => deleteMany("notes", at(R("notes")), ids, (id) => (S.notes[id] && S.notes[id].name) || "（無題）", "テキスト") }
    ]
  });
  initListBar($("markerBar"), "markers", {
    placeholder: "検索（文字・クリックアクション・ID）",
    onChange: renderObjLists,
    actions: [
      { label: "選択を複製", run: (ids) => duplicateMany("markers", at(objBase("markers")), S.markers, ids, shift).then(renderObjLists) },
      { label: "選択を削除", cls: "del", run: (ids) => deleteMany("markers", at(objBase("markers")), ids, (id) => objLabel("markers", S.markers[id] || {}), "マーカーパネル").then((ok) => { if (ok && ids.includes(S.selMarker)) S.selMarker = ""; renderObjLists(); }) }
    ]
  });
  const tagAdd = tagSelect("タグを付ける…", true);
  const tagDel = tagSelect("タグを外す…", false);
  initListBar($("itemBar"), "items", {
    placeholder: "検索（名前・クリックアクション・ID）",
    onChange: renderObjLists,
    actions: [
      { label: "出す", title: "選んだパネルを盤面に出す", run: (ids) => setActive(ids, true) },
      { label: "しまう", title: "選んだパネルを盤面からしまう", run: (ids) => setActive(ids, false) },
      { node: tagAdd },
      { node: tagDel },
      { label: "選択を複製", run: (ids) => duplicateMany("items", at(R("items")), S.items, ids, shift).then((made) => copyTags(made)).then(renderObjLists) },
      { label: "選択を削除", cls: "del", run: (ids) => deleteMany("items", at(R("items")), ids, (id) => objLabel("items", S.items[id] || {}), "スクリーンパネル").then((ok) => { if (ok) { dropTags(ids); if (ids.includes(S.selItem)) S.selItem = ""; } renderObjLists(); }) }
    ]
  });
}

function shift(o) {
  return { ...o, x: (o.x || 0) + 1, y: (o.y || 0) + 1 };
}

function setActive(ids, on) {
  const up = {};
  ids.forEach((id) => { if (S.items[id]) up[id + "/active"] = on; });
  return update(rp("items"), up).catch((e) => setStatus("保存失敗: " + e.message, true));
}

export function imagePicker(box, cur, onPick) {
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
  const bar = el("div", "folder-bar pick-folders");
  const grid = el("div", "pick-grid");
  const fill = () => {
    if (S.pickView !== "*" && S.pickView && !kpd("folders")[S.pickView]) S.pickView = "*";
    bar.replaceChildren();
    const fs = sortedFolders();
    bar.hidden = !fs.length;
    const chip = (k, label, color) => {
      const b = el("button", "folder-chip" + (S.pickView === k ? " on" : ""), label);
      b.type = "button";
      if (color) b.style.setProperty("--fc", color);
      b.addEventListener("click", () => { S.pickView = k; fill(); });
      bar.append(b);
    };
    chip("*", "すべて");
    chip("", "未分類");
    fs.forEach(([k, f]) => chip(k, (S.pickView === k ? "📂" : "📁") + (f.name || ""), f.color));
    grid.replaceChildren();
    const list = assetEntries().map(([k]) => k).filter((k) => S.pickView === "*" || folderOf(k) === S.pickView);
    if (!list.length) grid.append(el("p", "msg", "このフォルダーに画像はありません"));
    list.forEach((k) => {
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
  d.append(bar, grid);
  if (wasOpen) { d.open = true; fill(); }
  box.append(head, d);
}

export function saveBoard(key, val) {
  const up = {};
  if (stageTab() === "main") up[R("meta/board/" + key)] = val;
  const sid = curSceneId();
  if (sid) up[scenePath(sid) + "/" + key] = val;
  if (!Object.keys(up).length) return Promise.resolve();
  return update(dbr(""), up).catch((e) => setStatus("保存失敗: " + e.message, true));
}

export function renderBoardPickers() {
  if (!S.isKP) return;
  const b = viewBoard();
  imagePicker($("bgPick"), b.bg || "", (k) => saveBoard("bg", k || null));
  imagePicker($("fgPick"), b.fg || "", (k) => saveBoard("fg", k || null));
  const sid = curSceneId();
  const st = stageTab();
  const where = st === "main" ? "" : "（タブ「" + tabName(st) + "」）";
  $("markerScene").textContent = sid ? "シーン「" + (S.scenes[sid].name || "（名前なし）") + "」" + where + "のマーカーです。チャットウィンドウで開いているタブのシーンが対象です" : "メインのシーンを選んでいないので、部屋のマーカーです";
  const bs = $("boardScene");
  if (bs) bs.textContent = sid ? "対象：シーン「" + (S.scenes[sid].name || "（名前なし）") + "」" + where : "対象：メインの盤面（シーンなし）";
}

export const OBJ_FIELDS = {
  items: [["memo", "名前（メモ）", "text"], ["x", "X", "num"], ["y", "Y", "num"], ["w", "幅", "num"], ["h", "高さ", "num"], ["z", "レイヤー", "z"], ["click", "クリックアクション（クリックで発言する文字）", "area"], ["locked", "固定（動かせなくする）", "check"]],
  markers: [["text", "文字", "area"], ["x", "X", "num"], ["y", "Y", "num"], ["w", "幅", "num"], ["h", "高さ", "num"], ["z", "レイヤー", "z"], ["click", "クリックアクション（クリックで発言する文字）", "area"], ["locked", "固定（動かせなくする）", "check"]]
};

export function objLabel(kind, o) {
  const t = kind === "items" ? o.memo || o.click : o.text || o.click;
  return String(t || "（名前なし）").split("\n")[0].slice(0, 30);
}

export function renderObjLists() {
  if (!S.isKP) return;
  const byZ = (a, b) => (+b[1].z || 0) - (+a[1].z || 0) || a[0].localeCompare(b[0]);
  [["items", "itemList", "selItem"], ["markers", "markerList", "selMarker"]].forEach(([kind, listId, selKey]) => {
    const base = at(objBase(kind));
    renderRows($(listId), kind, orderedEntries(S[kind], byZ), {
      search: (id, o) => (kind === "items" ? (o.memo || "") + " " + tagNames(id).join(" ") : o.text || "") + " " + (o.click || ""),
      filter: kind === "items" && S.tagView ? (id) => !!(kpd("itemTags")[id] || {})[S.tagView] : null,
      onReorder: (ids) => saveOrder(base, ids),
      onOpen: (id) => { S[selKey] = id === S[selKey] ? "" : id; renderObjLists(); renderObjEditor(kind, true); },
      fill: (li, id, o) => {
        li.classList.toggle("current", id === S[selKey]);
        if (kind === "items") {
          const pair = el("span", "thumb-pair");
          pair.append(thumbOf(o.img), thumbOf(o.cover));
          li.append(pair);
          li.classList.toggle("put-away", o.active === false);
        } else {
          li.append(thumbOf(o.img));
        }
        const name = el("span", "lst-name", objLabel(kind, o) + (kind === "items" ? itemTags(o) : o.locked ? "（固定）" : ""));
        if (kind === "items") tagNames(id).forEach((t) => name.append(el("span", "tag-chip", t)));
        li.append(name, el("span", "z-tag", "L" + Math.round(+o.z || 0)));
      }
    });
  });
  renderTagBar();
  renderObjEditor("items");
  renderObjEditor("markers");
}

export function kpd(key) {
  return (S.kp && S.kp[key]) || {};
}

function kp(path) {
  return ref(S.db, "kpdata/" + S.roomId + (path ? "/" + path : ""));
}

export function watchKpData() {
  if (S.isKP && !S.kpOff) {
    S.kpOff = onValue(kp(""), (s) => {
      S.kp = s.val() || {};
      S.kpLoaded = true;
      ensureFolders();
      renderObjLists();
      renderAssetList();
      renderBoardPickers();
    }, () => { S.kpOff = null; });
  } else if (!S.isKP && S.kpOff) {
    S.kpOff();
    S.kpOff = null;
    S.kp = {};
    S.kpLoaded = false;
  }
}

function sortedTags() {
  return orderedEntries(kpd("tags"));
}

function tagNames(id) {
  const t = kpd("tags");
  return sortedTags().filter(([k]) => (kpd("itemTags")[id] || {})[k] && t[k]).map(([, v]) => v.name || "");
}

async function newTag() {
  const name = (prompt("新しいタグの名前") || "").trim().slice(0, 20);
  if (!name) return "";
  const hit = sortedTags().find(([, v]) => v.name === name);
  if (hit) return hit[0];
  const k = "t" + newKey();
  const max = Object.values(kpd("tags")).reduce((m, v) => Math.max(m, +v.order || 0), 0);
  await set(kp("tags/" + k), { name, order: max + 1 });
  return k;
}

function tagSelect(label, on) {
  const sel = el("select", "tag-sel");
  sel.dataset.on = on ? "1" : "";
  sel.dataset.label = label;
  sel.addEventListener("change", async () => {
    let t = sel.value;
    sel.value = "";
    if (!t) return;
    const ids = checkedIds("items");
    if (!ids.length) { setStatus("先にパネルを選んでください", true); return; }
    if (t === "__new") t = await newTag();
    if (!t) return;
    const up = {};
    ids.forEach((id) => { up[id + "/" + t] = on ? true : null; });
    update(kp("itemTags"), up).catch((e) => setStatus("タグを保存できませんでした: " + e.message, true));
  });
  return sel;
}

function fillTagSelects() {
  document.querySelectorAll(".tag-sel").forEach((sel) => {
    sel.replaceChildren();
    const first = el("option", "", sel.dataset.label);
    first.value = "";
    sel.append(first);
    sortedTags().forEach(([k, v]) => { const o = el("option", "", v.name || ""); o.value = k; sel.append(o); });
    if (sel.dataset.on) { const o = el("option", "", "＋ 新しいタグ…"); o.value = "__new"; sel.append(o); }
    sel.value = "";
  });
}

export function renderTagBar() {
  const box = $("itemTagBar");
  if (!box) return;
  if (S.tagView && !kpd("tags")[S.tagView]) S.tagView = "";
  box.replaceChildren();
  const edit = isEditing("items");
  box.hidden = !edit && !sortedTags().length;
  const chip = (k, label, n) => {
    const b = el("button", "tag-filter" + (S.tagView === k ? " on" : ""), label + (n === undefined ? "" : "（" + n + "）"));
    b.type = "button";
    b.addEventListener("click", () => { S.tagView = k; renderObjLists(); });
    box.append(b);
  };
  chip("", "すべて");
  const it = kpd("itemTags");
  sortedTags().forEach(([k, v]) => chip(k, "#" + (v.name || ""), Object.keys(S.items).filter((id) => (it[id] || {})[k]).length));
  if (!edit) { fillTagSelects(); return; }
  const add = el("button", "mini", "＋ タグ");
  add.type = "button";
  add.addEventListener("click", newTag);
  box.append(add);
  if (S.tagView) {
    const rn = el("button", "mini", "名前");
    rn.type = "button";
    rn.addEventListener("click", () => {
      const cur = kpd("tags")[S.tagView].name || "";
      const name = (prompt("タグの新しい名前", cur) || "").trim().slice(0, 20);
      if (name && name !== cur) set(kp("tags/" + S.tagView + "/name"), name);
    });
    const dl = el("button", "mini del", "タグを削除");
    dl.type = "button";
    dl.addEventListener("click", () => {
      const k = S.tagView;
      if (!confirm("タグ「" + (kpd("tags")[k].name || "") + "」を削除しますか？\n（パネルは消えません。付いているタグだけ外れます）")) return;
      const up = { ["tags/" + k]: null };
      Object.keys(kpd("itemTags")).forEach((id) => { if (kpd("itemTags")[id][k]) up["itemTags/" + id + "/" + k] = null; });
      S.tagView = "";
      update(kp(""), up);
    });
    box.append(rn, dl);
  }
  fillTagSelects();
}

function copyTags(made) {
  const up = {};
  made.forEach(([from, to]) => { if (kpd("itemTags")[from]) up[to] = kpd("itemTags")[from]; });
  if (Object.keys(up).length) return update(kp("itemTags"), up).catch(() => {});
}

function dropTags(ids) {
  const up = {};
  ids.forEach((id) => { if (kpd("itemTags")[id]) up[id] = null; });
  if (Object.keys(up).length) update(kp("itemTags"), up).catch(() => {});
}

export function itemTags(o) {
  return (o.active === false ? "（しまってある）" : "") + (o.visible === false ? "（両方非表示）" : o.closed ? "（背）" : "") + (o.locked ? "（固定）" : "");
}

export function itemFace(o) {
  return o.visible === false ? "none" : o.closed ? "back" : "front";
}

export function segRow(label, opts, cur, onPick) {
  const row = el("div", "seg-row");
  row.append(el("span", "seg-label", label));
  const g = el("div", "seg");
  opts.forEach(([v, t]) => {
    const b = el("button", v === cur ? "on" : "", t);
    b.type = "button";
    b.addEventListener("click", () => onPick(v));
    g.append(b);
  });
  row.append(g);
  return row;
}

export function renderObjEditor(kind, force) {
  const box = $(kind === "items" ? "itemEditor" : "markerEditor");
  const id = kind === "items" ? S.selItem : S.selMarker;
  const o = S[kind][id];
  box.hidden = !o;
  if (!o) { box.replaceChildren(); box.dataset.id = ""; return; }
  const ae = document.activeElement;
  if (!force && box.dataset.id === id && ae && box.contains(ae) && ae.matches("input, textarea, select")) return;
  box.dataset.id = id;
  box.replaceChildren();
  const save = (patch) => update(dbr(objPath(kind, id)), patch).catch((e) => setStatus("保存失敗: " + e.message, true));
  const pick = el("div", "img-pick");
  imagePicker(pick, o.img || "", (k) => save({ img: k }));
  const f0 = el("div", "field");
  f0.append(el("span", "", kind === "items" ? "表の画像" : "画像"), pick);
  if (kind === "items") {
    const pair = el("div", "img-pair");
    const pick2 = el("div", "img-pick");
    imagePicker(pick2, o.cover || "", (k) => save({ cover: k || null }));
    const f1 = el("div", "field");
    f1.append(el("span", "", "背の画像"), pick2);
    pair.append(f0, f1);
    box.append(pair);
    box.append(segRow("盤面", [["on", "出す"], ["off", "しまう"]], o.active === false ? "off" : "on", (v) => save({ active: v === "on" })));
    box.append(segRow("見せ方", [["front", "表"], ["back", "背"], ["none", "両方非表示"]], itemFace(o), (v) => save(v === "front" ? { closed: false, visible: true } : v === "back" ? { closed: true, visible: true } : { closed: false, visible: false })));
  } else {
    box.append(f0);
  }
  const grid = el("div", "obj-grid");
  OBJ_FIELDS[kind].forEach(([key, label, type]) => {
    if (type === "check") {
      const lab = el("label", "check");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!o[key];
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
  box.insertBefore(grid, box.children[kind === "items" ? 3 : 1]);
  const row = el("div", "row wrap");
  const center = el("button", "", "盤面の中央へ");
  center.type = "button";
  center.addEventListener("click", () => save(centerPos(o.w || 1, o.h || 1)));
  const dup = el("button", "", "複製");
  dup.type = "button";
  dup.addEventListener("click", async () => {
    const made = await duplicateMany(kind, at(objBase(kind)), S[kind], [id], shift);
    if (!made.length) return;
    listState(kind).checked.clear();
    if (kind === "items") { S.selItem = made[0][1]; await copyTags(made); } else S.selMarker = made[0][1];
    renderObjLists();
  });
  const del = el("button", "del", "削除");
  del.type = "button";
  del.addEventListener("click", () => {
    if (!confirm("「" + objLabel(kind, o) + "」を削除しますか？")) return;
    remove(dbr(objPath(kind, id)));
    if (kind === "items") { S.selItem = ""; dropTags([id]); } else S.selMarker = "";
  });
  const conv = el("button", "", kind === "items" ? "マーカーパネルにする" : "スクリーンパネルにする");
  conv.type = "button";
  conv.title = kind === "items" ? "今のシーンのマーカーパネルに移します" : "部屋のスクリーンパネルに移します";
  conv.addEventListener("click", () => convertObj(kind, id));
  row.append(center, dup, conv, del);
  box.append(row);
}

export async function convertObj(kind, id) {
  const o = S[kind][id];
  if (!o) return;
  const toItem = kind === "markers";
  const sid = curSceneId();
  const where = toItem ? "部屋のスクリーンパネル" : sid ? "シーン「" + (S.scenes[sid].name || "") + "」のマーカーパネル" : "部屋のマーカーパネル（シーンなし）";
  const lost = toItem ? "" : "\n（背の画像・出す／しまう・表／背／両方非表示の設定はなくなります）";
  if (!confirm("「" + objLabel(kind, o) + "」を" + where + "にしますか？" + lost)) return;
  const common = { x: o.x || 0, y: o.y || 0, w: o.w || 1, h: o.h || 1, z: o.z || 0, img: o.img || "", click: o.click || "", locked: !!o.locked };
  const nk = toItem ? "items" : "markers";
  const obj = toItem ? { ...common, type: "object", memo: o.text || "", active: true, closed: false, visible: true } : { ...common, text: o.memo || "" };
  const key = push(dbr(objBase(nk))).key;
  const tail = endOrder(nk, objBase(nk));
  obj.order = tail.order;
  try {
    await update(dbr(""), { ...tail.up, [objPath(nk, key)]: obj, [objPath(kind, id)]: null });
    if (kind === "items") { S.selItem = ""; dropTags([id]); } else S.selMarker = "";
    selectObj(nk, key);
  } catch (e) {
    setStatus("変換に失敗しました: " + e.message, true);
  }
}

function endOrder(name, base) {
  const st = listState(name);
  const all = (st.ul && st.ul._all) || [];
  const up = {};
  all.forEach((id, i) => { up[base + "/" + id + "/order"] = i; });
  return { up, order: all.length };
}

export async function addObj(kind) {
  const base = { ...centerPos(8, 6), w: 8, h: 6, z: 50, img: "", click: "", locked: false };
  const o = kind === "items" ? { ...base, type: "object", memo: "新しいパネル", active: true, closed: false, visible: true } : { ...base, text: "新しいマーカー" };
  const key = push(dbr(objBase(kind))).key;
  const tail = endOrder(kind, objBase(kind));
  o.order = tail.order;
  await update(dbr(""), { ...tail.up, [objPath(kind, key)]: o });
  if (kind === "items") S.selItem = key; else S.selMarker = key;
  renderObjLists();
  renderObjEditor(kind, true);
}

export function selectObj(kind, id) {
  if (!S.isKP) return;
  if (!S.kpOpen) { S.kpOpen = true; applyKpLayout(); }
  showTab(kind === "items" ? "items" : "scenes");
  const box = $(kind === "items" ? "itemEditor" : "markerEditor");
  const d = box.closest("details");
  if (d) d.open = true;
  if (kind === "items") S.selItem = id; else S.selMarker = id;
  renderObjLists();
  renderObjEditor(kind, true);
  box.scrollIntoView({ block: "nearest" });
}

export function renderVars() {
  const list = $("varList");
  list.replaceChildren();
  const entries = Object.entries(S.vars || {});
  if (!entries.length) list.append(el("li", "", "なし（/var 名前 値 で作成）"));
  entries.forEach(([k, v]) => list.append(el("li", "", "{" + k + "} = " + (/^[\s　]*$/.test(v) ? "（空）" : v))));
}

export function initRoomTab() {
  $("zipFile").addEventListener("change", importZip);
  $("fieldMult").addEventListener("change", () => set(rp("meta/fieldMult"), parseInt($("fieldMult").value, 10)).then(() => { S.fitted = false; queueRender(); }));
  $("gridShow").addEventListener("change", () => saveBoard("displayGrid", $("gridShow").checked));
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
  $("logDelBtn").addEventListener("click", deleteLogs);
  initListBars();
  initAssetList();
  $("roomDelete").addEventListener("click", deleteRoom);
}

export async function deleteRoomAssets() {
  if (!S.isKP) return;
  const keys = [...S.assets.keys()];
  if (!keys.length) { $("adminMsg").textContent = "部屋の画像はありません"; return; }
  if (!confirm("この部屋の画像 " + keys.length + "枚 を全部削除しますか？\n（room.zipの背景・パネル・駒の画像が表示されなくなります。マイ画像は消えません）")) return;
  const up = {};
  keys.forEach((k) => { up["assets/" + k] = null; });
  try {
    await update(rp(""), up);
    dropAssetData(keys);
    $("adminMsg").textContent = keys.length + "枚の画像を削除しました";
    await postSystem(S.name + " が部屋の画像を全部削除しました");
  } catch (e) {
    $("adminMsg").textContent = "削除に失敗しました: " + e.message;
  }
}

export async function deleteRoom() {
  if (!S.isOwner) return;
  const typed = prompt("部屋そのものを削除します。チャットのログ・駒・画像・シーンがすべて消え、元に戻せません。\n削除するなら部屋ID「" + S.roomId + "」を入力してください");
  if (typed === null) return;
  if (typed.trim() !== S.roomId) { $("adminMsg").textContent = "部屋IDが違うため削除しませんでした"; return; }
  try {
    await removeAllSecrets();
    await set(kp(""), null);
    await remove(rp(""));
    localStorage.removeItem("s51-pal-" + S.roomId);
    localStorage.removeItem("s51-speaker-" + S.roomId);
    location.href = location.pathname;
  } catch (e) {
    $("adminMsg").textContent = "削除に失敗しました（ルールが古い可能性があります）: " + e.message;
  }
}

export function queueAssetUi() {
  clearTimeout(S.assetUiT);
  S.assetUiT = setTimeout(() => { renderBoardPickers(); renderObjLists(); renderAssetList(); }, 300);
}

export function assetUsage() {
  const use = new Map();
  const add = (k, label) => {
    if (!k || typeof k !== "string" || k.startsWith("lib:") || !S.assets.has(k)) return;
    if (!use.has(k)) use.set(k, []);
    const l = use.get(k);
    if (!l.includes(label)) l.push(label);
  };
  Object.values(S.items || {}).forEach((o) => { add(o.img, "スクパネ「" + (o.memo || "") + "」"); add(o.cover, "スクパネ「" + (o.memo || "") + "」の背"); });
  Object.values(S.roomMarkers || {}).forEach((o) => add(o.img, "マーカー（部屋）"));
  Object.values(S.scenes || {}).forEach((sc) => {
    const n = "シーン「" + (sc.name || "") + "」";
    add(sc.bg, n + "の背景");
    add(sc.fg, n + "の前景");
    Object.values(sc.markers || {}).forEach((o) => add(o.img, n + "のマーカー"));
  });
  const b = (S.meta && S.meta.board) || {};
  add(b.bg, "今の盤面の背景");
  add(b.fg, "今の盤面の前景");
  Object.values(S.chars || {}).forEach((c) => {
    add(c.icon, "駒「" + (c.name || "") + "」");
    (c.faces || []).forEach((f) => add(f && f.icon, "駒「" + (c.name || "") + "」の差分"));
  });
  Object.values(S.effects || {}).forEach((f) => add(f.img, "カットイン「" + (f.name || "") + "」"));
  S.msgs.forEach((m) => add(m.icon, "チャットの発言アイコン"));
  return use;
}

function assetName(k) {
  const m = k.match(/^(.*)_([a-z0-9]{2,5})$/i);
  const base = m ? m[1] : k;
  return (base.length > 10 ? base.slice(0, 8) + "…" : base) + (m ? "." + m[2] : "");
}

const DEFAULT_FOLDERS = [["fa", "風景"], ["fb", "アイコン"], ["fc", "SC"]];

function ensureFolders() {
  if (!S.isKP || !S.kpLoaded || S.foldersMade || (S.kp && S.kp.folders)) return;
  S.foldersMade = true;
  const up = {};
  DEFAULT_FOLDERS.forEach(([k, name], i) => { up["folders/" + k] = { name, order: i }; });
  update(kp(""), up).catch(() => { S.foldersMade = false; });
}

function sortedFolders() {
  return orderedEntries(kpd("folders"));
}

function folderOf(k) {
  const f = kpd("assetFolder")[k];
  return f && kpd("folders")[f] ? f : "";
}

function assetEntries() {
  const ord = kpd("assetOrder");
  const list = [...S.assets.keys()].map((k) => [k, typeof ord[k] === "number" ? { order: ord[k] } : {}]);
  return orderedEntries(Object.fromEntries(list));
}

export function renderAssetList() {
  const grid = $("assetGrid");
  if (!grid || !S.isKP) return;
  if (S.assetView !== "*" && S.assetView && !kpd("folders")[S.assetView]) S.assetView = "*";
  renderFolderBar();
  const use = assetUsage();
  renderRows(grid, "assets", assetEntries(), {
    grid: true,
    empty: "部屋の画像はありません",
    toggleOnClick: true,
    search: (k) => k,
    filter: S.assetView === "*" ? null : (k) => folderOf(k) === S.assetView,
    onReorder: (keys) => {
      const up = {};
      keys.forEach((k, i) => { up[k] = i; });
      update(kp("assetOrder"), up).catch((e) => setStatus("並べ替えを保存できませんでした: " + e.message, true));
    },
    onDrop: (f, keys) => moveAssets(keys, f),
    onCheck: updateAssetMsg,
    fill: (li, k) => {
      li.classList.add("asset-card");
      const im = el("img");
      im.alt = "";
      im.loading = "lazy";
      im.draggable = false;
      im.src = S.assets.get(k) || "";
      const used = use.get(k);
      const info = el("span", "asset-info");
      info.append(el("span", "asset-name", assetName(k)), el("span", "asset-size", Math.round(((S.assets.get(k) || "").length * 3) / 4 / 1024) + "KB"));
      const f = folderOf(k);
      li.title = k + "\nフォルダー：" + (f ? kpd("folders")[f].name || "" : "未分類") + (used ? "\n使用中：" + used.join("、") : "\n未使用");
      li.append(im, info);
      if (used) li.append(el("span", "asset-used", "使用中"));
    }
  });
  updateAssetMsg();
}

function renderFolderBar() {
  const box = $("folderBar");
  if (!box) return;
  box.replaceChildren();
  const af = kpd("assetFolder");
  const fs = kpd("folders");
  const counts = { "*": S.assets.size, "": 0 };
  S.assets.forEach((v, k) => { const f = af[k] && fs[af[k]] ? af[k] : ""; counts[f] = (counts[f] || 0) + 1; });
  const chip = (k, label, color, drop) => {
    const b = el("button", "folder-chip" + (S.assetView === k ? " on" : ""), label + "（" + (counts[k] || 0) + "）");
    b.type = "button";
    if (drop) b.dataset.drop = k;
    if (color) b.style.setProperty("--fc", color);
    b.addEventListener("click", () => { S.assetView = k; renderAssetList(); });
    box.append(b);
  };
  chip("*", "すべて");
  chip("", "未分類", "", true);
  sortedFolders().forEach(([k, f]) => chip(k, (S.assetView === k ? "📂" : "📁") + (f.name || ""), f.color, true));
  const edit = isEditing("assets");
  const add = el("button", "mini", "＋ フォルダー");
  add.hidden = !edit;
  add.type = "button";
  add.addEventListener("click", async () => {
    const name = (prompt("新しいフォルダーの名前") || "").trim().slice(0, 20);
    if (!name) return;
    const k = "f" + newKey();
    const max = Object.values(kpd("folders")).reduce((m, v) => Math.max(m, +v.order || 0), 0);
    await set(kp("folders/" + k), { name, order: max + 1 });
  });
  box.append(add);
  const tools = $("folderTools");
  tools.replaceChildren();
  const f = S.assetView && S.assetView !== "*" ? fs[S.assetView] : null;
  tools.hidden = !f || !edit;
  if (f) {
    const k = S.assetView;
    const col = el("input");
    col.type = "color";
    col.value = f.color || "#4a90d9";
    col.title = "フォルダーの色";
    col.addEventListener("change", () => set(kp("folders/" + k + "/color"), col.value));
    const rn = el("button", "mini", "名前");
    rn.type = "button";
    rn.addEventListener("click", () => {
      const name = (prompt("フォルダーの新しい名前", f.name || "") || "").trim().slice(0, 20);
      if (name && name !== f.name) set(kp("folders/" + k + "/name"), name);
    });
    const dl = el("button", "mini del", "フォルダーを削除");
    dl.type = "button";
    dl.addEventListener("click", () => {
      if (!confirm("フォルダー「" + (f.name || "") + "」を削除しますか？\n（中の画像は消えません。未分類に戻ります）")) return;
      const up = { ["folders/" + k]: null };
      Object.entries(kpd("assetFolder")).forEach(([a, v]) => { if (v === k) up["assetFolder/" + a] = null; });
      S.assetView = "*";
      update(kp(""), up);
    });
    tools.append(el("span", "msg", "「" + (f.name || "") + "」"), col, rn, dl);
  }
  const mv = $("assetMove");
  if (mv && document.activeElement !== mv) {
    mv.replaceChildren();
    const o0 = el("option", "", "選択をフォルダーへ移動…");
    o0.value = "*";
    mv.append(o0);
    const un = el("option", "", "未分類");
    un.value = "";
    mv.append(un);
    sortedFolders().forEach(([fk, v]) => { const o = el("option", "", v.name || ""); o.value = fk; mv.append(o); });
    mv.value = "*";
  }
}

function moveAssets(keys, f) {
  if (!keys.length) return;
  const up = {};
  keys.forEach((k) => { up[k] = f || null; });
  const name = f ? (kpd("folders")[f] || {}).name || "" : "未分類";
  update(kp("assetFolder"), up)
    .then(() => { $("assetMsg").textContent = keys.length + "枚を「" + name + "」へ移動しました"; })
    .catch((e) => setStatus("移動できませんでした: " + e.message, true));
}

function dropAssetData(keys) {
  const up = {};
  keys.forEach((k) => {
    if (kpd("assetFolder")[k]) up["assetFolder/" + k] = null;
    if (kpd("assetOrder")[k] !== undefined) up["assetOrder/" + k] = null;
  });
  if (Object.keys(up).length) update(kp(""), up).catch(() => {});
}

function updateAssetMsg() {
  const box = $("assetMsg");
  if (box) box.textContent = S.assetSel.size ? S.assetSel.size + "枚を選択中" : "";
}

async function deleteAssetKeys(keys, what) {
  const use = assetUsage();
  const used = keys.filter((k) => use.has(k));
  let msg = what + " " + keys.length + "枚 を削除しますか？";
  if (used.length) {
    const lines = used.slice(0, 8).map((k) => "・" + assetName(k) + "：" + use.get(k).join("、"));
    msg += "\n\nこのうち " + used.length + "枚 は使用中です。消すと表示されなくなります。\n" + lines.join("\n") + (used.length > 8 ? "\n…ほか" + (used.length - 8) + "枚" : "");
  }
  if (!confirm(msg)) return;
  const up = {};
  keys.forEach((k) => { up["assets/" + k] = null; });
  try {
    await update(rp(""), up);
    keys.forEach((k) => S.assetSel.delete(k));
    dropAssetData(keys);
    $("assetMsg").textContent = keys.length + "枚の画像を削除しました";
    await postSystem(S.name + " が部屋の画像を " + keys.length + "枚 削除しました");
  } catch (e) {
    $("assetMsg").textContent = "削除に失敗しました: " + e.message;
  }
}

export function initAssetList() {
  listState("assets", S.assetSel);
  const mv = el("select", "asset-move");
  mv.id = "assetMove";
  mv.addEventListener("change", () => {
    const f = mv.value;
    mv.value = "*";
    if (f === "*") return;
    const keys = checkedIds("assets");
    if (!keys.length) { $("assetMsg").textContent = "画像を選んでください"; return; }
    moveAssets(keys, f);
  });
  initListBar($("assetBar"), "assets", {
    placeholder: "検索（ファイル名）",
    unit: "枚",
    hint: "画像を押すと選択（チェック欄を上下にドラッグでも）。フォルダーを開くと、色・名前・削除ができます",
    onChange: renderAssetList,
    actions: [
      { node: mv },
      { label: "選択を削除", cls: "del", run: (keys) => deleteAssetKeys(keys, "選んだ画像") },
      {
        label: "未使用を削除", cls: "del", always: true, run: () => {
          const use = assetUsage();
          const keys = [...S.assets.keys()].filter((k) => !use.has(k));
          if (!keys.length) { $("assetMsg").textContent = "未使用の画像はありません"; return; }
          deleteAssetKeys(keys, "未使用の画像");
        }
      }
    ]
  });
}

export function updateAssetInfo() {
  let total = 0;
  S.assets.forEach((v) => { total += (v || "").length; });
  $("assetInfo").textContent = "画像 " + S.assets.size + "枚・約" + (total / 1024 / 1024).toFixed(1) + "MB（無料枠の保存容量は1GB）";
}

export async function importZip(e) {
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
  put("effects", data.effects);
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
    msg.textContent = "読み込み完了：キャラ" + Object.keys(data.chars).length + "・パネル" + Object.keys(data.items).length + "・シーン" + Object.keys(data.scenes).length + "・メモ" + Object.keys(data.notes).length + "・カットイン" + Object.keys(data.effects).length + "・画像" + keys.length;
    await postSystem(S.name + " が room.zip を読み込みました");
  } catch (err) {
    msg.textContent = "読み込みに失敗しました: " + err.message;
  } finally {
    $("zipFile").disabled = false;
    $("zipFile").value = "";
  }
}
