import { set, update } from "./51-session-fb.js?v=4k";
import { compressImage } from "./51-session-import.js?v=4k";
import { $, UNIT, PAD, FG_Z, S, visibleChar, isStand, canSeeOther, el, blurInput, setStatus, newKey, charIcon, src, rp, objPath } from "./51-session-core.js?v=4k";
import { showTab } from "./51-session-layout.js?v=4k";
import { setSpeaker, sendChat } from "./51-session-chat.js?v=4k";
import { renderCharList, renderCharDetail } from "./51-session-chars.js?v=4k";
import { selectObj } from "./51-session-kp.js?v=4k";

export function refreshAvatars() {
  document.querySelectorAll("img[data-asset]").forEach((im) => {
    const s = src(im.dataset.asset);
    if (s && im.src !== s) im.src = s;
  });
}

export function fieldRect() {
  const b = S.meta.board || {};
  const mult = S.meta.fieldMult || 4;
  const w = (b.fieldW || 16) * mult;
  const h = (b.fieldH || 9) * mult;
  return { x: -w / 2, y: -h / 2, w, h };
}

export function initBoard() {
  const wrap = $("boardWrap");
  $("zoomIn").addEventListener("click", () => setZoom(S.zoom * 1.25));
  $("zoomOut").addEventListener("click", () => setZoom(S.zoom / 1.25));
  $("zoomFit").addEventListener("click", fitField);
  window.addEventListener("resize", () => { if (!S.drag) queueRender(); });
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const step = Math.max(-3, Math.min(3, -e.deltaY / (e.deltaMode === 1 ? 3 : 100)));
    setZoom(S.zoom * Math.pow(1.15, step), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  let pan = null;
  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || (e.button !== 0 && e.button !== 1)) return;
    if (e.target.closest(".obj, .popup")) return;
    e.preventDefault();
    blurInput();
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add("panning");
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!pan || pan.id !== e.pointerId) return;
    wrap.scrollLeft = pan.sl - (e.clientX - pan.x);
    wrap.scrollTop = pan.st - (e.clientY - pan.y);
  });
  const stop = (e) => {
    if (!pan || pan.id !== e.pointerId) return;
    pan = null;
    wrap.classList.remove("panning");
  };
  wrap.addEventListener("pointerup", stop);
  wrap.addEventListener("pointercancel", stop);
}

export function setZoom(z, at) {
  const wrap = $("boardWrap");
  const p = at && typeof at === "object" ? at : { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
  const bx = (wrap.scrollLeft + p.x - S.off.x) / S.zoom;
  const by = (wrap.scrollTop + p.y - S.off.y) / S.zoom;
  S.zoom = Math.max(0.1, Math.min(5, z));
  $("zoomLabel").textContent = Math.round(S.zoom * 100) + "%";
  layoutSizer();
  if (at !== false) {
    wrap.scrollLeft = bx * S.zoom + S.off.x - p.x;
    wrap.scrollTop = by * S.zoom + S.off.y - p.y;
  }
}

export function fitField() {
  const wrap = $("boardWrap");
  const f = fieldRect();
  const z = Math.min(wrap.clientWidth / ((f.w + 2) * UNIT), wrap.clientHeight / ((f.h + 2) * UNIT));
  setZoom(z, false);
  wrap.scrollLeft = (f.x + S.origin.x + f.w / 2) * UNIT * S.zoom + S.off.x - wrap.clientWidth / 2;
  wrap.scrollTop = (f.y + S.origin.y + f.h / 2) * UNIT * S.zoom + S.off.y - wrap.clientHeight / 2;
}

export function layoutSizer() {
  const board = $("board");
  const wrap = $("boardWrap");
  const w = parseFloat(board.style.width || 0) * S.zoom;
  const h = parseFloat(board.style.height || 0) * S.zoom;
  const vw = wrap.clientWidth;
  const vh = wrap.clientHeight;
  S.off = { x: vw, y: vh };
  board.style.transform = "scale(" + S.zoom + ")";
  board.style.left = S.off.x + "px";
  board.style.top = S.off.y + "px";
  $("sizer").style.width = w + vw * 2 + "px";
  $("sizer").style.height = h + vh * 2 + "px";
}

export function queueRender() {
  if (S.renderQueued) return;
  S.renderQueued = true;
  requestAnimationFrame(() => { S.renderQueued = false; renderBoard(); refreshAvatars(); });
}

export function boardObjects() {
  const list = [];
  Object.entries(S.items).forEach(([id, o]) => { if (o.active !== false && (o.visible !== false || S.isKP)) list.push({ kind: "items", id, o }); });
  Object.entries(S.markers).forEach(([id, o]) => list.push({ kind: "markers", id, o }));
  Object.entries(S.chars).forEach(([id, o]) => { if (o.active !== false && visibleChar(o)) list.push({ kind: "chars", id, o }); });
  return list;
}

export function renderBoard() {
  if (S.drag) return;
  const f = fieldRect();
  const objs = boardObjects();
  let minX = f.x, minY = f.y, maxX = f.x + f.w, maxY = f.y + f.h;
  objs.forEach(({ o }) => {
    minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + (o.w || 1)); maxY = Math.max(maxY, o.y + (o.h || 1));
  });
  S.origin = { x: -minX + PAD, y: -minY + PAD };
  const board = $("board");
  board.style.width = (maxX - minX + PAD * 2) * UNIT + "px";
  board.style.height = (maxY - minY + PAD * 2) * UNIT + "px";
  layoutSizer();

  const b = S.meta.board || {};
  const wrap = $("boardWrap");
  const bg = src(b.bg);
  wrap.style.backgroundImage = bg ? "url(\"" + bg + "\")" : "";
  wrap.style.backgroundColor = b.bgColor || "";
  const field = $("field");
  field.style.zIndex = String(cssZ(FG_Z, true));
  field.style.left = (f.x + S.origin.x) * UNIT + "px";
  field.style.top = (f.y + S.origin.y) * UNIT + "px";
  field.style.width = f.w * UNIT + "px";
  field.style.height = f.h * UNIT + "px";
  const fg = src(b.fg);
  field.style.backgroundImage = fg ? "url(\"" + fg + "\")" : "";
  board.classList.toggle("grid", !!b.displayGrid);
  board.style.backgroundSize = (b.gridSize || 2) * UNIT + "px " + (b.gridSize || 2) * UNIT + "px";

  const seen = new Set();
  objs.forEach((obj) => { seen.add(obj.kind + ":" + obj.id); drawObject(obj); });
  S.nodes.forEach((node, key) => { if (!seen.has(key)) { node.remove(); S.nodes.delete(key); } });

  if (!S.fitted && wrap.clientWidth > 0) { S.fitted = true; fitField(); }
}

export function drawObject({ kind, id, o }) {
  const key = kind + ":" + id;
  let node = S.nodes.get(key);
  if (!node) {
    node = el("div", "obj obj-" + kind);
    node.dataset.kind = kind;
    node.dataset.id = id;
    const img = el("img", "obj-img");
    img.alt = "";
    img.draggable = false;
    node.append(img);
    if (kind === "chars") node.append(el("div", "face-fallback"), el("div", "label"), el("div", "bars"));
    bindPointer(node);
    node.addEventListener("contextmenu", (e) => {
      const { kind: k, id: oid } = node.dataset;
      if (k === "chars") {
        e.preventDefault();
        S.selChar = oid;
        showTab("chars");
        renderCharList();
        renderCharDetail();
      } else if (S.isKP) {
        e.preventDefault();
        selectObj(k, oid);
      }
    });
    $("board").append(node);
    S.nodes.set(key, node);
  }
  node.style.left = (o.x + S.origin.x) * UNIT + "px";
  node.style.top = (o.y + S.origin.y) * UNIT + "px";
  node.style.width = (o.w || 1) * UNIT + "px";
  node.style.height = (o.h || 1) * UNIT + "px";
  node.style.zIndex = String(cssZ(o.z, kind === "chars" && isStand(o)));
  node.classList.toggle("locked", !!o.locked);
  node.classList.toggle("stand", kind === "chars" && isStand(o));
  node.classList.toggle("hidden-obj", kind === "items" && o.visible === false);
  node.classList.toggle("kp-only", kind === "chars" && !!o.kpOnly);
  node.classList.toggle("clickable", !!o.click);
  node.title = kind === "markers" ? (o.text || "") : (o.memo || "");
  const img = node.querySelector(".obj-img");
  const back = kind === "items" && !!o.closed && o.visible !== false;
  node.classList.toggle("back-blank", back && !o.cover);
  const s = src(back ? o.cover : (kind === "chars" ? charIcon(o) : o.img));
  if (img.getAttribute("src") !== s) { if (s) img.src = s; else img.removeAttribute("src"); }
  img.hidden = !s;
  if (kind === "chars") {
    const fb = node.querySelector(".face-fallback");
    fb.hidden = !!s;
    fb.textContent = (o.name || "?").slice(0, 1);
    fb.style.background = o.color || "#888";
    node.querySelector(".label").textContent = isStand(o) ? "" : o.name || "";
    const bars = node.querySelector(".bars");
    bars.replaceChildren();
    if (!isStand(o) && canSeeOther(o)) {
      (o.status || []).slice(0, 4).forEach((st) => {
        const row = el("div", "sbar");
        const fill = el("span", "bar-fill");
        const pct = st.max > 0 ? Math.max(0, Math.min(100, (st.value / st.max) * 100)) : 100;
        fill.style.width = pct + "%";
        row.append(fill, el("span", "bar-text", st.label + " " + st.value + (st.max ? "/" + st.max : "")));
        bars.append(row);
      });
    }
  } else if (kind === "markers" && !s && o.text) {
    node.dataset.text = o.text.split("\n")[0];
  }
}

export function bindPointer(node) {
  let sx = 0, sy = 0, ox = 0, oy = 0, sl = 0, st = 0, moved = false, active = false, mode = "";
  const wrap = $("boardWrap");
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { kind, id } = node.dataset;
    const o = S[kind][id];
    if (!o) return;
    e.preventDefault();
    e.stopPropagation();
    blurInput();
    active = true;
    moved = false;
    sx = e.clientX; sy = e.clientY;
    ox = o.x; oy = o.y;
    sl = wrap.scrollLeft; st = wrap.scrollTop;
    node.setPointerCapture(e.pointerId);
    if (o.locked || (kind !== "chars" && !S.isKP)) {
      mode = e.pointerType === "touch" ? "" : "pan";
      if (mode) wrap.classList.add("panning");
    } else {
      mode = "drag";
      S.drag = { kind, id };
      node.classList.add("drag");
    }
  });
  node.addEventListener("pointermove", (e) => {
    if (!active) return;
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
    if (mode === "pan") {
      wrap.scrollLeft = sl - (e.clientX - sx);
      wrap.scrollTop = st - (e.clientY - sy);
      return;
    }
    if (mode !== "drag" || !S.drag || S.drag.id !== node.dataset.id) return;
    const dx = (e.clientX - sx) / S.zoom / UNIT;
    const dy = (e.clientY - sy) / S.zoom / UNIT;
    node.style.left = (ox + dx + S.origin.x) * UNIT + "px";
    node.style.top = (oy + dy + S.origin.y) * UNIT + "px";
  });
  const end = (e, cancel) => {
    if (!active) return;
    active = false;
    const { kind, id } = node.dataset;
    const o = S[kind][id];
    const wasDrag = mode === "drag" && !!S.drag;
    S.drag = null;
    mode = "";
    node.classList.remove("drag");
    wrap.classList.remove("panning");
    if (wasDrag && moved && !cancel) {
      const nx = Math.round(ox + (e.clientX - sx) / S.zoom / UNIT);
      const ny = Math.round(oy + (e.clientY - sy) / S.zoom / UNIT);
      update(rp(objPath(kind, id)), { x: nx, y: ny }).catch((err) => setStatus("保存失敗: " + err.message, true));
    } else if (!moved && !cancel && o) {
      onObjectClick(kind, id, o);
    }
    queueRender();
  };
  node.addEventListener("pointerup", (e) => end(e, false));
  node.addEventListener("pointercancel", (e) => end(e, true));
}

export function onObjectClick(kind, id, o) {
  if (o.click) {
    sendChat(o.click, S.speaker, S.chatTab).catch((err) => setStatus("送信失敗: " + err.message, true));
    return;
  }
  if (kind === "chars") {
    S.selChar = id;
    if (o.owner === S.pid) setSpeaker(id);
    renderCharList();
    renderCharDetail();
  }
}

export async function uploadAsset(file, max) {
  const url = await compressImage(await file.arrayBuffer(), file.type || "image/png", max);
  const key = "u" + newKey();
  await set(rp("assets/" + key), url);
  return key;
}

export function centerPos(w, h, i) {
  return { x: Math.round(-w / 2) + (i || 0) * 2, y: Math.round(-h / 2) + (i || 0) * 2 };
}

export function cssZ(z, low) {
  const n = Math.max(-100, Math.min(999, Math.round(Number.isFinite(+z) ? +z : 0)));
  return (n + 101) * 2 + (low ? 0 : 1);
}
