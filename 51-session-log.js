import { ref, get } from "./51-session-fb.js?v=4l";
import { S, $, el, rp, setStatus } from "./51-session-core.js?v=4l";
import { colKeys, tabName } from "./51-session-chat.js?v=4l";
import { sp, isSecret } from "./51-session-secret.js?v=4l";

const CCF_ID = { main: "main", info: "info", talk: "other" };
const CCF_JA = { main: "メイン", info: "情報", talk: "雑談" };

const STYLE = `    <style>
      :root {
        color-scheme: dark;
        color: #eee;
        background: #121212;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-width: 280px;
        margin: 0;
        background: #121212;
      }

      .message-list {
        width: 100%;
        max-width: 960px;
        margin: 0 auto;
        padding: 0 24px 48px;
      }

      .log-title {
        margin: 24px 0;
        font-size: 24px;
      }

      .message {
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr);
        column-gap: 12px;
        padding: 16px 0;
        border-bottom: 1px solid #262626;
      }

      .message.system {
        display: block;
        padding-left: 52px;
        color: #888;
      }

      .avatar,
      .avatar-spacer {
        width: 40px;
        height: 40px;
      }

      .avatar {
        display: block;
        background-repeat: no-repeat;
        background-size: 100% 100%;
      }

%AVATARS%

      .message-content {
        min-width: 0;
      }

      .message-header {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px;
      }

      .speaker {
        color: var(--speaker-color);
        font-size: 14px;
        font-weight: bold;
      }

      .timestamp,
      .edited,
      .channel-name {
        color: #888;
        font-size: 12px;
      }

      .message-text,
      .roll-result {
        font-size: 16px;
        line-height: 1.6;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }

      .roll-result {
        display: block;
        color: #888;
      }

      .roll-result.success,
      .roll-result.critical {
        color: #2196f3;
      }

      .roll-result.failure,
      .roll-result.fumble {
        color: #dc004e;
      }
    </style>`;

export function initLog() {
  $("logBtn").addEventListener("click", () => { $("logMenu").hidden = !$("logMenu").hidden; });
  $("logMenu").querySelectorAll("button[data-fmt]").forEach((b) => b.addEventListener("click", () => exportLog(b.dataset.fmt)));
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function chanId(k) {
  return CCF_ID[k] || k;
}

function chanName(k) {
  return CCF_ID[k] || tabName(k);
}

function chanJa(k) {
  return CCF_JA[k] || tabName(k);
}

function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

function jst(t) {
  const d = new Date(t);
  return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

async function imageData(key) {
  if (!key) return "";
  try {
    if (key.startsWith("lib:")) {
      const [pid, fk] = key.slice(4).split("/");
      const s = await get(ref(S.db, "lib/" + pid + "/files/" + fk + "/data"));
      return s.val() || "";
    }
    if (S.assets.get(key)) return S.assets.get(key);
    const s = await get(rp("assets/" + key));
    return s.val() || "";
  } catch {
    return "";
  }
}

async function hashOf(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function collect() {
  const keys = colKeys();
  const list = [];
  const pub = await get(rp("messages"));
  Object.entries(pub.val() || {}).forEach(([k, m]) => { if (m) list.push({ ...m, key: k, tab: m.tab || "main" }); });
  for (const k of keys.filter((x) => isSecret(x))) {
    try {
      const s = await get(sp("msgs/" + k));
      Object.entries(s.val() || {}).forEach(([mk, m]) => { if (m) list.push({ ...m, key: mk, tab: k }); });
    } catch {
      setStatus("秘匿タブ「" + tabName(k) + "」を読めませんでした", true);
    }
  }
  const visible = new Set(keys);
  const out = list.filter((m) => visible.has(m.tab)).sort((a, b) => (a.t || 0) - (b.t || 0));
  for (const m of out) {
    if (!m.secret) continue;
    if (S.sdopen[m.key]) { m.sd = S.sdopen[m.key]; continue; }
    if (S.sdice[m.key]) { m.sd = S.sdice[m.key]; continue; }
    if (S.isKP || m.pid === S.pid || m.uid === S.uid) {
      try { m.sd = (await get(sp("sdice/" + m.key))).val(); } catch { m.sd = null; }
    }
  }
  const images = {};
  const ids = new Map();
  for (const m of out) {
    if (m.sys || !m.icon || ids.has(m.icon)) continue;
    const data = await imageData(m.icon);
    if (!data) { ids.set(m.icon, null); continue; }
    const id = await hashOf(data);
    ids.set(m.icon, id);
    images[id] = data;
  }
  return { messages: out.map((m) => toCcf(m, ids)), images };
}

function rollOf(m) {
  const res = m.sd ? m.sd.res : m.res;
  const dice = m.sd ? m.sd.dice : m.dice;
  if (!dice) return null;
  return {
    result: dice,
    dices: Array.isArray(m.dices) ? m.dices : [],
    secret: !!m.secret,
    success: res === "success" || res === "critical",
    failure: res === "failure" || res === "fumble",
    critical: res === "critical",
    fumble: res === "fumble"
  };
}

function isStatusMsg(m) {
  return !!m.st || (/^:/.test(m.text || "") && /^\[ /.test(m.dice || ""));
}

function toCcf(m, ids) {
  const t = m.t || 0;
  const base = { name: m.name || "", color: m.color || "#888888", edited: !!m.edited, channel: chanId(m.tab), channelName: chanName(m.tab), createdAt: t, updatedAt: m.et || t };
  if (m.sys) return { ...base, name: "system", text: m.text || "", type: "system", extend: {}, iconImage: null };
  if (isStatusMsg(m)) return { ...base, name: "system", text: m.dice || "", type: "system", extend: {}, iconImage: null };
  const hidden = m.secret && !m.sd;
  const text = hidden ? "シークレットダイス" : m.sd ? m.sd.text || "" : m.text || "";
  const roll = hidden ? null : rollOf(m);
  return { ...base, text, type: "text", extend: roll ? { roll } : {}, iconImage: (m.icon && ids.get(m.icon)) || null };
}

function oldHtml(data) {
  const rows = data.messages.map((m) => {
    const label = m.channel === m.channelName ? m.channel : m.channelName;
    const roll = m.extend && m.extend.roll ? m.extend.roll.result : "";
    return `<p style="color:${esc(m.color)};">
  <span> [${esc(label)}]</span>
  <span>${esc(m.name)}</span> :
  <span>
    ${esc(m.text)} ${esc(roll)}
  </span>
</p>
`;
  });
  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
    <title>ccfolia - logs</title>
  </head>
  <body>



${rows.join("\n")}
  </body>
</html>
`;
}

function newHtml(data, title, withChannel) {
  const order = [];
  data.messages.forEach((m) => { if (m.iconImage && m.type !== "system" && !order.includes(m.iconImage)) order.push(m.iconImage); });
  const avatars = order.map((id, i) => `      .avatar-image-${i} { background-image: url("${data.images[id]}"); }\n`).join("\n");
  const ja = (m) => CCF_JA[{ main: "main", info: "info", other: "talk" }[m.channel]] || m.channelName;
  const arts = data.messages.map((m) => {
    if (m.type === "system") {
      return `      <article class="message system" data-channel="${esc(m.channel)}">
${withChannel ? `
        <div class="message-header">
          <span class="channel-name">[${esc(ja(m))}]</span>
        </div>
` : ""}
        <div class="message-text">${esc(m.text)}</div>
      </article>
`;
    }
    const idx = order.indexOf(m.iconImage);
    const avatar = idx >= 0 ? `        <span class="avatar avatar-image-${idx}" aria-hidden="true"></span>` : `        <span class="avatar-spacer" aria-hidden="true"></span>`;
    const roll = m.extend && m.extend.roll;
    const cls = roll ? ["success", "failure", "critical", "fumble"].filter((k) => roll[k]).reverse()[0] || "" : "";
    const iso = new Date(m.createdAt).toISOString();
    return `      <article class="message" data-channel="${esc(m.channel)}">

${avatar}

        <div class="message-content">
          <div class="message-header">
            <span class="speaker" style="--speaker-color:${esc(m.color)}">${esc(m.name)}</span>
            <time class="timestamp" datetime="${iso}">${jst(m.createdAt)}</time>
${m.edited ? `            <span class="edited">(編集済み)</span>
` : ""}${withChannel ? `
            <span class="channel-name">[${esc(ja(m))}]</span>
` : ""}

          </div>
          <div class="message-text">${esc(m.text)}</div>
${roll ? `
          <span class="roll-result${cls ? " " + cls : ""}">${esc(roll.result)}</span>
` : ""}
        </div>
      </article>
`;
  });
  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
${STYLE.replace("%AVATARS%", avatars)}
  </head>
  <body>
    <main class="message-list">
      <h1 class="log-title">${esc(title)}</h1>

${arts.map((a) => "\n" + a + "\n").join("")}
    </main>
  </body>
</html>
`;
}

function download(name, blob) {
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function subset(data, ids) {
  const messages = data.messages.filter((m) => ids.includes(m.channel));
  const images = {};
  messages.forEach((m) => { if (m.iconImage && data.images[m.iconImage]) images[m.iconImage] = data.images[m.iconImage]; });
  return { messages, images };
}

export async function exportLog(fmt) {
  const msg = $("logMsg");
  msg.textContent = "ログを集めています…";
  try {
    const data = await collect();
    const room = S.roomId;
    if (fmt === "json") {
      download(room + "_log.json", new Blob([JSON.stringify(data)], { type: "application/json" }));
    } else if (fmt === "old") {
      download(room + "[all].html", new Blob([oldHtml(data)], { type: "text/html" }));
    } else {
      const zip = new JSZip();
      zip.file(room + "[すべて].html", newHtml(data, room + " [すべて]", true));
      colKeys().forEach((k) => {
        const part = subset(data, [chanId(k)]);
        zip.file(room + "[" + chanJa(k) + "].html", newHtml(part, room + " [" + chanJa(k) + "]", false));
      });
      download(room + "_html_log.zip", await zip.generateAsync({ type: "blob" }));
    }
    msg.textContent = "書き出しました（" + data.messages.length + "件）";
  } catch (e) {
    msg.textContent = "書き出せませんでした: " + e.message;
  }
}
