import { firebaseConfig } from "./51-session-config.js?v=4k";
import {
  initializeApp, getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
  getDatabase, ref, push, update, onValue, serverTimestamp, connectDatabaseEmulator
} from "./51-session-fb.js?v=4k";
import { ensureProfile, applyTransfer, transferCode, rand } from "./51-session-id.js?v=4k";
import { compressImage } from "./51-session-import.js?v=4k";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,19}$/;
document.documentElement.dataset.theme = localStorage.getItem("s51-theme") === "light" ? "light" : "dark";
const M = { db: null, uid: "", pid: "", code: "", sets: {}, files: {}, sel: "", replacing: null, picked: new Set() };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setStatus(t, bad) {
  $("status").textContent = t;
  $("status").classList.toggle("bad", !!bad);
}

function lp(path) {
  return ref(M.db, "lib/" + M.pid + (path ? "/" + path : ""));
}

async function start() {
  const emu = params.has("emu");
  if (!emu && !(firebaseConfig.apiKey && firebaseConfig.databaseURL)) { setStatus("設定がありません", true); return; }
  const app = initializeApp(emu ? { apiKey: "demo-key", projectId: "demo-s51", databaseURL: "http://127.0.0.1:9000/?ns=demo-s51" } : firebaseConfig);
  const auth = getAuth(app);
  M.db = getDatabase(app);
  if (emu) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(M.db, "127.0.0.1", 9000);
  }
  setStatus("接続中…");
  await signInAnonymously(auth);
  await new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { if (u) { M.uid = u.uid; off(); resolve(); } });
  });
  const p = await ensureProfile(M.db, M.uid);
  M.pid = p.pid;
  M.code = p.code;
  $("codeShow").value = transferCode(p);
  setStatus("接続中");
  bind();
  onValue(lp("sets"), (s) => { M.sets = s.val() || {}; render(); });
  onValue(lp("files"), (s) => { M.files = s.val() || {}; render(); });
}

function bind() {
  $("codeCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("codeShow").value); $("codeMsg").textContent = "コピーしました"; }
    catch { $("codeShow").select(); }
  });
  $("codeApply").addEventListener("click", async () => {
    if (!confirm("このブラウザの画像置き場を、入力したコードのものに切り替えますか？")) return;
    try {
      await applyTransfer(M.db, M.uid, $("codeInput").value);
      $("codeMsg").textContent = "切り替えました。読み込み直します…";
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      $("codeMsg").textContent = e.message;
    }
  });
  $("setNew").addEventListener("click", newSet);
  $("selAll").addEventListener("change", () => {
    const st = M.sets[M.sel];
    M.picked = new Set($("selAll").checked && st ? (st.faces || []).map((_, i) => i) : []);
    render();
  });
  $("selDel").addEventListener("click", deletePicked);
  $("allDel").addEventListener("click", deleteAll);
  $("setId").addEventListener("change", () => {
    const v = $("setId").value.trim().toLowerCase();
    if (!ID_RE.test(v)) { $("setMsg").textContent = "IDは半角英数字（と - _）で20文字までです"; render(); return; }
    if (Object.entries(M.sets).some(([k, s]) => k !== M.sel && s.id === v)) { $("setMsg").textContent = "同じIDがすでにあります"; render(); return; }
    update(lp("sets/" + M.sel), { id: v });
  });
  $("setPrefix").addEventListener("click", addPrefix);
  $("setDel").addEventListener("click", deleteSet);
  $("files").addEventListener("change", (e) => { uploadFiles([...e.target.files]); e.target.value = ""; });
  const drop = $("drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    uploadFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
  });
  $("replaceFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    const fk = M.replacing;
    e.target.value = "";
    if (!f || !fk) return;
    try {
      const data = await compressImage(await f.arrayBuffer(), f.type || "image/png", 1024);
      await update(lp("files/" + fk), { data, t: serverTimestamp() });
      $("setMsg").textContent = "画像を差し替えました";
    } catch (err) {
      $("setMsg").textContent = "差し替えに失敗しました: " + err.message;
    }
  });
}

function sortedSets() {
  return Object.entries(M.sets).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
}

function newId() {
  const used = new Set(Object.values(M.sets).map((s) => s.id));
  for (let i = 0; i < 50; i++) {
    const id = rand(3, "abcdefghijklmnopqrstuvwxyz");
    if (!used.has(id)) return id;
  }
  return rand(5, "abcdefghijklmnopqrstuvwxyz");
}

async function newSet() {
  const r = await push(lp("sets"), { id: newId(), faces: [], order: Date.now() });
  M.sel = r.key;
  render();
}

function baseName(name) {
  return String(name).replace(/\.[^.]+$/, "");
}

async function uploadFiles(list) {
  if (!M.sel || !list.length) return;
  const st = M.sets[M.sel];
  const faces = Array.isArray(st.faces) ? st.faces.slice() : [];
  let n = 0;
  for (const f of list) {
    $("setMsg").textContent = "アップロード中 " + (++n) + "/" + list.length + "：" + f.name;
    try {
      const data = await compressImage(await f.arrayBuffer(), f.type || "image/png", 1024);
      const r = await push(lp("files"), { name: f.name.slice(0, 80), data, t: serverTimestamp() });
      faces.push({ label: "@" + baseName(f.name).slice(0, 30), file: r.key });
    } catch (err) {
      $("setMsg").textContent = f.name + " を読めませんでした: " + err.message;
    }
  }
  await update(lp("sets/" + M.sel), { faces });
  $("setMsg").textContent = list.length + "枚アップロードしました。「IDをつける」でファイル名にIDを付けられます";
}

async function addPrefix() {
  const st = M.sets[M.sel];
  if (!st) return;
  const up = {};
  (st.faces || []).forEach((fc) => {
    const file = M.files[fc.file];
    if (file && !String(file.name).startsWith(st.id + "-")) up["files/" + fc.file + "/name"] = st.id + "-" + file.name;
  });
  if (!Object.keys(up).length) { $("setMsg").textContent = "すべてIDが付いています"; return; }
  await update(lp(""), up);
  $("setMsg").textContent = Object.keys(up).length + "件のファイル名にIDを付けました";
}

function usedElsewhere(fk, exceptSet) {
  return Object.entries(M.sets).some(([k, s]) => k !== exceptSet && (s.faces || []).some((f) => f.file === fk));
}

async function deleteSet() {
  const st = M.sets[M.sel];
  if (!st || !confirm("セット「" + st.id + "」と、その画像を削除しますか？（このセットを使っている駒は画像が出なくなります）")) return;
  const up = { ["sets/" + M.sel]: null };
  (st.faces || []).forEach((f) => { if (!usedElsewhere(f.file, M.sel)) up["files/" + f.file] = null; });
  await update(lp(""), up);
  M.sel = "";
  render();
}

async function deletePicked() {
  const st = M.sets[M.sel];
  if (!st || !M.picked.size) return;
  if (!confirm("選んだ " + M.picked.size + "枚 の画像を削除しますか？")) return;
  const faces = Array.isArray(st.faces) ? st.faces : [];
  const gone = faces.filter((_, i) => M.picked.has(i));
  const next = faces.filter((_, i) => !M.picked.has(i));
  const upd = { ["sets/" + M.sel + "/faces"]: next };
  gone.forEach((f) => {
    if (!usedElsewhere(f.file, M.sel) && !next.some((x) => x.file === f.file)) upd["files/" + f.file] = null;
  });
  await update(lp(""), upd);
  M.picked = new Set();
  $("setMsg").textContent = gone.length + "枚削除しました";
}

async function deleteAll() {
  const n = Object.keys(M.files).length;
  const typed = prompt("マイ画像（すべてのIDと画像 " + n + "枚）を全部削除します。差分セットを使っている駒は画像が出なくなり、元に戻せません。\n削除するなら「削除」と入力してください");
  if (typed === null) return;
  if (typed.trim() !== "削除") { setStatus("入力が違うため削除しませんでした", true); return; }
  await update(lp(""), { files: null, sets: null });
  M.sel = "";
  M.picked = new Set();
  setStatus("マイ画像を全部削除しました");
}

function saveFaces(faces) {
  return update(lp("sets/" + M.sel), { faces });
}

function render() {
  const tabs = $("setTabs");
  tabs.replaceChildren();
  const list = sortedSets();
  if (!M.sel || !M.sets[M.sel]) M.sel = list[0] ? list[0][0] : "";
  list.forEach(([k, s]) => {
    const b = el("button", k === M.sel ? "on" : "", s.id + "（" + (s.faces || []).length + "）");
    b.type = "button";
    b.addEventListener("click", () => { M.sel = k; M.picked = new Set(); $("setMsg").textContent = ""; render(); });
    tabs.append(b);
  });
  $("setEmpty").hidden = list.length > 0;
  const st = M.sets[M.sel];
  $("setEditor").hidden = !st;
  renderUsage();
  if (!st) return;
  [...M.picked].forEach((i) => { if (!(st.faces || [])[i]) M.picked.delete(i); });
  $("selDel").disabled = !M.picked.size;
  $("selDel").textContent = M.picked.size ? "選択した画像を削除（" + M.picked.size + "枚）" : "選択した画像を削除";
  $("selAll").checked = M.picked.size > 0 && M.picked.size === (st.faces || []).length;
  if (document.activeElement !== $("setId")) $("setId").value = st.id;
  const tb = $("rows");
  tb.replaceChildren();
  const faces = Array.isArray(st.faces) ? st.faces : [];
  faces.forEach((fc, i) => {
    const file = M.files[fc.file] || {};
    const tr = el("tr");
    const lab = el("input");
    lab.value = fc.label || "";
    lab.addEventListener("change", () => {
      let v = lab.value.trim();
      if (v && !v.startsWith("@")) v = "@" + v;
      const next = faces.map((x) => ({ ...x }));
      next[i].label = v.slice(0, 31);
      saveFaces(next);
    });
    const name = el("input");
    name.value = file.name || "";
    name.addEventListener("change", () => update(lp("files/" + fc.file), { name: name.value.trim().slice(0, 80) || "image.png" }));
    const pv = el("button", "pv");
    pv.type = "button";
    pv.title = "クリックで画像を差し替え";
    const im = el("img");
    im.alt = "";
    if (file.data) im.src = file.data;
    pv.append(im);
    pv.addEventListener("click", () => { M.replacing = fc.file; $("replaceFile").click(); });
    const ops = el("td", "ops");
    const up = el("button", "", "↑");
    up.type = "button";
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      const next = faces.map((x) => ({ ...x }));
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      saveFaces(next);
    });
    const del = el("button", "del", "×");
    del.type = "button";
    del.addEventListener("click", async () => {
      if (!confirm((fc.label || "この差分") + " を削除しますか？")) return;
      const next = faces.filter((_, j) => j !== i);
      const upd = { ["sets/" + M.sel + "/faces"]: next };
      if (!usedElsewhere(fc.file, M.sel) && !next.some((x) => x.file === fc.file)) upd["files/" + fc.file] = null;
      await update(lp(""), upd);
    });
    ops.append(up, del);
    const pick = el("input");
    pick.type = "checkbox";
    pick.checked = M.picked.has(i);
    pick.addEventListener("change", () => {
      if (pick.checked) M.picked.add(i); else M.picked.delete(i);
      render();
    });
    const c0 = el("td", "pick"); c0.append(pick);
    const c1 = el("td"); c1.append(lab);
    const c2 = el("td"); c2.append(name);
    const c3 = el("td"); c3.append(pv);
    tr.append(c0, c1, c2, c3, ops);
    tb.append(tr);
  });
  if (!faces.length) {
    const tr = el("tr");
    const td = el("td", "msg", "まだ画像がありません");
    td.colSpan = 5;
    tr.append(td);
    tb.append(tr);
  }
}

function renderUsage() {
  let total = 0;
  let n = 0;
  Object.values(M.files).forEach((f) => { n++; total += (f.data || "").length; });
  $("usage").textContent = "画像 " + n + "枚・約" + (total / 1024 / 1024).toFixed(1) + "MB";
}

document.body.classList.add("booted");
start().catch((e) => setStatus("接続に失敗しました: " + e.message, true));
