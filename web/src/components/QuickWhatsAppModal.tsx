"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type Client = {
    id: string;
    full_name: string;
    phone: string | null;
    is_walk_in?: boolean;
};

export default function QuickWhatsAppModal({ onClose }: { onClose: () => void }) {
    const [search, setSearch] = useState("");
    const [clients, setClients] = useState<Client[]>([]);
    const [selected, setSelected] = useState<Client | null>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [body, setBody] = useState("");
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        apiFetch<Client[]>("/api/clients").then(setClients).catch(() => {});
        setTimeout(() => searchRef.current?.focus(), 100);
    }, []);

    const filtered = clients
        .filter(c => !c.is_walk_in && c.phone)
        .filter(c => {
            const q = search.toLowerCase();
            return (
                c.full_name?.toLowerCase().includes(q) ||
                c.phone?.includes(q)
            );
        })
        .slice(0, 8);

    const handleSend = async () => {
        if (!selected || !body.trim()) return;
        setSending(true);
        setError(null);
        try {
            await apiFetch("/api/messages/quick-send", {
                method: "POST",
                body: JSON.stringify({ client_id: selected.id, body: body.trim() }),
            });
            setSent(true);
            setTimeout(onClose, 1800);
        } catch (e: any) {
            setError(e?.message || "שגיאה בשליחה");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900">שלח הודעת וואטסאפ</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
                </div>

                {sent ? (
                    <div className="text-center py-6 space-y-2">
                        <div className="text-4xl">✅</div>
                        <div className="font-semibold text-slate-800">ההודעה נשלחה בהצלחה!</div>
                        <div className="text-sm text-slate-500">{selected?.full_name} · {selected?.phone}</div>
                    </div>
                ) : (
                    <>
                        {/* Client search */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">לקוח</label>
                            {selected ? (
                                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-slate-800 text-sm">{selected.full_name}</div>
                                        <div className="text-xs text-slate-500" dir="ltr">{selected.phone}</div>
                                    </div>
                                    <button
                                        onClick={() => { setSelected(null); setSearch(""); setTimeout(() => searchRef.current?.focus(), 50); }}
                                        className="text-slate-400 hover:text-red-500 text-lg font-bold"
                                    >
                                        &times;
                                    </button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <input
                                        ref={searchRef}
                                        type="text"
                                        placeholder="חפש לפי שם או טלפון..."
                                        value={search}
                                        onChange={e => { setSearch(e.target.value); setDropdownOpen(true); }}
                                        onFocus={() => setDropdownOpen(true)}
                                        onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                    />
                                    {dropdownOpen && search.length > 0 && (
                                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                                            {filtered.length > 0 ? filtered.map(c => (
                                                <div
                                                    key={c.id}
                                                    onMouseDown={() => { setSelected(c); setSearch(""); setDropdownOpen(false); }}
                                                    className="px-4 py-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                                                >
                                                    <div className="font-semibold text-slate-800 text-sm">{c.full_name}</div>
                                                    <div className="text-xs text-slate-500" dir="ltr">{c.phone}</div>
                                                </div>
                                            )) : (
                                                <div className="px-4 py-3 text-sm text-slate-400 text-center">לא נמצאו לקוחות</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Message body */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">הודעה</label>
                            <textarea
                                rows={4}
                                placeholder="כתוב את ההודעה כאן..."
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                            />
                            <div className="text-xs text-slate-400 text-left mt-0.5">{body.length} תווים</div>
                        </div>

                        {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</div>}

                        {/* Actions */}
                        <div className="flex gap-3">
                            <button
                                onClick={handleSend}
                                disabled={!selected || !body.trim() || sending}
                                className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition disabled:opacity-40"
                            >
                                {sending ? "שולח..." : "שלח בוואטסאפ 📱"}
                            </button>
                            <button
                                onClick={onClose}
                                className="px-5 py-2.5 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                            >
                                סגור
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
