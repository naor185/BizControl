"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
    created_at: string;
    updated_at: string;
};

const COLUMNS = [
    { key: "new",        label: "חדש",        color: "border-blue-400",   bg: "bg-blue-50",   dot: "bg-blue-400",   badge: "bg-blue-100 text-blue-700" },
    { key: "contacted",  label: "נוצר קשר",   color: "border-purple-400", bg: "bg-purple-50", dot: "bg-purple-400", badge: "bg-purple-100 text-purple-700" },
    { key: "interested", label: "מעוניין",    color: "border-amber-400",  bg: "bg-amber-50",  dot: "bg-amber-400",  badge: "bg-amber-100 text-amber-700" },
    { key: "booked",     label: "קבע תור",    color: "border-green-400",  bg: "bg-green-50",  dot: "bg-green-400",  badge: "bg-green-100 text-green-700" },
    { key: "lost",       label: "אבד",        color: "border-red-300",    bg: "bg-red-50",    dot: "bg-red-300",    badge: "bg-red-100 text-red-500" },
];

const SOURCES = [
    { key: "manual",    label: "ידני",      icon: "✏️" },
    { key: "whatsapp",  label: "WhatsApp",  icon: "💬" },
    { key: "instagram", label: "Instagram", icon: "📸" },
    { key: "facebook",  label: "Facebook",  icon: "👍" },
];

const colOf  = (key: string) => COLUMNS.find(c => c.key === key) ?? COLUMNS[0];
const srcOf  = (key: string) => SOURCES.find(s => s.key === key) ?? SOURCES[0];

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

const EMPTY_FORM = { name: "", phone: "", email: "", source: "manual", service_interest: "", notes: "" };

export default function LeadsPage() {
    const router = useRouter();
    const [leads, setLeads]           = useState<Lead[]>([]);
    const [loading, setLoading]       = useState(true);
    const [modal, setModal]           = useState<{ mode: "create" | "edit"; lead?: Lead } | null>(null);
    const [detailLead, setDetailLead] = useState<Lead | null>(null);
    const [form, setForm]             = useState({ ...EMPTY_FORM });
    const [saving, setSaving]         = useState(false);
    const [converting, setConverting] = useState(false);
    const [movingId, setMovingId]     = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await apiFetch<Lead[]>("/api/leads");
            setLeads(data);
        } catch (e: any) {
            if (e?.message?.includes("401") || e?.message?.includes("403")) router.replace("/login");
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => { setForm({ ...EMPTY_FORM }); setModal({ mode: "create" }); };
    const openEdit   = (lead: Lead) => {
        setForm({
            name: lead.name,
            phone: lead.phone ?? "",
            email: lead.email ?? "",
            source: lead.source,
            service_interest: lead.service_interest ?? "",
            notes: lead.notes ?? "",
        });
        setModal({ mode: "edit", lead });
        setDetailLead(null);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const body = {
                name: form.name.trim(),
                phone: form.phone.trim() || null,
                email: form.email.trim() || null,
                source: form.source,
                service_interest: form.service_interest.trim() || null,
                notes: form.notes.trim() || null,
            };
            if (modal?.mode === "create") {
                const lead = await apiFetch<Lead>("/api/leads", { method: "POST", body: JSON.stringify(body) });
                setLeads(prev => [lead, ...prev]);
            } else if (modal?.lead) {
                const updated = await apiFetch<Lead>(`/api/leads/${modal.lead.id}`, { method: "PATCH", body: JSON.stringify(body) });
                setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
            }
            setModal(null);
        } catch (e: any) {
            alert(e?.message || "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    const handleMove = async (lead: Lead, status: string) => {
        if (lead.status === status) return;
        setMovingId(lead.id);
        try {
            const updated = await apiFetch<Lead>(`/api/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
            setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
            if (detailLead?.id === lead.id) setDetailLead(updated);
        } catch (e: any) {
            alert(e?.message);
        } finally {
            setMovingId(null);
        }
    };

    const handleDelete = async (lead: Lead) => {
        if (!confirm(`למחוק את ${lead.name}?`)) return;
        await apiFetch(`/api/leads/${lead.id}`, { method: "DELETE" });
        setLeads(prev => prev.filter(l => l.id !== lead.id));
        setDetailLead(null);
    };

    const handleConvert = async (lead: Lead) => {
        if (!confirm(`להמיר את ${lead.name} ללקוח?`)) return;
        setConverting(true);
        try {
            const res = await apiFetch<{ client_id: string; created: boolean }>(`/api/leads/${lead.id}/convert`, { method: "POST" });
            await load();
            setDetailLead(null);
            alert(res.created ? "לקוח חדש נוצר בהצלחה!" : "הליד קושר ללקוח קיים.");
        } catch (e: any) {
            alert(e?.message);
        } finally {
            setConverting(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm" dir="rtl">טוען...</div>
    );

    return (
        <div dir="rtl" className="min-h-screen bg-gray-50 flex flex-col">

            {/* Header */}
            <div className="bg-white border-b border-gray-100 sticky top-0 z-10 flex-shrink-0">
                <div className="px-4 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold text-gray-900">לידים CRM</h1>
                        <p className="text-xs text-gray-400">{leads.length} לידים · {COLUMNS.map(c => leads.filter(l => l.status === c.key).length + " " + c.label).join(" · ")}</p>
                    </div>
                    <button
                        onClick={openCreate}
                        className="bg-black text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-gray-800 transition-colors"
                    >
                        + ליד חדש
                    </button>
                </div>
            </div>

            {/* Kanban board — horizontal scroll */}
            <div className="flex-1 overflow-x-auto">
                <div className="flex gap-3 p-4 h-full" style={{ minWidth: `${COLUMNS.length * 280}px` }}>
                    {COLUMNS.map(col => {
                        const colLeads = leads.filter(l => l.status === col.key);
                        return (
                            <div key={col.key} className="flex flex-col w-64 flex-shrink-0">
                                {/* Column header */}
                                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-t-2xl border-t-2 ${col.color} bg-white shadow-sm mb-0.5`}>
                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${col.dot}`} />
                                    <span className="text-sm font-bold text-gray-800 flex-1">{col.label}</span>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${col.badge}`}>{colLeads.length}</span>
                                </div>

                                {/* Cards */}
                                <div className="flex-1 space-y-2 overflow-y-auto pb-4 max-h-[calc(100vh-160px)]">
                                    {colLeads.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-10 text-gray-300 text-xs gap-1">
                                            <span className="text-2xl">🎯</span>
                                            <span>אין לידים</span>
                                        </div>
                                    ) : colLeads.map(lead => {
                                        const src = srcOf(lead.source);
                                        return (
                                            <div
                                                key={lead.id}
                                                onClick={() => setDetailLead(lead)}
                                                className="bg-white rounded-2xl border border-gray-100 p-3 cursor-pointer hover:border-gray-300 hover:shadow-md active:scale-[0.98] transition-all shadow-sm"
                                            >
                                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                                    <span className="font-semibold text-sm text-gray-900 leading-tight">{lead.name}</span>
                                                    <span className="text-base flex-shrink-0 mt-0.5">{src.icon}</span>
                                                </div>
                                                {lead.phone && (
                                                    <p className="text-xs text-gray-400 mb-1" dir="ltr">{lead.phone}</p>
                                                )}
                                                {lead.service_interest && (
                                                    <p className="text-xs text-gray-500 truncate">{lead.service_interest}</p>
                                                )}
                                                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                                                    <span className="text-[10px] text-gray-300">{fmtDate(lead.created_at)}</span>
                                                    {movingId === lead.id && (
                                                        <span className="text-[10px] text-gray-400">מעביר...</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Detail sheet */}
            {detailLead && (() => {
                const lead = detailLead;
                const col  = colOf(lead.status);
                const src  = srcOf(lead.source);
                return (
                    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setDetailLead(null)}>
                        <div
                            className="bg-white rounded-t-3xl w-full max-w-lg p-6 pb-8 space-y-4"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto -mt-2 mb-2" />

                            {/* Header */}
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">{lead.name}</h2>
                                    <p className="text-sm text-gray-400">{src.icon} {src.label}</p>
                                </div>
                                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full mt-1 ${col.badge}`}>{col.label}</span>
                            </div>

                            {/* Contact buttons */}
                            <div className="flex gap-2">
                                {lead.phone && (
                                    <a
                                        href={`https://wa.me/972${lead.phone.replace(/^0/, "")}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-50 text-green-700 text-sm font-semibold rounded-xl hover:bg-green-100 transition-colors"
                                    >
                                        💬 WhatsApp
                                    </a>
                                )}
                                {lead.phone && (
                                    <a
                                        href={`tel:${lead.phone}`}
                                        onClick={e => e.stopPropagation()}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-700 text-sm font-semibold rounded-xl hover:bg-blue-100 transition-colors"
                                    >
                                        📞 התקשר
                                    </a>
                                )}
                                {lead.email && (
                                    <a
                                        href={`mailto:${lead.email}`}
                                        onClick={e => e.stopPropagation()}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-100 transition-colors"
                                    >
                                        ✉️ מייל
                                    </a>
                                )}
                            </div>

                            {/* Info */}
                            {(lead.email || lead.service_interest || lead.notes) && (
                                <div className="bg-gray-50 rounded-2xl p-3 space-y-1.5 text-sm">
                                    {lead.email && <p className="text-gray-600" dir="ltr">{lead.email}</p>}
                                    {lead.service_interest && <p className="text-gray-600">שירות: {lead.service_interest}</p>}
                                    {lead.notes && <p className="text-gray-500 whitespace-pre-wrap">{lead.notes}</p>}
                                </div>
                            )}

                            {/* Move to column */}
                            <div>
                                <p className="text-xs text-gray-400 mb-2 font-medium">העבר לעמודה:</p>
                                <div className="flex flex-wrap gap-2">
                                    {COLUMNS.map(c => (
                                        <button
                                            key={c.key}
                                            onClick={() => handleMove(lead, c.key)}
                                            disabled={movingId === lead.id}
                                            className={[
                                                "text-xs font-semibold px-3 py-1.5 rounded-full transition-all border",
                                                lead.status === c.key
                                                    ? "border-black bg-black text-white"
                                                    : `border-transparent ${c.badge} hover:opacity-80`,
                                            ].join(" ")}
                                        >
                                            {c.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => openEdit(lead)}
                                    className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200 transition-colors"
                                >
                                    ✏️ ערוך
                                </button>
                                <button
                                    onClick={() => handleConvert(lead)}
                                    disabled={converting || lead.status === "booked"}
                                    className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-40"
                                >
                                    {converting ? "ממיר..." : "✅ המר ללקוח"}
                                </button>
                                <button
                                    onClick={() => handleDelete(lead)}
                                    className="py-2.5 px-3 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition-colors"
                                >
                                    🗑
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Create / Edit modal */}
            {modal && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4" onClick={() => setModal(null)}>
                    <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-6 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto -mt-2 mb-2 sm:hidden" />
                        <h2 className="text-base font-bold text-gray-900">{modal.mode === "create" ? "ליד חדש" : "עריכת ליד"}</h2>

                        <div className="space-y-3">
                            <div>
                                <label className="text-xs text-gray-500 block mb-1">שם *</label>
                                <input
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="שם הליד"
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-black/10"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 block mb-1">טלפון</label>
                                    <input
                                        value={form.phone}
                                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                                        placeholder="05X-XXXXXXX"
                                        dir="ltr"
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 block mb-1">אימייל</label>
                                    <input
                                        value={form.email}
                                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                        placeholder="email@..."
                                        dir="ltr"
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-500 block mb-1">מקור</label>
                                    <select
                                        value={form.source}
                                        onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10"
                                    >
                                        {SOURCES.map(s => (
                                            <option key={s.key} value={s.key}>{s.icon} {s.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 block mb-1">שירות מבוקש</label>
                                    <input
                                        value={form.service_interest}
                                        onChange={e => setForm(f => ({ ...f, service_interest: e.target.value }))}
                                        placeholder="לדוגמה: קעקוע"
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-black/10"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-gray-500 block mb-1">הערות</label>
                                <textarea
                                    value={form.notes}
                                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                    placeholder="מידע נוסף על הליד..."
                                    rows={3}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right resize-none focus:outline-none focus:ring-2 focus:ring-black/10"
                                />
                            </div>
                        </div>

                        <div className="flex gap-2 pt-1">
                            <button onClick={() => setModal(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200 transition-colors">
                                ביטול
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving || !form.name.trim()}
                                className="flex-1 py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40"
                            >
                                {saving ? "שומר..." : modal.mode === "create" ? "הוסף ליד" : "שמור שינויים"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
