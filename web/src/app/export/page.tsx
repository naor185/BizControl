"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, KeyRound, Mail, ShieldCheck } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { API_BASE, getCurrentUserRole, getToken } from "@/lib/api";
import { toast } from "@/lib/toast";

import { tx } from "@/lib/i18n";
// The business's clients and appointments in one Excel file — to keep, or to move to another system (owner,
// 2026-10-14). Owner only, with his PIN (app/api/data_export_routes.py); written in the activity log.

export default function ExportPage() {
    const [pin, setPin] = useState("");
    const [busy, setBusy] = useState<"download" | "email" | null>(null);
    const [isOwner, setIsOwner] = useState<boolean | null>(null);       // from the sign-in — known in the browser only
    useEffect(() => { setIsOwner(getCurrentUserRole() === "owner"); }, []);

    const run = async (deliver: "download" | "email") => {
        if (!/^\d{4}$/.test(pin)) { toast.error(tx("הקלידו את קוד ה-PIN — 4 ספרות")); return; }
        setBusy(deliver);
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/api/data-export`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ pin, deliver }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || tx("הייצוא נכשל"));
            if (deliver === "email") {
                const { email } = await res.json();
                toast.success(tx("הקובץ נשלח ל-{0}", { 0: email }));
            } else {
                const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "BizControl.xlsx";
                const a = document.createElement("a");
                a.href = URL.createObjectURL(await res.blob());
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                toast.success(tx("הקובץ ירד"));
            }
            setPin("");
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    return (
        <RequireAuth>
            <AppShell title={tx("ייצוא לאקסל")}>
                <div className="p-4 md:p-8 max-w-xl mx-auto space-y-6">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2"><FileSpreadsheet className="w-7 h-7 text-emerald-600" aria-hidden />{tx(" ייצוא לאקסל")}</h1>
                        <p className="mt-2 text-slate-500 leading-relaxed">
                            {tx("כל הלקוחות והתורים שלך בקובץ אחד — לשמירה, לרואה החשבון או למעבר למערכת אחרת. כל מערכת יודעת לקלוט קובץ כזה.")}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-2 text-sm text-slate-600">
                        <div className="font-bold text-slate-800">{tx("מה בקובץ")}</div>
                        <div><b>{tx("לקוחות:")}</b>{tx(" שם, טלפון, מייל, תאריך לידה, הערות, נקודות, מועדון, אישור דיוור, מספר תורים, ביקור אחרון ומה שולם.")}</div>
                        <div><b>{tx("תורים:")}</b>{tx(" תאריך ושעה, לקוח, שירות, איש צוות, סטטוס, מחיר, מקדמה ומה שולם — עבר ועתיד.")}</div>
                        <div className="text-slate-500">{tx("לא בקובץ: הצהרות בריאות, חתימות ותמונות טיפול — מידע רפואי ואישי שנשאר אצלנו.")}</div>
                    </div>

                    {isOwner === null ? null : !isOwner ? (
                        <p className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm font-medium">{tx("הייצוא פתוח לבעל העסק בלבד.")}</p>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                            <label className="block">
                                <span className="flex items-center gap-1.5 text-sm font-bold text-slate-700 mb-2"><KeyRound className="w-4 h-4" aria-hidden />{tx(" קוד ה-PIN שלך")}</span>
                                <input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin}
                                    onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                                    className="w-40 text-center tracking-[0.5em] text-2xl font-black bg-slate-50 border border-slate-200 rounded-xl py-2.5 outline-none focus:ring-2 focus:ring-emerald-500" />
                            </label>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <button type="button" onClick={() => run("download")} disabled={busy !== null}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-60">
                                    <Download className="w-4 h-4" aria-hidden /> {busy === "download" ? tx("מכין...") : tx("הורדת הקובץ")}
                                </button>
                                <button type="button" onClick={() => run("email")} disabled={busy !== null}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-bold disabled:opacity-60">
                                    <Mail className="w-4 h-4" aria-hidden /> {busy === "email" ? tx("שולח...") : tx("שליחה למייל שלי")}
                                </button>
                            </div>
                            <p className="flex items-start gap-1.5 text-xs text-slate-500">
                                <ShieldCheck className="w-4 h-4 shrink-0 mt-px" aria-hidden />
                                {tx("הקובץ כולל פרטים אישיים של הלקוחות — שמרו אותו במקום בטוח. כל ייצוא נרשם ביומן הפעילות. באפליקציה בטלפון — השתמשו ב\"שליחה למייל\".")}
                            </p>
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
