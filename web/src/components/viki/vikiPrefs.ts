// What this device remembers about ויקי's popping in (the owner, 2026-10-16: "from לוח בקרה you can let her come"): on or
// off, what she already said, when she last came. Per device — a convenience; nothing breaks without it.
const ON_KEY = "viki_popups";
const SEEN_KEY = "viki_seen";
const LAST_KEY = "viki_last_pop";
export const PREFS_EVENT = "viki-popups";

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* fine */ } };

export const popupsOn = () => read(ON_KEY) !== "0";
export function setPopupsOn(on: boolean) {
    write(ON_KEY, on ? "1" : "0");
    try { window.dispatchEvent(new Event(PREFS_EVENT)); } catch { /* fine */ }
}

export function seen(): Set<string> {
    try { return new Set(JSON.parse(read(SEEN_KEY) || "[]") as string[]); } catch { return new Set(); }
}
export function markSeen(key: string) {
    const all = [...seen().add(key)].slice(-300);
    write(SEEN_KEY, JSON.stringify(all));
}

export const lastPop = () => Number(read(LAST_KEY) || 0);

// Whether ויקי speaks on this screen: "on" once she looked and may (she announces a new lead and a deposit report
// herself — the bell's toast then leaves those two to her, components/ToastContainer), "off" when she doesn't; unset
// while she hasn't looked yet.
export const VIKI_TELLS = ["new_lead", "deposit_reported"];
export function setSpeaking(on: boolean) {
    try { document.documentElement.dataset.viki = on ? "on" : "off"; } catch { /* fine */ }
}
export function speaking(): "on" | "off" | null {
    try { const v = document.documentElement.dataset.viki; return v === "on" || v === "off" ? v : null; } catch { return "off"; }
}
export const markPopped = () => write(LAST_KEY, String(Date.now()));
