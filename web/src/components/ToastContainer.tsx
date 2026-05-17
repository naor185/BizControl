"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type Notif = {
    id: string;
    type: string;
    title: string;
    body: string;
    is_read: boolean;
    action_url?: string | null;
    created_at: string;
};

const TYPE_CONFIG: Record<string, { icon: string; borderColor: string; bg: string; titleColor: string }> = {
    new_member:  { icon: "👤", borderColor: "border-green-300",  bg: "bg-green-50",  titleColor: "text-green-800" },
    new_lead:    { icon: "🎯", borderColor: "border-orange-300", bg: "bg-orange-50", titleColor: "text-orange-800" },
    new_message: { icon: "💬", borderColor: "border-blue-300",   bg: "bg-blue-50",   titleColor: "text-blue-800" },
    system:      { icon: "🔔", borderColor: "border-slate-300",  bg: "bg-slate-50",  titleColor: "text-slate-800" },
};

const STORAGE_KEY = "biz_seen_notif_ids";
const TOAST_TTL_MS = 6000;

function loadSeen(): Set<string> {
    try {
        return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as string[]);
    } catch {
        return new Set();
    }
}

function saveSeen(seen: Set<string>) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen].slice(-200)));
    } catch {}
}

function ToastItem({
    notif,
    onDismiss,
}: {
    notif: Notif;
    onDismiss: () => void;
}) {
    const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG.system;

    useEffect(() => {
        const t = setTimeout(onDismiss, TOAST_TTL_MS);
        return () => clearTimeout(t);
    }, []);

    return (
        <div
            className={`animate-toast-in relative flex gap-3 items-start px-4 py-3 rounded-2xl border shadow-xl ${cfg.bg} ${cfg.borderColor} cursor-pointer max-w-xs w-full`}
            dir="rtl"
            onClick={() => {
                if (notif.action_url) window.location.href = notif.action_url;
                onDismiss();
            }}
        >
            <span className="text-2xl flex-shrink-0 mt-0.5">{cfg.icon}</span>
            <div className="flex-1 min-w-0">
                <div className={`font-bold text-sm leading-tight ${cfg.titleColor}`}>{notif.title}</div>
                {notif.body && (
                    <div className="text-xs text-slate-600 mt-0.5 line-clamp-2 leading-snug">{notif.body}</div>
                )}
            </div>
            <button
                onClick={e => { e.stopPropagation(); onDismiss(); }}
                className="text-slate-400 hover:text-slate-600 text-xs flex-shrink-0 mt-0.5 leading-none"
            >
                ✕
            </button>
        </div>
    );
}

export default function ToastContainer() {
    const [toasts, setToasts] = useState<Notif[]>([]);
    const seenRef = useRef<Set<string>>(new Set());
    const initializedRef = useRef(false);

    useEffect(() => {
        seenRef.current = loadSeen();
        initializedRef.current = true;
    }, []);

    useEffect(() => {
        async function poll() {
            if (!initializedRef.current) return;
            try {
                const data = await apiFetch<Notif[]>("/api/notifications?limit=20");
                const fresh = data.filter(n => !n.is_read && !seenRef.current.has(n.id));
                if (fresh.length > 0) {
                    fresh.forEach(n => seenRef.current.add(n.id));
                    saveSeen(seenRef.current);
                    setToasts(prev => [...prev, ...fresh].slice(-5));
                }
            } catch {}
        }

        // first poll after a short delay so localStorage can initialize
        const init = setTimeout(poll, 800);
        const interval = setInterval(poll, 30_000);
        return () => { clearTimeout(init); clearInterval(interval); };
    }, []);

    function dismiss(id: string) {
        setToasts(prev => prev.filter(n => n.id !== id));
    }

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-20 left-4 z-[200] flex flex-col-reverse gap-2 md:bottom-4">
            {toasts.map(n => (
                <ToastItem key={n.id} notif={n} onDismiss={() => dismiss(n.id)} />
            ))}
        </div>
    );
}
