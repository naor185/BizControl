"use client";
import { toast } from "@/lib/toast";
import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type StampCard = {
    id: string; name: string; description: string | null;
    required_stamps: number; reward_type: string; reward_value: number;
    reward_description: string | null; is_active: boolean;
};

type LeaderboardEntry = {
    id: string; full_name: string; phone: string | null;
    is_club_member: boolean; loyalty_points: number;
    visit_count?: number; total_paid_cents?: number;
};

type Leaderboard = { top_visitors: LeaderboardEntry[]; top_payers: LeaderboardEntry[] };

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtILS = (cents: number) =>
    (cents / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });

const MEDALS = ["🥇", "🥈", "🥉"];

const REWARD_LABELS: Record<string, string> = {
    discount_percent: "% הנחה", points: "נקודות", free_service: "שירות חינם",
};

// ── Leaderboard ───────────────────────────────────────────────────────────────

function LeaderboardSection({ data }: { data: Leaderboard }) {
    const [tab, setTab] = useState<"visitors" | "payers">("payers");
    const list = tab === "payers" ? data.top_payers : data.top_visitors;

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-50">
                <h2 className="text-base font-black text-slate-800">🏆 לוח אלופים</h2>
                <div className="flex gap-2 mt-3">
                    {([["payers", "💰 שילמו הכי הרבה"], ["visitors", "📅 ביקרו הכי הרבה"]] as const).map(([key, label]) => (
                        <button key={key} type="button" onClick={() => setTab(key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="divide-y divide-slate-50">
                {list.length === 0 ? (
                    <div className="text-center py-8 text-slate-300 text-sm">אין נתונים עדיין</div>
                ) : list.map((entry, i) => (
                    <div key={entry.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="text-xl w-7 text-center shrink-0">
                            {i < 3 ? MEDALS[i] : <span className="text-xs text-slate-400 font-bold">#{i + 1}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-800 text-sm truncate">{entry.full_name}</span>
                                {entry.is_club_member && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">👑 VIP</span>}
                            </div>
                            {entry.phone && <div className="text-xs text-slate-400" dir="ltr">{entry.phone}</div>}
                        </div>
                        <div className="text-right shrink-0">
                            {tab === "payers"
                                ? <div className="text-sm font-black text-emerald-700" dir="ltr">{fmtILS(entry.total_paid_cents ?? 0)}</div>
                                : <div className="text-sm font-black text-blue-700">{entry.visit_count} ביקורים</div>}
                            <div className="text-[10px] text-amber-500">⭐ {entry.loyalty_points} נקודות</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Stamp Cards ───────────────────────────────────────────────────────────────

function StampVisual({ total, collected }: { total: number; collected: number }) {
    return (
        <div className="flex flex-wrap gap-1.5 mt-2">
            {Array.from({ length: total }).map((_, i) => (
                <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all ${i < collected ? "bg-amber-400 text-white shadow-sm" : "bg-slate-100 text-slate-300"}`}>
                    {i < collected ? "✓" : "○"}
                </div>
            ))}
        </div>
    );
}

function StampsTab() {
    const [cards, setCards] = useState<StampCard[]>([]);
    const [editing, setEditing] = useState<Partial<StampCard> | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [saving, setSaving] = useState(false);

    const EMPTY: Omit<StampCard, "id"> = { name: "", description: null, required_stamps: 5, reward_type: "discount_percent", reward_value: 10, reward_description: null, is_active: true };

    const load = () => apiFetch<StampCard[]>("/api/stamp-cards").then(setCards).catch(() => {});
    useEffect(() => { load(); }, []);

    const openNew = () => { setEditing({ ...EMPTY }); setIsNew(true); };
    const openEdit = (c: StampCard) => { setEditing({ ...c }); setIsNew(false); };
    const close = () => { setEditing(null); setIsNew(false); };

    const save = async () => {
        if (!editing) return;
        setSaving(true);
        try {
            if (isNew) await apiFetch("/api/stamp-cards", { method: "POST", body: JSON.stringify(editing) });
            else await apiFetch(`/api/stamp-cards/${editing.id}`, { method: "PATCH", body: JSON.stringify(editing) });
            await load(); close();
        } catch { toast.error("שגיאה בשמירה"); }
        finally { setSaving(false); }
    };

    const remove = async (id: string) => {
        if (!confirm("למחוק את כרטיס החותמות?")) return;
        await apiFetch(`/api/stamp-cards/${id}`, { method: "DELETE" }); load();
    };

    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-slate-500">לקוח מקבל חותמת בכל ביקור. כשמגיע למספר הנדרש — מקבל פרס אוטומטי.</p>
                <button type="button" onClick={openNew} className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition">+ כרטיס חדש</button>
            </div>

            {cards.length === 0 ? (
                <div className="text-center py-16 text-slate-400"><div className="text-5xl mb-3">🎫</div><p>אין כרטיסי חותמות עדיין</p><p className="text-xs mt-1">צור כרטיס ראשון</p></div>
            ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                    {cards.map(card => (
                        <div key={card.id} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <div className="font-bold text-slate-800">{card.name}</div>
                                    {card.description && <div className="text-xs text-slate-500 mt-0.5">{card.description}</div>}
                                </div>
                                {!card.is_active && <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">מושבת</span>}
                            </div>
                            <StampVisual total={Math.min(card.required_stamps, 10)} collected={0} />
                            <div className="mt-3 flex items-center justify-between">
                                <span className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-lg font-medium">
                                    פרס: {card.reward_value}{REWARD_LABELS[card.reward_type]}{card.reward_description && ` — ${card.reward_description}`}
                                </span>
                                <div className="flex gap-1">
                                    <button type="button" onClick={() => openEdit(card)} className="text-xs text-slate-400 hover:text-sky-600 px-2 py-1 rounded-lg hover:bg-sky-50 transition">ערוך</button>
                                    <button type="button" onClick={() => remove(card.id)} className="text-xs text-slate-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition">מחק</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {editing && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4" dir="rtl">
                        <h2 className="text-lg font-black text-slate-800">{isNew ? "כרטיס חדש" : "עריכת כרטיס"}</h2>
                        <div className="space-y-3">
                            <div><label className="text-xs font-bold text-slate-500 block mb-1">שם הכרטיס</label>
                                <input className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400" value={editing.name || ""} onChange={e => setEditing(p => ({ ...p!, name: e.target.value }))} placeholder='כרטיס נאמנות' /></div>
                            <div><label className="text-xs font-bold text-slate-500 block mb-1">תיאור (אופציונלי)</label>
                                <input className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400" value={editing.description || ""} onChange={e => setEditing(p => ({ ...p!, description: e.target.value }))} /></div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">מספר חותמות</label>
                                    <input type="number" min={2} max={20} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400" value={editing.required_stamps || 5} onChange={e => setEditing(p => ({ ...p!, required_stamps: +e.target.value }))} /></div>
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">סוג פרס</label>
                                    <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400" value={editing.reward_type || "discount_percent"} onChange={e => setEditing(p => ({ ...p!, reward_type: e.target.value }))}>
                                        <option value="discount_percent">% הנחה</option>
                                        <option value="points">נקודות</option>
                                        <option value="free_service">שירות חינם</option>
                                    </select></div>
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">ערך הפרס</label>
                                    <input type="number" min={1} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400" value={editing.reward_value || 10} onChange={e => setEditing(p => ({ ...p!, reward_value: +e.target.value }))} /></div>
                                <div><label className="text-xs font-bold text-slate-500 block mb-1">תיאור הפרס</label>
                                    <input className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400" value={editing.reward_description || ""} onChange={e => setEditing(p => ({ ...p!, reward_description: e.target.value }))} /></div>
                            </div>
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button type="button" onClick={save} disabled={saving || !editing.name} className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition disabled:opacity-50">{saving ? "שומר..." : "שמור"}</button>
                            <button type="button" onClick={close} className="px-5 py-3 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 text-sm">ביטול</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
    { key: "leaderboard", label: "🏆 לוח אלופים" },
    { key: "stamps",      label: "🎫 כרטיסי חותמות" },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function ClubPage() {
    const [tab, setTab] = useState<TabKey>("leaderboard");
    const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);

    useEffect(() => {
        apiFetch<Leaderboard>("/api/clients/club/leaderboard").then(setLeaderboard).catch(() => {});
    }, []);

    return (
        <RequireAuth>
            <AppShell title="מועדון לקוחות 🎖️">
                <div className="max-w-3xl mx-auto space-y-5" dir="rtl">

                    {/* Tab bar */}
                    <div className="flex gap-2 bg-slate-100 rounded-2xl p-1">
                        {TABS.map(t => (
                            <button key={t.key} type="button" onClick={() => setTab(t.key)}
                                className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${tab === t.key ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    {tab === "leaderboard" && (
                        leaderboard
                            ? <LeaderboardSection data={leaderboard} />
                            : <div className="text-center py-16 text-slate-300">טוען...</div>
                    )}
                    {tab === "stamps" && <StampsTab />}

                </div>
            </AppShell>
        </RequireAuth>
    );
}
