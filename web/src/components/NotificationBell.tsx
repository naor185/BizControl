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

const TYPE_ICON: Record<string, string> = {
    new_member: "👤",
    upcoming_appointment: "📅",
    system: "🔔",
};

function timeAgo(dateStr: string): string {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return "עכשיו";
    if (diff < 3600) return `לפני ${Math.floor(diff / 60)} ד'`;
    if (diff < 86400) return `לפני ${Math.floor(diff / 3600)} ש'`;
    return `לפני ${Math.floor(diff / 86400)} ימים`;
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [notifs, setNotifs] = useState<Notif[]>([]);
    const [unread, setUnread] = useState(0);
    const ref = useRef<HTMLDivElement>(null);

    async function fetchCount() {
        try {
            const data = await apiFetch<{ count: number }>("/api/notifications/unread-count");
            setUnread(data.count);
        } catch {}
    }

    async function fetchAll() {
        try {
            const data = await apiFetch<Notif[]>("/api/notifications");
            setNotifs(data);
            setUnread(data.filter(n => !n.is_read).length);
        } catch {}
    }

    useEffect(() => {
        fetchCount();
        const interval = setInterval(fetchCount, 30_000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (open) fetchAll();
    }, [open]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    async function markRead(id: string) {
        await apiFetch(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
        setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
        setUnread(prev => Math.max(0, prev - 1));
    }

    async function markAll() {
        await apiFetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
        setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
        setUnread(0);
    }

    async function remove(id: string) {
        await apiFetch(`/api/notifications/${id}`, { method: "DELETE" }).catch(() => {});
        setNotifs(prev => prev.filter(n => n.id !== id));
    }

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(o => !o)}
                className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors"
                title="התראות"
            >
                <span className="text-xl">🔔</span>
                {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute left-0 top-11 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden" dir="rtl">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                        <span className="font-bold text-slate-800 text-sm">התראות</span>
                        {unread > 0 && (
                            <button onClick={markAll} className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
                                סמן הכל כנקרא
                            </button>
                        )}
                    </div>

                    {/* List */}
                    <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                        {notifs.length === 0 ? (
                            <div className="py-10 text-center text-slate-400 text-sm">אין התראות</div>
                        ) : notifs.map(n => (
                            <div
                                key={n.id}
                                className={`flex gap-3 px-4 py-3 transition-colors ${n.is_read ? "bg-white" : "bg-blue-50/60"}`}
                            >
                                <div className="text-xl flex-shrink-0 mt-0.5">{TYPE_ICON[n.type] || "🔔"}</div>
                                <div
                                    className="flex-1 min-w-0 cursor-pointer"
                                    onClick={() => {
                                        if (!n.is_read) markRead(n.id);
                                        if (n.action_url) window.location.href = n.action_url;
                                    }}
                                >
                                    <div className={`text-sm font-semibold text-slate-800 ${!n.is_read ? "font-bold" : ""}`}>{n.title}</div>
                                    {n.body && <div className="text-xs text-slate-500 mt-0.5 truncate">{n.body}</div>}
                                    <div className="text-[10px] text-slate-400 mt-1">{timeAgo(n.created_at)}</div>
                                </div>
                                <button
                                    onClick={() => remove(n.id)}
                                    className="text-slate-300 hover:text-slate-500 text-sm flex-shrink-0 transition-colors mt-0.5"
                                    title="מחק"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
