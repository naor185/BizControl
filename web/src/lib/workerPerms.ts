import { apiFetch, getCurrentUserRole } from "@/lib/api";

// What a worker (artist / staff) may do beyond their own calendar — the owner's switches, per worker
// (core/permissions.WORKER_PERMISSIONS; the owner, 2026-10-27: "and what about a regular worker?"). Remembered on this
// device from /api/auth/me so the menu and the screen guard know at once; the server checks every request anyway.

export type WorkerPerm = "all_calendars" | "payments" | "pos" | "clients";
type Perms = Record<WorkerPerm, boolean>;

const KEY = "bizcontrol_worker_perms";
const NONE: Perms = { all_calendars: false, payments: false, pos: false, clients: false };
export const WORKER_PERMS_EVENT = "worker-perms";

export const isWorker = (role: string | null = getCurrentUserRole()) => role === "artist" || role === "staff";

export function workerPerms(): Perms {
    try { return { ...NONE, ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Perms>) }; } catch { return NONE; }
}

export function rememberWorkerPerms(p: Partial<Perms> | null | undefined) {
    try {
        const next = JSON.stringify({ ...NONE, ...(p || {}) });
        if (localStorage.getItem(KEY) === next) return;
        localStorage.setItem(KEY, next);
        window.dispatchEvent(new Event(WORKER_PERMS_EVENT));
    } catch { /* fine — the server decides anyway */ }
}

/** Ask the server again (the owner may have changed them) — for a worker only. */
export async function refreshWorkerPerms(): Promise<Perms> {
    if (!isWorker()) return NONE;
    try {
        const me = await apiFetch<{ worker_permissions?: Partial<Perms> | null }>("/api/auth/me");
        rememberWorkerPerms(me.worker_permissions);
    } catch { /* offline — what was remembered */ }
    return workerPerms();
}

/** May the signed-in user do this? The management always; a worker — what the owner switched on. */
export function may(perm: WorkerPerm): boolean {
    return !isWorker() || workerPerms()[perm];
}

// the screens a worker reaches: their own (the calendar, health declarations, the clock, their shifts) and what's open
const BASE_PAGES = ["/calendar", "/health-declarations", "/clock/", "/my-shifts"];   // /clock/: the barcode or NFC sticker at the door
export function workerPages(): string[] {
    const p = workerPerms();
    return [...BASE_PAGES, ...(p.pos ? ["/pos"] : []), ...(p.clients ? ["/clients", "/leads"] : [])];
}
