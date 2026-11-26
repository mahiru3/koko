import { ref, get, push, set, update, remove } from "./51-session-fb.js?v=4i";
import { readRoomZip } from "./51-session-import.js?v=4i";
import { $, CH_TABS, S, isStand, showsParams, showsOther, el, setStatus, newKey, src, rp, sorted, onlinePids, playerName, curSceneId, objBase, objPath } from "./51-session-core.js?v=4i";
import { showTab, applyKpLayout } from "./51-session-layout.js?v=4i";
import { colKeys, tabColor, tabName, postSystem, tabLabel, rerenderLog, tabOf } from "./51-session-chat.js?v=4i";
import { queueRender, uploadAsset, centerPos } from "./51-session-board.js?v=4i";
import { deleteSecret, isOpen, isSecret, memberBoxes, removeAllSecrets, renameSecret, setOpen, setSecretColor } from "./51-session-secret.js?v=4i";

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
  if (ul.contains(document.activeElement) && document.activeElement.matches("input")) return;
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
    if (sec) {
      const op = el("button", "mini" + (isOpen(k) ? " on" : ""), isOpen(k) ? "公開中（押すと秘匿に戻す）" : "公開する");
      op.type = "button";
      op.addEventListener("click", () => setOpen(k, !isOpen(k)));
      li.append(op);
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
    if (sec) li.append(memberBoxes(k));
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
  if (!confirm("タブ「" + name + "」を削除しますか？\n（このタブの発言は表示されなくなります）")) return;
  await set(rp("meta/chans/" + k), null);
  await postSystem("チャットのタブ「" + name + "」を削除しました");
}

export async function applyScene(id) {
  const sc = S.scenes[id];
  if (!sc) return;
  const b = { ...(S.meta.board || {}), bg: sc.bg || "", fg: sc.fg || "", fieldW: sc.fieldW || 16, fieldH: sc.fieldH || 9, gridSize: sc.gridSize || 2, displayGrid: !!sc.displayGrid };
  S.selMarker = "";
  await update(rp(""), { "meta/board": b, "meta/sceneId": id });
  await postSystem("シーン「" + (sc.name || "（名前なし）") + "」に切り替えました");
}

export function renderScenes() {
  const list = $("sceneList");
  list.replaceChildren();
  const entries = sorted(S.scenes, "order");
  if (!entries.length) list.append(el("li", "empty", "シーンはまだありません（room.zip を読み込むと入ります）"));
  entries.forEach(([id, sc]) => {
    const li = el("li");
    const key = sc.fg || sc.bg || "";
    let th;
    if (src(key)) {
      th = el("img", "thumb");
      th.alt = "";
      th.dataset.asset = key;
      th.src = src(key);
    } else {
      th = el("span", "thumb thumb-none", "なし");
    }
    const name = el("span", "", sc.name || "（名前なし）");
    const go = el("button", "primary", "切替");
    go.type = "button";
    go.addEventListener("click", () => applyScene(id));
    if (S.meta.sceneId === id) li.classList.add("current");
    li.append(th, name, go);
    list.append(li);
  });
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

export function addNote() {
  const max = Object.values(S.notes).reduce((m, n) => Math.max(m, +n.order || 0), 0);
  push(rp("notes"), { name: "新しいテキスト", text: "", color: 1, order: max + 1 }).then((r) => {
    renderNotes();
    const d = $("noteList").querySelector("details[data-id='" + r.key + "']");
    if (d) d.open = true;
  });
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

export function saveBoard(key, val) {
  const up = { ["meta/board/" + key]: val };
  const sid = curSceneId();
  if (sid) up["scenes/" + sid + "/" + key] = val;
  return update(rp(""), up).catch((e) => setStatus("保存失敗: " + e.message, true));
}

export function renderBoardPickers() {
  if (!S.isKP) return;
  const b = S.meta.board || {};
  imagePicker($("bgPick"), b.bg || "", (k) => saveBoard("bg", k || null));
  imagePicker($("fgPick"), b.fg || "", (k) => saveBoard("fg", k || null));
  const sid = curSceneId();
  $("markerScene").textContent = sid ? "シーン「" + (S.scenes[sid].name || "（名前なし）") + "」のマーカーです（シーンを切り替えると入れ替わります）" : "シーンを選んでいないので、部屋のマーカーです";
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
  [["items", "itemList", "selItem"], ["markers", "markerList", "selMarker"]].forEach(([kind, listId, selKey]) => {
    const list = $(listId);
    list.replaceChildren();
    Object.entries(S[kind]).sort((a, b) => (+b[1].z || 0) - (+a[1].z || 0)).forEach(([id, o]) => {
      const li = el("li", id === S[selKey] ? "current" : "");
      const thumb = (k) => {
        const u = src(k);
        if (!u) return el("span", "thumb thumb-none", "なし");
        const th = el("img", "thumb");
        th.alt = "";
        th.dataset.asset = k;
        th.src = u;
        return th;
      };
      const tags = kind === "items" ? itemTags(o) : (o.locked ? "（固定）" : "");
      if (kind === "items") {
        const pair = el("span", "thumb-pair");
        pair.append(thumb(o.img), thumb(o.cover));
        li.append(pair);
        li.classList.toggle("put-away", o.active === false);
      } else {
        li.append(thumb(o.img));
      }
      li.append(el("span", "", objLabel(kind, o) + tags), el("span", "z-tag", "L" + Math.round(+o.z || 0)));
      li.addEventListener("click", () => { S[selKey] = id === S[selKey] ? "" : id; renderObjLists(); renderObjEditor(kind, true); });
      list.append(li);
    });
    if (!list.childElementCount) list.append(el("li", "empty", "まだありません"));
  });
  renderObjEditor("items");
  renderObjEditor("markers");
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
  const save = (patch) => update(rp(objPath(kind, id)), patch).catch((e) => setStatus("保存失敗: " + e.message, true));
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
    const r = await push(rp(objBase(kind)), { ...o, x: (o.x || 0) + 1, y: (o.y || 0) + 1 });
    if (kind === "items") S.selItem = r.key; else S.selMarker = r.key;
    renderObjLists();
  });
  const del = el("button", "del", "削除");
  del.type = "button";
  del.addEventListener("click", () => {
    if (!confirm("「" + objLabel(kind, o) + "」を削除しますか？")) return;
    remove(rp(objPath(kind, id)));
    if (kind === "items") S.selItem = ""; else S.selMarker = "";
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
  const key = push(rp(objBase(nk))).key;
  try {
    await update(rp(""), { [objPath(nk, key)]: obj, [objPath(kind, id)]: null });
    if (kind === "items") S.selItem = ""; else S.selMarker = "";
    selectObj(nk, key);
  } catch (e) {
    setStatus("変換に失敗しました: " + e.message, true);
  }
}

export async function addObj(kind) {
  const base = { ...centerPos(8, 6), w: 8, h: 6, z: 50, img: "", click: "", locked: false };
  const o = kind === "items" ? { ...base, type: "object", memo: "新しいパネル", active: true, closed: false, visible: true } : { ...base, text: "新しいマーカー" };
  const r = await push(rp(objBase(kind)), o);
  if (kind === "items") S.selItem = r.key; else S.selMarker = r.key;
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
  S.assetUiT = setTimeout(() => { renderBoardPickers(); renderObjLists(); }, 300);
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
