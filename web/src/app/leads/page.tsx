"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Lead = {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    source: string;
    status: string;
    service_interest: string | null;
    notes: string | null;
    campaign_name: string | null;
    ad_id: string | null;
    created_at: string;
    updated_at: string;
};

const STATUSES = [
    { key: "new",        label: "חדש",       color: "bg-blue-500",   light: "bg-blue-50 text-blue-700",   ring: "ring-blue-300" },
    { key: "contacted",  label: "נוצר קשר",  color: "bg-purple-500", light: "bg-purple-50 text-purple-700", ring: "ring-purple-300" },
    { key: "interested", label: "מעוניין",   color: "bg-amber-500",  light: "bg-amber-50 text-amber-700",  ring: "ring-amber-300" },
    { key: "booked",     label: "קבע תור",   color: "bg-emerald-500",light: "bg-emerald-50 text-emerald-700", ring: "ring-emerald-300" },
    { key: "lost",       label: "אבד",       color: "bg-red-400",    light: "bg-red-50 text-red-600",     ring: "ring-red-200" },
];

const SOURCES = [
    { key: "manual",    label: "ידני",      icon: "✏️", color: "text-slate-500" },
    { key: "whatsapp",  label: "WhatsApp",  icon: "💬", color: "text-emerald-600" },
    { key: "instagram", label: "Instagram", icon: "📸", color: "text-pink-600" },
    { key: "facebook",  label: "Facebook",  icon: "👍", color: "text-blue-600" },
    { key: "tiktok",    label: "TikTok",    icon: "🎵", color: "text-slate-800" },
    { key: "google",    label: "Google",    icon: "🔍", color: "text-sky-600" },
];

const stOf  = (k: string) => STATUSES.find(s => s.key === k) ?? STATUSES[0];
const srcOf = (k: string) => SOURCES.find(s => s.key === k) ?? SOURCES[0];

function fmtTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return "אתמול";
    if (diffDays < 7) return d.toLocaleDateString("he-IL", { weekday: "short" });
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["bg-sky-500","bg-violet-500","bg-emerald-500","bg-rose-500","bg-amber-500","bg-indigo-500","bg-pink-500","bg-teal-500"];
function avatarColor(id: string) { return AVATAR_COLORS[id.charCodeAt(0) % AVATAR_COLORS.length]; }

const EMPTY_FORM = { name: "", phone: "", email: "", source: "manual", service_interest: "", notes: "", campaign_name: "" };

// ── Analytics helpers ──────────────────────────────────────────────────────────
function AnalyticsTab({ leads }: { leads: Lead[] }) {
    const bySource = useMemo(() => {
        const map: Record<string, { total: number; booked: number }> = {};
        leads.forEach(l => {
            if (!map[l.source]) map[l.source] = { total: 0, booked: 0 };
            map[l.source].total++;
            if (l.status === "booked") map[l.source].booked++;
        });
        return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
    }, [leads]);

    const byCampaign = useMemo(() => {
        const map: Record<string, { total: number; booked: number }> = {};
        leads.filter(l => l.campaign_name).forEach(l => {
            const k = l.campaign_name!;
            if (!map[k]) map[k] = { total: 0, booked: 0 };
            map[k].total++;
            if (l.status === "booked") map[k].booked++;
        });
        return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
    }, [leads]);

    const funnel = STATUSES.map(s => ({ ...s, count: leads.filter(l => l.status === s.key).length }));
    const maxFunnel = Math.max(...funnel.map(f => f.count), 1);
    const maxSource = Math.max(...bySource.map(s => s[1].total), 1);

    return (
        <div className="p-4 space-y-6 overflow-y-auto h-full" dir="rtl">

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: "סה״כ לידים", value: leads.length, icon: "🎯", color: "bg-sky-50 text-sky-700" },
                    { label: "קבעו תור", value: leads.filter(l => l.status === "booked").length, icon: "✅", color: "bg-emerald-50 text-emerald-700" },
                    { label: "המרה", value: leads.length ? Math.round(leads.filter(l => l.status === "booked").length / leads.length * 100) + "%" : "0%", icon: "📈", color: "bg-violet-50 text-violet-700" },
                    { label: "אבדו", value: leads.filter(l => l.status === "lost").length, icon: "❌", color: "bg-red-50 text-red-600" },
                ].map(c => (
                    <div key={c.label} className={`rounded-2xl p-4 ${c.color} flex flex-col gap-1`}>
                        <span className="text-2xl">{c.icon}</span>
                        <span className="text-2xl font-black">{c.value}</span>
                        <span className="text-xs font-semibold opacity-70">{c.label}</span>
                    </div>
                ))}
            </div>

            {/* Funnel */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h3 className="font-bold text-slate-800 mb-4">משפך המרה</h3>
                <div className="space-y-2.5">
                    {funnel.map(f => (
                        <div key={f.key} className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-slate-500 w-16 text-right">{f.label}</span>
                            <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                                <div
                                    className={`h-full rounded-full flex items-center px-2 transition-all duration-500 ${f.color}`}
                                    style={{ width: `${Math.max((f.count / maxFunnel) * 100, f.count > 0 ? 8 : 0)}%` }}
                                >
                                    {f.count > 0 && <span className="text-white text-[10px] font-bold">{f.count}</span>}
                                </div>
                            </div>
                            <span className="text-xs font-bold text-slate-600 w-6 text-left">{f.count}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* By source */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h3 className="font-bold text-slate-800 mb-4">לידים לפי מקור</h3>
                {bySource.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">אין נתונים</p>
                ) : (
                    <div className="space-y-3">
                        {bySource.map(([src, data]) => {
                            const s = srcOf(src);
                            const convPct = data.total > 0 ? Math.round(data.booked / data.total * 100) : 0;
                            return (
                                <div key={src}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-semibold text-slate-500">{s.icon} {s.label}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-emerald-600 font-semibold">{convPct}% המרה</span>
                                            <span className="text-xs font-bold text-slate-700">{data.total}</span>
                                        </div>
                                    </div>
                                    <div className="bg-slate-100 rounded-full h-3 overflow-hidden">
                                        <div
                                            className="h-full bg-sky-500 rounded-full transition-all duration-500"
                                            style={{ width: `${(data.total / maxSource) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* By campaign */}
            {byCampaign.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <h3 className="font-bold text-slate-800 mb-4">ביצועי קמפיינים 📣</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-slate-400 border-b border-slate-100">
                                    <th className="text-right pb-2 font-semibold">קמפיין</th>
                                    <th className="text-center pb-2 font-semibold">לידים</th>
                                    <th className="text-center pb-2 font-semibold">תורים</th>
                                    <th className="text-center pb-2 font-semibold">המרה</th>
                                </tr>
                            </thead>
                            <tbody>
                                {byCampaign.map(([name, data]) => (
                                    <tr key={name} className="border-b border-slate-50 hover:bg-slate-50">
                                        <td className="py-2 font-medium text-slate-800 max-w-[140px] truncate">{name}</td>
                                        <td className="py-2 text-center text-slate-600">{data.total}</td>
                                        <td className="py-2 text-center text-emerald-600 font-semibold">{data.booked}</td>
                                        <td className="py-2 text-center">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${data.total > 0 && data.booked / data.total >= 0.3 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                                {data.total > 0 ? Math.round(data.booked / data.total * 100) : 0}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function LeadsPage() {
    const router = useRouter();
    const [leads, setLeads]         = useState<Lead[]>([]);
    const [loading, setLoading]     = useState(true);
    const [selected, setSelected]   = useState<Lead | null>(null);
    const [tab, setTab]             = useState<"inbox" | "analytics">("inbox");
    const [search, setSearch]       = useState("");
    const [filterSrc, setFilterSrc] = useState("all");
    const [filterSt, setFilterSt]   = useState("all");
    const [modal, setModal]         = useState<{ mode: "create" | "edit"; lead?: Lead } | null>(null);
    const [form, setForm]           = useState({ ...EMPTY_FORM });
    const [saving, setSaving]       = useState(false);
    const [moving, setMoving]       = useState(false);
    const [converting, setConverting] = useState(false);
    const [noteText, setNoteText]   = useState("");
    const [addingNote, setAddingNote] = useState(false);
    const [showDetail, setShowDetail] = useState(false); // mobile toggle

    const load = useCallback(async () => {
        try {
            const data = await apiFetch<Lead[]>("/api/leads");
            setLeads(data.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
        } catch (e: any) {
            if (e?.message?.includes("401")) router.replace("/login");
        } finally { setLoading(false); }
    }, [router]);

    useEffect(() => { load(); }, [load]);

    const filtered = useMemo(() => leads.filter(l => {
        const matchSearch = !search || l.name.includes(search) || l.phone?.includes(search) || l.campaign_name?.includes(search);
        const matchSrc = filterSrc === "all" || l.source === filterSrc;
        const matchSt  = filterSt  === "all" || l.status === filterSt;
        return matchSearch && matchSrc && matchSt;
    }), [leads, search, filterSrc, filterSt]);

    const openCreate = () => { setForm({ ...EMPTY_FORM }); setModal({ mode: "create" }); };
    const openEdit = (lead: Lead) => {
        setForm({ name: lead.name, phone: lead.phone ?? "", email: lead.email ?? "", source: lead.source, service_interest: lead.service_interest ?? "", notes: lead.notes ?? "", campaign_name: lead.campaign_name ?? "" });
        setModal({ mode: "edit", lead });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const body = { name: form.name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, source: form.source, service_interest: form.service_interest.trim() || null, notes: form.notes.trim() || null, campaign_name: form.campaign_name.trim() || null };
            if (modal?.mode === "create") {
                const lead = await apiFetch<Lead>("/api/leads", { method: "POST", body: JSON.stringify(body) });
                setLeads(prev => [lead, ...prev]);
                setSelected(lead);
                setShowDetail(true);
            } else if (modal?.lead) {
                const updated = await apiFetch<Lead>(`/api/leads/${modal.lead.id}`, { method: "PATCH", body: JSON.stringify(body) });
                setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
                setSelected(updated);
            }
            setModal(null);
        } catch (e: any) { alert(e?.message || "שגיאה"); } finally { setSaving(false); }
    };

    const handleMove = async (status: string) => {
        if (!selected || selected.status === status) return;
        setMoving(true);
        try {
            const updated = await apiFetch<Lead>(`/api/leads/${selected.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
            setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
            setSelected(updated);
        } catch (e: any) { alert(e?.message); } finally { setMoving(false); }
    };

    const handleDelete = async () => {
        if (!selected) return;
        if (!confirm(`למחוק את ${selected.name}?`)) return;
        await apiFetch(`/api/leads/${selected.id}`, { method: "DELETE" });
        setLeads(prev => prev.filter(l => l.id !== selected.id));
        setSelected(null);
        setShowDetail(false);
    };

    const handleConvert = async () => {
        if (!selected) return;
        if (!confirm(`להמיר את ${selected.name} ללקוח?`)) return;
        setConverting(true);
        try {
            const res = await apiFetch<{ client_id: string; created: boolean }>(`/api/leads/${selected.id}/convert`, { method: "POST" });
            await load();
            setSelected(null);
            setShowDetail(false);
            alert(res.created ? "לקוח חדש נוצר!" : "קושר ללקוח קיים.");
        } catch (e: any) { alert(e?.message); } finally { setConverting(false); }
    };

    const handleAddNote = async () => {
        if (!selected || !noteText.trim()) return;
        setAddingNote(true);
        try {
            const newNotes = selected.notes ? `${selected.notes}\n\n${new Date().toLocaleDateString("he-IL")} — ${noteText.trim()}` : `${new Date().toLocaleDateString("he-IL")} — ${noteText.trim()}`;
            const updated = await apiFetch<Lead>(`/api/leads/${selected.id}`, { method: "PATCH", body: JSON.stringify({ notes: newNotes }) });
            setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
            setSelected(updated);
            setNoteText("");
        } catch (e: any) { alert(e?.message); } finally { setAddingNote(false); }
    };

    if (loading) return (
        <RequireAuth><AppShell title="לידים">
            <div className="flex items-center justify-center h-64 text-slate-400">טוען...</div>
        </AppShell></RequireAuth>
    );

    const DetailPanel = ({ lead }: { lead: Lead }) => {
        const st  = stOf(lead.status);
        const src = srcOf(lead.source);
        const noteLines = lead.notes ? lead.notes.split("\n\n").filter(Boolean) : [];
        return (
            <div className="flex flex-col h-full bg-[#f0f2f5]" dir="rtl">
                {/* Detail header */}
                <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 shadow-sm">
                    <button className="md:hidden text-slate-400 hover:text-slate-700 ml-1" onClick={() => setShowDetail(false)}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <div className={`w-10 h-10 rounded-full ${avatarColor(lead.id)} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
                        {initials(lead.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="font-bold text-slate-800 text-sm truncate">{lead.name}</h2>
                        <p className="text-xs text-slate-400">{src.icon} {src.label} · {lead.phone || lead.email || "—"}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${st.light}`}>{st.label}</span>
                </div>

                {/* Campaign + info bar */}
                {(lead.campaign_name || lead.service_interest) && (
                    <div className="bg-white border-b border-slate-100 px-4 py-2 flex flex-wrap gap-2">
                        {lead.campaign_name && <span className="text-[11px] bg-violet-50 text-violet-700 font-semibold px-2 py-0.5 rounded-full">📣 {lead.campaign_name}</span>}
                        {lead.service_interest && <span className="text-[11px] bg-sky-50 text-sky-700 font-semibold px-2 py-0.5 rounded-full">🎨 {lead.service_interest}</span>}
                    </div>
                )}

                {/* Notes / chat area */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                    {noteLines.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-2">
                            <span className="text-4xl">💬</span>
                            <span className="text-sm">אין הערות עדיין</span>
                        </div>
                    ) : noteLines.map((note, i) => (
                        <div key={i} className="flex justify-end">
                            <div className="bg-white rounded-2xl rounded-tr-sm shadow-sm px-4 py-2.5 max-w-[80%]">
                                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{note}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Status row */}
                <div className="bg-white border-t border-slate-100 px-3 py-2 flex gap-1.5 overflow-x-auto">
                    {STATUSES.map(s => (
                        <button
                            key={s.key}
                            onClick={() => handleMove(s.key)}
                            disabled={moving}
                            className={`flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full transition-all ${lead.status === s.key ? `${s.color} text-white shadow-sm` : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>

                {/* Contact buttons */}
                <div className="bg-white border-t border-slate-100 px-3 py-2 flex gap-2">
                    {lead.phone && (
                        <a href={`https://wa.me/972${lead.phone.replace(/^0/, "")}`} target="_blank" rel="noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-xl hover:bg-emerald-100 transition-colors">
                            💬 WhatsApp
                        </a>
                    )}
                    {lead.phone && (
                        <a href={`tel:${lead.phone}`}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-sky-50 text-sky-700 text-xs font-bold rounded-xl hover:bg-sky-100 transition-colors">
                            📞 שיחה
                        </a>
                    )}
                    <button onClick={() => openEdit(lead)} className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors">✏️</button>
                    <button onClick={handleConvert} disabled={converting} className="flex-1 py-2 bg-sky-600 text-white text-xs font-bold rounded-xl hover:bg-sky-700 transition-colors disabled:opacity-50">
                        {converting ? "..." : "✅ המר"}
                    </button>
                    <button onClick={handleDelete} className="px-3 py-2 bg-red-50 text-red-500 text-xs font-bold rounded-xl hover:bg-red-100 transition-colors">🗑</button>
                </div>

                {/* Note input */}
                <div className="bg-white border-t border-slate-100 px-3 py-2 flex gap-2 items-center">
                    <input
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleAddNote()}
                        placeholder="הוסף הערה..."
                        className="flex-1 bg-slate-100 rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-300 text-right"
                    />
                    <button
                        onClick={handleAddNote}
                        disabled={addingNote || !noteText.trim()}
                        className="w-9 h-9 bg-sky-600 rounded-full flex items-center justify-center text-white disabled:opacity-40 hover:bg-sky-700 transition-colors flex-shrink-0"
                    >
                        <svg className="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                    </button>
                </div>
            </div>
        );
    };

    return (
        <RequireAuth>
            <AppShell title="לידים CRM">
                <div className="flex flex-col h-[calc(100vh-64px)]" dir="rtl">

                    {/* Top tabs */}
                    <div className="bg-white border-b border-slate-100 flex items-center justify-between px-4 py-2 gap-3 flex-shrink-0">
                        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                            <button onClick={() => setTab("inbox")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === "inbox" ? "bg-white shadow-sm text-sky-600" : "text-slate-500 hover:text-slate-700"}`}>
                                📥 אינבוקס
                            </button>
                            <button onClick={() => setTab("analytics")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === "analytics" ? "bg-white shadow-sm text-sky-600" : "text-slate-500 hover:text-slate-700"}`}>
                                📊 אנליטיקס
                            </button>
                        </div>
                        <button onClick={openCreate} className="bg-sky-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-sky-700 transition-colors flex-shrink-0">
                            + ליד
                        </button>
                    </div>

                    {tab === "analytics" ? (
                        <div className="flex-1 overflow-y-auto">
                            <AnalyticsTab leads={leads} />
                        </div>
                    ) : (
                        <div className="flex flex-1 overflow-hidden">

                            {/* LEFT — lead list */}
                            <div className={`flex flex-col w-full md:w-80 lg:w-96 flex-shrink-0 border-l border-slate-100 bg-white ${showDetail ? "hidden md:flex" : "flex"}`}>
                                {/* Search + filters */}
                                <div className="p-3 space-y-2 border-b border-slate-100">
                                    <input
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder="חיפוש לידים..."
                                        className="w-full bg-slate-100 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-300 text-right"
                                    />
                                    <div className="flex gap-2 overflow-x-auto pb-0.5">
                                        <select value={filterSrc} onChange={e => setFilterSrc(e.target.value)} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none flex-shrink-0">
                                            <option value="all">כל המקורות</option>
                                            {SOURCES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
                                        </select>
                                        <select value={filterSt} onChange={e => setFilterSt(e.target.value)} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none flex-shrink-0">
                                            <option value="all">כל הסטטוסים</option>
                                            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* Lead list */}
                                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                                    {filtered.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-16 text-slate-300 gap-2">
                                            <span className="text-4xl">🎯</span>
                                            <span className="text-sm">אין לידים</span>
                                        </div>
                                    ) : filtered.map(lead => {
                                        const st  = stOf(lead.status);
                                        const src = srcOf(lead.source);
                                        const isSelected = selected?.id === lead.id;
                                        return (
                                            <div
                                                key={lead.id}
                                                onClick={() => { setSelected(lead); setShowDetail(true); }}
                                                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isSelected ? "bg-sky-50" : "hover:bg-slate-50"}`}
                                            >
                                                <div className={`w-11 h-11 rounded-full ${avatarColor(lead.id)} flex items-center justify-center text-white font-bold text-sm flex-shrink-0 relative`}>
                                                    {initials(lead.name)}
                                                    <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${st.color}`} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="font-semibold text-sm text-slate-800 truncate">{lead.name}</span>
                                                        <span className="text-[10px] text-slate-400 flex-shrink-0">{fmtTime(lead.updated_at)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <span className="text-xs">{src.icon}</span>
                                                        <span className="text-xs text-slate-400 truncate">{lead.campaign_name || lead.service_interest || lead.phone || "—"}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* RIGHT — detail panel */}
                            <div className={`flex-1 min-w-0 ${showDetail ? "flex" : "hidden md:flex"} flex-col`}>
                                {selected ? (
                                    <DetailPanel key={selected.id} lead={selected} />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-3">
                                        <span className="text-6xl">💬</span>
                                        <span className="text-sm font-medium">בחר ליד לצפייה</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Create / Edit modal */}
                {modal && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4" onClick={() => setModal(null)}>
                        <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-6 pb-8 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto sm:hidden" />
                            <h2 className="text-base font-bold text-slate-900">{modal.mode === "create" ? "ליד חדש" : "עריכת ליד"}</h2>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">שם *</label>
                                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="שם הליד" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-300" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-slate-500 block mb-1">טלפון</label>
                                        <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="05X-XXXXXXX" dir="ltr" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500 block mb-1">אימייל</label>
                                        <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@..." dir="ltr" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-slate-500 block mb-1">מקור</label>
                                        <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300">
                                            {SOURCES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500 block mb-1">שירות מבוקש</label>
                                        <input value={form.service_interest} onChange={e => setForm(f => ({ ...f, service_interest: e.target.value }))} placeholder="קעקוע, פירסינג..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-300" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">שם קמפיין / פרסום 📣</label>
                                    <input value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} placeholder="למשל: פוסט אינסטגרם מאי, ממומן פייסבוק..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-300" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">הערות</label>
                                    <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="מידע נוסף..." rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right resize-none focus:outline-none focus:ring-2 focus:ring-sky-300" />
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button onClick={() => setModal(null)} className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-colors">ביטול</button>
                                <button onClick={handleSave} disabled={saving || !form.name.trim()} className="flex-1 py-2.5 bg-sky-600 text-white text-sm font-semibold rounded-xl hover:bg-sky-700 transition-colors disabled:opacity-40">
                                    {saving ? "שומר..." : modal.mode === "create" ? "הוסף ליד" : "שמור"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
