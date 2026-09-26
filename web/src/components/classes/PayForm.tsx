"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { PAYMENT_METHODS } from "@/lib/classes";

// Recording a payment (the system never charges money): amount, method, and whether the client gets
// the receipt. Shared by a membership, a course, a fee and a single entry. `fixedAmount` = the amount cannot
// be changed (a fee is paid in full). `refund` = recording money given back (a course) — no receipt here.

export default function PayForm({ defaultAmountCents, fixedAmount, refund, busy, onPay, onCancel }: {
    defaultAmountCents: number; fixedAmount?: boolean; refund?: boolean; busy: boolean;
    onPay: (p: { amount_cents: number; method: string; send_receipt: boolean }) => void; onCancel: () => void;
}) {
    const [amount, setAmount] = useState<number | "">(defaultAmountCents ? defaultAmountCents / 100 : "");
    const [method, setMethod] = useState("cash");
    const [receipt, setReceipt] = useState(true);
    const cents = amount === "" ? 0 : Math.round(amount * 100);
    return (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-600">סכום (₪)
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
            {!refund && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={receipt} onChange={e => setReceipt(e.target.checked)} /> לשלוח קבלה ללקוח
                </label>
            )}
            <div className="flex gap-2">
                <button type="button" disabled={busy || cents <= 0} onClick={() => onPay({ amount_cents: cents, method, send_receipt: receipt })}
                    className={`inline-flex items-center gap-2 min-h-10 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-40 ${refund ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} {refund ? "רישום החזר" : "רישום תשלום"}
                </button>
                <button type="button" onClick={onCancel} className="min-h-10 px-3 text-sm text-slate-600">ביטול</button>
            </div>
            <p className="text-xs text-slate-500">{refund ? "המערכת רושמת את ההחזר — היא לא מעבירה כסף." : "המערכת רושמת את התשלום ומפיקה קבלה — היא לא גובה כסף."}</p>
        </div>
    );
}
