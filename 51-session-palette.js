const VAR_RE = /^\/\/([^=]+)=(.*)$/;
const HR_RE = /^-{3,}\s*$/;
const GROUP_RE = /^###(.*)$/;

export function parseTekeyJson(json) {
  const list = Array.isArray(json && json.palettes) ? json.palettes : [];
  return list
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((p, i) => ({
      id: "t" + Date.now().toString(36) + i,
      label: String(p.label || p.name || "パレット" + (i + 1)).slice(0, 40),
      name: String(p.name || ""),
      stock: String(p.stock || "")
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

export function renderPalette(stock, mount, mk, handlers) {
  const vars = paletteVars(stock);
  mount.replaceChildren();
  const stack = [mount];
  let gi = 0;
  String(stock).split(/\r?\n/).forEach((line) => {
    const top = stack[stack.length - 1];
    if (VAR_RE.test(line)) return;
    const g = line.match(GROUP_RE);
    if (g) {
      const title = g[1].trim();
      if (title) {
        const d = mk("details", "pal-group acc-color-" + ((gi++ % 4) + 1));
        d.open = true;
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
    const row = mk("div", "pal-row");
    const fill = mk("button", "pal-text", line);
    fill.type = "button";
    fill.addEventListener("click", () => handlers.fill(cmd));
    const go = mk("button", "pal-go", "▶");
    go.type = "button";
    go.addEventListener("click", () => handlers.send(cmd));
    row.append(fill, go);
    top.append(row);
  });
}
