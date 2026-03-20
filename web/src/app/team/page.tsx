"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

type Artist = {
    id: string;
    email: string;
    display_name: string;
    role: string;
    is_active: boolean;
    calendar_color?: string | null;
    pay_type: "hourly" | "commission" | "none";
    hourly_rate: number;
    commission_rate: number;
};

// Preset colors for artists
const COLOR_PRESETS = [
    "#3b82f6", // Blue
    "#10b981", // Emerald
    "#ef4444", // Red
    "#8b5cf6", // Violet
    "#f59e0b", // Amber
    "#ec4899", // Pink
    "#06b6d4", // Cyan
    "#14b8a6", // Teal
    "#f97316", // Orange
    "#6366f1", // Indigo
];

export default function TeamPage() {
    const [artists, setArtists] = useState<Artist[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUserId, setEditingUserId] = useState<string | null>(null);

    // Form states
    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [calendarColor, setCalendarColor] = useState(COLOR_PRESETS[0]);
    const [isActive, setIsActive] = useState(true);
    const [payType, setPayType] = useState<"hourly" | "commission" | "none">("none");
    const [hourlyRate, setHourlyRate] = useState(0);
    const [commissionRate, setCommissionRate] = useState(0);

    // Deletion state
    const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

    const loadArtists = async () => {
        setLoading(true);
        setErr(null);
        try {
            const data = await apiFetch<Artist[]>("/api/users/artists");
            setArtists(data);
        } catch (e: any) {
            setErr(e?.message || "שגיאה בטעינת הצוות");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadArtists();
    }, []);

    const openCreateModal = () => {
        setEditingUserId(null);
        setDisplayName("");
        setEmail("");
        setPassword("");
        setCalendarColor(COLOR_PRESETS[0]);
        setIsActive(true);
        setPayType("none");
        setHourlyRate(0);
        setCommissionRate(0);
        setIsModalOpen(true);
    };

    const openEditModal = (artist: Artist) => {
        setEditingUserId(artist.id);
        setDisplayName(artist.display_name || "");
        setEmail(artist.email || "");
        setPassword(""); // never show password, only edit if filled
        setCalendarColor(artist.calendar_color || COLOR_PRESETS[0]);
        setIsActive(artist.is_active);
        setPayType(artist.pay_type || "none");
        setHourlyRate(artist.hourly_rate || 0);
        setCommissionRate(artist.commission_rate || 0);
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!displayName.trim() || (!editingUserId && (!email.trim() || !password.trim()))) {
            alert("נא למלא את כל שדות החובה");
            return;
        }

        try {
            const payload: any = {
                display_name: displayName,
                calendar_color: calendarColor,
                is_active: isActive,
                pay_type: payType,
                hourly_rate: hourlyRate,
                commission_rate: commissionRate,
            };

            if (editingUserId) {
                // Update
                if (password.trim()) {
                    payload.password = password; // Only send password if we want to change it
                }
                await apiFetch(`/api/users/artists/${editingUserId}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload)
                });
            } else {
                // Create
                payload.email = email;
                payload.password = password;
                await apiFetch("/api/users/artists", {
                    method: "POST",
                    body: JSON.stringify(payload)
                });
            }

            setIsModalOpen(false);
            loadArtists();
        } catch (e: any) {
            alert(e?.message || "שגיאה בשמירת המקעקע");
        }
    };

    const handleDelete = async () => {
        if (!deletingUserId) return;
        try {
            await apiFetch(`/api/users/artists/${deletingUserId}`, { method: "DELETE" });
            setDeletingUserId(null);
            loadArtists();
        } catch (e: any) {
            alert(e?.message || "שגיאה במחיקת משתמש");
        }
    };

    return (
        <RequireAuth>
            <AppShell title="ניהול צוות ומקעקעים">
                <div className="p-4 md:p-8 max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500">

                    {/* Header */}
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                                צוות הסטודיו 👥
                            </h1>
                            <p className="mt-2 text-slate-500 max-w-xl leading-relaxed">
                                ניהול נציגים, מנהלים ומקעקעים. ניתן לבחור איזה צבע יציג כל מקעקע ביומן.
                            </p>
                        </div>
                        <button
                            onClick={openCreateModal}
                            className="flex items-center justify-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 transition-all w-full md:w-auto"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            הוסף איש צוות
                        </button>
                    </div>

                    {err && (
                        <div className="bg-red-50 text-red-600 p-4 rounded-2xl border border-red-100 flex items-center gap-3">
                            <span className="text-xl">⚠️</span>
                            <p className="font-medium text-sm">{err}</p>
                        </div>
                    )}

                    {/* Artists List */}
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/40 border border-slate-100 overflow-hidden">
                        {loading ? (
                            <div className="p-12 flex flex-col justify-center items-center">
                                <div className="animate-spin w-10 h-10 border-4 border-slate-800 border-t-transparent rounded-full mb-4"></div>
                                <p className="text-slate-500 font-medium">טוען נתוני צוות...</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-right border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 text-sm">
                                            <th className="p-4 font-semibold w-16 text-center">צבע ביומן</th>
                                            <th className="p-4 font-semibold">שם תצוגה</th>
                                            <th className="p-4 font-semibold">אימייל (כניסה)</th>
                                            <th className="p-4 font-semibold">תפקיד</th>
                                            <th className="p-4 font-semibold">הגדרות שכר</th>
                                            <th className="p-4 font-semibold text-center">פעיל</th>
                                            <th className="p-4 font-semibold text-center">פעולות</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {artists.map(artist => (
                                            <tr key={artist.id} className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="p-4">
                                                    <div className="flex justify-center">
                                                        <div
                                                            className="w-8 h-8 rounded-full shadow-sm ring-1 ring-black/5"
                                                            style={{ backgroundColor: artist.calendar_color || "#3b82f6" }}
                                                        ></div>
                                                    </div>
                                                </td>
                                                <td className="p-4 font-medium text-slate-800">{artist.display_name}</td>
                                                <td className="p-4 text-slate-500" dir="ltr">{artist.email}</td>
                                                <td className="p-4">
                                                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${artist.role === "owner" ? "bg-purple-100 text-purple-700" :
                                                            artist.role === "admin" ? "bg-blue-100 text-blue-700" :
                                                                "bg-emerald-100 text-emerald-700"
                                                        }`}>
                                                        {artist.role}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <div className="text-xs font-medium text-slate-600">
                                                        {artist.pay_type === "hourly" ? `שעתי: ₪${artist.hourly_rate}` : 
                                                         artist.pay_type === "commission" ? `עמלה: ${artist.commission_rate}%` : 
                                                         "ללא שכר"}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-center">
                                                    {artist.is_active ?
                                                        <span className="text-emerald-500 w-full flex justify-center"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></span> :
                                                        <span className="text-slate-300 w-full flex justify-center"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></span>
                                                    }
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={() => openEditModal(artist)}
                                                            className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-colors"
                                                            title="ערוך"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                            </svg>
                                                        </button>
                                                        {artist.role !== 'owner' && (
                                                            <button
                                                                onClick={() => setDeletingUserId(artist.id)}
                                                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                                                title="מחק"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {artists.length === 0 && !loading && (
                                            <tr>
                                                <td colSpan={6} className="p-8 text-center text-slate-500">
                                                    לא נמצאו חברי צוות במערכת.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                {/* Create/Edit Modal */}
                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                            <div className="bg-slate-50 border-b border-slate-100 p-5 flex items-center justify-between shrink-0">
                                <h3 className="text-xl font-bold text-slate-800">{editingUserId ? "עריכת איש צוות" : "הוספת איש צוות"}</h3>
                                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-white rounded-full transition-colors">✕</button>
                            </div>

                            <div className="p-6 space-y-4 overflow-y-auto">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">שם תצוגה (מופיע ללקוחות)</label>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={e => setDisplayName(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-slate-800"
                                        placeholder="לדוגמא: דניאל המקעקע"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">צבע ביומן</label>
                                    <p className="text-xs text-slate-500 mb-2">בחר צבע שבו יופיעו התורים של איש צוות זה ביומן.</p>
                                    <div className="flex flex-wrap gap-3">
                                        {COLOR_PRESETS.map(color => (
                                            <button
                                                key={color}
                                                type="button"
                                                onClick={() => setCalendarColor(color)}
                                                className={`w-10 h-10 rounded-full shadow-sm ring-2 ring-offset-2 transition-all ${calendarColor === color ? 'ring-slate-800 scale-110' : 'ring-transparent hover:scale-105'}`}
                                                style={{ backgroundColor: color }}
                                            />
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-100">
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">הגדרות שכר (Payroll)</label>
                                    <div className="flex gap-2 mb-3">
                                        {(["none", "hourly", "commission"] as const).map((t) => (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => setPayType(t)}
                                                className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all ${
                                                    payType === t 
                                                    ? 'bg-slate-900 text-white border-slate-900 shadow-md' 
                                                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                                }`}
                                            >
                                                {t === "none" ? "ללא" : t === "hourly" ? "שעתי" : "עמלה"}
                                            </button>
                                        ))}
                                    </div>

                                    {payType === "hourly" && (
                                        <div className="animate-in slide-in-from-top-2 duration-200">
                                            <label className="block text-xs font-bold text-slate-500 mb-1">תעריף שעה (₪)</label>
                                            <input
                                                type="number"
                                                value={hourlyRate}
                                                onChange={e => setHourlyRate(Number(e.target.value))}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-slate-800"
                                                placeholder="לדוגמא: 50"
                                            />
                                        </div>
                                    )}

                                    {payType === "commission" && (
                                        <div className="animate-in slide-in-from-top-2 duration-200">
                                            <label className="block text-xs font-bold text-slate-500 mb-1">אחוז עמלה מהכנסות (%)</label>
                                            <input
                                                type="number"
                                                value={commissionRate}
                                                onChange={e => setCommissionRate(Number(e.target.value))}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-slate-800"
                                                placeholder="לדוגמא: 30"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="pt-4 border-t border-slate-100">
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">אימייל (לכניסה למערכת)</label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        disabled={!!editingUserId}
                                        dir="ltr"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-slate-800 disabled:opacity-50"
                                        placeholder="user@example.com"
                                    />
                                    {editingUserId && <p className="text-xs text-slate-500 mt-1">לא ניתן לשנות אימייל למשתמש קיים.</p>}
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">סיסמה {editingUserId ? '(השאר ריק כדי לא לשנות)' : ''}</label>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        dir="ltr"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-slate-800"
                                        placeholder="********"
                                    />
                                </div>

                                {editingUserId && (
                                    <label className="flex items-center gap-3 pt-4 border-t border-slate-100 cursor-pointer group">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={isActive}
                                                onChange={e => setIsActive(e.target.checked)}
                                                className="sr-only"
                                            />
                                            <div className={`w-11 h-6 rounded-full transition-colors ${isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                                            <div className={`absolute top-1 bg-white w-4 h-4 rounded-full transition-all shadow-sm ${isActive ? 'left-1' : 'left-6'}`}></div>
                                        </div>
                                        <div className="text-sm font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                                            משתמש פעיל (מורשה להתחבר)
                                        </div>
                                    </label>
                                )}
                            </div>

                            <div className="bg-slate-50 p-5 flex justify-end gap-3 shrink-0 rounded-b-3xl">
                                <button onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">ביטול</button>
                                <button onClick={handleSave} className="px-6 py-2.5 text-sm font-bold text-white bg-slate-900 shadow-lg shadow-slate-900/20 hover:bg-slate-800 rounded-xl transition-all">
                                    שמור שינויים
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Delete Modal */}
                {deletingUserId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-xl p-6 text-center animate-in zoom-in-95 duration-200">
                            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">הסרת איש צוות</h3>
                            <p className="text-sm text-slate-500 mb-6">האם אתה בטוח שברצונך להסיר איש צוות זה מהמערכת? פעולה זו תמנע ממנו להתחבר.</p>
                            <div className="flex justify-center gap-3">
                                <button onClick={() => setDeletingUserId(null)} className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                                    ביטול
                                </button>
                                <button onClick={handleDelete} className="px-5 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg ring-1 ring-red-700 rounded-xl transition-colors">
                                    כן, הסר
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
