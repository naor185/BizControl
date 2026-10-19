"use client";

import { useEffect } from "react";

// On a phone, a tap on a button while the keyboard is up first closes the keyboard — the screen moves under the finger
// and the tap is lost (the owner, 2026-10-19: "the screen jumped, the appointment was set only on the third try"). So on
// a touch screen a button doesn't take the focus from the field being typed in: the keyboard stays until the button's
// click ran, and closes right after it (unless the click moved the typing elsewhere).

const NOT_TYPING = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "color", "image"]);

function typingIn(): HTMLElement | null {
    const a = document.activeElement;
    if (a instanceof HTMLTextAreaElement) return a;
    if (a instanceof HTMLInputElement && !NOT_TYPING.has(a.type)) return a;
    return null;
}

const buttonOf = (t: EventTarget | null) => (t instanceof Element ? t.closest("button, [role=button]") : null);

export default function SteadyTaps() {
    useEffect(() => {
        if (!window.matchMedia("(hover: none)").matches) return;      // a computer's mouse — nothing moves
        const down = (e: MouseEvent) => {
            const field = typingIn();
            const btn = buttonOf(e.target);
            if (btn && field && !btn.contains(field)) e.preventDefault();
        };
        const click = (e: MouseEvent) => {
            const field = typingIn();
            if (buttonOf(e.target) && field) setTimeout(() => { if (document.activeElement === field) field.blur(); }, 0);
        };
        document.addEventListener("mousedown", down, true);
        document.addEventListener("click", click);
        return () => { document.removeEventListener("mousedown", down, true); document.removeEventListener("click", click); };
    }, []);
    return null;
}
