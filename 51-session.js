import { firebaseConfig } from "./51-session-config.js?v=4g";
import { initializeApp, getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator, getDatabase, ref, set, update, remove, onValue, onChildAdded, onChildRemoved, serverTimestamp, onDisconnect, connectDatabaseEmulator } from "./51-session-fb.js?v=4g";
import { ensureProfile } from "./51-session-id.js?v=4g";
import { $, params, ROOM_RE, S, applyTheme, kpCheck, el, setStatus, randomId, rp, syncMarkers } from "./51-session-core.js?v=4g";
import { initTabs, initKeep, initWindows, applyKpLayout } from "./51-session-layout.js?v=4g";
import { initChat, chansChanged, ctBonus, renderBonus, renderSpeaker } from "./51-session-chat.js?v=4g";
import { initBoard, queueRender } from "./51-session-board.js?v=4g";
import { initPalettes, renderPaletteTabs } from "./51-session-pal.js?v=4g";
import { initChars, initPaste, renderCharList, renderCharDetail } from "./51-session-chars.js?v=4g";
import { renderPlayers, renderScenes, renderNotes, renderBoardPickers, renderObjLists, renderVars, initRoomTab, queueAssetUi, updateAssetInfo } from "./51-session-kp.js?v=4g";

function initJoin() {
  $("joinRoom").value = params.get("room") || "";
  if (params.has("kicked")) $("joinMsg").textContent = "KPにこの部屋から外されました。もう一度入室できます。";
  $("joinName").value = localStorage.getItem("s51-name") || "";
  $("joinColor").value = localStorage.getItem("s51-color") || "#4a90d9";
  $("newRoom").addEventListener("click", () => { $("joinRoom").value = randomId(10); S.created = $("joinRoom").value; });
  $("joinBtn").addEventListener("click", join);
  $("joinName").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  if (!(firebaseConfig.apiKey && firebaseConfig.databaseURL) && !params.has("emu")) {
    $("joinMsg").textContent = "51-session-config.js に Firebase の設定を貼り付けてください。";
    $("joinBtn").disabled = true;
  }
}

async function join() {
  const roomId = $("joinRoom").value.trim().toLowerCase();
  const name = $("joinName").value.trim();
  if (!ROOM_RE.test(roomId)) { $("joinMsg").textContent = "部屋IDは半角英数字とハイフンで4〜40文字です。"; return; }
  if (!name) { $("joinMsg").textContent = "名前を入力してください。"; return; }
  Object.assign(S, { roomId, name, color: $("joinColor").value });
  localStorage.setItem("s51-name", name);
  localStorage.setItem("s51-color", S.color);
  $("joinBtn").disabled = true;
  $("joinMsg").textContent = "接続中…";
  try {
    await connect();
  } catch (err) {
    $("joinBtn").disabled = false;
    $("joinMsg").textContent = "接続に失敗しました: " + err.message;
  }
}

async function connect() {
  const emu = params.has("emu");
  const app = initializeApp(emu ? { apiKey: "demo-key", projectId: "demo-s51", databaseURL: "http://127.0.0.1:9000/?ns=demo-s51" } : firebaseConfig);
  const auth = getAuth(app);
  S.db = getDatabase(app);
  if (emu) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(S.db, "127.0.0.1", 9000);
  }
  await signInAnonymously(auth);
  await new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { if (u) { S.uid = u.uid; off(); resolve(); } });
  });
  S.pid = (await ensureProfile(S.db, S.uid)).pid;
  const url = new URL(location.href);
  url.searchParams.set("room", S.roomId);
  url.searchParams.delete("kicked");
  history.replaceState(null, "", url);
  $("join").hidden = true;
  $("room").hidden = false;
  $("roomLabel").textContent = S.roomId;
  $("meName").textContent = S.name;
  $("meName").style.color = S.color;
  startRoom();
}

async function startRoom() {
  initTabs();
  initKeep();
  initWindows();
  initPaste();
  await initSystems();
  initPresence().catch((e) => setStatus("参加者の登録に失敗しました: " + e.message, true));
  initChat();
  initBoard();
  initChars();
  initPalettes();
  initRoomTab();
  $("copyUrl").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); setStatus("URLをコピーしました"); }
    catch { prompt("このURLを共有してください", location.href); }
  });
  onChildAdded(rp("assets"), (s) => { S.assets.set(s.key, s.val()); queueRender(); updateAssetInfo(); queueAssetUi(); });
  onChildRemoved(rp("assets"), (s) => { S.assets.delete(s.key); queueRender(); updateAssetInfo(); queueAssetUi(); });
  $("ctBonus").addEventListener("change", () => {
    const n = Math.max(1, Math.min(99, parseInt($("ctBonus").value, 10) || 20));
    $("ctBonus").value = n;
    set(rp("meta/ctBonus"), n);
  });
  onValue(rp("meta"), (s) => {
    const raw = s.val();
    if (!raw && S.metaSeen) setStatus("この部屋は削除されたか、空になりました", true);
    if (raw) S.metaSeen = true;
    S.meta = raw || {};
    if (!S.meta.owner && S.created && S.created === S.roomId) { S.created = ""; set(rp("meta/owner"), S.pid); }
    const kp = kpCheck();
    S.isOwner = !!S.pid && S.meta.owner === S.pid;
    if (kp !== S.isKP) { S.isKP = kp; renderCharList(); renderSpeaker(); renderCharDetail(); }
    renderPlayers();
    applyKpLayout();
    syncMarkers();
    renderBoardPickers();
    renderObjLists();
    renderScenes();
    S.vars = S.meta.vars || {};
    const b = S.meta.board || {};
    const sig = [b.fieldW, b.fieldH, b.fg, S.meta.fieldMult].join("|");
    if (sig !== S.boardSig) { S.boardSig = sig; S.fitted = false; }
    if ((S.meta.system || "DiceBot") !== S.systemId) loadSystem(S.meta.system || "DiceBot");
    $("fieldMult").value = String(S.meta.fieldMult || 4);
    $("gridShow").checked = !!(S.meta.board && S.meta.board.displayGrid);
    if (document.activeElement !== $("ctBonus")) $("ctBonus").value = ctBonus();
    if (S.chanReady) chansChanged();
    renderBonus();
    renderVars();
    queueRender();
  });
  const watch = (name, after) => onValue(rp(name), (s) => { S[name] = s.val() || {}; if (after) after(); queueRender(); });
  watch("chars", () => { renderCharList(); renderSpeaker(); renderCharDetail(); renderPaletteTabs(); renderPlayers(); });
  onValue(ref(S.db, "lib/" + S.pid + "/sets"), (s) => { S.mySets = s.val() || {}; renderCharDetail(); });
  watch("items", renderObjLists);
  onValue(rp("markers"), (s) => { S.roomMarkers = s.val() || {}; syncMarkers(); renderObjLists(); queueRender(); });
  watch("scenes", () => { syncMarkers(); renderScenes(); renderObjLists(); renderBoardPickers(); });
  watch("notes", renderNotes);
}

async function initSystems() {
  S.loader = new BCDiceLite.LiteLoader();
  S.calc = await S.loader.dynamicLoad("DiceBot");
  const sel = $("systemSel");
  S.loader.listAvailableGameSystems()
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"))
    .forEach((info) => { const o = el("option", "", info.name); o.value = info.id; sel.append(o); });
  sel.addEventListener("change", () => set(rp("meta/system"), sel.value));
  await loadSystem("DiceBot");
}

async function loadSystem(id) {
  try { S.system = await S.loader.dynamicLoad(id); S.systemId = id; }
  catch { S.system = S.calc; S.systemId = "DiceBot"; }
  $("systemSel").value = S.systemId;
}

async function initPresence() {
  const mine = rp("members/" + S.uid);
  await remove(rp("kick/" + S.pid)).catch(() => {});
  await update(rp("players/" + S.pid), { name: S.name, color: S.color, t: serverTimestamp() });
  onValue(ref(S.db, ".info/connected"), (snap) => {
    if (snap.val() === true) {
      setStatus("接続中");
      onDisconnect(mine).remove().then(() => set(mine, { name: S.name, color: S.color, pid: S.pid, t: serverTimestamp() }));
    } else {
      setStatus("切断（再接続待ち）", true);
    }
  });
  onValue(rp("kick/" + S.pid), async (snap) => {
    if (!snap.val()) return;
    await remove(rp("kick/" + S.pid)).catch(() => {});
    await remove(mine).catch(() => {});
    location.href = location.pathname + "?room=" + encodeURIComponent(S.roomId) + "&kicked=1";
  });
  onValue(rp("members"), (snap) => { S.online = snap.val() || {}; renderPlayers(); });
  onValue(rp("players"), (snap) => { S.players = snap.val() || {}; renderPlayers(); renderCharList(); renderCharDetail(); });
}

document.body.classList.add("booted");
applyTheme();
$("themeBtn").addEventListener("click", () => {
  localStorage.setItem("s51-theme", document.documentElement.dataset.theme === "light" ? "dark" : "light");
  applyTheme();
});
initJoin();
