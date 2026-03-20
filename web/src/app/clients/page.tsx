"use client";

import { useEffect, useState } from "react";
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

export default function Page() {
    const [items, setItems] = useState<Client[]>([]);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'regular' | 'club'>('all');
    const [birthdayMonth, setBirthdayMonth] = useState<number | 'all'>('all');

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
        } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setErr(e?.message || "שגיאה בטעינת לקוחות");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadClients();
    }, []);

    const handleDeleteClient = async () => {
        if (!deletingClientId) return;
        try {
            await apiFetch(`/api/clients/${deletingClientId}`, { method: "DELETE" });
            setDeletingClientId(null);
            loadClients();
        } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            alert(e?.message || "שגיאה במחיקת לקוח");
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
                    is_club_member: isClubMember
                }),
            });
            setIsModalOpen(false);
            setNewName("");
            setNewPhone("");
            setNewEmail("");
            setNewBirthDate("");
            setNewNotes("");
            setIsClubMember(false);
            loadClients();
        } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            alert(e?.message || "שגיאה ביצירת לקוח");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <RequireAuth>
            <AppShell title="לקוחות">
                {loading && <div className="text-sm text-gray-500">טוען...</div>}

                {err && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                        {err}
                    </div>
                )}

                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-slate-800">רשימת לקוחות</h2>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                        + הוסף לקוח
                    </button>
                </div>

                {!loading && !err && (
                    <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all whitespace-nowrap ${filter === 'all' ? 'bg-slate-800 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                            כל הלקוחות
                        </button>
                        <button
                            onClick={() => setFilter('regular')}
                            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all whitespace-nowrap ${filter === 'regular' ? 'bg-blue-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                            לקוחות רגילים
                        </button>
                        <button
                            onClick={() => setFilter('club')}
                            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all whitespace-nowrap ${filter === 'club' ? 'bg-pink-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                            חברי מועדון 👑
                        </button>
                    </div>
                )}

                {!loading && !err && (
                    <div className="mb-6 bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xl">🎂</span>
                            <span className="text-sm font-bold text-slate-700">סינון ימי הולדת:</span>
                        </div>
                        <select
                            value={birthdayMonth}
                            onChange={(e) => setBirthdayMonth(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
                        >
                            <option value="all">כל החודשים</option>
                            <option value="1">ינואר</option>
                            <option value="2">פברואר</option>
                            <option value="3">מרץ</option>
                            <option value="4">אפריל</option>
                            <option value="5">מאי</option>
                            <option value="6">יוני</option>
                            <option value="7">יולי</option>
                            <option value="8">אוגוסט</option>
                            <option value="9">ספטמבר</option>
                            <option value="10">אוקטובר</option>
                            <option value="11">נובמבר</option>
                            <option value="12">דצמבר</option>
                        </select>
                        {birthdayMonth !== 'all' && (
                            <span className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded-full animate-pulse">
                                מציג ימי הולדת בחודש זה ✨
                            </span>
                        )}
                    </div>
                )}

                {!loading && !err && (
                    <div className="overflow-hidden rounded-xl border bg-white">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-600">
                                <tr>
                                    <th className="text-right p-3 font-medium">שם</th>
                                    <th className="text-right p-3 font-medium">טלפון</th>
                                    <th className="text-right p-3 font-medium">אימייל</th>
                                    <th className="text-center p-3 font-medium w-16">פעולות</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.filter(c => {
                                    if (filter === 'regular') return !c.is_club_member;
                                    if (filter === 'club') return c.is_club_member;
                                    return true;
                                }).filter(c => {
                                    if (birthdayMonth === 'all') return true;
                                    if (!c.birth_date) return false;
                                    const bDate = new Date(c.birth_date);
                                    return bDate.getMonth() + 1 === birthdayMonth;
                                }).map((c) => (
                                    <tr key={c.id} className="border-t hover:bg-gray-50 cursor-pointer">
                                        <td className="p-3">
                                            <Link className="font-medium underline text-blue-600 flex items-center gap-2" href={`/clients/${c.id}`}>
                                                {c.full_name || c.id.slice(0, 8)}
                                                {c.is_club_member && (
                                                    <span className="bg-pink-100 text-pink-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                                        חבר מועדון 👑
                                                    </span>
                                                )}
                                            </Link>
                                        </td>
                                        <td className="p-3" dir="ltr">{c.phone || "-"}</td>
                                        <td className="p-3" dir="ltr">{c.email || "-"}</td>
                                        <td className="p-3 text-center">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setDeletingClientId(c.id); }}
                                                className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-full hover:bg-red-50"
                                                title="מחק לקוח"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </td>
                                    </tr>
                                ))}

                                {items.length === 0 && (
                                    <tr>
                                        <td className="p-3 text-gray-500 text-center" colSpan={3}>
                                            אין לקוחות עדיין.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {deletingClientId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-xl overflow-hidden p-6 text-center animate-in zoom-in-95 duration-200">
                            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">מחיקת לקוח</h3>
                            <p className="text-sm text-slate-500 mb-6">האם אתה בטוח שברצונך למחוק לקוח זה? פעולה זו תסתיר את הלקוח מהמערכת.</p>
                            <div className="flex justify-center gap-3">
                                <button onClick={() => setDeletingClientId(null)} className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                                    ביטול
                                </button>
                                <button onClick={handleDeleteClient} className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-lg ring-1 ring-red-700 transition-colors">
                                    כן, מחק
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
                            <div className="bg-slate-50 border-b border-slate-100 p-4 flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-800">הוסף לקוח חדש</h3>
                                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                            </div>
                            <div className="p-4 space-y-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">שם מלא *</label>
                                    <input value={newName} onChange={e => setNewName(e.target.value)} type="text" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">טלפון *</label>
                                    <input value={newPhone} onChange={e => setNewPhone(e.target.value)} type="tel" dir="ltr" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-left" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">אימייל <span className="text-slate-400 font-normal">(אופציונלי)</span></label>
                                    <input value={newEmail} onChange={e => setNewEmail(e.target.value)} type="email" dir="ltr" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-left" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">תאריך לידה <span className="text-slate-400 font-normal">(אופציונלי 🎉)</span></label>
                                    <input value={newBirthDate} onChange={e => setNewBirthDate(e.target.value)} type="date" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">הערות פנימיות <span className="text-slate-400 font-normal">(אופציונלי)</span></label>
                                    <textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer mt-2 bg-pink-50 p-3 rounded-lg border border-pink-100">
                                    <input
                                        type="checkbox"
                                        checked={isClubMember}
                                        onChange={e => setIsClubMember(e.target.checked)}
                                        className="w-4 h-4 text-pink-600"
                                    />
                                    <span className="text-sm font-bold text-pink-700">צרף כמועדון לקוחות (Club Member)</span>
                                </label>
                            </div>
                            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">ביטול</button>
                                <button onClick={handleCreateClient} disabled={isSaving} className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
                                    {isSaving ? "שומר..." : "שמור לקוח"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
