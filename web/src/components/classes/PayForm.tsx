"use client";

import { useState } from "react";
import { Loader2, Ticket, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { PAYMENT_METHODS } from "@/lib/classes";

// Recording a payment (the system never charges money): amount, method, and whether the client gets
// the receipt. Shared by a membership, a course, a fee, a single entry and a room rental. `fixedAmount` = the amount
// cannot be changed (a fee is paid in full). `refund` = recording money given back (a course) — no receipt here.
// A coupon (the business's own or a birthday one): the amount is the price before it; the server takes the percent
// off and the discount closes the rest of the bill. Not on a fee or a refund.

export default function PayForm({ defaultAmountCents, fixedAmount, refund, busy, onPay, onCancel, clientId }: {
    defaultAmountCents: number; fixedAmount?: boolean; refund?: boolean; busy: boolean;
    onPay: (p: { amount_cents: number; method: string; send_receipt: boolean; coupon_code?: string }) => void; onCancel: () => void;
    clientId?: string;             // who pays — a coupon for one use per client is checked for them
}) {
    const [amount, setAmount] = useState<number | "">(defaultAmountCents ? defaultAmountCents / 100 : "");
    const [method, setMethod] = useState("cash");
    const [receipt, setReceipt] = useState(true);
    const [code, setCode] = useState("");
    const [coupon, setCoupon] = useState<{ code: string; percent: number } | null>(null);
    const [couponErr, setCouponErr] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const cents = amount === "" ? 0 : Math.round(amount * 100);
    const discount = coupon ? Math.round(cents * coupon.percent / 100) : 0;
    const takesCoupon = !fixedAmount && !refund;

    const check = async () => {
        if (!code.trim()) return;
        setChecking(true);
        setCouponErr(null);
        try {
            const who = clientId ? `&client_id=${clientId}` : "";
            const r = await apiFetch<{ code: string; discount_percent: number }>(`/api/coupons/validate?code=${encodeURIComponent(code.trim())}${who}`);
            setCoupon({ code: r.code, percent: r.discount_percent });
        } catch (e) {
            setCoupon(null);
            setCouponErr(e instanceof Error ? e.message : "הקופון לא תקין");
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-600">{coupon ? "מחיר לפני קופון (₪)" : "סכום (₪)"}
                    <input type="number" min={1} value={amount} disabled={fixedAmount} dir="ltr"
                        onChange={e => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                        className="block mt-1 w-24 min-h-10 rounded-lg border border-slate-200 text-center tabular-nums disabled:bg-slate-50" />
                </label>
                <label className="text-xs text-slate-600 flex-1 min-w-[8rem]">אמצעי תשלום
                    <select value={method} onChange={e => setMethod(e.target.value)} className="block mt-1 w-full min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                </label>
            </div>
            {takesCoupon && (
                coupon ? (
                    <div className="flex items-center gap-2 rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-sm text-violet-800">
                        <Ticket className="w-4 h-4 shrink-0" aria-hidden />
                        <span className="flex-1">קופון <b dir="ltr">{coupon.code}</b> — {coupon.percent}% הנחה · ישולם <b className="tabular-nums">₪{((cents - discount) / 100).toLocaleString("he-IL")}</b></span>
                        <button type="button" onClick={() => { setCoupon(null); setCode(""); }} aria-label="הסרת הקופון" className="text-violet-500 hover:text-violet-800"><X className="w-4 h-4" /></button>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <div className="flex gap-2">
                            <input value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setCouponErr(null); }} dir="ltr" placeholder="קוד קופון (לא חובה)"
                                className="flex-1 min-w-0 min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-mono" />
                            <button type="button" onClick={check} disabled={!code.trim() || checking}
                                className="inline-flex items-center gap-1 min-h-10 px-3 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 disabled:opacity-40">
                                {checking && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />} בדיקה
                            </button>
                        </div>
                        {couponErr && <p className="text-xs text-rose-600">{couponErr}</p>}
                    </div>
                )
            )}
            {!refund && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={receipt} onChange={e => setReceipt(e.target.checked)} /> לשלוח קבלה ללקוח
                </label>
            )}
            <div className="flex gap-2">
                <button type="button" disabled={busy || cents <= 0 || (!!code.trim() && !coupon && takesCoupon)}
                    onClick={() => onPay({ amount_cents: cents, method, send_receipt: receipt, ...(coupon ? { coupon_code: coupon.code } : {}) })}
                    className={`inline-flex items-center gap-2 min-h-10 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-40 ${refund ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} {refund ? "רישום החזר" : "רישום תשלום"}
                </button>
                <button type="button" onClick={onCancel} className="min-h-10 px-3 text-sm text-slate-600">ביטול</button>
            </div>
            <p className="text-xs text-slate-500">{refund ? "המערכת רושמת את ההחזר — היא לא מעבירה כסף." : "המערכת רושמת את התשלום ומפיקה קבלה — היא לא גובה כסף."}</p>
        </div>
    );
}
