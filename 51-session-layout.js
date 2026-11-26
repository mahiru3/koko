import { $, MOBILE, S, isPc } from "./51-session-core.js?v=4i";
import { placeChatWin, scrollLog } from "./51-session-chat.js?v=4i";
import { queueRender } from "./51-session-board.js?v=4i";

export function initTabs() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("kpToggle").addEventListener("click", () => {
    S.kpOpen = !S.kpOpen;
    localStorage.setItem("s51-kpopen", S.kpOpen ? "1" : "");
    applyKpLayout();
  });
  S.kpOpen = localStorage.getItem("s51-kpopen") !== "";
}

export function showTab(name) {
  const panel = $("tab-" + name);
  if (!panel) return;
  const side = panel.closest(".side");
  side.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  side.querySelectorAll(".panel").forEach((p) => { p.hidden = p !== panel; });
  if (name === "chat") scrollLog(true);
}

export function initKeep() {
  document.querySelectorAll("details[data-keep]").forEach((d) => {
    const k = "s51-open-" + d.dataset.keep;
    const v = localStorage.getItem(k);
    if (v !== null) d.open = v === "1";
    d.addEventListener("toggle", () => localStorage.setItem(k, d.open ? "1" : "0"));
  });
}

export function winNode(k) {
  return $(k === "kp" ? "kpSide" : "plSide");
}

export function saveWins() {
  localStorage.setItem("s51-wins", JSON.stringify(S.wins));
}

export function fixPlTab() {
  if (isPc() && !$("tab-chat").hidden) showTab("palette");
  if (S.chanReady) placeChatWin();
}

export function applyWins() {
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

export function initWindows() {
  try { S.wins = JSON.parse(localStorage.getItem("s51-wins") || "{}") || {}; } catch { S.wins = {}; }
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

export function applyKpLayout() {
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
