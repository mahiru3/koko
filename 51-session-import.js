const MAX_DIM = 1280;
const MAX_CHARS = 380000;
const SVG_MAX = 300000;
const KEEP_MAX = 380000;
const TIMES_RE = /[×x✕]\s*\d+\s*$/i;
const SKILL_RE = /^\s*(?:CCB?|1D100|CC)\s*<=\s*(\d+)\s*[【〈《\[]([^】〉》\]]+)[】〉》\]]/i;

export function assetKey(name) {
  return String(name).replace(/[.#$\[\]\/]/g, "_");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function encode(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  let url = c.toDataURL("image/webp", q);
  if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/png");
  return url;
}

export async function compressImage(blob, type, max) {
  const original = await blobToDataUrl(new Blob([blob], { type }));
  if (type === "image/svg+xml") {
    if (original.length <= SVG_MAX) return original;
  } else if (/^image\/(gif|png|apng|webp|jpeg)$/.test(type) && original.length <= KEEP_MAX) {
    return original;
  }
  const bmp = await createImageBitmap(new Blob([blob], { type }));
  let dim = max || MAX_DIM;
  let q = 0.82;
  let url = await encode(bmp, dim, q);
  while (url.length > MAX_CHARS && dim > 128) {
    dim = Math.round(dim * 0.75);
    q = Math.max(0.6, q - 0.08);
    url = await encode(bmp, dim, q);
  }
  return url;
}

function ref(name) {
  return name ? assetKey(name) : "";
}

function click(a) {
  return a && a.type === "message" && a.text ? String(a.text) : "";
}

function marker(m) {
  return {
    x: +m.x || 0, y: +m.y || 0, z: +m.z || 0,
    w: +m.width || 1, h: +m.height || 1,
    img: ref(m.imageUrl), text: m.text || "", click: click(m.clickAction),
    locked: !!(m.locked || m.freezed)
  };
}

function markers(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, m]) => { out[assetKey(k)] = marker(m); });
  return out;
}

export async function readRoomZip(file, onProgress) {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file("__data.json");
  if (!dataFile) throw new Error("__data.json が見つかりません");
  const data = JSON.parse(await dataFile.async("string"));
  const e = data.entities || {};
  const res = data.resources || {};
  const room = e.room || {};

  const assets = {};
  const names = Object.keys(res).filter((n) => zip.file(n));
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    onProgress("画像を圧縮中 " + (i + 1) + "/" + names.length);
    try {
      const buf = await zip.file(n).async("uint8array");
      assets[assetKey(n)] = await compressImage(buf, res[n].type || "image/png");
    } catch (err) {
      onProgress("読めない画像を飛ばしました: " + n);
    }
  }

  const chars = {};
  Object.entries(e.characters || {}).forEach(([k, c]) => {
    chars[assetKey(k)] = {
      name: String(c.name || "").slice(0, 60),
      color: c.color || "#888888",
      icon: ref(c.iconUrl),
      faces: (c.faces || []).map((f) => ({ label: faceLabel(f.label), icon: ref(f.iconUrl) })),
      x: +c.x || 0, y: +c.y || 0, z: +c.z || 100,
      w: +c.width || 1, h: +c.height || 1,
      status: (c.status || []).map((s) => ({ label: String(s.label || ""), value: +s.value || 0, max: +s.max || 0 })),
      params: (c.params || []).map((p) => ({ label: String(p.label || ""), value: String(p.value ?? "") })),
      commands: c.commands || "",
      memo: c.memo || "",
      active: c.active !== false,
      hideStatus: !!c.hideStatus,
      order: +c.order || 0
    };
  });

  const items = {};
  Object.entries(e.items || {}).forEach(([k, it]) => {
    items[assetKey(k)] = {
      type: it.type || "object",
      x: +it.x || 0, y: +it.y || 0, z: +it.z || 0,
      w: +it.width || 1, h: +it.height || 1,
      img: ref(it.imageUrl), cover: ref(it.coverImageUrl),
      closed: !!it.closed, visible: it.visible !== false && it.active !== false,
      memo: it.memo || "", click: click(it.clickAction),
      locked: !!(it.locked || it.freezed)
    };
  });

  const scenes = {};
  Object.entries(e.scenes || {}).forEach(([k, s]) => {
    scenes[assetKey(k)] = {
      name: s.name || "",
      bg: ref(s.backgroundUrl), fg: ref(s.foregroundUrl),
      fieldW: +s.fieldWidth || 16, fieldH: +s.fieldHeight || 9,
      gridSize: +s.gridSize || 2, displayGrid: !!s.displayGrid,
      markers: markers(s.markers),
      order: +s.order || 0
    };
  });

  const notes = {};
  Object.entries(e.notes || {}).forEach(([k, n]) => {
    notes[assetKey(k)] = { name: n.name || "", text: n.text || "", order: +n.order || 0 };
  });

  const vars = {};
  (room.variables || []).forEach((v) => { if (v && v.label) vars[assetKey(v.label)] = String(v.value ?? ""); });

  const board = {
    bg: ref(room.backgroundUrl), fg: ref(room.foregroundUrl),
    fieldW: +room.fieldWidth || 16, fieldH: +room.fieldHeight || 9,
    gridSize: +room.gridSize || 2, displayGrid: !!room.displayGrid,
    bgColor: room.backgroundColor || ""
  };

  const usesCCB = JSON.stringify(e.characters || {}).includes("CCB") || JSON.stringify(e.items || {}).includes("CCB");

  return { assets, chars, items, markers: markers(room.markers), scenes, notes, vars, board, usesCCB };
}

function looseParse(text) {
  const t = String(text).trim().replace(/^\uFEFF/, "");
  try {
    return JSON.parse(t);
  } catch (e) {
    return JSON.parse(t.replace(/\r?\n/g, "\\n"));
  }
}

export function faceLabel(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return (s.startsWith("@") ? s : "@" + s).slice(0, 31);
}

export function normLabel(v) {
  return String(v || "").normalize("NFKC").toUpperCase();
}

export function parseCharJson(text) {
  const raw = looseParse(text);
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((o) => (o && o.data && typeof o.data === "object" ? o.data : o))
    .filter((d) => d && typeof d === "object" && (d.name || d.commands || d.status))
    .map((d) => {
      let commands = String(d.commands || "");
      if (commands.includes("\\n") && !commands.includes("\n")) commands = commands.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
      const status = (Array.isArray(d.status) ? d.status : [])
        .filter((s) => s && s.label && !TIMES_RE.test(String(s.label)))
        .map((s) => ({ label: String(s.label), value: Number(s.value) || 0, max: Number(s.max) || 0 }));
      const params = (Array.isArray(d.params) ? d.params : [])
        .filter((p) => p && p.label)
        .map((p) => ({ label: String(p.label), value: String(p.value ?? "") }));
      const have = new Set(params.map((p) => p.label));
      commands.split("\n").forEach((line) => {
        const m = line.match(SKILL_RE);
        if (!m) return;
        const label = m[2].trim();
        if (label && !have.has(label) && !TIMES_RE.test(label)) {
          params.push({ label, value: m[1] });
          have.add(label);
        }
      });
      const url = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : "");
      const faceUrls = (Array.isArray(d.faces) ? d.faces : [])
        .map((f) => ({ label: faceLabel(f && f.label), url: url(f && f.iconUrl) }))
        .filter((f) => f.label && f.url);
      return {
        name: String(d.name || "名前なし").slice(0, 60),
        color: /^#[0-9a-f]{3,8}$/i.test(d.color || "") ? d.color : "#888888",
        iconUrl: url(d.iconUrl),
        faceUrls,
        commands,
        status,
        params,
        memo: String(d.memo || ""),
        initiative: Number(d.initiative) || 0,
        externalUrl: typeof d.externalUrl === "string" && d.externalUrl.startsWith("https://") ? d.externalUrl : "",
        w: Number(d.width) || 4,
        h: Number(d.height) || 4
      };
    });
}
