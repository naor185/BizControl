"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { apiFetch, clearToken } from "@/lib/api";

// Deleting my account (POST /api/account/delete — Apple requires it inside the app). The owner deletes the whole
// business: closed at once, everything erased after 30 days (until then support can bring it back). Anyone else
// on the team deletes their own login only. The password is asked again; the owner also types the business name.

export default function DeleteAccountSettings() {
    const [me, setMe] = useState<{ role: string; studio_name: string | null } | null>(null);
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<{ role: string; studio_name: string | null }>("/api/auth/me").then(setMe).catch(() => {});
    }, []);
    if (!me || me.role === "superadmin") return null;
    const owner = me.role === "owner";

    const remove = async () => {
        setBusy(true);
        setError(null);
        try {
            const r = await apiFetch<{ deleted: string; erase_on?: string }>("/api/account/delete", {
                method: "POST", body: JSON.stringify({ password, ...(owner ? { business_name: name } : {}) }),
            });
            setDone(r.deleted === "business"
                ? `העסק נמחק. כל הנתונים יימחקו לצמיתות ב-${new Date(r.erase_on!).toLocaleDateString("he-IL")}.`
                : "המשתמש שלך נמחק.");
            setTimeout(() => { clearToken(); window.location.href = "/login"; }, 3500);
        } catch (e) {
            setError(e instanceof Error ? e.message : "המחיקה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-rose-100 shadow-sm p-6 mt-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Trash2 className="w-6 h-6 text-rose-500 shrink-0 hidden sm:block" aria-hidden />
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><Trash2 className="w-5 h-5 text-rose-500 sm:hidden" aria-hidden />{owner ? "מחיקת העסק והחשבון" : "מחיקת המשתמש שלי"}</h3>
                    <p className="text-sm text-slate-500">
                        {owner
                            ? "סוגר את העסק מיד — אף אחד בצוות לא יוכל להתחבר, והעסק יורד מ-BizFind. אחרי 30 יום כל הנתונים נמחקים לצמיתות: לקוחות, תורים, תשלומים וקבלות. עד אז אפשר לבטל דרך התמיכה."
                            : "מוחק את פרטי הכניסה שלך (מייל, שם וסיסמה). התורים שעשית נשארים ברישומים של העסק."}
                    </p>
                </div>
                {!open && !done && (
                    <button type="button" onClick={() => setOpen(true)}
                        className="self-start sm:self-auto border border-rose-200 text-rose-600 text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-rose-50 whitespace-nowrap">
                        {owner ? "מחיקת העסק" : "מחיקת המשתמש"}
                    </button>
                )}
            </div>

            {done ? (
                <p className="mt-4 text-sm font-semibold text-slate-800 bg-slate-50 rounded-xl px-4 py-3">{done} מתנתקים…</p>
            ) : open && (
                <div className="mt-4 space-y-3 rounded-xl bg-rose-50/60 border border-rose-100 p-4">
                    {owner && (
                        <label className="block text-sm text-slate-700">
                            להמשך, הקלידו את שם העסק: <b>{me.studio_name}</b>
                            <input value={name} onChange={e => setName(e.target.value)} className="block mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white" />
                        </label>
                    )}
                    <label className="block text-sm text-slate-700">
                        הסיסמה שלך
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" dir="ltr"
                            className="block mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white" />
                    </label>
                    {error && <p className="text-sm text-rose-700">{error}</p>}
                    <div className="flex gap-2">
                        <button type="button" onClick={remove} disabled={busy || !password || (owner && name.trim() !== (me.studio_name || "").trim())}
                            className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-5 py-2.5 rounded-xl disabled:opacity-40">
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} {owner ? "מחיקת העסק לצמיתות" : "מחיקת המשתמש"}
                        </button>
                        <button type="button" onClick={() => { setOpen(false); setPassword(""); setName(""); setError(null); }} className="text-sm text-slate-600 px-3">ביטול</button>
                    </div>
                </div>
            )}
        </div>
    );
}
