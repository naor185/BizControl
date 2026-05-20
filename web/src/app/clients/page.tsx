"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import Link from "next/link";

type Client = {
    id: string;
    full_name?: string | null;
    phone?: string | null;
    email?: string | null;
    created_at?: string;
    is_club_member?: boolean;
    birth_date?: string | null;
};

type ClubMember = {
    id: string;
    full_name: string;
    phone: string | null;
    points: number;
    joined_at: string | null;
    source: "landing" | "manual";
};

type ClubStats = {
    total: number;
    this_month: number;
    via_landing: number;
    via_manual: number;
    members: ClubMember[];
};

type LoyaltyStats = {
    total_points_awarded: number;
    total_points_redeemed: number;
    total_points_redeemed_ils: number;
    total_outstanding_points: number;
    total_outstanding_ils: number;
    clients_with_points: number;
};

const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function PageInner() {
    const searchParams = useSearchParams();
    const [tab, setTab] = useState<"all" | "club">(
        searchParams.get("tab") === "club" ? "club" : "all"
    );

    // ── All clients state ──
    const [items, setItems] = useState<Client[]>([]);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "regular" | "club">("all");
    const [birthdayMonth, setBirthdayMonth] = useState<number | "all">("all");
    const [search, setSearch] = useState("");
    const [deletingClientId, setDeletingClientId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newPhone, setNewPhone] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [newBirthDate, setNewBirthDate] = useState("");
    const [newNotes, setNewNotes] = useState("");
    const [isClubMember, setIsClubMember] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // ── Club state ──
    const [clubStats, setClubStats] = useState<ClubStats | null>(null);
    const [loyaltyStats, setLoyaltyStats] = useState<LoyaltyStats | null>(null);
    const [clubLoading, setClubLoading] = useState(false);
    const [clubSearch, setClubSearch] = useState("");
    const [sourceFilter, setSourceFilter] = useState<"all" | "landing" | "manual">("all");

    const loadClients = async () => {
        try {
            setErr(null);
            setLoading(true);
            const data = await apiFetch<Client[]>("/api/clients", { method: "GET" });
            setItems(data);
        } catch (e: unknown) {
            setErr((e as Error)?.message || "שגיאה בטעינת לקוחות");
        } finally {
            setLoading(false);
        }
    };

    const loadClubData = async () => {
        if (clubStats) return;
        setClubLoading(true);
        try {
            const [cs, ls] = await Promise.all([
                apiFetch<ClubStats>("/api/clients/club/stats"),
                apiFetch<LoyaltyStats>("/api/dashboard/loyalty-stats"),
            ]);
            setClubStats(cs);
            setLoyaltyStats(ls);
        } catch { /* silent */ } finally {
            setClubLoading(false);
        }
    };

    useEffect(() => { loadClients(); }, []);
    useEffect(() => { if (tab === "club") loadClubData(); }, [tab]);

    const handleDeleteClient = async () => {
        if (!deletingClientId) return;
        try {
            await apiFetch(`/api/clients/${deletingClientId}`, { method: "DELETE" });
            setDeletingClientId(null);
            loadClients();
        } catch (e: unknown) {
            alert((e as Error)?.message || "שגיאה במחיקת לקוח");
        }
    };

    const handleCreateClient = async () => {
        if (!newName.trim() || !newPhone.trim()) { alert("יש להזין שם וטלפון"); return; }
        try {
            setIsSaving(true);
            await apiFetch("/api/clients", {
                method: "POST",
                body: JSON.stringify({
                    full_name: newName.trim(), phone: newPhone.trim(),
                    email: newEmail.trim() || null, birth_date: newBirthDate || null,
                    notes: newNotes.trim() || null, is_club_member: isClubMember,
                }),
            });
            setIsModalOpen(false);
            setNewName(""); setNewPhone(""); setNewEmail("");
            setNewBirthDate(""); setNewNotes(""); setIsClubMember(false);
            loadClients();
        } catch (e: unknown) {
            alert((e as Error)?.message || "שגיאה ביצירת לקוח");
        } finally { setIsSaving(false); }
    };

    const visible = useMemo(() => items
        .filter(c => filter === "regular" ? !c.is_club_member : filter === "club" ? c.is_club_member : true)
        .filter(c => birthdayMonth === "all" ? true : c.birth_date ? new Date(c.birth_date).getMonth() + 1 === birthdayMonth : false)
        .filter(c => !search.trim() ? true : [c.full_name, c.phone, c.email].some(v => v?.toLowerCase().includes(search.toLowerCase())))
    , [items, filter, birthdayMonth, search]);

    const clubCount = items.filter(c => c.is_club_member).length;

    const filteredMembers = useMemo(() => (clubStats?.members || []).filter(m => {
        const q = clubSearch.toLowerCase();
        return (!q || m.full_name.toLowerCase().includes(q) || (m.phone || "").includes(q)) &&
               (sourceFilter === "all" || m.source === sourceFilter);
    }), [clubStats, clubSearch, sourceFilter]);

    return (
        <RequireAuth>
            <AppShell title="לקוחות">
                <div className="space-y-5 animate-page-in">

                    {/* Header */}
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">רשימת לקוחות</h2>
                            {!loading && (
                                <p className="text-sm text-slate-400 mt-0.5">
                                    {items.length} לקוחות סה״כ · {clubCount} חברי מועדון
                                </p>
                            )}
                        </div>
                        <button onClick={() => setIsModalOpen(true)}
                            className="flex items-center gap-2 bg-black hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                            לקוח חדש
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
                        <button onClick={() => setTab("all")}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "all" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                            👥 כל הלקוחות
                        </button>
                        <button onClick={() => setTab("club")}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "club" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                            👑 מועדון VIP {clubCount > 0 && <span className="mr-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{clubCount}</span>}
                        </button>
                    </div>

                    {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{err}</div>}

                    {/* ── TAB: כל הלקוחות ── */}
                    {tab === "all" && (
                        <>
                            {!loading && !err && (
                                <div className="space-y-3">
                                    <div className="relative">
                                        <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                                        </svg>
                                        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                                            placeholder="חיפוש לפי שם, טלפון או אימייל..."
                                            className="w-full bg-white border border-slate-200 rounded-xl pr-9 pl-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 transition" />
                                        {search && <button onClick={() => setSearch("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">✕</button>}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {([
                                            { key: "all", label: "כולם", count: items.length },
                                            { key: "club", label: "מועדון 👑", count: clubCount },
                                            { key: "regular", label: "רגילים", count: items.length - clubCount },
                                        ] as const).map(f => (
                                            <button key={f.key} onClick={() => setFilter(f.key)}
                                                className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all border ${filter === f.key ? "bg-black text-white border-black shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                                                {f.label} <span className={`mr-1.5 text-xs ${filter === f.key ? "text-white/70" : "text-slate-400"}`}>{f.count}</span>
                                            </button>
                                        ))}
                                        <select value={birthdayMonth} onChange={e => setBirthdayMonth(e.target.value === "all" ? "all" : parseInt(e.target.value))}
                                            className="px-3 py-1.5 rounded-full text-sm font-semibold bg-white border border-slate-200 outline-none hover:border-slate-400 transition cursor-pointer text-slate-600">
                                            <option value="all">🎂 כל החודשים</option>
                                            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {loading ? (
                                <div className="space-y-2">
                                    {[1,2,3,4,5].map(i => (
                                        <div key={i} className="bg-white rounded-xl border border-slate-100 p-4 animate-pulse flex items-center gap-3">
                                            <div className="w-10 h-10 bg-slate-100 rounded-full shrink-0" />
                                            <div className="flex-1 space-y-2"><div className="h-3 bg-slate-100 rounded w-1/3" /><div className="h-3 bg-slate-100 rounded w-1/4" /></div>
                                        </div>
                                    ))}
                                </div>
                            ) : !err && (
                                <>
                                    <div className="hidden md:block bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-semibold uppercase tracking-wide">
                                                    <th className="text-right px-5 py-3">לקוח</th>
                                                    <th className="text-right px-5 py-3">טלפון</th>
                                                    <th className="text-right px-5 py-3">אימייל</th>
                                                    <th className="text-right px-5 py-3">הצטרפות</th>
                                                    <th className="px-5 py-3 w-14" />
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {visible.length === 0 ? (
                                                    <tr><td colSpan={5} className="py-16 text-center">
                                                        <div className="text-3xl mb-2">🔍</div>
                                                        <div className="text-slate-500 font-medium">לא נמצאו לקוחות</div>
                                                    </td></tr>
                                                ) : visible.map(c => (
                                                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                                                        <td className="px-5 py-3.5">
                                                            <Link href={`/clients/${c.id}`} className="flex items-center gap-3">
                                                                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600 shrink-0 group-hover:bg-black group-hover:text-white transition-colors">
                                                                    {(c.full_name || "?")[0].toUpperCase()}
                                                                </div>
                                                                <div>
                                                                    <div className="font-semibold text-slate-800 group-hover:text-black">{c.full_name || c.id.slice(0, 8)}</div>
                                                                    {c.is_club_member && <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">מועדון 👑</span>}
                                                                </div>
                                                            </Link>
                                                        </td>
                                                        <td className="px-5 py-3.5 text-slate-600 text-xs font-mono" dir="ltr">{c.phone || <span className="text-slate-300">—</span>}</td>
                                                        <td className="px-5 py-3.5 text-slate-500 text-xs" dir="ltr">{c.email || <span className="text-slate-300">—</span>}</td>
                                                        <td className="px-5 py-3.5 text-slate-400 text-xs">{c.created_at ? new Date(c.created_at).toLocaleDateString("he-IL") : "—"}</td>
                                                        <td className="px-5 py-3.5">
                                                            <button onClick={() => setDeletingClientId(c.id)}
                                                                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-50">
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                </svg>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="md:hidden space-y-2">
                                        {visible.map(c => (
                                            <Link key={c.id} href={`/clients/${c.id}`}
                                                className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 px-4 py-3.5 active:scale-[0.98] transition-transform">
                                                <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-base font-bold text-slate-600 shrink-0">
                                                    {(c.full_name || "?")[0].toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-semibold text-slate-800 truncate flex items-center gap-2">
                                                        {c.full_name || c.id.slice(0, 8)}
                                                        {c.is_club_member && <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">👑</span>}
                                                    </div>
                                                    <div className="text-xs text-slate-400 mt-0.5 font-mono" dir="ltr">{c.phone || "אין טלפון"}</div>
                                                </div>
                                            </Link>
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* ── TAB: מועדון VIP ── */}
                    {tab === "club" && (
                        clubLoading ? (
                            <div className="flex justify-center items-center h-48">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Stats cards */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {[
                                        { label: "סה״כ חברי מועדון", value: clubStats?.total ?? 0, icon: "👑", bg: "bg-amber-50" },
                                        { label: "הצטרפו החודש", value: clubStats?.this_month ?? 0, icon: "🆕", bg: "bg-sky-50" },
                                        { label: "דרך קישור", value: clubStats?.via_landing ?? 0, icon: "🔗", bg: "bg-green-50" },
                                        { label: "הכנסה ידנית", value: clubStats?.via_manual ?? 0, icon: "✍️", bg: "bg-purple-50" },
                                    ].map(s => (
                                        <div key={s.label} className={`${s.bg} rounded-2xl border border-slate-100 shadow-sm p-5 flex items-center gap-4`}>
                                            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-2xl shadow-sm">{s.icon}</div>
                                            <div>
                                                <div className="text-2xl font-black text-slate-900">{s.value}</div>
                                                <div className="text-sm text-slate-500 mt-0.5">{s.label}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Points summary */}
                                {loyaltyStats && (
                                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                                        <h3 className="font-bold text-slate-800 mb-4">⭐ סיכום נקודות נאמנות</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                            <div className="bg-slate-50 rounded-xl p-4">
                                                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">נקודות שהוענקו</div>
                                                <div className="text-2xl font-black text-slate-800">{loyaltyStats.total_points_awarded.toLocaleString()}</div>
                                                <div className="text-xs text-slate-400 mt-0.5">= ₪{loyaltyStats.total_points_awarded.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-emerald-50 rounded-xl p-4">
                                                <div className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-1">נקודות שמומשו</div>
                                                <div className="text-2xl font-black text-emerald-700">{loyaltyStats.total_points_redeemed.toLocaleString()}</div>
                                                <div className="text-xs text-emerald-500 mt-0.5">= ₪{loyaltyStats.total_points_redeemed_ils.toLocaleString()} הנחות</div>
                                            </div>
                                            <div className="bg-amber-50 rounded-xl p-4">
                                                <div className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-1">יתרה אצל לקוחות</div>
                                                <div className="text-2xl font-black text-amber-700">{loyaltyStats.total_outstanding_points.toLocaleString()}</div>
                                                <div className="text-xs text-amber-500 mt-0.5">= ₪{loyaltyStats.total_outstanding_ils.toLocaleString()} פוטנציאל</div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Member list */}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3">
                                        <input type="text" placeholder="חיפוש לפי שם או טלפון..." value={clubSearch}
                                            onChange={e => setClubSearch(e.target.value)}
                                            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                                        <div className="flex gap-2">
                                            {(["all", "landing", "manual"] as const).map(f => (
                                                <button key={f} onClick={() => setSourceFilter(f)}
                                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${sourceFilter === f ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-600 border-slate-200 hover:bg-amber-50"}`}>
                                                    {f === "all" ? "הכל" : f === "landing" ? "🔗 קישור" : "✍️ ידני"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {filteredMembers.length === 0 ? (
                                        <div className="py-16 text-center space-y-2">
                                            <div className="text-5xl">👑</div>
                                            <div className="text-slate-600 font-semibold">אין חברי מועדון</div>
                                        </div>
                                    ) : (
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-slate-50 border-b border-slate-100">
                                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs">שם</th>
                                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs hidden sm:table-cell">טלפון</th>
                                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs">נקודות</th>
                                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs hidden md:table-cell">הצטרפות</th>
                                                    <th className="text-right px-5 py-3 font-semibold text-slate-500 text-xs">מקור</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {filteredMembers.map(m => (
                                                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                                                        <td className="px-5 py-3.5">
                                                            <Link href={`/clients/${m.id}`} className="flex items-center gap-2.5">
                                                                <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
                                                                    {m.full_name[0] || "?"}
                                                                </div>
                                                                <span className="font-medium text-slate-800 hover:text-amber-700">{m.full_name}</span>
                                                            </Link>
                                                        </td>
                                                        <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell" dir="ltr">{m.phone || "—"}</td>
                                                        <td className="px-5 py-3.5">
                                                            {m.points > 0 ? (
                                                                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 font-semibold px-2.5 py-0.5 rounded-full text-xs">⭐ {m.points}</span>
                                                            ) : <span className="text-slate-300 text-xs">0</span>}
                                                        </td>
                                                        <td className="px-5 py-3.5 text-slate-500 text-xs hidden md:table-cell">
                                                            {m.joined_at ? new Date(m.joined_at).toLocaleDateString("he-IL") : "—"}
                                                        </td>
                                                        <td className="px-5 py-3.5">
                                                            {m.source === "landing"
                                                                ? <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 font-medium px-2.5 py-0.5 rounded-full text-xs border border-green-100">🔗 קישור</span>
                                                                : <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 font-medium px-2.5 py-0.5 rounded-full text-xs border border-purple-100">✍️ ידני</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        )
                    )}
                </div>

                {/* Delete modal */}
                {deletingClientId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 text-center">
                            <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 mb-1">מחיקת לקוח</h3>
                            <p className="text-sm text-slate-500 mb-6">הלקוח יוסתר מהמערכת.</p>
                            <div className="flex gap-3">
                                <button onClick={() => setDeletingClientId(null)} className="flex-1 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition">ביטול</button>
                                <button onClick={handleDeleteClient} className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition">מחק</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Add client modal */}
                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                <h3 className="text-base font-bold text-slate-800">לקוח חדש</h3>
                                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition">✕</button>
                            </div>
                            <div className="p-5 space-y-3.5 max-h-[70vh] overflow-y-auto">
                                {[
                                    { label: "שם מלא *", val: newName, set: setNewName, type: "text" },
                                    { label: "טלפון *", val: newPhone, set: setNewPhone, type: "tel" },
                                    { label: "אימייל", val: newEmail, set: setNewEmail, type: "email" },
                                    { label: "תאריך לידה", val: newBirthDate, set: setNewBirthDate, type: "date" },
                                ].map(f => (
                                    <div key={f.label}>
                                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">{f.label}</label>
                                        <input value={f.val} onChange={e => f.set(e.target.value)} type={f.type}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 transition" />
                                    </div>
                                ))}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">הערות</label>
                                    <textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 transition resize-none" />
                                </div>
                                <label className="flex items-center gap-3 cursor-pointer p-3 bg-amber-50 rounded-xl border border-amber-100">
                                    <input type="checkbox" checked={isClubMember} onChange={e => setIsClubMember(e.target.checked)} className="w-4 h-4 rounded accent-black" />
                                    <div>
                                        <div className="text-sm font-bold text-amber-800">חבר מועדון 👑</div>
                                        <div className="text-xs text-amber-600">מקבל הטבות ונקודות</div>
                                    </div>
                                </label>
                            </div>
                            <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
                                <button onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition">ביטול</button>
                                <button onClick={handleCreateClient} disabled={isSaving}
                                    className="flex-1 py-2.5 text-sm font-semibold text-white bg-black hover:bg-slate-800 rounded-xl transition disabled:opacity-50">
                                    {isSaving ? "שומר..." : "שמור"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}

export default function Page() {
    return (
        <Suspense fallback={null}>
            <PageInner />
        </Suspense>
    );
}
