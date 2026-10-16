// A link to a part of a screen — "/dashboard#leads", "/dashboard#viki" (ויקי's buttons, her notices). Already on that
// screen: open that part and scroll to it (the screen listens for SECTION_EVENT); from another screen the link goes
// there and the screen does it when it opens (app/dashboard). The owner, 2026-10-16: "ללידים" didn't open the leads.
import type { MouseEvent } from "react";

export const SECTION_EVENT = "app-section";

export function followSection(e: MouseEvent, href: string, pathname: string | null): void {
    const [path, hash] = href.split("#");
    if (!hash || path !== pathname) return;          // another screen — the link takes you there
    e.preventDefault();
    try { history.replaceState(null, "", href); } catch { /* fine */ }
    window.dispatchEvent(new CustomEvent(SECTION_EVENT, { detail: hash }));
}
