import { push, update } from "./51-session-fb.js?v=4l";
import { $, S, R, dbr, el, setStatus } from "./51-session-core.js?v=4l";
import { tabName } from "./51-session-chat.js?v=4l";
import { at, saveOrder, deleteMany, duplicateMany, thumbOf, imagePicker } from "./51-session-kp.js?v=4l";
import { initListBar, renderRows, orderedEntries } from "./51-session-list.js?v=4l";
import { loadSoundList, soundUrl, setBgm, sendFx, showCutin, playSe, nowPlaying, bgmTab } from "./51-session-sound.js?v=4l";

const KINDS = {
  effects: { list: "cutList", bar: "cutBar", editor: "cutEditor", add: "cutAdd", label: "カットイン", newName: "新しいカットイン" },
  bgms: { list: "bgmList", bar: "bgmBar", editor: "bgmEditor", add: "bgmAdd", label: "BGM", newName: "新しいBGM" },
  ses: { list: "seList", bar: "seBar", editor: "seEditor", add: "seAdd", label: "SE", newName: "新しいSE" }
};

let preview = null;

export function initFx() {
  S.fxSel = { effects: "", bgms: "", ses: "" };
  Object.entries(KINDS).forEach(([kind, k]) => {
    $(k.add).addEventListener("click", () => addFx(kind));
    initListBar($(k.bar), kind, {
      placeholder: "検索（名前・ファイル名）",
      onChange: renderFx,
      actions: [
        { label: "選択を複製", run: (ids) => duplicateMany(kind, at(R(kind)), S[kind], ids).then(renderFx) },
        { label: "選択を削除", cls: "del", run: (ids) => deleteMany(kind, at(R(kind)), ids, (id) => (S[kind][id] && S[kind][id].name) || "（名前なし）", k.label).then(renderFx) }
      ]
    });
  });
  $("soundReload").addEventListener("click", () => loadSoundList(true).then(renderFx));
  S.fxRender = renderFx;
  const tabBtn = document.querySelector("#kpSide nav.tabs button[data-tab=fx]");
  if (tabBtn) tabBtn.addEventListener("click", () => loadSoundList().then(renderFx));
}

function fileOf(kind, o) {
  return kind === "effects" ? o.sound || "" : o.file || "";
}

export function renderFx() {
  if (!S.isKP || !$("cutList")) return;
  const msg = $("soundListMsg");
  msg.textContent = S.soundList ? (S.soundErr ? "音の一覧：" + S.soundErr : "音の一覧：" + S.soundList.length + "件（sound フォルダー）") : "音の一覧はまだ読んでいません";
  const t = bgmTab();
  $("bgmNow").replaceChildren();
  [1, 2].forEach((slot) => {
    const id = nowPlaying(slot);
    const row = el("div", "bgm-now");
    row.append(el("span", "bgm-slot", "枠" + slot), el("span", "bgm-title", id && S.bgms[id] ? S.bgms[id].name || "（名前なし）" : "（なし）"));
    if (id) {
      const stop = el("button", "mini", "■ 止める");
      stop.type = "button";
      stop.addEventListener("click", () => setBgm(t, slot, ""));
      row.append(stop);
    }
    $("bgmNow").append(row);
  });
  $("bgmNow").append(el("p", "msg", "今のタブ：" + tabName(t) + "（▶ はチャットウィンドウで開いているタブに流します）"));
  Object.entries(KINDS).forEach(([kind, k]) => {
    renderRows($(k.list), kind, orderedEntries(S[kind]), {
      search: (id, o) => (o.name || "") + " " + fileOf(kind, o),
      onReorder: (ids) => saveOrder(at(R(kind)), ids),
      onOpen: (id) => { S.fxSel[kind] = S.fxSel[kind] === id ? "" : id; renderFx(); },
      fill: (li, id, o) => {
        li.classList.toggle("current", S.fxSel[kind] === id);
        if (kind === "effects") li.append(thumbOf(o.img));
        const name = el("span", "lst-name", o.name || "（名前なし）");
        const f = fileOf(kind, o);
        if (f && S.soundList && !S.soundList.includes(f)) name.append(el("span", "tag-chip warn", "音が見つからない"));
        if (kind === "bgms" && (nowPlaying(1) === id || nowPlaying(2) === id)) name.append(el("span", "tag-chip on", "再生中"));
        li.append(name);
        const btn = (label, title, fn) => {
          const b = el("button", "mini", label);
          b.type = "button";
          b.title = title;
          b.addEventListener("click", fn);
          li.append(b);
        };
        if (kind === "effects") btn("▶", "全員に出す（開いているタブを見られる人）", () => sendFx(S.chatTab, "cut", id));
        if (kind === "ses") btn("▶", "全員に鳴らす（開いているタブを見られる人）", () => sendFx(S.chatTab, "se", id));
        if (kind === "bgms") {
          btn("▶1", "枠1で流す", () => setBgm(S.chatTab, 1, id));
          btn("▶2", "枠2で流す", () => setBgm(S.chatTab, 2, id));
        }
      }
    });
    renderEditor(kind);
  });
}

async function addFx(kind) {
  const max = Object.values(S[kind] || {}).reduce((m, o) => Math.max(m, +o.order || 0), 0);
  const o = { name: KINDS[kind].newName, volume: 100, order: max + 1 };
  if (kind === "effects") Object.assign(o, { img: "", sound: "", playtime: 3000 });
  else o.file = "";
  if (kind === "bgms") o.slot = 1;
  try {
    const r = await push(dbr(R(kind)), o);
    S.fxSel[kind] = r.key;
    loadSoundList().then(renderFx);
  } catch (e) {
    setStatus("追加できませんでした: " + e.message, true);
  }
}

function soundPicker(cur, onPick) {
  const box = el("div", "sound-pick");
  const sel = el("select");
  const none = el("option", "", "音なし");
  none.value = "";
  sel.append(none);
  const list = S.soundList || [];
  if (cur && !list.includes(cur)) { const o = el("option", "", cur + "（見つからない）"); o.value = cur; sel.append(o); }
  list.forEach((n) => { const o = el("option", "", n); o.value = n; sel.append(o); });
  sel.value = cur || "";
  sel.addEventListener("change", () => onPick(sel.value));
  const play = el("button", "mini", "試聴");
  play.type = "button";
  play.title = "自分の画面だけで鳴らす";
  play.addEventListener("click", () => {
    if (preview) { preview.pause(); preview = null; play.textContent = "試聴"; return; }
    if (!sel.value) return;
    preview = new Audio(soundUrl(sel.value));
    preview.play().catch((e) => setStatus("鳴らせませんでした: " + e.message, true));
    preview.addEventListener("ended", () => { preview = null; play.textContent = "試聴"; });
    play.textContent = "■";
  });
  box.append(sel, play);
  return box;
}

function renderEditor(kind) {
  const box = $(KINDS[kind].editor);
  const id = S.fxSel[kind];
  const o = S[kind][id];
  box.hidden = !o;
  if (!o) { box.replaceChildren(); box.dataset.id = ""; return; }
  const ae = document.activeElement;
  if (box.dataset.id === id && ae && box.contains(ae) && ae.matches("input, textarea, select")) return;
  box.dataset.id = id;
  box.replaceChildren();
  const save = (patch) => update(dbr(R(kind + "/" + id)), patch).catch((e) => setStatus("保存失敗: " + e.message, true));
  const field = (label, node) => {
    const f = el("label", "field");
    f.append(el("span", "", label), node);
    box.append(f);
    return f;
  };
  const name = el("input");
  name.value = o.name || "";
  name.addEventListener("change", () => save({ name: name.value.trim().slice(0, 60) }));
  field("名前（発言にこの名前が入ると発動）", name);
  if (kind === "effects") {
    const pick = el("div", "img-pick");
    imagePicker(pick, o.img || "", (k) => save({ img: k }));
    const f = el("div", "field");
    f.append(el("span", "", "画像"), pick);
    box.append(f);
  }
  const f0 = el("div", "field");
  f0.append(el("span", "", "音（sound フォルダー）"), soundPicker(fileOf(kind, o), (v) => save(kind === "effects" ? { sound: v } : { file: v })));
  box.append(f0);
  const row = el("div", "obj-grid");
  if (kind === "effects") {
    const sec = el("input");
    sec.type = "number";
    sec.min = "0.5";
    sec.max = "60";
    sec.step = "0.5";
    sec.value = String((+o.playtime || 3000) / 1000);
    sec.addEventListener("change", () => save({ playtime: Math.round(Math.max(0.5, Math.min(60, +sec.value || 3)) * 1000) }));
    const l = el("label", "field small");
    l.append(el("span", "", "表示する秒数"), sec);
    row.append(l);
  }
  const v = el("input");
  v.type = "number";
  v.min = "0";
  v.max = "100";
  v.value = String(typeof o.volume === "number" ? o.volume : 100);
  v.addEventListener("change", () => save({ volume: Math.max(0, Math.min(100, Math.round(+v.value || 0))) }));
  const lv = el("label", "field small");
  lv.append(el("span", "", "音量（0〜100）"), v);
  row.append(lv);
  if (kind === "bgms") {
    const s = el("select");
    [1, 2].forEach((n) => { const op = el("option", "", "枠" + n); op.value = String(n); s.append(op); });
    s.value = String(o.slot === 2 ? 2 : 1);
    s.addEventListener("change", () => save({ slot: +s.value }));
    const ls = el("label", "field small");
    ls.append(el("span", "", "発言・シーンで流す枠"), s);
    row.append(ls);
  }
  box.append(row);
  if (kind !== "bgms") {
    const test = el("button", "", "試し再生（自分だけ）");
    test.type = "button";
    test.addEventListener("click", () => (kind === "effects" ? showCutin(id, o) : playSe(id, o)));
    box.append(test);
  }
}
