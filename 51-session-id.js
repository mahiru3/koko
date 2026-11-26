import { ref, set } from "./51-session-fb.js?v=4k";

const CH = "abcdefghijkmnpqrstuvwxyz23456789";

export function rand(n, chars) {
  const c = chars || CH;
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (v) => c[v % c.length]).join("");
}

export function transferCode(p) {
  return p.pid + "-" + p.code;
}

function save(pid, code) {
  localStorage.setItem("s51-pid", pid);
  localStorage.setItem("s51-code", code);
}

export async function ensureProfile(db, uid) {
  let pid = localStorage.getItem("s51-pid");
  let code = localStorage.getItem("s51-code");
  if (pid && code) {
    try {
      await set(ref(db, "links/" + uid), { pid, code });
      return { pid, code };
    } catch {
      localStorage.removeItem("s51-pid");
      localStorage.removeItem("s51-code");
    }
  }
  pid = rand(12);
  code = rand(20);
  await set(ref(db, "profileCodes/" + pid), code);
  await set(ref(db, "links/" + uid), { pid, code });
  save(pid, code);
  return { pid, code };
}

export async function applyTransfer(db, uid, text) {
  const m = String(text).trim().toLowerCase().replace(/\s+/g, "").match(/^([a-z0-9]{8,24})-([a-z0-9]{16,64})$/);
  if (!m) throw new Error("コードの形が正しくありません");
  try {
    await set(ref(db, "links/" + uid), { pid: m[1], code: m[2] });
  } catch {
    throw new Error("コードが違うようです");
  }
  save(m[1], m[2]);
  return { pid: m[1], code: m[2] };
}
