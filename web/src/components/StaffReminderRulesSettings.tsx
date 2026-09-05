"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

// Shared between /automation's settings tab and the calendar's own gear-menu
// dropdown (both desktop and mobile go through this same component, since
// the native app loads the same site) — one place to fix instead of two.
// An admin-managed list with no fixed set of lead times (unlike the
// customer-facing 1day/3day/7day/same_day reminders), so add/remove/toggle
// instead of a few checkboxes.

type ReminderRule = { id: string; applies_to: "appointment" | "task" | "both"; lead_minutes: number; enabled: boolean; created_at: string };

function formatLeadLabel(minutes: number): string {
    if (minutes >= 7 * 24 * 60 && minutes % (7 * 24 * 60) === 0) {
        const w = minutes / (7 * 24 * 60);
        return w === 1 ? "שבוע לפני" : `${w} שבועות לפני`;
    }
    if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) {
        const d = minutes / (24 * 60);
        return d === 1 ? "יום לפני" : `${d} ימים לפני`;
    }
    if (minutes >= 60 && minutes % 60 === 0) {
        const h = minutes / 60;
        return h === 1 ? "שעה לפני" : `${h} שעות לפני`;
    }
    return `${minutes} דקות לפני`;
}

export default function StaffReminderRulesSettings({ compact }: { compact?: boolean }) {
    const [rules, setRules] = useState<ReminderRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [newValue, setNewValue] = useState(30);
    const [newUnit, setNewUnit] = useState<"minutes" | "hours" | "days">("minutes");
    const [newAppliesTo, setNewAppliesTo] = useState<"appointment" | "task" | "both">("both");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<ReminderRule[]>("/api/push/staff-reminder-rules")
            .then(setRules)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const addRule = async () => {
        const unitToMinutes = { minutes: 1, hours: 60, days: 1440 };
        const lead_minutes = Math.round(newValue * unitToMinutes[newUnit]);
        if (!lead_minutes || lead_minutes <= 0) return;
        setSaving(true);
        setErr(null);
        try {
            const created = await apiFetch<ReminderRule>("/api/push/staff-reminder-rules", {
                method: "POST",
                body: JSON.stringify({ applies_to: newAppliesTo, lead_minutes, enabled: true }),
            });
            setRules(prev => [...prev, created].sort((a, b) => a.lead_minutes - b.lead_minutes));
            setNewValue(30);
            setNewUnit("minutes");
        } catch {
            setErr("שגיאה בהוספת התזמון");
        } finally {
            setSaving(false);
        }
    };

    const toggleRule = async (rule: ReminderRule) => {
        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
        try {
            await apiFetch<ReminderRule>(`/api/push/staff-reminder-rules/${rule.id}`, {
                method: "PUT",
                body: JSON.stringify({ enabled: !rule.enabled }),
            });
        } catch {
            setRules(prev => prev.map(r => r.id === rule.id ? rule : r));
        }
    };

    const deleteRule = async (id: string) => {
        const prev = rules;
        setRules(prev.filter(r => r.id !== id));
        try {
            await apiFetch(`/api/push/staff-reminder-rules/${id}`, { method: "DELETE" });
        } catch {
            setRules(prev);
        }
    };

    const inputCls = "bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500";

    return (
        <div className={compact ? "" : "bg-white rounded-2xl border border-slate-100 shadow-sm p-6"}>
            <div className="mb-3">
                <h4 className={compact ? "text-sm font-bold text-slate-700" : "text-lg font-bold text-slate-800"}>🔔 תזכורות פוש לצוות</h4>
                {!compact && (
                    <p className="text-sm text-slate-500 mt-0.5">שלחו פוש לעצמכם/לצוות לפני שתור או משימה מתחילים — הוסיפו כמה תזמונים שתרצו, אין מגבלה על הכמות</p>
                )}
            </div>

            {loading ? (
                <p className="text-sm text-slate-400">טוען...</p>
            ) : (
                <div className="space-y-2 mb-3">
                    {rules.length === 0 && <p className="text-xs text-slate-400">אין תזמונים מוגדרים עדיין</p>}
                    {rules.map(rule => (
                        <div key={rule.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-2.5 py-2 border border-slate-100">
                            <div className="flex items-center gap-2 min-w-0">
                                <button
                                    type="button"
                                    onClick={() => toggleRule(rule)}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${rule.enabled ? "bg-emerald-500" : "bg-slate-200"}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${rule.enabled ? "translate-x-4" : "translate-x-0"}`} />
                                </button>
                                <span className={`text-xs font-semibold truncate ${rule.enabled ? "text-slate-700" : "text-slate-400"}`}>
                                    {formatLeadLabel(rule.lead_minutes)}
                                </span>
                                {!compact && (
                                    <span className="text-[10px] text-slate-400 shrink-0">
                                        {rule.applies_to === "both" ? "תורים ומשימות" : rule.applies_to === "appointment" ? "תורים בלבד" : "משימות בלבד"}
                                    </span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => deleteRule(rule.id)}
                                aria-label="מחק תזמון"
                                className="text-slate-300 hover:text-red-500 text-base leading-none shrink-0 px-1"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {err && <p className="text-xs text-red-500 mb-2">{err}</p>}

            <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex gap-2">
                    <input
                        type="number" min={1}
                        value={newValue}
                        onChange={e => setNewValue(parseInt(e.target.value) || 1)}
                        className={`${inputCls} w-16 text-center`} dir="ltr"
                    />
                    <select value={newUnit} onChange={e => setNewUnit(e.target.value as "minutes" | "hours" | "days")} className={`${inputCls} flex-1`}>
                        <option value="minutes">דקות לפני</option>
                        <option value="hours">שעות לפני</option>
                        <option value="days">ימים לפני</option>
                    </select>
                </div>
                <select value={newAppliesTo} onChange={e => setNewAppliesTo(e.target.value as "appointment" | "task" | "both")} className={`${inputCls} w-full`}>
                    <option value="both">חל על: תורים ומשימות</option>
                    <option value="appointment">חל על: תורים בלבד</option>
                    <option value="task">חל על: משימות בלבד</option>
                </select>
                <button
                    type="button"
                    onClick={addRule}
                    disabled={saving}
                    className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-50 min-h-11"
                >
                    {saving ? "מוסיף..." : "+ הוסף תזמון"}
                </button>
            </div>
        </div>
    );
}
