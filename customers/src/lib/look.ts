// BizFind's black-and-white look (BizControl's login: white text, see-through glass on a picture) — the shared button
// styles every page uses. The colors themselves are the --bf-* tokens in app/layout.tsx.
import type { CSSProperties } from "react";

// The one solid white button on a screen — the main action.
export const PRIMARY_BTN: CSSProperties = {
    display: "flex", alignItems: "center", gap: "0.45rem", background: "#fff", color: "#000", border: "none", textDecoration: "none",
    padding: "0.72rem 1.35rem", borderRadius: 14, fontWeight: 800, fontSize: "0.92rem", cursor: "pointer", boxShadow: "0 6px 22px rgba(255,255,255,.12)",
};

// Every other action — see-through glass.
export const GLASS_BTN: CSSProperties = {
    display: "flex", alignItems: "center", gap: "0.45rem", background: "var(--bf-glass)", border: "1px solid var(--bf-line)", color: "var(--bf-text)",
    textDecoration: "none", padding: "0.72rem 1.1rem", borderRadius: 14, fontWeight: 700, fontSize: "0.88rem", backdropFilter: "blur(10px)",
};

// A card or a panel.
export const GLASS_CARD: CSSProperties = {
    background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 20,
};

// A text field on black.
export const GLASS_INPUT: CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12,
    padding: "0.7rem 0.9rem", color: "#fff", fontSize: "0.92rem", outline: "none", boxSizing: "border-box", colorScheme: "dark",
};

// A dropdown's options — the browser draws the open list itself, so each option carries its colors.
export const OPTION_STYLE: CSSProperties = { background: "#111", color: "#fff" };
