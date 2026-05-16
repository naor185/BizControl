"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Lead = {
    id: string;
    studio_id: string;
    studio_name: string;
    studio_slug: string;
    name: string;
    phone: string | null;
    email: string | null;
    source: string;
    status: string;
    service_interest: string | null;
    notes: string | null;
    campaign_name: string | null;
    created_at: string;
    updated_at: string;
};

const SOURCE_ICONS: Record<string, string> = {
    whatsapp: "💬",
    instagram: "📸",
    facebook: "📘",
    tiktok: "🎵",
    google: "🔍",
    manual: "✍️",
};

const STATUS_COLORS: Record<string, string> = {
    new: "bg-blue-100 text-blue-700",
    contacted: "bg-yellow-100 text-yellow-700",
    converted: "bg-emerald-100 text-emerald-700",
    lost: "bg-slate-100 text-slate-500",
};

const STATUSES = ["new", "contacted", "converted", "lost"];
const STATUS_LABELS: Record<string, string> = { new: "חדש", contacted: "נצור קשר", converted: "הפך ללקוח", lost: "אבוד" };

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["bg-purple-400", "bg-blue-400", "bg-pink-400", "bg-amber-400", "bg-teal-400", "bg-rose-400"];
function avatarColor(name: string) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function timeAgo(iso: string) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "עכשיו";
    if (diff < 3600) return `לפני ${Math.floor(diff / 60)}ד'`;
    if (diff < 86400) return `לפני ${Math.floor(diff / 3600)}ש'`;
    return `לפני ${Math.floor(diff / 86400)} ימים`;
}

function DetailPanel({ lead, onClose, onUpdate }: { lead: Lead; onClose: () => void; onUpdate: (l: Lead) => void }) {
    const [note, setNote] = useState(lead.notes || "");
    const [saving, setSaving] = useState(false);

    const save = async (status?: string) => {
        setSaving(true);
        try {
            const body: Record<string, string> = {};
            if (status) body.status = status;
            else body.notes = note;
            await apiFetch(`/api/admin/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify(body) });
            onUpdate({ ...lead, ...(status ? { status } : { notes: note }) });
        } catch { /* ignore */ } finally { setSaving(false); }
    };

    return (
        <div className="flex flex-col h-full bg-white" dir="rtl">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm ${avatarColor(lead.name)}`}>
                    {initials(lead.name)}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 truncate">{lead.name}</p>
                    <p className="text-xs text-slate-500">{lead.studio_name} · {SOURCE_ICONS[lead.source] || "•"} {lead.source}</p>
                </div>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>

            {/* Info */}
            <div className="px-5 py-3 border-b border-slate-50 space-y-1">
                {lead.phone && <p className="text-sm text-slate-600 flex items-center gap-2"><span>📞</span> <span dir="ltr">{lead.phone}</span></p>}
                {lead.email && <p className="text-sm text-slate-600 flex items-center gap-2"><span>✉️</span> {lead.email}</p>}
                {lead.service_interest && <p className="text-sm text-slate-600 flex items-center gap-2"><span>🎯</span> {lead.service_interest}</p>}
                {lead.campaign_name && <p className="text-sm text-slate-600 flex items-center gap-2"><span>📢</span> {lead.campaign_name}</p>}
                <p className="text-xs text-slate-400">{timeAgo(lead.created_at)}</p>
            </div>

            {/* Status pills */}
            <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-slate-50">
                {STATUSES.map(s => (
                    <button key={s} onClick={() => save(s)} disabled={saving || lead.status === s}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${lead.status === s ? STATUS_COLORS[s] + " ring-2 ring-offset-1 ring-current" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                        {STATUS_LABELS[s]}
                    </button>
                ))}
            </div>

            {/* Notes */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
                {lead.notes && (
                    <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-700 whitespace-pre-wrap mb-3">{lead.notes}</div>
                )}
            </div>

            {/* Note input */}
            <div className="px-4 pb-4 pt-2 border-t border-slate-100">
                <div className="flex gap-2">
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="הוסף הערה..."
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                    <button onClick={() => save()} disabled={saving || !note.trim()}
                        className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 transition-all">
                        שמור
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function AdminLeadsPage() {
    const router = useRouter();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Lead | null>(null);
    const [search, setSearch] = useState("");
    const [filterSource, setFilterSource] = useState("");
    const [filterStatus, setFilterStatus] = useState("");
    const [filterStudio, setFilterStudio] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filterSource) params.set("source", filterSource);
            if (filterStatus) params.set("status", filterStatus);
            if (search) params.set("search", search);
            const data = await apiFetch<Lead[]>(`/api/admin/leads-inbox?${params}`);
            setLeads(data);
        } catch (e: unknown) {
            if ((e as { status?: number })?.status === 403) router.push("/admin");
        } finally { setLoading(false); }
    }, [filterSource, filterStatus, search, router]);

    useEffect(() => { load(); }, [load]);

    const studios = Array.from(new Set(leads.map(l => l.studio_name))).sort();

    const visible = filterStudio ? leads.filter(l => l.studio_name === filterStudio) : leads;

    const handleUpdate = (updated: Lead) => {
        setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
        setSelected(updated);
    };

    return (
        <div className="h-screen flex flex-col bg-slate-50" dir="rtl">
            {/* Top bar */}
            <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-wrap">
                <button onClick={() => router.push("/admin")} className="text-slate-500 hover:text-slate-800 text-sm font-medium flex items-center gap-1">
                    ← ניהול
                </button>
                <h1 className="text-lg font-bold text-slate-800 flex-1">📥 לידים — כל הסטודיואים</h1>
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">{visible.length} לידים</span>
            </div>

            {/* Filters */}
            <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-2 flex-wrap">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש שם / טלפון..."
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-400 w-44" />
                <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none">
                    <option value="">כל המקורות</option>
                    {Object.keys(SOURCE_ICONS).map(s => <option key={s} value={s}>{SOURCE_ICONS[s]} {s}</option>)}
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none">
                    <option value="">כל הסטטוסים</option>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
                <select value={filterStudio} onChange={e => setFilterStudio(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none">
                    <option value="">כל הסטודיואים</option>
                    {studios.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
                {/* Lead list */}
                <div className={`flex flex-col overflow-y-auto border-r border-slate-200 bg-white ${selected ? "w-96 hidden md:flex" : "flex-1"}`}>
                    {loading ? (
                        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" /></div>
                    ) : visible.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <div className="text-4xl mb-3">📭</div>
                            <p>אין לידים להצגה</p>
                        </div>
                    ) : (
                        visible.map(lead => (
                            <button key={lead.id} onClick={() => setSelected(lead)}
                                className={`w-full text-right px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-center gap-3 ${selected?.id === lead.id ? "bg-blue-50" : ""}`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${avatarColor(lead.name)}`}>
                                    {initials(lead.name)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-semibold text-slate-800 text-sm truncate">{lead.name}</p>
                                        <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(lead.created_at)}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium truncate max-w-[90px]">{lead.studio_name}</span>
                                        <span className="text-xs text-slate-400">{SOURCE_ICONS[lead.source] || "•"}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_COLORS[lead.status] || "bg-slate-100 text-slate-500"}`}>{STATUS_LABELS[lead.status] || lead.status}</span>
                                    </div>
                                    {lead.phone && <p className="text-xs text-slate-400 mt-0.5 truncate" dir="ltr">{lead.phone}</p>}
                                </div>
                            </button>
                        ))
                    )}
                </div>

                {/* Detail panel */}
                {selected && (
                    <div className="flex-1 overflow-hidden flex flex-col">
                        <DetailPanel lead={selected} onClose={() => setSelected(null)} onUpdate={handleUpdate} />
                    </div>
                )}

                {/* Empty state when nothing selected */}
                {!selected && !loading && visible.length > 0 && (
                    <div className="hidden md:flex flex-1 items-center justify-center text-slate-300 flex-col gap-3">
                        <div className="text-5xl">👈</div>
                        <p className="text-sm">בחר ליד לצפייה</p>
                    </div>
                )}
            </div>
        </div>
    );
}
