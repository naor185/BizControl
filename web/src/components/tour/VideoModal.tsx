"use client";

// A guide video — a short screen recording of one step (web/public/guide, made from the real screens), in a window
// over the page: plays at once (it has no sound), inline on a phone, closes with X, Esc or the phone's back.
import { useEffect } from "react";
import { X } from "lucide-react";
import { useBackButtonClose } from "@/lib/backButtonStack";

import { tx } from "@/lib/i18n";
export default function VideoModal({ src, poster, title, onClose }: { src: string; poster?: string; title: string; onClose: () => void }) {
    useBackButtonClose(true, onClose);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-[1200] bg-black/75 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-label={tx("סרטון: {0}", { 0: title })}>
            <div className="relative w-full max-w-[360px]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2 text-white">
                    <span className="text-sm font-bold">{title}</span>
                    <button type="button" onClick={onClose} aria-label={tx("סגירת הסרטון")}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
                        <X className="w-5 h-5" aria-hidden />
                    </button>
                </div>
                <video src={src} poster={poster} controls autoPlay muted playsInline preload="auto"
                    className="w-full max-h-[80dvh] rounded-2xl bg-black shadow-2xl" />
            </div>
        </div>
    );
}
