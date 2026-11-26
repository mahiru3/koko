import { update } from "./51-session-fb.js?v=4j";
import { parseTekeyJson, renderPalette, moveLine } from "./51-session-palette.js?v=4j";
import { $, S, canEdit, el, setStatus, newKey, faceList, charIcon, src, rp, isPc, speakerChar, charByName } from "./51-session-core.js?v=4j";
import { isChan, colKeys, buildChatTabs, paintTab, tabName, sendChat, tabLabel, tabColor } from "./51-session-chat.js?v=4j";

export function buildPlaceOptions() {
  const box = $("palPlaceBtns");
  if (!box) return;
  box.replaceChildren();
  const cur = curPalette();
  const now = cur ? cur.place || "" : "";
  let drag = "";
  [""].concat(colKeys()).forEach((k) => {
    const b = el("button", "place-btn" + ((isChan(now) ? now : "") === k ? " on" : ""), k ? tabLabel(k) : "未指定");
    b.type = "button";
    b.dataset.ch = k;
    b.title = k ? tabName(k) + "に送る" : "チャットウィンドウで開いているタブに送る";
    b.disabled = !cur;
    if (k) paintTab(b, k);
    b.addEventListener("click", () => setPalPlace(k));
    if (k && k !== "main" && isPc()) {
      b.draggable = true;
      b.addEventListener("dragstart", (e) => { drag = k; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); });
      b.addEventListener("dragend", () => { drag = ""; });
    }
    b.addEventListener("dragover", (e) => { if (drag && k && k !== "main" && drag !== k) { e.preventDefault(); b.classList.add("drop"); } });
    b.addEventListener("dragleave", () => b.classList.remove("drop"));
    b.addEventListener("drop", (e) => {
      e.preventDefault();
      b.classList.remove("drop");
      if (!drag || !k || k === "main" || drag === k) return;
      moveChanOrder(drag, k);
      drag = "";
    });
    box.append(b);
  });
  renderPalDest();
}

export function moveChanOrder(from, to) {
  S.colOrder = colKeys();
  const a = S.colOrder.indexOf(from);
  const t = S.colOrder.indexOf(to);
  if (a < 0 || t < 0) return;
  S.colOrder.splice(a, 1);
  S.colOrder.splice(t, 0, from);
  localStorage.setItem("s51-cols", JSON.stringify(S.colOrder));
  buildChatTabs();
  buildPlaceOptions();
}

export function renderPalDest() {
  const box = $("palDest");
  if (!box) return;
  const cur = curPalette();
  const set0 = cur && isChan(cur.place) ? cur.place : "";
  const k = set0 || S.chatTab || "main";
  box.replaceChildren();
  box.append(el("span", "pal-dest-label", "送信先"));
  const chip = el("span", "pal-dest-tab", tabLabel(k));
  chip.style.setProperty("--tab-c", tabColor(k) || "var(--accent)");
  box.append(chip);
  if (!set0) box.append(el("span", "pal-dest-note", "（未指定：チャットウィンドウで開いているタブ）"));
}

export function setPalPlace(k) {
  const cur = curPalette();
  if (!cur) return;
  const p = S.palettes.find((x) => x.id === cur.id);
  if (p) { p.place = k; savePalettes(); } else { S.palPlace[cur.id] = k; savePalPlace(); }
  buildPlaceOptions();
}

export function renderPalFace() {
  const btn = $("palFace");
  if (!btn) return;
  const c = speakerChar();
  btn.replaceChildren();
  const icon = c ? charIcon(c) : "";
  if (icon) {
    const im = el("img");
    im.alt = "";
    im.dataset.asset = icon;
    im.src = src(icon);
    btn.append(im);
  } else {
    const f = el("span", "cb-fb", ((c ? c.name : S.name) || "?").slice(0, 1));
    f.style.background = (c ? c.color : S.color) || "#888";
    btn.append(f);
  }
  const list = c ? faceList(c).filter((f) => f.label) : [];
  btn.append(el("span", "pal-face-name", c ? (c.face || (list.length ? "表情" : c.name || "")) : S.name || ""));
  btn.disabled = !list.length || !canEdit(c);
  btn.title = list.length ? "押すと表情（差分）を選べます" : "このキャラには差分がありません";
  const box = $("palFaceList");
  if (box.hidden) return;
  box.replaceChildren();
  list.forEach((fc) => {
    const b = el("button", "face-btn" + (c.face === fc.label ? " on" : ""));
    b.type = "button";
    const im = el("img");
    im.alt = "";
    im.dataset.asset = fc.key || "";
    im.src = src(fc.key);
    b.append(im, el("span", "", fc.label));
    b.addEventListener("click", () => {
      update(rp("chars/" + S.speaker), { face: fc.label }).catch((e) => setStatus("保存失敗: " + e.message, true));
      box.hidden = true;
    });
    box.append(b);
  });
  if (!list.length) box.hidden = true;
}

export function palStoreKey() {
  return "s51-pal-" + S.roomId;
}

export function savePalettes() {
  localStorage.setItem(palStoreKey(), JSON.stringify(S.palettes));
}

export function savePalPlace() {
  localStorage.setItem("s51-palplace-" + S.roomId, JSON.stringify(S.palPlace));
}

export function initPalettes() {
  try { S.palettes = JSON.parse(localStorage.getItem(palStoreKey()) || "[]"); } catch { S.palettes = []; }
  if (!S.palettes.length) {
    S.palettes = [{ id: "p0", label: "自分用", name: "", place: "", stock: "###よく使う\nCCB<=50 【目星】\nCCB<=50 【聞き耳】\n1d100<={SAN} 【正気度ロール】\n###\n:SAN-1\n:HP-1" }];
    savePalettes();
  }
  S.palSel = S.palettes[0].id;
  $("tekeyFile").addEventListener("change", async (e) => {
    let added = 0;
    for (const f of e.target.files) {
      try { const list = parseTekeyJson(JSON.parse(await f.text())); S.palettes.push(...list); added += list.length; }
      catch { $("palMsg").textContent = f.name + " を読めませんでした"; }
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
  $("palSend").addEventListener("click", () => sendPalInput());
  $("palInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendPalInput(); }
  });
  renderPaletteTabs();
}

export function curPalette() {
  return allPalettes().find((p) => p.id === S.palSel) || null;
}

export function palWho(cur) {
  if (!cur) return S.speaker;
  return cur.id.startsWith("char:") ? cur.id.slice(5) : (cur.name && charByName(cur.name)) || S.speaker;
}

export function palSendTo(cmd) {
  const cur = curPalette();
  const place = cur ? cur.place || "" : "";
  return sendChat(cmd, palWho(cur), place || S.chatTab).catch((err) => setStatus("送信失敗: " + err.message, true));
}

export async function sendPalInput() {
  const v = $("palInput").value.replace(/\s+$/, "");
  if (!v) return;
  $("palInput").value = "";
  await palSendTo(v);
}

export function allPalettes() {
  const list = S.palettes.map((p) => ({ ...p, local: true }));
  const c = speakerChar();
  if (c && c.commands) {
    const id = "char:" + S.speaker;
    list.push({ id, label: "駒: " + (c.name || ""), name: c.name || "", stock: c.commands, place: S.palPlace[id] || "", local: false, edit: canEdit(c) });
  }
  return list;
}

export function renderPaletteTabs() {
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
  buildPlaceOptions();
  if (!editable) $("palEditor").hidden = true;
  if (editable && !$("palEditor").hidden) {
    if (document.activeElement !== $("palLabel")) $("palLabel").value = cur.label;
    if (document.activeElement !== $("palName")) $("palName").value = cur.name;
    if (document.activeElement !== $("palStock")) $("palStock").value = cur.stock;
  }
  renderPaletteView();
}

export function movePaletteLine(from, to) {
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

export function renderPaletteView() {
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
