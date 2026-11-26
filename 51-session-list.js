import { el } from "./51-session-core.js?v=4k";

const STATES = {};

export function listState(name, checked) {
  if (!STATES[name]) STATES[name] = { checked: checked || new Set(), anchor: "", q: "", bar: null, cfg: null, ul: null };
  return STATES[name];
}

export function orderedEntries(obj, fallback) {
  const all = Object.entries(obj || {});
  const has = all.filter(([, o]) => o && typeof o.order === "number");
  const rest = all.filter(([, o]) => !o || typeof o.order !== "number");
  has.sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]));
  rest.sort(fallback || ((a, b) => a[0].localeCompare(b[0])));
  return has.concat(rest);
}

export function checkedIds(name) {
  const st = listState(name);
  const all = st.ul && st.ul._all ? st.ul._all : [];
  return all.filter((id) => st.checked.has(id));
}

export function clearChecked(name) {
  listState(name).checked.clear();
}

export function initListBar(box, name, opt) {
  const st = listState(name);
  box.replaceChildren();
  box.classList.add("lst-bar");
  const top = el("div", "lst-top");
  const q = el("input", "lst-q");
  q.type = "search";
  q.placeholder = opt.placeholder || "検索";
  q.addEventListener("input", () => { st.q = q.value.trim().toLowerCase(); opt.onChange(); });
  const count = el("span", "lst-count");
  top.append(q, count);
  const row = el("div", "lst-row");
  const allLab = el("label", "check lst-all");
  const all = el("input");
  all.type = "checkbox";
  all.addEventListener("change", () => {
    const vis = st.ul && st.ul._ids ? st.ul._ids : [];
    vis.forEach((id) => { if (all.checked) st.checked.add(id); else st.checked.delete(id); });
    opt.onChange();
  });
  allLab.append(all, document.createTextNode("すべて選択"));
  row.append(allLab);
  (opt.actions || []).forEach((a) => {
    if (a.node) { row.append(a.node); return; }
    const b = el("button", "mini lst-act" + (a.cls ? " " + a.cls : ""), a.label);
    b.type = "button";
    if (a.title) b.title = a.title;
    b.addEventListener("click", () => {
      const ids = checkedIds(name);
      if (!ids.length && !a.always) { count.textContent = "先に選んでください"; return; }
      a.run(ids);
    });
    row.append(b);
  });
  const hint = el("p", "msg lst-hint", opt.hint || "≡をドラッグで並べ替え。チェック欄を上下にドラッグすると続けて選べます（Shift／Ctrl＋クリックでも選べます）");
  box.append(top, row, hint);
  st.bar = { q, count, all, unit: opt.unit || "件" };
  syncBar(name);
}

export function syncBar(name) {
  const st = listState(name);
  if (!st.bar) return;
  const vis = st.ul && st.ul._ids ? st.ul._ids : [];
  const total = st.ul && st.ul._all ? st.ul._all.length : 0;
  const n = checkedIds(name).length;
  st.bar.count.textContent = (vis.length === total ? total + st.bar.unit : vis.length + "／" + total + st.bar.unit) + (n ? "・" + n + "選択" : "");
  st.bar.all.checked = vis.length > 0 && vis.every((id) => st.checked.has(id));
  st.bar.all.indeterminate = !st.bar.all.checked && vis.some((id) => st.checked.has(id));
}

export function renderRows(ul, name, entries, cfg) {
  const st = listState(name);
  st.cfg = cfg;
  st.ul = ul;
  const all = entries.map(([id]) => id);
  [...st.checked].forEach((id) => { if (!all.includes(id)) st.checked.delete(id); });
  const vis = entries.filter(([id, o]) => {
    if (cfg.filter && !cfg.filter(id, o)) return false;
    if (!st.q) return true;
    return ((cfg.search ? cfg.search(id, o) : "") + " " + id).toLowerCase().includes(st.q);
  });
  ul._all = all;
  ul._ids = vis.map(([id]) => id);
  ul.classList.add("lst");
  ul.replaceChildren();
  vis.forEach(([id, o]) => {
    const li = el("li", "lst-item" + (st.checked.has(id) ? " checked" : ""));
    li.dataset.id = id;
    const chk = el("span", "lst-chk");
    const cb = el("input");
    cb.type = "checkbox";
    cb.tabIndex = -1;
    cb.checked = st.checked.has(id);
    chk.append(cb);
    const grip = el("span", "lst-grip", "≡");
    grip.title = "ドラッグで並べ替え";
    li.append(chk, grip);
    cfg.fill(li, id, o);
    ul.append(li);
  });
  if (!vis.length) ul.append(el("li", "empty", entries.length ? "当てはまるものがありません" : cfg.empty || "まだありません"));
  if (!ul._lst) bindList(ul, name);
  syncBar(name);
}

function rowsOf(ul) {
  return [...ul.querySelectorAll(":scope > li.lst-item")];
}

function rowAt(ul, x, y) {
  const t = document.elementFromPoint(x, y);
  const li = t && t.closest("li.lst-item");
  return li && li.parentElement === ul ? li : null;
}

function paintChecks(ul, st) {
  rowsOf(ul).forEach((li) => {
    const on = st.checked.has(li.dataset.id);
    li.classList.toggle("checked", on);
    const cb = li.querySelector(".lst-chk input");
    if (cb) cb.checked = on;
  });
}

function changed(name) {
  const st = listState(name);
  paintChecks(st.ul, st);
  syncBar(name);
  if (st.cfg && st.cfg.onCheck) st.cfg.onCheck();
}

function bindList(ul, name) {
  ul._lst = true;
  const st = listState(name);
  ul.addEventListener("click", (e) => {
    if (e.target.closest(".lst-chk")) { e.preventDefault(); return; }
    if (e.target.closest(".lst-grip")) return;
    const li = e.target.closest("li.lst-item");
    if (!li || li.parentElement !== ul) return;
    if (e.target.closest("input, textarea, select, button, a, .no-row")) return;
    const id = li.dataset.id;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (st.checked.has(id)) st.checked.delete(id); else st.checked.add(id);
      st.anchor = id;
      changed(name);
      return;
    }
    if (e.shiftKey && st.anchor) {
      e.preventDefault();
      const ids = ul._ids;
      const a = ids.indexOf(st.anchor), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((k) => st.checked.add(k));
      changed(name);
      return;
    }
    if (st.cfg && st.cfg.toggleOnClick) {
      if (st.checked.has(id)) st.checked.delete(id); else st.checked.add(id);
      st.anchor = id;
      changed(name);
      return;
    }
    if (st.cfg && st.cfg.onOpen) st.cfg.onOpen(id, e);
  });
  ul.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const chk = e.target.closest(".lst-chk");
    const grip = e.target.closest(".lst-grip");
    const li = e.target.closest("li.lst-item");
    if (!li || li.parentElement !== ul || (!chk && !grip)) return;
    e.preventDefault();
    if (chk) startSelect(ul, name, li, e);
    else startMove(ul, name, li, e);
  });
}

function startSelect(ul, name, li, e) {
  const st = listState(name);
  const ids = ul._ids;
  const start = ids.indexOf(li.dataset.id);
  const on = !st.checked.has(li.dataset.id);
  const base = new Set(st.checked);
  st.anchor = li.dataset.id;
  let last = -1;
  const apply = (end) => {
    if (end === last) return;
    last = end;
    st.checked.clear();
    base.forEach((k) => st.checked.add(k));
    ids.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((k) => { if (on) st.checked.add(k); else st.checked.delete(k); });
    changed(name);
  };
  apply(start);
  const move = (ev) => {
    const r = rowAt(ul, ev.clientX, ev.clientY);
    if (r) apply(ids.indexOf(r.dataset.id));
    else {
      const rows = rowsOf(ul);
      if (!rows.length) return;
      if (ev.clientY < rows[0].getBoundingClientRect().top) apply(0);
      else if (ev.clientY > rows[rows.length - 1].getBoundingClientRect().bottom) apply(rows.length - 1);
    }
  };
  const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

function startMove(ul, name, li, e) {
  const st = listState(name);
  const id = li.dataset.id;
  const drag = st.checked.has(id) ? ul._all.filter((k) => st.checked.has(k)) : [id];
  const grid = !!(st.cfg && st.cfg.grid);
  const sx = e.clientX, sy = e.clientY;
  let moving = false, target = null, after = false, drop = null;
  const ghost = el("div", "lst-ghost", drag.length > 1 ? drag.length + "件" : (li.textContent || "").replace("≡", "").trim().slice(0, 16));
  const clear = () => {
    rowsOf(ul).forEach((r) => r.classList.remove("drop-before", "drop-after", "dragging"));
    document.querySelectorAll(".drop-hover").forEach((d) => d.classList.remove("drop-hover"));
  };
  const move = (ev) => {
    if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
    if (!moving) {
      moving = true;
      document.body.append(ghost);
      document.body.classList.add("lst-moving");
      rowsOf(ul).forEach((r) => { if (drag.includes(r.dataset.id)) r.classList.add("dragging"); });
    }
    ghost.style.left = ev.clientX + 12 + "px";
    ghost.style.top = ev.clientY + 8 + "px";
    clear();
    rowsOf(ul).forEach((r) => { if (drag.includes(r.dataset.id)) r.classList.add("dragging"); });
    target = null;
    drop = null;
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const d = t && t.closest("[data-drop]");
    if (d && st.cfg && st.cfg.onDrop) { drop = d; d.classList.add("drop-hover"); return; }
    const r = rowAt(ul, ev.clientX, ev.clientY);
    if (!r || drag.includes(r.dataset.id)) return;
    const rc = r.getBoundingClientRect();
    after = grid ? ev.clientX > rc.left + rc.width / 2 : ev.clientY > rc.top + rc.height / 2;
    target = r.dataset.id;
    r.classList.add(after ? "drop-after" : "drop-before");
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    ghost.remove();
    document.body.classList.remove("lst-moving");
    clear();
    if (!moving) return;
    if (drop) { st.cfg.onDrop(drop.dataset.drop, drag); return; }
    if (!target || !st.cfg || !st.cfg.onReorder) return;
    const rest = ul._all.filter((k) => !drag.includes(k));
    let at = rest.indexOf(target);
    if (after) at++;
    rest.splice(at, 0, ...drag);
    st.cfg.onReorder(rest);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}
