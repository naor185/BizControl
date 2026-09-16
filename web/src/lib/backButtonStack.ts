"use client";

import { useEffect } from "react";

// A tiny LIFO stack any open modal/sheet/panel registers itself on via
// useBackButtonClose(). The app-wide Android hardware-back listener
// (BackButtonHandler.tsx) checks this stack first and, if anything's open,
// closes just the topmost one and stops there — instead of falling through
// to router.back() or exiting the app, which is what happened before: none
// of these overlays touch browser/URL history, so the hardware back button
// had nothing of theirs to "go back" through.
type CloseHandler = () => void;
const stack: CloseHandler[] = [];

export function consumeTopBackHandler(): boolean {
    const handler = stack[stack.length - 1];
    if (!handler) return false;
    handler();
    return true;
}

export function useBackButtonClose(isOpen: boolean, onClose: CloseHandler) {
    useEffect(() => {
        if (!isOpen) return;
        stack.push(onClose);
        return () => {
            const i = stack.lastIndexOf(onClose);
            if (i !== -1) stack.splice(i, 1);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);
}
