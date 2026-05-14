"use client";

import { useEffect, useState, useMemo } from "react";
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

const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export default function Page() {
    const [items, setItems] = useState<Client[]>([]);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "regular" | "club">("all");
    const [birthdayMonth, setBirthdayMonth] = useState<number | "all">("all");
    const [search, setSearch] = useState("");

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newPhone, setNewPhone] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [newBirthDate, setNewBirthDate] = useState("");
    const [newNotes, setNewNotes] = useState("");
    const [isClubMember, setIsClubMember] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [deletingClientId, setDeletingClientId] = useState<string | null>(null);

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

    useEffect(() => { loadClients(); }, []);

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
        if (!newName.trim() || !newPhone.trim()) {
            alert("יש להזין שם וטלפון");
            return;
        }
        try {
            setIsSaving(true);
            await apiFetch("/api/clients", {
                method: "POST",
                body: JSON.stringify({
                    full_name: newName.trim(),
                    phone: newPhone.trim(),
                    email: newEmail.trim() || null,
                    birth_date: newBirthDate || null,
                    notes: newNotes.trim() || null,
                    is_club_member: isClubMember,
                }),
            });
            setIsModalOpen(false);
            setNewName(""); setNewPhone(""); setNewEmail("");
            setNewBirthDate(""); setNewNotes(""); setIsClubMember(false);
            loadClients();
        } catch (e: unknown) {
            alert((e as Error)?.message || "שגיאה ביצירת לקוח");
        } finally {
            setIsSaving(false);
        }
    };

    const visible = useMemo(() => {
        return items
            .filter(c => {
                if (filter === "regular") return !c.is_club_member;
                if (filter === "club") return c.is_club_member;
                return true;
            })
            .filter(c => {
                if (birthdayMonth === "all") return true;
                if (!c.birth_date) return false;
                return new Date(c.birth_date).getMonth() + 1 === birthdayMonth;
            })
            .filter(c => {
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                return (
                    c.full_name?.toLowerCase().includes(q) ||
                    c.phone?.toLowerCase().includes(q) ||
                    c.email?.toLowerCase().includes(q)
                );
            });
    }, [items, filter, birthdayMonth, search]);

    const clubCount = items.filter(c => c.is_club_member).length;

    return (
        <RequireAuth>
            <AppShell title="לקוחות">
                <div className="space-y-5 animate-page-in">

                    {/* Header row */}
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">רשימת לקוחות</h2>
                            {!loading && (
                                <p className="text-sm text-slate-400 mt-0.5">
                                    {items.length} לקוחות סה״כ · {clubCount} חברי מועדון
                                </p>
                            )}
                        </div>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="flex items-center gap-2 bg-black hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            לקוח חדש
                        </button>
                    </div>

                    {err && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{err}</div>
                    )}

                    {/* Search + Filters */}
                    {!loading && !err && (
                        <div className="space-y-3">
                            {/* Search */}
                            <div className="relative">
                                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                                </svg>
                                <input
                                    type="text"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="חיפוש לפי שם, טלפון או אימייל..."
                                    className="w-full bg-white border border-slate-200 rounded-xl pr-9 pl-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 focus:border-slate-300 transition"
                                />
                                {search && (
                                    <button onClick={() => setSearch("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>

                            {/* Filter pills */}
                            <div className="flex flex-wrap gap-2">
                                {([
                                    { key: "all",     label: "כולם",         count: items.length },
                                    { key: "club",    label: "מועדון 👑",    count: clubCount },
                                    { key: "regular", label: "רגילים",       count: items.length - clubCount },
                                ] as const).map(f => (
                                    <button
                                        key={f.key}
                                        onClick={() => setFilter(f.key)}
                                        className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all border ${
                                            filter === f.key
                                                ? "bg-black text-white border-black shadow-sm"
                                                : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                                        }`}
                                    >
                                        {f.label}
                                        <span className={`mr-1.5 text-xs ${filter === f.key ? "text-white/70" : "text-slate-400"}`}>
                                            {f.count}
                                        </span>
                                    </button>
                                ))}

                                {/* Birthday month */}
                                <select
                                    value={birthdayMonth}
                                    onChange={e => setBirthdayMonth(e.target.value === "all" ? "all" : parseInt(e.target.value))}
                                    className="px-3 py-1.5 rounded-full text-sm font-semibold bg-white border border-slate-200 outline-none hover:border-slate-400 transition cursor-pointer text-slate-600"
                                >
                                    <option value="all">🎂 כל החודשים</option>
                                    {MONTHS.map((m, i) => (
                                        <option key={i + 1} value={i + 1}>{m}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Results count */}
                            {(search || filter !== "all" || birthdayMonth !== "all") && (
                                <p className="text-xs text-slate-500">
                                    מציג {visible.length} מתוך {items.length} לקוחות
                                </p>
                            )}
                        </div>
                    )}

                    {/* Loading skeleton */}
                    {loading && (
                        <div className="space-y-2">
                            {[1,2,3,4,5].map(i => (
                                <div key={i} className="bg-white rounded-xl border border-slate-100 p-4 animate-pulse flex items-center gap-3">
                                    <div className="w-10 h-10 bg-slate-100 rounded-full flex-shrink-0" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-3 bg-slate-100 rounded w-1/3" />
                                        <div className="h-3 bg-slate-100 rounded w-1/4" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Client list */}
                    {!loading && !err && (
                        <>
                            {/* Desktop table */}
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
                                            <tr>
                                                <td colSpan={5} className="py-16 text-center">
                                                    <div className="text-3xl mb-2">🔍</div>
                                                    <div className="text-slate-500 font-medium">לא נמצאו לקוחות</div>
                                                    <div className="text-slate-400 text-xs mt-1">נסה לשנות את מסנני החיפוש</div>
                                                </td>
                                            </tr>
                                        ) : visible.map(c => (
                                            <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                                                <td className="px-5 py-3.5">
                                                    <Link href={`/clients/${c.id}`} className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600 flex-shrink-0 group-hover:bg-black group-hover:text-white transition-colors">
                                                            {(c.full_name || "?")[0].toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <div className="font-semibold text-slate-800 group-hover:text-black">
                                                                {c.full_name || c.id.slice(0, 8)}
                                                            </div>
                                                            {c.is_club_member && (
                                                                <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">
                                                                    מועדון 👑
                                                                </span>
                                                            )}
                                                        </div>
                                                    </Link>
                                                </td>
                                                <td className="px-5 py-3.5 text-slate-600 text-xs font-mono" dir="ltr">
                                                    {c.phone || <span className="text-slate-300">—</span>}
                                                </td>
                                                <td className="px-5 py-3.5 text-slate-500 text-xs" dir="ltr">
                                                    {c.email || <span className="text-slate-300">—</span>}
                                                </td>
                                                <td className="px-5 py-3.5 text-slate-400 text-xs">
                                                    {c.created_at ? new Date(c.created_at).toLocaleDateString("he-IL") : "—"}
                                                </td>
                                                <td className="px-5 py-3.5">
                                                    <button
                                                        onClick={() => setDeletingClientId(c.id)}
                                                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-50"
                                                        title="מחק"
                                                    >
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

                            {/* Mobile cards */}
                            <div className="md:hidden space-y-2">
                                {visible.length === 0 ? (
                                    <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
                                        <div className="text-4xl mb-2">🔍</div>
                                        <div className="text-slate-500 font-medium">לא נמצאו לקוחות</div>
                                    </div>
                                ) : visible.map(c => (
                                    <Link
                                        key={c.id}
                                        href={`/clients/${c.id}`}
                                        className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 px-4 py-3.5 active:scale-[0.98] transition-transform"
                                    >
                                        <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-base font-bold text-slate-600 flex-shrink-0">
                                            {(c.full_name || "?")[0].toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-slate-800 truncate flex items-center gap-2">
                                                {c.full_name || c.id.slice(0, 8)}
                                                {c.is_club_member && (
                                                    <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">👑</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-400 mt-0.5 font-mono" dir="ltr">
                                                {c.phone || "אין טלפון"}
                                            </div>
                                        </div>
                                        <svg className="w-4 h-4 text-slate-300 flex-shrink-0 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                        </svg>
                                    </Link>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Delete confirm modal */}
                {deletingClientId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 text-center">
                            <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 mb-1">מחיקת לקוח</h3>
                            <p className="text-sm text-slate-500 mb-6">הלקוח יוסתר מהמערכת. פעולה זו ניתנת לביטול.</p>
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
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">שם מלא *</label>
                                    <input value={newName} onChange={e => setNewName(e.target.value)} type="text"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 focus:border-slate-300 transition" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">טלפון *</label>
                                    <input value={newPhone} onChange={e => setNewPhone(e.target.value)} type="tel" dir="ltr"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 focus:border-slate-300 transition text-left" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">אימייל <span className="text-slate-400 font-normal">(אופציונלי)</span></label>
                                    <input value={newEmail} onChange={e => setNewEmail(e.target.value)} type="email" dir="ltr"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 focus:border-slate-300 transition text-left" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">תאריך לידה <span className="text-slate-400 font-normal">(אופציונלי)</span></label>
                                    <input value={newBirthDate} onChange={e => setNewBirthDate(e.target.value)} type="date"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 focus:border-slate-300 transition" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">הערות <span className="text-slate-400 font-normal">(אופציונלי)</span></label>
                                    <textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 focus:border-slate-300 transition resize-none" />
                                </div>
                                <label className="flex items-center gap-3 cursor-pointer p-3 bg-amber-50 rounded-xl border border-amber-100">
                                    <input type="checkbox" checked={isClubMember} onChange={e => setIsClubMember(e.target.checked)}
                                        className="w-4 h-4 rounded accent-black" />
                                    <div>
                                        <div className="text-sm font-bold text-amber-800">חבר מועדון 👑</div>
                                        <div className="text-xs text-amber-600">מקבל הטבות ונקודות</div>
                                    </div>
                                </label>
                            </div>
                            <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
                                <button onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition">ביטול</button>
                                <button onClick={handleCreateClient} disabled={isSaving}
                                    className="flex-1 py-2.5 text-sm font-semibold text-white bg-black hover:bg-sky-700 rounded-xl transition disabled:opacity-50">
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
