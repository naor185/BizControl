"use client";

// Approving a deposit — from the calendar's appointment and from לוח בקרה (one window for both). What came in (as
// asked, or "הלקוח שילם סכום אחר?"), how, whether the client gets the receipt's link; then the receipt that was made.
// The picture of the payment the client attached on the payment page shows on top (services/deposit_report).
import { useState } from "react";
import { Banknote, CreditCard, FileText, Landmark, Receipt, Smartphone, type LucideIcon } from "lucide-react";
import { apiFetch, imgUrl } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { useBackButtonClose } from "@/lib/backButtonStack";

export type DepositToConfirm = {
    appointmentId: string;
    amountCents: number;
    clientName: string;
    proofUrl?: string | null;
    reportedAt?: string | null;
};

const METHODS: { value: string; label: string; icon: LucideIcon }[] = [
    { value: "bit", label: "Bit", icon: Smartphone },
    { value: "paybox", label: "PayBox", icon: Smartphone },
    { value: "cash", label: "מזומן", icon: Banknote },
    { value: "credit_card", label: "כרטיס", icon: CreditCard },
    { value: "bank_transfer", label: "העברה", icon: Landmark },
    { value: "check", label: "צ'ק", icon: FileText },
];

export default function DepositConfirmModal({ deposit, onClose, onConfirmed }: {
    deposit: DepositToConfirm;
    onClose: () => void;
    onConfirmed: () => void;      // approved — the parent refreshes what it shows
}) {
    const [method, setMethod] = useState("bit");
    const [sendReceipt, setSendReceipt] = useState(true);
    // the client paid another amount than the deposit asked (owner, 2026-10-14: "asked 200, paid 400") — null: as asked
    const [paid, setPaid] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [receiptId, setReceiptId] = useState<string | null>(null);
    useBackButtonClose(true, onClose);

    const confirm = async () => {
        const paidCents = paid === null ? deposit.amountCents : Math.round(Number(paid) * 100);
        if (!(paidCents > 0)) { setError("הקלידו את הסכום שהתקבל"); return; }
        setBusy(true);
        setError(null);
        try {
            const other = paidCents !== deposit.amountCents ? `&amount_cents=${paidCents}` : "";
            const res = await apiFetch<{ invoice_id: string | null }>(
                `/api/appointments/${deposit.appointmentId}/verify-payment?method=${method}&send_receipt=${sendReceipt}${other}`,
                { method: "POST" });
            onConfirmed();
            if (res.invoice_id) setReceiptId(res.invoice_id);
            else onClose();
        } catch (e: unknown) {
            setError((e as { message?: string })?.message || "האישור לא נשמר");
        } finally {
            setBusy(false);
        }
    };

    if (receiptId) return (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-3xl w-full max-w-sm p-8 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
                <Receipt className="w-12 h-12 mx-auto mb-3 text-emerald-600" aria-hidden />
                <div className="text-xl font-black text-slate-800 mb-1">קבלה נוצרה!</div>
                <div className="text-sm text-slate-500 mb-6">המקדמה אושרה והקבלה הופקה בהצלחה</div>
                <div className="flex gap-3">
                    <button type="button" onClick={onClose}
                        className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold text-sm">
                        סגור
                    </button>
                    <button type="button" onClick={() => window.open(`/receipt/${receiptId}`, "_blank")}
                        className="flex-[2] py-3 rounded-2xl bg-slate-900 text-white font-black text-sm hover:bg-slate-700 transition">
                        צפה בקבלה
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end justify-center" onClick={onClose}>
            <div className="bg-white rounded-t-3xl w-full max-w-md p-6 max-h-[92dvh] overflow-y-auto" dir="rtl"
                style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }} onClick={e => e.stopPropagation()}>
                <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
                <div className="text-center mb-5">
                    <div className="text-lg font-black text-slate-800">אישור קבלת מקדמה</div>
                    <div className="text-sm text-slate-500 mt-0.5">{deposit.clientName}</div>
                    {paid === null ? (
                        <>
                            <div className="text-3xl font-black text-emerald-600 mt-2">₪{(deposit.amountCents / 100).toLocaleString()}</div>
                            <button type="button" onClick={() => setPaid(String(deposit.amountCents / 100))}
                                className="mt-1.5 text-sm font-bold text-sky-700 underline underline-offset-2">
                                הלקוח שילם סכום אחר?
                            </button>
                        </>
                    ) : (
                        <label className="block mt-3">
                            <span className="block text-xs font-bold text-slate-500 mb-1">כמה התקבל בפועל?</span>
                            <span className="inline-flex items-center gap-1 text-3xl font-black text-emerald-600">
                                ₪<input type="number" inputMode="decimal" min={1} autoFocus value={paid}
                                    onChange={e => setPaid(e.target.value)}
                                    className="w-36 text-center bg-emerald-50 border-2 border-emerald-200 rounded-xl py-1 outline-none focus:border-emerald-500" />
                            </span>
                            <span className="block text-xs text-slate-500 mt-1.5">
                                המקדמה שנדרשה: ₪{(deposit.amountCents / 100).toLocaleString()} · התשלום, הקבלה והיתרה יהיו לפי הסכום שהתקבל
                            </span>
                            <button type="button" onClick={() => setPaid(null)} className="mt-1 text-xs font-bold text-slate-500 underline">חזרה לסכום שנדרש</button>
                        </label>
                    )}
                </div>

                {deposit.proofUrl && (
                    <a href={imgUrl(deposit.proofUrl)} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-3 mb-5 p-2 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imgUrl(deposit.proofUrl)} alt="צילום התשלום ששלח הלקוח" className="w-14 h-20 object-cover rounded-lg border border-slate-200" />
                        <span className="text-sm text-slate-700 text-right">
                            <span className="block font-bold">הצילום ששלח הלקוח</span>
                            <span className="block text-xs text-slate-500">לחיצה פותחת בגודל מלא</span>
                        </span>
                    </a>
                )}

                <div data-tour="deposit-confirm" className="mb-5">
                    <div className="text-xs font-bold text-slate-500 mb-2 text-right">באיזה אמצעי קיבלת?</div>
                    <div className="grid grid-cols-3 gap-2">
                        {METHODS.map(m => (
                            <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                                className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-xs font-bold transition-all ${
                                    method === m.value ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                                }`}>
                                <m.icon className="w-5 h-5" aria-hidden />
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>

                <button type="button" onClick={() => setSendReceipt(v => !v)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 transition-all mb-4 ${sendReceipt ? "bg-sky-50 border-sky-300" : "bg-slate-50 border-slate-200"}`}>
                    <Switch as="span" checked={sendReceipt} onColor="bg-sky-500" />
                    <span className={`text-sm font-bold ${sendReceipt ? "text-sky-700" : "text-slate-500"}`}>
                        {sendReceipt ? "שלח קישור קבלה ללקוח" : "אל תשלח קישור קבלה"}
                    </span>
                </button>

                {error && <div className="mb-3 text-center text-sm font-medium text-rose-600 bg-rose-50 rounded-xl py-2 px-3">{error}</div>}

                <div className="flex gap-3">
                    <button type="button" onClick={onClose}
                        className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold text-sm">
                        ביטול
                    </button>
                    <button type="button" onClick={confirm} disabled={busy}
                        className="flex-[2] py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm disabled:opacity-60 hover:bg-emerald-700 transition">
                        {busy ? "מאשר..." : "אשר וצור קבלה"}
                    </button>
                </div>
            </div>
        </div>
    );
}
