"use client";

// The links to pay sent to clients (services/payment_requests) on לוח בקרה — sent, or reported paid with a picture —
// and the approval: how the money came in, the receipt to the client; the sale is recorded then (in the till, or as
// the appointment's payment) and the window says it was received (the owner, 2026-10-24: "every payment gets feedback").
import { useCallback, useEffect, useState } from "react";
import { Banknote, CircleCheck, CreditCard, Landmark, Link2, Smartphone, type LucideIcon } from "lucide-react";
import { apiFetch, imgUrl } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Switch } from "@/components/ui/switch";
import { tx } from "@/lib/i18n";

type Req = {
    id: string; status: "waiting" | "reported"; amount_cents: number; client_name: string | null; what: string;
    from: "till" | "appointment"; reported_at: string | null; proof_url: string | null; client_note: string | null;
};

const METHODS: { value: string; label: string; icon: LucideIcon }[] = [
    { value: "bit", label: "Bit", icon: Smartphone },
    { value: "paybox", label: "PayBox", icon: Smartphone },
    { value: "bank_transfer", label: tx("העברה"), icon: Landmark },
    { value: "cash", label: tx("מזומן"), icon: Banknote },
    { value: "credit_card", label: tx("כרטיס"), icon: CreditCard },
];

const ils = (c: number) => `₪${(c / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

export default function PaymentRequestsCard() {
    const [list, setList] = useState<Req[]>([]);
    const [approving, setApproving] = useState<Req | null>(null);
    const load = useCallback(() => {
        apiFetch<Req[]>("/api/payment-requests").then(setList).catch(() => setList([]));
    }, []);
    useEffect(() => {
        load();
        window.addEventListener("focus", load);
        return () => window.removeEventListener("focus", load);
    }, [load]);

    const cancel = async (r: Req) => {
        if (!confirm(tx("לבטל את הקישור לתשלום של {0}?", { 0: r.client_name || "" }))) return;
        try {
            await apiFetch(`/api/payment-requests/${r.id}/cancel`, { method: "POST" });
            toast.success(tx("הקישור בוטל"));
            load();
        } catch (e) { toast.error((e as Error)?.message || tx("שגיאה")); }
    };

    // the approval window stays until it's closed — with the last link approved the list is empty, and the window
    // (with its "received") must not go with it
    const windowEl = approving && <ApproveWindow req={approving} onClose={() => setApproving(null)} onDone={load} />;
    // the window in the same place in the tree whether the card shows or not — so it keeps its state
    return (
        <>
        {list.length > 0 && (
        <div id="payment-requests" className="bg-white rounded-2xl border-2 border-sky-300 shadow-sm overflow-hidden scroll-mt-24">
            <div className="px-5 py-4 bg-sky-50 border-b border-sky-200 flex items-center gap-3">
                <Link2 className="w-5 h-5 text-sky-700" aria-hidden />
                <div className="flex-1">
                    <div className="font-bold text-sky-900">{tx("קישורים לתשלום")}</div>
                    <div className="text-xs text-sky-700">{tx("קישורים שנשלחו ללקוחות בוואטסאפ — מי שלחץ \"שילמתי\" מסומן, עם הצילום ששלח")}</div>
                </div>
            </div>
            <div className="divide-y divide-slate-100">
                {list.map(r => (
                    <div key={r.id} className="px-5 py-4 flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-800 truncate">{r.client_name || tx("לקוח")} · <span dir="ltr">{ils(r.amount_cents)}</span></div>
                            <div className="text-xs text-slate-500 truncate">{r.what}</div>
                            {r.status === "reported" ? (
                                <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                                    <CircleCheck className="w-3.5 h-3.5" aria-hidden />{tx("הלקוח דיווח ששילם")}
                                </div>
                            ) : (
                                <div className="mt-1 inline-block text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{tx("נשלח — מחכה לתשלום")}</div>
                            )}
                            {r.client_note && <div className="text-xs text-slate-600 mt-1">“{r.client_note}”</div>}
                        </div>
                        {r.proof_url && (
                            <a href={imgUrl(r.proof_url)} target="_blank" rel="noopener noreferrer" className="shrink-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={imgUrl(r.proof_url)} alt={tx("צילום התשלום")} className="w-10 h-14 object-cover rounded-lg border border-slate-200" />
                            </a>
                        )}
                        <button type="button" onClick={() => setApproving(r)}
                            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700">{tx("קיבלתי")}</button>
                        <button type="button" onClick={() => cancel(r)}
                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50">{tx("ביטול")}</button>
                    </div>
                ))}
            </div>
        </div>
        )}
        {windowEl}
        </>
    );
}

function ApproveWindow({ req, onClose, onDone }: { req: Req; onClose: () => void; onDone: () => void }) {
    const [method, setMethod] = useState("bit");
    const [sendReceipt, setSendReceipt] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const approve = async () => {
        setBusy(true);
        setError(null);
        try {
            await apiFetch(`/api/payment-requests/${req.id}/approve`, { method: "POST", body: JSON.stringify({ method, send_receipt: sendReceipt }) });
            setDone(true);
            onDone();
        } catch (e) {
            setError((e as Error)?.message || tx("האישור לא נשמר"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
                {done ? (
                    <div className="text-center py-2">
                        <CircleCheck className="w-12 h-12 mx-auto mb-3 text-emerald-600" aria-hidden />
                        <div className="text-xl font-black text-slate-800 mb-1">{tx("התשלום התקבל")}</div>
                        <div className="text-sm text-slate-500 mb-6">
                            {req.from === "till" ? tx("המכירה נרשמה בקופה והקבלה הופקה") : tx("התשלום נרשם בתור והקבלה הופקה")}
                        </div>
                        <button type="button" onClick={onClose} className="w-full py-3 rounded-2xl bg-slate-900 text-white font-black text-sm">{tx("סגור")}</button>
                    </div>
                ) : (
                    <>
                        <div className="text-center mb-4">
                            <div className="text-lg font-black text-slate-800">{tx("אישור קבלת תשלום")}</div>
                            <div className="text-sm text-slate-500">{req.client_name}</div>
                            <div className="text-3xl font-black text-emerald-700 mt-1" dir="ltr">{ils(req.amount_cents)}</div>
                        </div>
                        <div className="text-xs font-bold text-slate-500 mb-2">{tx("באיזה אמצעי קיבלת?")}</div>
                        <div className="grid grid-cols-3 gap-2 mb-4">
                            {METHODS.map(m => (
                                <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                                    className={`rounded-2xl border-2 py-3 flex flex-col items-center gap-1 text-sm font-bold ${method === m.value ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                                    <m.icon className="w-5 h-5" aria-hidden />{m.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-sky-50 border border-sky-200 px-4 py-3 mb-4">
                            <span className="text-sm font-semibold text-slate-700">{tx("שלח קישור קבלה ללקוח")}</span>
                            <Switch size="sm" checked={sendReceipt} onChange={setSendReceipt} onColor="bg-sky-500" />
                        </div>
                        {error && <div className="text-sm text-rose-600 font-semibold mb-3">{error}</div>}
                        <div className="flex gap-3">
                            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold text-sm">{tx("ביטול")}</button>
                            <button type="button" onClick={approve} disabled={busy}
                                className="flex-[2] py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm disabled:opacity-50">
                                {busy ? tx("מאשר...") : tx("אשר וצור קבלה")}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
