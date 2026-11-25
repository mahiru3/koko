const VAR_RE = /^\/\/([^=]+)=(.*)$/;
const HR_RE = /^-{3,}\s*$/;
const GROUP_RE = /^###(.*)$/;

export function placeOf(v) {
  const t = String(v || "").toLowerCase();
  if (/メイン|main/.test(t)) return "main";
  if (/情報|info/.test(t)) return "info";
  if (/雑談|talk|zatsudan|other/.test(t)) return "talk";
  return "";
}

export function parseTekeyJson(json) {
  const list = Array.isArray(json && json.palettes) ? json.palettes : [];
  return list
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((p, i) => ({
      id: "t" + Date.now().toString(36) + i,
      label: String(p.label || p.name || "パレット" + (i + 1)).slice(0, 40),
      name: String(p.name || ""),
      stock: String(p.stock || ""),
      place: placeOf(p.place || p.channel || p.chatTab || p.chatChannel || p.tab || p.room || p.target)
    }));
}

export function paletteVars(stock) {
  const vars = {};
  String(stock).split(/\r?\n/).forEach((line) => {
    const m = line.match(VAR_RE);
    if (m) vars[m[1].trim()] = m[2].trim();
  });
  return vars;
}

export function expandVars(text, vars) {
  let out = text;
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/\{([^{}]+)\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : all));
    if (next === out) break;
    out = next;
  }
  return out;
}

export function moveLine(stock, from, to) {
  const lines = String(stock).split(/\r?\n/);
  if (from === to || from < 0 || to < 0 || from >= lines.length || to > lines.length) return stock;
  const [x] = lines.splice(from, 1);
  lines.splice(to, 0, x);
  return lines.join("\n");
}

export function renderPalette(stock, mount, mk, opt) {
  const vars = paletteVars(stock);
  mount.replaceChildren();
  const stack = [mount];
  let gi = 0;
  let drag = -1;
  String(stock).split(/\r?\n/).forEach((line, li) => {
    const top = stack[stack.length - 1];
    if (VAR_RE.test(line)) return;
    const g = line.match(GROUP_RE);
    if (g) {
      const title = g[1].trim();
      if (title) {
        const d = mk("details", "pal-group acc-color-" + ((gi++ % 4) + 1));
        const key = title + "#" + li;
        d.open = !opt.closed.has(key);
        d.addEventListener("toggle", () => { if (d.open) opt.closed.delete(key); else opt.closed.add(key); });
        d.append(mk("summary", "", title));
        const body = mk("div", "pal-body");
        d.append(body);
        top.append(d);
        stack.push(body);
      } else if (stack.length > 1) {
        stack.pop();
      }
      return;
    }
    if (HR_RE.test(line)) { top.append(mk("hr", "pal-hr")); return; }
    if (!line.trim()) { top.append(mk("div", "pal-gap")); return; }
    const cmd = expandVars(line, vars).replace(/\\n/g, "\n");
    const row = mk("button", "pal-text" + (opt.picked === li ? " on" : ""), line);
    row.type = "button";
    row.dataset.line = String(li);
    row.addEventListener("click", () => {
      if (opt.tapSend()) { opt.send(cmd); return; }
      mount.querySelectorAll(".pal-text.on").forEach((n) => n.classList.remove("on"));
      row.classList.add("on");
      opt.select(cmd, li);
    });
    row.addEventListener("dblclick", (e) => { e.preventDefault(); if (!opt.tapSend()) opt.send(cmd); });
    if (opt.movable) {
      row.draggable = true;
      row.addEventListener("dragstart", (e) => { drag = li; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(li)); row.classList.add("dragging"); });
      row.addEventListener("dragend", () => { drag = -1; row.classList.remove("dragging"); });
      row.addEventListener("dragover", (e) => { if (drag >= 0) { e.preventDefault(); row.classList.add("drop"); } });
      row.addEventListener("dragleave", () => row.classList.remove("drop"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drop");
        if (drag >= 0 && drag !== li) opt.move(drag, li);
      });
    }
    top.append(row);
  });
}
