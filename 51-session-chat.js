import { onChildChanged, onChildRemoved, ref, remove, push, set, update, onValue, onChildAdded, query, limitToLast, serverTimestamp } from "./51-session-fb.js?v=4k";
import { expandVars } from "./51-session-palette.js?v=4k";
import { assetKey, normLabel } from "./51-session-import.js?v=4k";
import { $, LOG_LIMIT, CH_TABS, CHECK_RE, S, visibleChar, isStand, canEdit, el, setStatus, faceList, charIcon, src, rp, sorted, isPc, speakerChar } from "./51-session-core.js?v=4k";
import { showTab } from "./51-session-layout.js?v=4k";
import { queueRender } from "./51-session-board.js?v=4k";
import { buildPlaceOptions, renderPalFace, renderPaletteTabs, setPalPlace, renderPalDest } from "./51-session-pal.js?v=4k";
import { renderChanList, addChan, renameChan, deleteChan, applyScene } from "./51-session-kp.js?v=4k";
import { addSecretChan, initSecrets, isOpen, isSecret, openSdice, sdiceOf, secretList, sendSecretDice, watchSdice } from "./51-session-secret.js?v=4k";

export function lookupVars(c) {
  const v = {};
  Object.entries(S.vars || {}).forEach(([k, val]) => { v[k] = /^[\s　]*$/.test(val) ? "" : val; });
  if (c) {
    (c.params || []).forEach((p) => { if (p.label) v[p.label] = String(p.value); });
    (c.status || []).forEach((s) => { if (s.label) v[s.label] = String(s.value); });
  }
  return v;
}

export function initChat() {
  const input = $("chatInput");
  $("sendBtn").addEventListener("click", () => submit(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); }
  });
  S.speaker = localStorage.getItem("s51-speaker-" + S.roomId) || "";
  try { S.cbOrder = JSON.parse(localStorage.getItem("s51-cborder-" + S.roomId) || "[]"); } catch { S.cbOrder = []; }
  try { S.palPlace = JSON.parse(localStorage.getItem("s51-palplace-" + S.roomId) || "{}"); } catch { S.palPlace = {}; }
  const q = query(rp("messages"), limitToLast(LOG_LIMIT));
  onChildAdded(q, (snap) => { const m = snap.val(); if (m) { m.key = snap.key; renderMessage(m); } });
  onChildChanged(q, (snap) => { const m = snap.val(); if (m) { m.key = snap.key; msgChanged(m); } });
  onChildRemoved(q, (snap) => msgRemoved(snap.key));
  onValue(q, () => { S.popReady = true; }, { onlyOnce: true });
  renderBonus();
  initChatDock();
  S.chanReady = true;
  initSecrets();
  chansChanged();
}

export function initChatDock() {
  try { S.colOrder = JSON.parse(localStorage.getItem("s51-cols") || "[]"); } catch { S.colOrder = []; }
  $("chanAdd").addEventListener("click", addChan);
  $("chanAdd2").addEventListener("click", addChan);
  $("chanAddSecret").addEventListener("click", addSecretChan);
  $("palFace").addEventListener("click", () => { $("palFaceList").hidden = !$("palFaceList").hidden; renderPalFace(); });
  initChatTools();
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
  placeChatWin();
}

export function setChatH(h) {
  S.chatH = Math.max(120, Math.min(Math.round(innerHeight * 0.75), Math.round(h)));
  $("room").style.setProperty("--chat-h", S.chatH + "px");
}

export function chans() {
  const custom = Object.entries((S.meta && S.meta.chans) || {})
    .filter(([, c]) => c && c.name)
    .sort((a, b) => (a[1].t || 0) - (b[1].t || 0) || a[0].localeCompare(b[0]))
    .map(([k, c]) => [k, String(c.name)]);
  return CH_TABS.concat(custom, S.sChans ? secretList() : []);
}

export function tabLabel(k) {
  return (isSecret(k) && !isOpen(k) ? "🔒" : "") + tabName(k);
}

export function msgChanged(m) {
  const i = S.msgs.findIndex((x) => x.key === m.key && tabOf(x) === tabOf(m));
  if (i >= 0) S.msgs[i] = m;
  rerenderLog();
}

export function msgRemoved(key) {
  const n = S.msgs.length;
  S.msgs = S.msgs.filter((x) => x.key !== key);
  if (S.editing === key) S.editing = "";
  if (S.msgs.length !== n) rerenderLog();
}

export function msgPath(m) {
  return isSecret(m.tab) ? "secrets/" + S.roomId + "/msgs/" + m.tab + "/" + m.key : "rooms/" + S.roomId + "/messages/" + m.key;
}

function storedOf(m) {
  const o = { ...m };
  delete o.key;
  return o;
}

export function canEditMsg(m) {
  return !!m.key && m.uid === S.uid && !m.sys && !m.secret;
}

export function canDeleteMsg(m) {
  return !!m.key && (m.uid === S.uid || S.isKP);
}

export async function saveEdit(m, text) {
  const t = String(text).replace(/\s+$/, "").slice(0, 2000);
  if (!t) return;
  try {
    await set(ref(S.db, msgPath(m)), { ...storedOf(m), text: t, edited: true, et: serverTimestamp() });
    S.editing = "";
    rerenderLog();
  } catch (e) {
    setStatus("修正できませんでした: " + e.message, true);
  }
}

export async function deleteMsg(m) {
  const own = m.uid === S.uid;
  if (!confirm(own ? "この発言を削除しますか？" : "「" + (m.name || "") + "」の発言を削除しますか？（KPとして削除）")) return;
  try {
    await remove(ref(S.db, msgPath(m)));
  } catch (e) {
    setStatus("削除できませんでした: " + e.message, true);
  }
}

function msgActions(m, li) {
  const box = el("div", "msg-actions");
  if (canEditMsg(m)) {
    const ed = el("button", "mini", "編集");
    ed.type = "button";
    ed.addEventListener("click", (e) => { e.stopPropagation(); S.editing = m.key; S.editDraft = m.text || ""; rerenderLog(); });
    box.append(ed);
  }
  if (canDeleteMsg(m)) {
    const dl = el("button", "mini del", "削除");
    dl.type = "button";
    dl.addEventListener("click", (e) => { e.stopPropagation(); deleteMsg(m); });
    box.append(dl);
  }
  if (!box.childElementCount) return;
  li.append(box);
  li.classList.add("has-actions");
  li.addEventListener("click", (e) => { if (!e.target.closest("button, textarea, a")) li.classList.toggle("show-actions"); });
}

function editorNode(m) {
  const box = el("div", "msg-edit");
  const ta = el("textarea");
  ta.rows = 2;
  ta.value = S.editDraft ?? m.text ?? "";
  ta.addEventListener("input", () => { S.editDraft = ta.value; });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEdit(m, ta.value); }
    if (e.key === "Escape") { S.editing = ""; rerenderLog(); }
  });
  const ok = el("button", "mini primary", "保存");
  ok.type = "button";
  ok.addEventListener("click", () => saveEdit(m, ta.value));
  const ng = el("button", "mini", "やめる");
  ng.type = "button";
  ng.addEventListener("click", () => { S.editing = ""; rerenderLog(); });
  const row = el("div", "row");
  row.append(ok, ng);
  box.append(ta, row);
  setTimeout(() => { if (S.editing === m.key && document.activeElement !== ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0);
  return box;
}

export function rerenderLog() {
  const log = $("log");
  if (!log) return;
  const stick = nearBottom();
  log.replaceChildren();
  S.msgs.filter((m) => tabOf(m) === S.chatTab).forEach((m) => log.append(messageNode(m)));
  if (stick) scrollLog(true);
}

export function isChan(k) {
  return chans().some(([x]) => x === k);
}

export function colKeys() {
  const all = chans().map(([k]) => k);
  const out = ["main"];
  S.colOrder.forEach((k) => { if (k !== "main" && all.includes(k) && !out.includes(k)) out.push(k); });
  all.forEach((k) => { if (!out.includes(k)) out.push(k); });
  return out;
}

export function chansChanged() {
  const sig = JSON.stringify([chans(), S.isKP, (S.meta && S.meta.tabColors) || {}, S.sChans || {}, S.players ? Object.keys(S.players) : []]);
  if (sig === S.chanSig) return;
  S.chanSig = sig;
  if (!isChan(S.chatTab)) S.chatTab = "main";
  $("chanAdd").hidden = !S.isKP;
  buildChatTabs();
  buildPlaceOptions();
  renderChanList();
}

export function buildChatTabs() {
  const nav = $("chatTabs");
  nav.replaceChildren();
  let drag = "";
  colKeys().forEach((k) => {
    const b = el("button", "", tabLabel(k));
    b.type = "button";
    b.dataset.ch = k;
    b.addEventListener("click", () => { switchChatTab(k); setPalPlace(k); });
    paintTab(b, k);
    if (k === "main") {
      b.title = "メイン（左端に固定）";
    } else {
      b.draggable = true;
      b.title = "ドラッグで並べ替え";
      b.addEventListener("dragstart", (e) => { drag = k; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); });
      b.addEventListener("dragend", () => { drag = ""; });
    }
    b.addEventListener("dragover", (e) => { if (drag && drag !== k && k !== "main") { e.preventDefault(); b.classList.add("drop"); } });
    b.addEventListener("dragleave", () => b.classList.remove("drop"));
    b.addEventListener("drop", (e) => {
      e.preventDefault();
      b.classList.remove("drop");
      if (!drag || drag === k || k === "main") return;
      S.colOrder = colKeys();
      const a = S.colOrder.indexOf(drag);
      const t = S.colOrder.indexOf(k);
      S.colOrder.splice(a, 1);
      S.colOrder.splice(t, 0, drag);
      drag = "";
      localStorage.setItem("s51-cols", JSON.stringify(S.colOrder));
      buildChatTabs();
      buildPlaceOptions();
    });
    if (S.isKP && !CH_TABS.some(([x]) => x === k)) {
      const rn = el("span", "tab-act", "✎");
      rn.title = "名前を変える";
      rn.addEventListener("click", (e) => { e.stopPropagation(); renameChan(k); });
      const dl = el("span", "tab-act", "×");
      dl.title = "このタブを削除";
      dl.addEventListener("click", (e) => { e.stopPropagation(); deleteChan(k); });
      b.append(rn, dl);
    }
    nav.append(b);
  });
  renderChatTabs();
  if ($("log").dataset.ch !== S.chatTab) switchChatTab(S.chatTab);
}

export function tabColor(k) {
  const v = isSecret(k) ? S.sChans[k].color : S.meta && S.meta.tabColors && S.meta.tabColors[k];
  return /^#[0-9a-f]{6}$/i.test(v || "") ? v : "";
}

export function paintTab(b, k) {
  const c = tabColor(k);
  b.style.setProperty("--tab-c", c || "var(--accent)");
  b.classList.toggle("colored", !!c);
}

export function placeChatWin() {
  const w = $("chatWin");
  const host = isPc() ? $("chatDock") : $("tab-chat");
  if (w.parentElement !== host) { host.append(w); scrollLog(true); }
}

export function renderChatWho() {
  const who = $("chatWho");
  if (!who) return;
  if (document.activeElement !== who) {
    who.replaceChildren();
    const me = el("option", "", S.name || "（PL）");
    me.value = "";
    who.append(me);
    speakerEntries().forEach(([id, c]) => { const o = el("option", "", c.name || "（名前なし）"); o.value = id; who.append(o); });
    who.value = S.speaker || "";
  }
  const face = $("chatFace");
  if (document.activeElement === face) return;
  face.replaceChildren();
  const c = speakerChar();
  const list = c ? faceList(c).filter((f) => f.label) : [];
  const none = el("option", "", list.length ? "（そのまま）" : "なし");
  none.value = "";
  face.append(none);
  list.forEach((f) => { const o = el("option", "", f.label); o.value = f.label; face.append(o); });
  face.value = c && c.face && list.some((f) => f.label === c.face) ? c.face : "";
  face.disabled = !list.length || !canEdit(c);
}

export function textColor() {
  const v = localStorage.getItem("s51-tcolor") || "";
  return /^#[0-9a-f]{6}$/i.test(v) ? v : "";
}

export function initChatTools() {
  $("chatWho").addEventListener("change", () => setSpeaker($("chatWho").value));
  $("chatFace").addEventListener("change", () => {
    const c = speakerChar();
    const v = $("chatFace").value;
    if (c && v && canEdit(c)) update(rp("chars/" + S.speaker), { face: v }).catch((e) => setStatus("保存失敗: " + e.message, true));
  });
  const tc = textColor();
  if (tc) $("chatColor").value = tc;
  $("chatColorReset").hidden = !tc;
  $("chatColor").addEventListener("input", () => {
    localStorage.setItem("s51-tcolor", $("chatColor").value);
    $("chatColorReset").hidden = false;
    $("chatInput").style.color = $("chatColor").value;
  });
  $("chatColorReset").addEventListener("click", () => {
    localStorage.removeItem("s51-tcolor");
    $("chatColor").value = "#dddddd";
    $("chatColorReset").hidden = true;
    $("chatInput").style.color = "";
  });
  if (tc) $("chatInput").style.color = tc;
  const box = $("diceBtns");
  [4, 6, 8, 10, 12, 20, 100].forEach((n) => {
    const b = el("button", "mini die", "D" + n);
    b.type = "button";
    b.title = "入力欄に 1D" + n + " を入れる（もう一度押すと個数が増える）";
    b.addEventListener("click", () => {
      const ta = $("chatInput");
      const v = ta.value.trim();
      const m = v.match(new RegExp("^(\\d+)D" + n + "$", "i"));
      if (!v) ta.value = "1D" + n;
      else if (m) ta.value = (+m[1] + 1) + "D" + n;
      else ta.value = v + "+1D" + n;
      ta.focus();
    });
    box.append(b);
  });
}

export function tabOf(m) {
  return (m && m.tab) || "main";
}

export function tabName(k) {
  const t = chans().find(([x]) => x === k);
  return t ? t[1] : "メイン";
}

export function switchChatTab(k) {
  S.chatTab = k;
  renderPalDest();
  S.unread[k] = false;
  renderChatTabs();
  const log = $("log");
  log.dataset.ch = k;
  log.replaceChildren();
  S.msgs.filter((m) => tabOf(m) === k).forEach((m) => log.append(messageNode(m)));
  scrollLog(true);
}

export function renderChatTabs() {
  $("chatTabs").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.ch === S.chatTab);
    b.classList.toggle("unread", !!S.unread[b.dataset.ch] && b.dataset.ch !== S.chatTab);
  });
}

export function ctBonus() {
  const n = parseInt(S.meta && S.meta.ctBonus, 10);
  return n > 0 ? n : 20;
}

export function ctStatus(c) {
  if (!c) return null;
  const st = (c.status || []).find((s) => normLabel(s.label) === "CT");
  return st ? st : null;
}

export function renderBonus() {
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

export function renderMyStatus() {
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

export function setSpeaker(id) {
  if (S.bonus && S.bonus.ct && id !== S.speaker) S.bonus = null;
  S.speaker = id;
  localStorage.setItem("s51-speaker-" + S.roomId, id);
  const c = S.chars[id];
  if (c && c.commands) S.palSel = "char:" + id;
  renderSpeaker();
  renderPaletteTabs();
}

export function speakerEntries() {
  const list = sorted(S.chars, "order")
    .filter(([id, c]) => !isStand(c) && visibleChar(c) && ((S.isKP && S.showAllChars) || c.owner === S.pid || (id === S.speaker && canEdit(c))));
  const pos = (id) => { const i = S.cbOrder.indexOf(id); return i < 0 ? 1e9 : i; };
  return list.map((e, i) => [e, i]).sort((a, b) => (pos(a[0][0]) - pos(b[0][0])) || (a[1] - b[1])).map((x) => x[0]);
}

export function moveSpeakerOrder(from, to) {
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

export function renderSpeaker() {
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
  renderChatWho();
  renderPalFace();
}

export async function submit(raw) {
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

export function lastNumber(t) {
  const m = String(t).match(/(-?\d+)\s*$/);
  return m ? parseInt(m[1], 10) : NaN;
}

export function evalNumber(expr) {
  const e = expr.trim();
  if (/^-?\d+$/.test(e)) return { n: parseInt(e, 10), detail: "" };
  const r = /d/i.test(e) ? S.calc.eval(e) : S.calc.eval("C(" + e + ")");
  if (!r) return { n: NaN, detail: "" };
  return { n: lastNumber(r.text), detail: r.text };
}

export async function statusCommand(line, charId) {
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

export function rollDice(text) {
  if (!S.system) return null;
  const first = text.split("\n")[0].replace(/　/g, " ");
  try { return S.system.eval(first); } catch { return null; }
}

export function resultClass(r) {
  if (r.critical) return "critical";
  if (r.fumble) return "fumble";
  if (r.success) return "success";
  if (r.failure) return "failure";
  return "";
}

export async function postSystem(text) {
  await push(rp("messages"), { uid: S.uid, name: "system", color: "#888888", text: text.slice(0, 2000), sys: true, tab: "main", t: serverTimestamp() });
}

export async function sendChat(rawText, charId0, place) {
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
      const key = assetKey(m[1]);
      const old = S.vars && S.vars[key] !== undefined ? String(S.vars[key]) : "";
      const val = m[2] === "" ? "　" : m[2];
      await set(rp("meta/vars/" + key), val);
      await postSystem("[ room ] " + m[1] + " : " + (old === "" ? "　" : old) + " → " + val);
    }
    return;
  }

  const tab = isChan(place) ? place : isChan(S.chatTab) ? S.chatTab : "main";
  const dest = isSecret(tab) ? "secrets/" + S.roomId + "/msgs/" + tab : "rooms/" + S.roomId + "/messages";
  const msg = {
    uid: S.uid,
    name: (c ? c.name : S.name) || S.name,
    color: c ? c.color || S.color : S.color,
    text: expanded.slice(0, 2000),
    tab,
    t: serverTimestamp()
  };
  if (icon) msg.icon = icon;
  if (textColor()) msg.tc = textColor();
  if (first.startsWith(":")) {
    const r = await statusCommand(first, charId);
    if (r) {
      msg.dice = r.error || r.text;
      msg.res = r.error ? "failure" : "";
      if (!r.error) msg.st = true;
      await push(ref(S.db, dest), msg);
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
  if (msg.secret) {
    await sendSecretDice(dest, msg);
    return;
  }
  await push(ref(S.db, dest), msg);
}

export function nearBottom() {
  const log = $("log");
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

export function scrollLog(force) {
  const log = $("log");
  if (force || nearBottom()) log.scrollTop = log.scrollHeight;
}

export function messageNode(m) {
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
  if (m.edited) head.append(el("span", "edited", "（編集済み）"));
  body.append(head);
  if (S.editing && S.editing === m.key && canEditMsg(m)) {
    body.append(editorNode(m));
    if (m.dice) body.append(el("div", "dice " + (m.res || ""), m.dice));
    li.append(body);
    return li;
  }
  if (m.secret && m.key) {
    const d = sdiceOf(m);
    if (!d) {
      body.append(el("div", "dice secret", "シークレットダイス"));
    } else {
      const tx = el("div", "text", d.text || "");
      body.append(tx, el("div", "dice " + (d.res || ""), (d.opened ? "[S公開] " : "[S] ") + (d.dice || "")));
      if (!d.opened) {
        const op = el("button", "mini sd-open", "このダイスを公開");
        op.type = "button";
        op.addEventListener("click", () => openSdice(m));
        body.append(op);
      }
    }
  } else if (m.secret && m.uid !== S.uid) {
    body.append(el("div", "dice secret", "シークレットダイス"));
  } else {
    const tx = el("div", "text", m.text || "");
    if (/^#[0-9a-f]{6}$/i.test(m.tc || "")) tx.style.color = m.tc;
    body.append(tx);
    if (m.dice) body.append(el("div", "dice " + (m.res || ""), (m.secret ? "[S] " : "") + m.dice));
  }
  li.append(body);
  msgActions(m, li);
  return li;
}

export function renderMessage(m) {
  if (!m) return;
  watchSdice(m);
  S.msgs.push(m);
  if (S.msgs.length > LOG_LIMIT) S.msgs.shift();
  const k = tabOf(m);
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

export function popMessage(m) {
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
    if (!isPc()) showTab("chat");
    switchChatTab(tabOf(m));
  });
  box.append(p);
  const max = isPc() ? 3 : 1;
  while (box.children.length > max) box.firstElementChild.remove();
}
