import { ref, push, update, remove, serverTimestamp } from "./51-session-fb.js?v=4k";
import { compressImage, parseCharJson } from "./51-session-import.js?v=4k";
import { $, CHAR_Z, S, visibleChar, isStand, canEdit, showsParams, showsOther, canSeeParams, canSeeOther, el, setStatus, randomId, faceList, charIcon, src, rp, sorted, playerName } from "./51-session-core.js?v=4k";
import { showTab } from "./51-session-layout.js?v=4k";
import { setSpeaker } from "./51-session-chat.js?v=4k";
import { uploadAsset, centerPos } from "./51-session-board.js?v=4k";

export function initChars() {
  $("pieceAdd").addEventListener("click", addChar);
  $("cdSpeak").addEventListener("click", () => {
    setSpeaker(S.selChar);
    showTab("chat");
  });
  $("cdSet").addEventListener("change", () => {
    if (!S.selChar) return;
    const v = $("cdSet").value;
    if (v === "__keep") return;
    update(rp("chars/" + S.selChar), { set: v ? { pid: S.pid, sid: v } : null, face: null });
  });
  $("cdSize").addEventListener("change", () => {
    if (!S.selChar) return;
    const n = Math.max(1, Math.min(64, parseInt($("cdSize").value, 10) || 1));
    update(rp("chars/" + S.selChar), { w: n, h: n });
  });
  $("charImport").addEventListener("click", () => importChars($("charJson").value));
  $("charJsonFile").addEventListener("change", async (e) => {
    for (const f of e.target.files) await importChars(await f.text());
    e.target.value = "";
  });
  $("cdDelete").addEventListener("click", () => {
    if (S.selChar && confirm("このキャラを削除しますか？")) { remove(rp("chars/" + S.selChar)); S.selChar = ""; }
  });
  const field = (id, key, conv) => $(id).addEventListener("change", () => {
    if (!S.selChar) return;
    const v = conv ? conv($(id)) : $(id).value;
    update(rp("chars/" + S.selChar), { [key]: v });
  });
  field("cdName", "name");
  field("cdColor", "color");
  field("cdActive", "active", (e) => e.checked);
  $("cdShowParams").addEventListener("change", () => { if (S.selChar && S.isKP) update(rp("chars/" + S.selChar), { showParams: $("cdShowParams").checked }); });
  $("cdShowOther").addEventListener("change", () => { if (S.selChar && S.isKP) update(rp("chars/" + S.selChar), { showOther: $("cdShowOther").checked, hideStatus: null }); });
  field("cdLock", "locked", (e) => e.checked);
  $("cdOwner").addEventListener("change", () => {
    if (!S.selChar || !S.isKP) return;
    const owner = $("cdOwner").value || null;
    const up = { ["chars/" + S.selChar + "/owner"]: owner };
    Object.entries(S.chars).forEach(([id, c]) => { if (isStand(c) && c.parent === S.selChar) up["chars/" + id + "/owner"] = owner; });
    update(rp(""), up);
  });
  $("cdLayer").addEventListener("change", () => {
    if (!S.selChar) return;
    const n = Math.max(100, Math.min(200, parseInt($("cdLayer").value, 10) || CHAR_Z));
    $("cdLayer").value = n;
    update(rp("chars/" + S.selChar), { z: n });
  });
  field("cdKpOnly", "kpOnly", (e) => e.checked);
  $("dupType").addEventListener("change", () => { $("dupSize").value = $("dupType").value === "stand" ? "16" : "4"; });
  $("dupBtn").addEventListener("click", duplicateChar);
  field("cdMemo", "memo");
  field("cdCommands", "commands");
  $("cdAddStatus").addEventListener("click", () => {
    const c = S.chars[S.selChar]; if (!c) return;
    const label = prompt("ステータス名（例: HP）"); if (!label) return;
    update(rp("chars/" + S.selChar), { status: [...(c.status || []), { label, value: 0, max: 0 }] });
  });
  $("cdAddParam").addEventListener("click", () => {
    const c = S.chars[S.selChar]; if (!c) return;
    const label = prompt("パラメータ名（例: STR）"); if (!label) return;
    update(rp("chars/" + S.selChar), { params: [...(c.params || []), { label, value: "0" }] });
  });
  $("pieceFile").addEventListener("change", () => { $("pieceMsg").textContent = $("pieceFile").files[0] ? "画像を選びました" : ""; });
}

export async function duplicateChar() {
  const src0 = S.chars[S.selChar];
  if (!src0) return;
  const kind = $("dupType").value;
  const n = Math.max(1, Math.min(64, parseInt($("dupSize").value, 10) || 4));
  const parentId = isStand(src0) ? src0.parent : S.selChar;
  const base = {
    name: kind === "stand" ? (src0.name || "").slice(0, 60) : (src0.name || "").slice(0, 56) + "（複製）",
    color: src0.color || "#888888", icon: src0.icon || "", faces: src0.faces || [], set: src0.set || null, face: src0.face || null,
    ...centerPos(n, n), z: CHAR_Z, w: n, h: n, owner: S.pid, active: true, order: Date.now(),
    kpOnly: !!src0.kpOnly, locked: false, showParams: showsParams(src0), showOther: showsOther(src0)
  };
  const c = kind === "stand"
    ? { ...base, kind: "stand", parent: parentId, status: [], params: [], commands: "", memo: "" }
    : { ...base, kind: "char", status: src0.status || [], params: src0.params || [], commands: src0.commands || "", memo: src0.memo || "" };
  const r = await push(rp("chars"), c);
  S.selChar = r.key;
  renderCharList();
  renderCharDetail();
  $("dupMsg").textContent = (kind === "stand" ? "立ち絵駒" : "キャラ駒") + "を作りました（盤面の中央）";
}

export async function addChar() {
  const name = $("pieceName").value.trim() || "キャラ";
  const c = {
    name: name.slice(0, 60), color: $("pieceColor").value,
    ...centerPos(4, 4), z: CHAR_Z,
    w: 4, h: 4, kind: "char", owner: S.pid, status: [{ label: "HP", value: 10, max: 10 }, { label: "MP", value: 10, max: 10 }, { label: "SAN", value: 50, max: 99 }],
    params: [], commands: "", memo: "", active: true, order: Date.now(), showParams: false, showOther: false
  };
  try {
    $("pieceAdd").disabled = true;
    if ($("pieceFile").files[0]) { $("pieceMsg").textContent = "画像を圧縮中…"; c.icon = await uploadAsset($("pieceFile").files[0], 512); }
    const r = await push(rp("chars"), c);
    S.selChar = r.key;
    setSpeaker(r.key);
    renderCharList();
    renderCharDetail();
    $("pieceName").value = "";
    $("pieceFile").value = "";
    $("pieceMsg").textContent = "追加しました";
  } catch (err) {
    $("pieceMsg").textContent = "追加に失敗しました: " + err.message;
  } finally {
    $("pieceAdd").disabled = false;
  }
}

export async function fetchImage(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) throw new Error("画像ではありません");
    return await compressImage(await blob.arrayBuffer(), blob.type, 1024);
  } finally {
    clearTimeout(timer);
  }
}

export function newSetId() {
  const used = new Set(Object.values(S.mySets || {}).map((x) => x.id));
  for (let i = 0; i < 50; i++) {
    const id = randomId(3).replace(/[^a-z]/g, "x");
    if (!used.has(id)) return id;
  }
  return randomId(5);
}

export async function importImages(c, say) {
  const list = [];
  if (c.iconUrl) list.push({ label: "@通常", url: c.iconUrl });
  (c.faceUrls || []).forEach((f) => { if (!list.some((x) => x.label === f.label)) list.push(f); });
  if (!list.length) return {};
  const faces = [];
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    say(c.name + " の画像を取り込み中 " + (i + 1) + "/" + list.length);
    try {
      const data = await fetchImage(list[i].url);
      const r = await push(ref(S.db, "lib/" + S.pid + "/files"), { name: (c.name + "-" + list[i].label.slice(1)).slice(0, 80) + ".webp", data, t: serverTimestamp() });
      faces.push({ label: list[i].label, file: r.key });
    } catch {
      failed++;
    }
  }
  if (failed === 0) {
    const id = newSetId();
    const r = await push(ref(S.db, "lib/" + S.pid + "/sets"), { id, faces, order: Date.now() });
    S.mySets[r.key] = { id, faces };
    return { set: { pid: S.pid, sid: r.key }, saved: "マイ画像に保存（ID: " + id + "）" };
  }
  if (faces.length) {
    const up = {};
    faces.forEach((f) => { up["lib/" + S.pid + "/files/" + f.file] = null; });
    await update(ref(S.db), up);
  }
  return { saved: "画像は取り込めませんでした。マイ画像から差分セットを作って設定してください" };
}

export async function importChars(text, say) {
  const msg = $("charImportMsg");
  const tell = say || ((t) => { msg.textContent = t; });
  if (!text.trim()) { tell("貼り付けるか、ファイルを選んでください"); return false; }
  let list;
  try { list = parseCharJson(text); }
  catch { tell("読み込めませんでした（JSONの形ではないようです）"); return false; }
  if (!list.length) { tell("キャラのデータが見つかりませんでした"); return false; }
  let last = "";
  const notes = [];
  for (let i = 0; i < list.length; i++) {
    const { iconUrl, faceUrls, ...base } = list[i];
    const img = await importImages(list[i], tell);
    if (img.saved) notes.push(img.saved);
    const c = {
      ...base, ...centerPos(base.w, base.h, i), z: CHAR_Z, kind: "char",
      active: true, showParams: false, showOther: false, owner: S.pid, order: Date.now() + i
    };
    if (img.set) c.set = img.set;
    last = (await push(rp("chars"), c)).key;
  }
  S.selChar = last;
  setSpeaker(last);
  renderCharList();
  renderCharDetail();
  $("charJson").value = "";
  tell(list.map((c) => c.name).join("、") + " を盤面の中央に取り込みました" + (notes.length ? "。" + [...new Set(notes)].join("。") : ""));
  return true;
}

export function initPaste() {
  document.addEventListener("paste", (e) => {
    const t = e.target;
    if (t && (t.closest("input, textarea, select, [contenteditable]"))) return;
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const types = [...cd.types];
    const texts = [];
    types.filter((ty) => ty !== "Files").forEach((ty) => {
      const t = cd.getData(ty) || "";
      texts.push(t);
      if (/html/.test(ty)) texts.push(new DOMParser().parseFromString(t, "text/html").documentElement.textContent || "");
    });
    const json = texts.map((t) => t.match(/[\[{][\s\S]*[\]}]/)).find((m) => m && /"(name|data|status|commands)"/.test(m[0]));
    if (!json) {
      const head = (cd.getData("text/plain") || "").slice(0, 30);
      setStatus("駒のデータが見つかりませんでした（形式: " + (types.join(", ") || "なし") + (head ? "／中身: " + head : "") + "）", true);
      return;
    }
    importChars(json[0], (m) => setStatus(m)).catch((err) => setStatus("取り込みに失敗しました: " + err.message, true));
  });
}

export function renderCharList() {
  const list = $("charList");
  list.replaceChildren();
  sorted(S.chars, "order").filter(([, c]) => visibleChar(c)).forEach(([id, c]) => {
    const li = el("li", id === S.selChar ? "current" : "");
    const th = el("img", "thumb round");
    th.alt = "";
    th.dataset.asset = charIcon(c);
    th.src = src(th.dataset.asset);
    const who = c.owner === S.pid ? "（自分）" : S.isKP ? "（" + (playerName(c.owner) || "持ち主なし") + "）" : "";
    const tags = (isStand(c) ? "（立ち絵）" : "") + who + (c.kpOnly ? "（KPのみ）" : "") + (c.locked ? "（固定）" : "");
    const name = el("span", "", (c.name || "（名前なし）") + tags);
    const off = c.active === false;
    li.classList.toggle("off", off);
    li.append(th, name);
    if (canEdit(c)) {
      const tg = el("button", "mini" + (off ? " primary" : ""), off ? "戻す" : "下げる");
      tg.type = "button";
      tg.title = off ? "盤面に戻す" : "盤面から下げる";
      tg.addEventListener("click", (e) => { e.stopPropagation(); update(rp("chars/" + id), { active: off }); });
      li.append(tg);
    }
    li.addEventListener("click", () => { S.selChar = id; renderCharList(); renderCharDetail(); });
    list.append(li);
  });
}

export function renderCharDetail() {
  const c = visibleChar(S.chars[S.selChar]) ? S.chars[S.selChar] : null;
  $("charDetail").hidden = !c;
  if (!c) return;
  const stand = isStand(c);
  const seeP = canSeeParams(c);
  const seeO = canSeeOther(c);
  const edit = canEdit(c);
  document.querySelectorAll("#charDetail input, #charDetail select, #charDetail textarea, #charDetail .st button, #cdAddStatus, #cdAddParam").forEach((n) => {
    if (!n.closest(".dup")) n.disabled = !edit;
  });
  $("cdDelete").hidden = !edit;
  $("cdReadonly").hidden = edit;
  document.querySelectorAll("#charDetail .char-only").forEach((n) => { n.hidden = stand; });
  document.querySelectorAll("#charDetail .kp-only-ui").forEach((n) => { n.hidden = !S.isKP; });
  $("cdShowParams").closest("label").hidden = stand || !S.isKP;
  $("cdShowOther").closest("label").hidden = stand || !S.isKP;
  $("cdStatusBox").hidden = stand || !seeO;
  $("cdParamBox").hidden = stand || !seeP;
  $("cdCmdField").hidden = stand || !seeO;
  $("cdFaceBox").hidden = !seeO;
  const hid = [!stand && !seeP ? "パラメータ" : "", !seeO ? (stand ? "差分" : "ステータス・チャパレ・差分") : ""].filter(Boolean);
  $("cdHiddenNote").hidden = !hid.length;
  $("cdHiddenNote").textContent = "この駒の" + hid.join("と") + "は隠されています";
  const parent = stand && c.parent ? S.chars[c.parent] : null;
  $("cdParent").hidden = !stand;
  $("cdSpeak").hidden = stand || !edit;
  $("cdParent").textContent = parent ? "「" + (parent.name || "") + "」の発言で表情が切り替わります" : "元のキャラ駒が見つかりません（表情は切り替わりません）";
  $("cdLock").checked = !!c.locked;
  const os = $("cdOwner");
  if (document.activeElement !== os) {
    os.replaceChildren();
    const none = el("option", "", "なし（KP管理）");
    none.value = "";
    os.append(none);
    Object.entries(S.players).sort((a, b) => (a[1].t || 0) - (b[1].t || 0)).forEach(([pid, p]) => {
      const o = el("option", "", (p.name || "?") + (pid === S.pid ? "（自分）" : ""));
      o.value = pid;
      os.append(o);
    });
    if (c.owner && !S.players[c.owner]) {
      const o = el("option", "", "一覧にいない人");
      o.value = c.owner;
      os.append(o);
    }
    os.value = c.owner || "";
  }
  if (document.activeElement !== $("cdLayer")) $("cdLayer").value = Number.isFinite(+c.z) ? Math.round(+c.z) : CHAR_Z;
  $("cdKpOnly").checked = !!c.kpOnly;
  const keep = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  keep("cdName", c.name || "");
  keep("cdColor", c.color || "#888888");
  keep("cdMemo", c.memo || "");
  keep("cdCommands", c.commands || "");
  $("cdActive").checked = c.active !== false;
  if (document.activeElement !== $("cdSize")) $("cdSize").value = c.w || 1;
  const setSel = $("cdSet");
  setSel.replaceChildren();
  const none = el("option", "", "なし（駒に直接入れた画像）");
  none.value = "";
  setSel.append(none);
  Object.entries(S.mySets || {}).sort((a, b) => (a[1].order || 0) - (b[1].order || 0)).forEach(([k, st]) => {
    const o = el("option", "", st.id + "（" + (st.faces || []).length + "枚）");
    o.value = k;
    setSel.append(o);
  });
  if (c.set && c.set.pid !== S.pid) {
    const o = el("option", "", "ほかの人のセット");
    o.value = "__keep";
    setSel.append(o);
    setSel.value = "__keep";
  } else {
    setSel.value = c.set ? c.set.sid : "";
  }
  $("cdShowParams").checked = showsParams(c);
  $("cdShowOther").checked = showsOther(c);

  const faces = $("cdFaces");
  faces.replaceChildren();
  const faceOwner = parent ? c.parent : S.selChar;
  const curFace = parent ? parent.face : c.face;
  faceList(c).forEach((fc) => {
    const b = el("button", "face-btn" + (fc.label && fc.label === curFace ? " on" : ""));
    b.type = "button";
    b.title = (fc.label || "") + "（クリックでこの表情にする）";
    const im = el("img");
    im.alt = "";
    im.dataset.asset = fc.key || "";
    im.src = src(fc.key);
    b.append(im, el("span", "", fc.label || "-"));
    b.disabled = !canEdit(S.chars[faceOwner]);
    b.addEventListener("click", () => update(rp("chars/" + faceOwner), { face: fc.label || null }));
    faces.append(b);
  });

  const rows = (tbodyId, arr, key, withMax) => {
    const tb = $(tbodyId);
    tb.replaceChildren();
    (arr || []).forEach((s, i) => {
      const tr = el("tr");
      tr.append(el("th", "", s.label));
      const vIn = el("input");
      vIn.value = s.value;
      vIn.inputMode = withMax ? "numeric" : "text";
      vIn.addEventListener("change", () => {
        const next = (S.chars[S.selChar][key] || []).map((x) => ({ ...x }));
        next[i].value = withMax ? (parseInt(vIn.value, 10) || 0) : vIn.value;
        update(rp("chars/" + S.selChar), { [key]: next });
      });
      const td = el("td");
      td.append(vIn);
      tr.append(td);
      if (withMax) {
        const mIn = el("input");
        mIn.value = s.max;
        mIn.inputMode = "numeric";
        mIn.addEventListener("change", () => {
          const next = (S.chars[S.selChar][key] || []).map((x) => ({ ...x }));
          next[i].max = parseInt(mIn.value, 10) || 0;
          update(rp("chars/" + S.selChar), { [key]: next });
        });
        const td2 = el("td");
        td2.append(mIn);
        tr.append(td2);
      }
      const del = el("button", "del", "×");
      del.type = "button";
      del.addEventListener("click", () => {
        const next = (S.chars[S.selChar][key] || []).filter((_, j) => j !== i);
        update(rp("chars/" + S.selChar), { [key]: next });
      });
      const td3 = el("td");
      td3.append(del);
      tr.append(td3);
      tb.append(tr);
    });
  };
  rows("cdStatus", c.status, "status", true);
  rows("cdParams", c.params, "params", false);
}
