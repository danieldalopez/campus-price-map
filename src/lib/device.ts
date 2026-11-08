// This phone's random id (docs/SPEC.md section 8). Created on first use and kept in localStorage, so votes and
// reports from one phone can be told apart from another's. It's never tied to a name or an email.
// If storage is blocked (private mode), the id lasts until the page is closed.

/** Same shape as the database check on every device_id column: lowercase UUID text. */
export const DEVICE_ID_PATTERN = /^[0-9a-f-]{36}$/;

const KEY = "cpm.device_id";
let memo: string | null = null;

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context; plain http on a LAN address doesn't have one.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Browser only. The same id every call on this phone, until its storage is cleared. */
export function getDeviceId(): string {
  if (memo) return memo;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && DEVICE_ID_PATTERN.test(saved)) return (memo = saved);
  } catch {
    // Storage blocked: fall through to an id for this page only.
  }
  const id = newId().toLowerCase();
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Not saved; still usable for this visit.
  }
  return (memo = id);
}
