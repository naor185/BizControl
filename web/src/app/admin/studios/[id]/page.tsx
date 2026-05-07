"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, getToken, setToken } from "@/lib/api";

type StudioDetail = {
    id: string;
    name: string;
    slug: string;
    subscription_plan: string;
    is_active: boolean;
    plan_expires_at: string | null;
    created_at: string;
    owner_email: string | null;
    owner_display_name: string | null;
    user_count: number;
    client_count: number;
    appointment_count_total: number;
    appointment_count_month: number;
    users: { id: string; email: string; display_name: string; role: string; is_active: boolean }[];
};

type Note = {
    id: string;
    body: string;
    created_by_email: string;
    created_at: string;
};

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
    free:     { label: "חינמי",    color: "bg-slate-100 text-slate-600" },
    starter:  { label: "Starter",  color: "bg-blue-100 text-blue-700" },
    pro:      { label: "Pro",      color: "bg-purple-100 text-purple-700" },
    studio:   { label: "Studio",   color: "bg-emerald-100 text-emerald-700" },
    platform: { label: "Platform", color: "bg-black text-white" },
};

const ROLE_LABELS: Record<string, string> = {
    owner: "בעלים", admin: "אדמין", artist: "אמן/ת", staff: "צוות",
};

function daysUntil(iso: string | null): number | null {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function StudioDetailPage() {
    const params = useParams();
    const studioId = params.id as string;
    const router = useRouter();

    const [detail, setDetail] = useState<StudioDetail | null>(null);
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [newNote, setNewNote] = useState("");
    const [addingNote, setAddingNote] = useState(false);
    const [extendModal, setExtendModal] = useState(false);
    const [extendDays, setExtendDays] = useState(30);
    const [extending, setExtending] = useState(false);
    const [impersonating, setImpersonating] = useState(false);

    const load = useCallback(async () => {
        setErr(null);
        try {
            const [d, n] = await Promise.all([
                apiFetch<StudioDetail>(`/api/admin/studios/${studioId}/detail`),
                apiFetch<Note[]>(`/api/admin/studios/${studioId}/notes`),
            ]);
            setDetail(d);
            setNotes(n);
        } catch (e: any) {
            if (e?.message?.includes("403") || e?.message?.includes("401")) {
                router.replace("/login");
            } else {
                setErr(e?.message || "שגיאה בטעינה");
            }
        } finally {
            setLoading(false);
        }
    }, [studioId, router]);

    useEffect(() => { load(); }, [load]);

    const handleToggleActive = async () => {
        if (!detail) return;
        if (!confirm(`${detail.is_active ? "להשהות" : "להפעיל מחדש"} את ${detail.name}?`)) return;
        await apiFetch(`/api/admin/studios/${studioId}`, {
            method: "PATCH",
            body: JSON.stringify({ is_active: !detail.is_active }),
        });
        await load();
    };

    const handleExtend = async () => {
        setExtending(true);
        try {
            await apiFetch(`/api/admin/studios/${studioId}`, {
                method: "PATCH",
                body: JSON.stringify({ plan_days: extendDays }),
            });
            setExtendModal(false);
            await load();
        } catch (e: any) {
            alert(e?.message);
        } finally {
            setExtending(false);
        }
    };

    const handleImpersonate = async () => {
        if (!detail) return;
        setImpersonating(true);
        try {
            const res = await apiFetch<{ access_token: string }>(`/api/admin/impersonate/${studioId}`, { method: "POST" });
            sessionStorage.setItem("admin_token", getToken() || "");
            sessionStorage.setItem("admin_return", "true");
            setToken(res.access_token);
            router.push("/dashboard");
        } catch (e: any) {
            alert(e?.message);
            setImpersonating(false);
        }
    };

    const handleDelete = async () => {
        if (!detail) return;
        if (!confirm(`למחוק את ${detail.name}? פעולה זו בלתי הפיכה!`)) return;
        await apiFetch(`/api/admin/studios/${studioId}`, { method: "DELETE" });
        router.replace("/admin");
    };

    const handleAddNote = async () => {
        if (!newNote.trim()) return;
        setAddingNote(true);
        try {
            const note = await apiFetch<Note>(`/api/admin/studios/${studioId}/notes`, {
                method: "POST",
                body: JSON.stringify({ body: newNote.trim() }),
            });
            setNotes(prev => [note, ...prev]);
            setNewNote("");
        } catch (e: any) {
            alert(e?.message);
        } finally {
            setAddingNote(false);
        }
    };

    const handleDeleteNote = async (noteId: string) => {
        if (!confirm("למחוק הערה זו?")) return;
        await apiFetch(`/api/admin/studios/${studioId}/notes/${noteId}`, { method: "DELETE" });
        setNotes(prev => prev.filter(n => n.id !== noteId));
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm" dir="rtl">
            טוען...
        </div>
    );

    if (err || !detail) return (
        <div className="min-h-screen flex items-center justify-center text-red-500 text-sm" dir="rtl">
            {err || "לא נמצא"}
        </div>
    );

    const plan = PLAN_LABELS[detail.subscription_plan] ?? { label: detail.subscription_plan, color: "bg-gray-100 text-gray-600" };
    const daysLeft = daysUntil(detail.plan_expires_at);
    const isExpired = daysLeft !== null && daysLeft < 0;
    const isTrial = daysLeft !== null && daysLeft >= 0 && daysLeft <= 14;

    return (
        <div dir="rtl" className="min-h-screen bg-gray-50 pb-20">
            {/* Header */}
            <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
                    <button onClick={() => router.push("/admin")} className="text-gray-400 hover:text-black transition-colors text-xl">←</button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-lg font-bold text-gray-900 truncate">{detail.name}</h1>
                        <p className="text-xs text-gray-400">{detail.slug}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${plan.color}`}>{plan.label}</span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${detail.is_active && !isExpired ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {detail.is_active && !isExpired ? "פעיל" : "מושהה"}
                    </span>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

                {/* KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        { label: "לקוחות", value: detail.client_count, icon: "👥" },
                        { label: "תורים החודש", value: detail.appointment_count_month, icon: "📅" },
                        { label: "תורים סה״כ", value: detail.appointment_count_total, icon: "📊" },
                        { label: "משתמשים", value: detail.user_count, icon: "🧑‍💼" },
                    ].map(k => (
                        <div key={k.label} className="bg-white rounded-2xl p-4 text-center shadow-sm border border-gray-100">
                            <div className="text-2xl mb-1">{k.icon}</div>
                            <div className="text-2xl font-bold text-gray-900">{k.value}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{k.label}</div>
                        </div>
                    ))}
                </div>

                {/* Info card */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">בעלים</span>
                        <span className="font-medium text-gray-900">{detail.owner_display_name || "—"} {detail.owner_email ? `(${detail.owner_email})` : ""}</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">נוצר</span>
                        <span className="font-medium text-gray-900">{fmtDate(detail.created_at)}</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">תוקף תוכנית</span>
                        <span className={`font-medium ${isExpired ? "text-red-600" : isTrial ? "text-amber-600" : "text-gray-900"}`}>
                            {detail.plan_expires_at
                                ? `${fmtDate(detail.plan_expires_at)} ${daysLeft !== null ? `(${daysLeft >= 0 ? `עוד ${daysLeft} ימים` : `פג לפני ${Math.abs(daysLeft)} ימים`})` : ""}`
                                : "ללא הגבלה"}
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                    <h2 className="text-sm font-semibold text-gray-700">פעולות</h2>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => setExtendModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
                        >
                            ⏳ הארך תוכנית
                        </button>
                        <button
                            onClick={handleImpersonate}
                            disabled={impersonating}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50"
                        >
                            👁 {impersonating ? "נכנס..." : "התחזה לבעלים"}
                        </button>
                        <button
                            onClick={handleToggleActive}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${detail.is_active ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`}
                        >
                            {detail.is_active ? "⏸ השהה" : "▶ הפעל"}
                        </button>
                        <button
                            onClick={handleDelete}
                            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition-colors"
                        >
                            🗑 מחק סטודיו
                        </button>
                    </div>
                </div>

                {/* Users list */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-50">
                        <h2 className="text-sm font-semibold text-gray-700">משתמשים ({detail.users.length})</h2>
                    </div>
                    {detail.users.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-6">אין משתמשים</p>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {detail.users.map(u => (
                                <div key={u.id} className="px-4 py-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">{u.display_name}</div>
                                        <div className="text-xs text-gray-400 truncate">{u.email}</div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className="text-xs text-gray-500">{ROLE_LABELS[u.role] ?? u.role}</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.is_active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                                            {u.is_active ? "פעיל" : "מושהה"}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Internal Notes */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-50">
                        <h2 className="text-sm font-semibold text-gray-700">הערות פנימיות</h2>
                    </div>

                    {/* Add note */}
                    <div className="p-4 border-b border-gray-50">
                        <textarea
                            value={newNote}
                            onChange={e => setNewNote(e.target.value)}
                            placeholder="הוסף הערה פנימית..."
                            rows={3}
                            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-black/10 text-right"
                        />
                        <div className="mt-2 flex justify-end">
                            <button
                                onClick={handleAddNote}
                                disabled={addingNote || !newNote.trim()}
                                className="px-4 py-2 bg-black text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40"
                            >
                                {addingNote ? "שומר..." : "הוסף הערה"}
                            </button>
                        </div>
                    </div>

                    {/* Notes list */}
                    {notes.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-6">אין הערות עדיין</p>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {notes.map(n => (
                                <div key={n.id} className="px-4 py-3 group">
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1">{n.body}</p>
                                        <button
                                            onClick={() => handleDeleteNote(n.id)}
                                            className="text-gray-300 hover:text-red-500 transition-colors text-xs opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1.5">{n.created_by_email} · {fmtDate(n.created_at)}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Extend Modal */}
            {extendModal && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4" onClick={() => setExtendModal(false)}>
                    <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-bold text-gray-900 mb-4">הארך תוכנית — {detail.name}</h3>

                        <div className="grid grid-cols-4 gap-2 mb-4">
                            {[7, 14, 30, 90].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setExtendDays(d)}
                                    className={`py-2 text-sm font-semibold rounded-xl transition-colors ${extendDays === d ? "bg-black text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                                >
                                    {d}י׳
                                </button>
                            ))}
                        </div>

                        <div className="mb-4">
                            <label className="text-xs text-gray-500 block mb-1">ימים מותאמים אישית</label>
                            <input
                                type="number"
                                min={1}
                                value={extendDays}
                                onChange={e => setExtendDays(Number(e.target.value))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                        </div>

                        {detail.plan_expires_at && (
                            <p className="text-xs text-gray-400 mb-4 text-center">
                                תוקף חדש: {fmtDate(new Date(Math.max(new Date(detail.plan_expires_at).getTime(), Date.now()) + extendDays * 86_400_000).toISOString())}
                            </p>
                        )}

                        <div className="flex gap-2">
                            <button onClick={() => setExtendModal(false)} className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">ביטול</button>
                            <button
                                onClick={handleExtend}
                                disabled={extending}
                                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-black text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
                            >
                                {extending ? "מאריך..." : `הארך ${extendDays} ימים`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
