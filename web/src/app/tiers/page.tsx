"use client" already handled
"use client";
import { toast } from "@/lib/toast";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Tier = {
    id: string;
    name: string;
    color: string;
    icon: string;
    rank_order: number;
    threshold_type: string;
    threshold_value: number;
    points_multiplier: number;
    birthday_gift_percent: number;
    is_active: boolean;
};

const EMPTY: Omit<Tier, "id"> = {
    name: "",
    color: "#C0C0C0",
    icon: "⭐",
    rank_order: 1,
    threshold_type: "visits",
    threshold_value: 1,
    points_multiplier: 1.0,
    birthday_gift_percent: 10,
    is_active: true,
};

const THRESHOLD_LABELS: Record<string, string> = {
    visits: "ביקורים",
    spend_ils: "הוצאה (₪)",
    points_earned: "נקודות שנצברו",
};

const REWARD_ICONS: Record<string, string> = {
    visits: "📅",
    spend_ils: "💰",
    points_earned: "⭐",
};

export default function TiersPage() {
    const [tiers, setTiers] = useState<Tier[]>([]);
    const [editing, setEditing] = useState<Partial<Tier> | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = () =>
        apiFetch<Tier[]>("/api/tiers").then(setTiers).catch(() => {});

    useEffect(() => { load(); }, []);

    const openNew = () => { setEditing({ ...EMPTY }); setIsNew(true); };
    const openEdit = (t: Tier) => { setEditing({ ...t }); setIsNew(false); };
    const close = () => { setEditing(null); setIsNew(false); };

    const save = async () => {
        if (!editing) return;
        setSaving(true);
        try {
            if (isNew) {
                await apiFetch("/api/tiers", { method: "POST", body: JSON.stringify(editing) });
            } else {
                await apiFetch(`/api/tiers/${editing.id}`, { method: "PATCH", body: JSON.stringify(editing) });
            }
            await load();
            close();
        } catch { toast.error("שגיאה בשמירה"); }
        finally { setSaving(false); }
    };

    const remove = async (id: string) => {
        if (!confirm("למחוק את הדרגה?")) return;
        await apiFetch(`/api/tiers/${id}`, { method: "DELETE" });
        load();
    };

    const sorted = [...tiers].sort((a, b) => b.rank_order - a.rank_order);

    return (
        <RequireAuth>
            <AppShell title="דרגות מועדון 🏆">
                <div className="max-w-3xl mx-auto space-y-6">

                    <div className="flex items-center justify-between">
                        <p className="text-sm text-slate-500">הגדר דרגות לפי ביקורים / הוצאה / נקודות. לקוחות עולים דרגה אוטומטית.</p>
                        <button
                            onClick={openNew}
                            className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition"
                        >
                            + הוסף דרגה
                        </button>
                    </div>

                    {sorted.length === 0 && (
                        <div className="text-center py-16 text-slate-400">
                            <div className="text-5xl mb-3">🏆</div>
                            <p>אין דרגות מועדון עדיין</p>
                            <p className="text-xs mt-1">הוסף דרגה כדי להתחיל</p>
                        </div>
                    )}

                    <div className="space-y-3">
                        {sorted.map(tier => (
                            <div
                                key={tier.id}
                                className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex items-center gap-4"
                            >
                                <div
                                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                                    style={{ background: tier.color + "33" }}
                                >
                                    {tier.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-slate-800 text-base">{tier.name}</span>
                                        <span
                                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                            style={{ background: tier.color + "33", color: tier.color }}
                                        >
                                            דרגה {tier.rank_order}
                                        </span>
                                        {!tier.is_active && <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">מושבת</span>}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-3">
                                        <span>{REWARD_ICONS[tier.threshold_type]} מינימום {tier.threshold_value} {THRESHOLD_LABELS[tier.threshold_type]}</span>
                                        <span>✨ ×{tier.points_multiplier} נקודות</span>
                                        <span>🎂 {tier.birthday_gift_percent}% הנחה ליום הולדת</span>
                                    </div>
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                    <button onClick={() => openEdit(tier)} className="text-slate-400 hover:text-sky-600 transition text-sm px-3 py-1.5 rounded-lg hover:bg-sky-50">ערוך</button>
                                    <button onClick={() => remove(tier.id)} className="text-slate-400 hover:text-red-600 transition text-sm px-3 py-1.5 rounded-lg hover:bg-red-50">מחק</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Modal */}
                {editing && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4" dir="rtl">
                            <h2 className="text-lg font-black text-slate-800">{isNew ? "דרגה חדשה" : "עריכת דרגה"}</h2>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">שם הדרגה</label>
                                    <input
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400"
                                        value={editing.name || ""}
                                        onChange={e => setEditing(p => ({ ...p!, name: e.target.value }))}
                                        placeholder="Gold, Silver, Black..."
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">אייקון</label>
                                    <input
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400"
                                        value={editing.icon || ""}
                                        onChange={e => setEditing(p => ({ ...p!, icon: e.target.value }))}
                                        placeholder="⭐"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">צבע</label>
                                    <div className="flex items-center gap-2">
                                        <div className="relative">
                                            <div className="w-10 h-10 rounded-xl border border-slate-200" style={{ background: editing.color }} />
                                            <input
                                                type="color"
                                                value={editing.color || "#C0C0C0"}
                                                onChange={e => setEditing(p => ({ ...p!, color: e.target.value }))}
                                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                            />
                                        </div>
                                        <span className="text-xs text-slate-400">{editing.color}</span>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">סדר (גבוה = עליון)</label>
                                    <input
                                        type="number" min={1}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400"
                                        value={editing.rank_order || 1}
                                        onChange={e => setEditing(p => ({ ...p!, rank_order: +e.target.value }))}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">קריטריון</label>
                                    <select
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400"
                                        value={editing.threshold_type || "visits"}
                                        onChange={e => setEditing(p => ({ ...p!, threshold_type: e.target.value }))}
                                    >
                                        <option value="visits">ביקורים</option>
                                        <option value="spend_ils">הוצאה (₪)</option>
                                        <option value="points_earned">נקודות שנצברו</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">ערך מינימום</label>
                                    <input
                                        type="number" min={1}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400"
                                        value={editing.threshold_value || 1}
                                        onChange={e => setEditing(p => ({ ...p!, threshold_value: +e.target.value }))}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">מכפיל נקודות</label>
                                    <input
                                        type="number" min={1} step={0.1}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400"
                                        value={editing.points_multiplier || 1}
                                        onChange={e => setEditing(p => ({ ...p!, points_multiplier: +e.target.value }))}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">הנחת יום הולדת %</label>
                                    <input
                                        type="number" min={0} max={100}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400"
                                        value={editing.birthday_gift_percent ?? 10}
                                        onChange={e => setEditing(p => ({ ...p!, birthday_gift_percent: +e.target.value }))}
                                    />
                                </div>

                                <div className="col-span-2 flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setEditing(p => ({ ...p!, is_active: !p!.is_active }))}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editing.is_active ? "bg-sky-600" : "bg-slate-200"}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${editing.is_active ? "translate-x-6" : "translate-x-1"}`} />
                                    </button>
                                    <span className="text-sm text-slate-700">דרגה פעילה</span>
                                </div>
                            </div>

                            <div className="flex gap-2 pt-2">
                                <button onClick={save} disabled={saving || !editing.name}
                                    className="flex-1 py-3 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl transition disabled:opacity-50">
                                    {saving ? "שומר..." : "שמור"}
                                </button>
                                <button onClick={close} className="px-5 py-3 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition text-sm">
                                    ביטול
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
