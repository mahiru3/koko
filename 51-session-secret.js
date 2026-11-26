import { onChildChanged, onChildRemoved, ref, set, update, remove, push, onValue, onChildAdded, query, limitToLast } from "./51-session-fb.js?v=4j";
import { S, LOG_LIMIT, el, newKey, setStatus } from "./51-session-core.js?v=4j";
import { chansChanged, renderMessage, rerenderLog, postSystem, tabName, msgChanged, msgRemoved } from "./51-session-chat.js?v=4j";

export function sp(path) {
  return ref(S.db, "secrets/" + S.roomId + (path ? "/" + path : ""));
}

export function isSecret(k) {
  return !!S.sChans[k];
}

export function isOpen(k) {
  return !!(S.sChans[k] && S.sChans[k].open);
}

export function secretList() {
  return Object.entries(S.sChans)
    .filter(([, c]) => c && c.name)
    .sort((a, b) => (a[1].t || 0) - (b[1].t || 0) || a[0].localeCompare(b[0]))
    .map(([k, c]) => [k, String(c.name)]);
}

export function initSecrets() {
  S.sChans = {};
  S.sSrc = { kp: {}, mine: {}, open: {} };
  S.sDefSubs = {};
  S.sMsgSubs = {};
  S.sdice = {};
  S.sdopen = {};
  S.sdiceSubs = {};
  onValue(ref(S.db, "rooms/" + S.roomId + "/sdopen"), (s) => { S.sdopen = s.val() || {}; rerenderLog(); });
  onValue(sp("mine/" + S.pid), (s) => { S.sSrc.mine = s.val() || {}; syncDefSubs(); }, () => { S.sSrc.mine = {}; syncDefSubs(); });
  secretsForRole();
}

export function secretsForRole() {
  if (S.isKP && !S.sKpSub) {
    const retry = () => {
      if (S.sKpSub) S.sKpSub();
      if (S.sKpDice) S.sKpDice();
      S.sKpSub = null;
      S.sKpDice = null;
      S.sSrc.kp = {};
      mergeDefs();
      setTimeout(secretsForRole, 2000);
    };
    S.sKpSub = onValue(sp("chans"), (s) => { S.sSrc.kp = s.val() || {}; mergeDefs(); }, retry);
    S.sKpDice = onValue(sp("sdice"), (s) => { S.sdice = { ...S.sdice, ...(s.val() || {}) }; rerenderLog(); }, retry);
  } else if (!S.isKP && S.sKpSub) {
    S.sKpSub();
    S.sKpDice();
    S.sKpSub = null;
    S.sKpDice = null;
    S.sSrc.kp = {};
    mergeDefs();
  }
}

export function syncOpened() {
  S.sSrc.open = (S.meta && S.meta.opened) || {};
  syncDefSubs();
}

function syncDefSubs() {
  const want = new Set([...Object.keys(S.sSrc.mine), ...Object.keys(S.sSrc.open)]);
  Object.keys(S.sDefSubs).forEach((k) => {
    if (want.has(k)) return;
    S.sDefSubs[k].off();
    delete S.sDefSubs[k];
  });
  want.forEach((k) => {
    if (S.sDefSubs[k]) return;
    const sub = { val: null };
    sub.off = onValue(sp("chans/" + k), (s) => { sub.val = s.val(); mergeDefs(); }, () => { sub.val = null; mergeDefs(); });
    S.sDefSubs[k] = sub;
  });
  mergeDefs();
}

function mergeDefs() {
  const out = {};
  Object.entries(S.sDefSubs).forEach(([k, sub]) => { if (sub.val) out[k] = sub.val; });
  Object.entries(S.sSrc.kp).forEach(([k, v]) => { if (v) out[k] = v; });
  S.sChans = out;
  syncMsgSubs();
  chansChanged();
}

function syncMsgSubs() {
  let dropped = false;
  Object.keys(S.sMsgSubs).forEach((k) => {
    if (S.sChans[k]) return;
    S.sMsgSubs[k].forEach((off) => off());
    delete S.sMsgSubs[k];
    S.msgs = S.msgs.filter((m) => m.tab !== k);
    dropped = true;
  });
  Object.keys(S.sChans).forEach((k) => {
    if (S.sMsgSubs[k]) return;
    const q = query(sp("msgs/" + k), limitToLast(LOG_LIMIT));
    const wrap = (fn) => (snap) => {
      const m = snap.val();
      if (!m) return;
      m.key = snap.key;
      m.tab = k;
      fn(m);
    };
    S.sMsgSubs[k] = [
      onChildAdded(q, wrap(renderMessage), () => {}),
      onChildChanged(q, wrap(msgChanged), () => {}),
      onChildRemoved(q, (snap) => msgRemoved(snap.key), () => {})
    ];
  });
  if (dropped) rerenderLog();
}

export function sendToSecret(k, msg) {
  return push(sp("msgs/" + k), msg);
}

export async function sendSecretDice(path, msg) {
  const r = push(ref(S.db, path));
  const priv = { pid: S.pid, text: msg.text, dice: msg.dice || "", res: msg.res || "", sys2: msg.sys2 || "" };
  await set(sp("sdice/" + r.key), priv);
  S.sdice[r.key] = priv;
  const stub = { uid: msg.uid, pid: S.pid, name: msg.name, color: msg.color, text: "", secret: true, tab: msg.tab, t: msg.t };
  if (msg.icon) stub.icon = msg.icon;
  await set(r, stub);
}

export function watchSdice(m) {
  if (!m.key || !m.secret || S.sdice[m.key] || S.sdiceSubs[m.key]) return;
  if (m.pid !== S.pid && m.uid !== S.uid) return;
  S.sdiceSubs[m.key] = onValue(sp("sdice/" + m.key), (s) => { if (s.val()) { S.sdice[m.key] = s.val(); rerenderLog(); } }, () => {});
}

export function sdiceOf(m) {
  if (!m.secret || !m.key) return null;
  if (S.sdopen[m.key]) return { ...S.sdopen[m.key], opened: true };
  if (S.sdice[m.key]) return { ...S.sdice[m.key], opened: false };
  return null;
}

export async function openSdice(m) {
  const d = S.sdice[m.key];
  if (!d) return;
  await set(ref(S.db, "rooms/" + S.roomId + "/sdopen/" + m.key), { text: d.text, dice: d.dice, res: d.res });
  await postSystem((m.name || "") + " のシークレットダイスを公開しました");
}

export async function addSecretChan() {
  if (!S.isKP) return;
  const name = (prompt("追加する秘匿タブの名前（例：HO1秘匿）") || "").trim().slice(0, 20);
  if (!name) return;
  const k = "s" + newKey();
  await set(sp("chans/" + k), { name, t: Date.now(), open: false });
}

export async function setMember(k, pid, on) {
  const up = {};
  up["chans/" + k + "/members/" + pid] = on ? true : null;
  up["mine/" + pid + "/" + k] = on ? true : null;
  await update(sp(""), up).catch((e) => setStatus("保存失敗: " + e.message, true));
}

export async function setOpen(k, on) {
  try {
    await set(sp("chans/" + k + "/open"), on);
    await set(ref(S.db, "rooms/" + S.roomId + "/meta/opened/" + k), on ? true : null);
    await postSystem("秘匿タブ「" + tabName(k) + "」を" + (on ? "全員に公開しました" : "秘匿に戻しました"));
  } catch (e) {
    setStatus("保存失敗: " + e.message, true);
  }
}

export async function renameSecret(k) {
  const cur = tabName(k);
  const name = (prompt("タブの新しい名前", cur) || "").trim().slice(0, 20);
  if (!name || name === cur) return;
  await set(sp("chans/" + k + "/name"), name);
}

export async function setSecretColor(k, color) {
  await set(sp("chans/" + k + "/color"), color);
}

export async function deleteSecret(k) {
  const name = tabName(k);
  if (!confirm("秘匿タブ「" + name + "」を削除しますか？\nこのタブの発言も消え、元に戻せません")) return;
  const def = S.sChans[k] || {};
  const up = { ["chans/" + k]: null, ["msgs/" + k]: null };
  Object.keys(def.members || {}).forEach((pid) => { up["mine/" + pid + "/" + k] = null; });
  try {
    await update(sp(""), up);
    await set(ref(S.db, "rooms/" + S.roomId + "/meta/opened/" + k), null);
  } catch (e) {
    setStatus("削除失敗: " + e.message, true);
  }
}

export async function removeAllSecrets() {
  await remove(sp("")).catch(() => {});
}

export function memberBoxes(k) {
  const def = S.sChans[k] || {};
  const box = el("div", "sec-members");
  const players = Object.entries(S.players || {}).filter(([pid]) => pid !== S.meta.owner && !(S.meta.kps && S.meta.kps[pid]));
  if (!players.length) box.append(el("span", "msg", "参加者がまだいません"));
  players.forEach(([pid, p]) => {
    const lab = el("label", "check");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!(def.members && def.members[pid]);
    cb.addEventListener("change", () => setMember(k, pid, cb.checked));
    lab.append(cb, document.createTextNode((p && p.name) || "（名前なし）"));
    box.append(lab);
  });
  return box;
}
