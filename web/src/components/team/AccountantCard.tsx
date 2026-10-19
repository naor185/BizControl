"use client";

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

import { tx } from "@/lib/i18n";
// The month's hours and pay to the accountant (app/services/payroll_report.py): the team's report (PDF) and every
// shift (Excel) — now, by hand, or by itself on the 1st for the month before (the owner, 2026-10-19).

type Accountant = { email: string | null; auto: boolean; last_auto: string | null };
const MONTHS = [tx("ינואר"), tx("פברואר"), tx("מרץ"), tx("אפריל"), tx("מאי"), tx("יוני"), tx("יולי"), tx("אוגוסט"), tx("ספטמבר"), tx("אוקטובר"), tx("נובמבר"), tx("דצמבר")];

export default function AccountantCard({ month }: { month: { year: number; month: number } }) {
    const [acc, setAcc] = useState<Accountant | null>(null);
    const [sending, setSending] = useState(false);

    useEffect(() => { apiFetch<Accountant>("/api/staff/payroll/accountant").then(setAcc).catch(() => {}); }, []);

    const send = async () => {
        setSending(true);
        try {
            const r = await apiFetch<{ to: string; shifts: number }>("/api/staff/payroll/send-to-accountant",
                { method: "POST", body: JSON.stringify(month) });
            toast.success(tx("נשלח ל-{0} — הדוח ו-{1} משמרות", { 0: r.to, 1: r.shifts }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : tx("השליחה נכשלה"));
        } finally {
            setSending(false);
        }
    };
    const setAuto = async (on: boolean) => {
        try { setAcc(await apiFetch<Accountant>("/api/staff/payroll/accountant/auto", { method: "POST", body: JSON.stringify({ on }) })); }
        catch (e) { toast.error(e instanceof Error ? e.message : tx("השמירה נכשלה")); }
    };

    if (!acc) return null;
    return (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3" aria-labelledby="to-accountant">
            <div>
                <h2 id="to-accountant" className="font-bold text-slate-900">{tx("לרואה החשבון")}</h2>
                <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                    {tx("דוח השכר של הצוות (PDF) וכל המשמרות של החודש בקובץ לאקסל — תאריך, כניסה, יציאה ושעות לכל עובד/ת. סיכום מהמערכת, לא תלוש רשמי: את הניכויים מכין רואה החשבון.")}
                </p>
            </div>
            {acc.email ? (
                <>
                    <button type="button" onClick={send} disabled={sending}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-60">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />}
                        {tx("שליחת")} {MONTHS[month.month - 1]}{tx(" ל-")}<bdi dir="ltr">{acc.email}</bdi>
                    </button>
                    <div className="flex items-center gap-3 pt-1">
                        <p id="acc-auto" className="flex-1 text-sm text-slate-700">
                            {tx("לשלוח לבד בראשון לכל חודש את החודש שעבר")}
                            {acc.auto && acc.last_auto && <span className="block text-xs text-slate-500">{tx("נשלח לאחרונה: ")}{acc.last_auto.split("-").reverse().join("/")}</span>}
                        </p>
                        <Switch checked={acc.auto} labelledBy="acc-auto" onChange={setAuto} />
                    </div>
                </>
            ) : (
                <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    {tx("עוד לא הוגדר מייל של רואה החשבון — מגדירים אותו ב")}<a href="/automation?tab=finance" className="font-semibold underline">{tx("הגדרות ← פיננסים ותשלומים")}</a>.
                </p>
            )}
        </section>
    );
}
