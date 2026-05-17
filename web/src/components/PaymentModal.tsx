"use client";

import { useState, useEffect } from "react";
import { apiFetch, Product, getProducts } from "@/lib/api";

export type PaymentAppointmentInfo = {
    appointment_id: string;
    client_id: string;
    client_name: string;
    client_loyalty_points: number;
    remaining_cents: number;
};

type PaymentModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    appointment: PaymentAppointmentInfo | null;
};

export default function PaymentModal({ isOpen, onClose, onSuccess, appointment }: PaymentModalProps) {
    const [amount, setAmount] = useState<string>("");
    const [method, setMethod] = useState<string>("cash");
    const [type, setType] = useState<string>("payment");
    const [notes, setNotes] = useState<string>("");
    const [pointsRedeemed, setPointsRedeemed] = useState<number>(0);
    const [usePoints, setUsePoints] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [allProducts, setAllProducts] = useState<Product[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<{ product_id: string; quantity: number; name: string; price: number; discount: number }[]>([]);
    const [showProductPicker, setShowProductPicker] = useState(false);

    useEffect(() => {
        if (appointment && isOpen) {
            setAmount((appointment.remaining_cents / 100).toFixed(0));
            setPointsRedeemed(0);
            setUsePoints(false);
            setNotes("");
            setMethod("cash");
            setType("payment");
            setSelectedProducts([]);
            getProducts().then(setAllProducts).catch(console.error);
        }
    }, [appointment, isOpen]);

    if (!isOpen || !appointment) return null;

    const availablePoints = appointment.client_loyalty_points;
    // 1 point = 1 ₪ discount
    const maxRedeem = Math.min(availablePoints, Math.round(parseFloat(amount || "0")));
    const discountAmount = usePoints ? pointsRedeemed : 0;
    const cashAmount = Math.max(0, parseFloat(amount || "0") - discountAmount);
    const totalDisplay = parseFloat(amount || "0");

    const handlePointsChange = (val: number) => {
        const clamped = Math.max(0, Math.min(val, maxRedeem));
        setPointsRedeemed(clamped);
    };

    const handleSave = async () => {
        if (!amount && !usePoints) return;
        try {
            setIsSaving(true);
            await apiFetch("/api/payments", {
                method: "POST",
                body: JSON.stringify({
                    appointment_id: appointment.appointment_id,
                    client_id: appointment.client_id,
                    amount_cents: Math.round(cashAmount * 100),
                    points_redeemed: usePoints ? pointsRedeemed : 0,
                    currency: "ILS",
                    type,
                    method,
                    status: "paid",
                    notes,
                    product_items: selectedProducts.map(p => ({
                        product_id: p.product_id,
                        quantity: p.quantity,
                        price_cents: Math.round(Math.max(0, p.price - (p.discount || 0)) * 100),
                    })),
                }),
            });
            onSuccess();
        } catch (e: unknown) {
            alert((e as { message?: string })?.message || "שגיאה בשמירת תשלום");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 animate-in fade-in duration-200" dir="rtl">
            <div className="bg-white rounded-2xl w-full max-w-[360px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="bg-sky-600 px-4 py-3 text-white flex justify-between items-center">
                    <h3 className="text-sm font-bold truncate ml-2">💳 תשלום — {appointment.client_name}</h3>
                    <button onClick={onClose} className="text-white/70 hover:text-white text-lg leading-none">✕</button>
                </div>

                <div className="p-4 space-y-4 text-right">

                    {/* Method + Type */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">אמצעי תשלום</label>
                            <select value={method} onChange={e => setMethod(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-slate-800 outline-none">
                                <option value="cash">מזומן 💵</option>
                                <option value="credit_card">אשראי 💳</option>
                                <option value="bit">ביט 📱</option>
                                <option value="paybox">פייבוקס</option>
                                <option value="bank_transfer">העברה בנקאית</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">סוג פעולה</label>
                            <select value={type} onChange={e => setType(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-slate-800 outline-none">
                                <option value="payment">תשלום יתרה</option>
                                <option value="deposit">מקדמה</option>
                            </select>
                        </div>
                    </div>

                    {/* Amount */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">סכום לחיוב (₪)</label>
                        <div className="relative">
                            <input type="number" step="1" placeholder="0" value={amount}
                                onChange={e => {
                                    setAmount(e.target.value);
                                    if (pointsRedeemed > Math.round(parseFloat(e.target.value || "0"))) {
                                        setPointsRedeemed(Math.round(parseFloat(e.target.value || "0")));
                                    }
                                }}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xl font-black text-slate-900 outline-none focus:ring-2 focus:ring-sky-400 text-left"
                                dir="ltr" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">₪</span>
                        </div>
                    </div>

                    {/* Points Redemption */}
                    {availablePoints > 0 ? (
                        <div className={`rounded-2xl border-2 transition-all overflow-hidden ${usePoints ? "border-amber-400 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                            {/* Toggle header */}
                            <button type="button" onClick={() => { setUsePoints(v => !v); if (!usePoints) setPointsRedeemed(0); }}
                                className="w-full flex items-center justify-between px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">⭐</span>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-slate-800">מימוש נקודות</p>
                                        <p className="text-xs text-slate-500">{availablePoints} נקודות = {availablePoints} ₪ הנחה אפשרית</p>
                                    </div>
                                </div>
                                <div className={`w-11 h-6 rounded-full transition-all relative ${usePoints ? "bg-amber-400" : "bg-slate-300"}`}>
                                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${usePoints ? "left-5" : "left-0.5"}`} />
                                </div>
                            </button>

                            {/* Redemption controls */}
                            {usePoints && (
                                <div className="px-4 pb-4 space-y-3 border-t border-amber-200">
                                    {/* Quick buttons */}
                                    <div className="flex gap-2 pt-3">
                                        {[0, Math.floor(maxRedeem / 2), maxRedeem].map((v, i) => (
                                            <button key={i} type="button" onClick={() => handlePointsChange(v)}
                                                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all ${pointsRedeemed === v ? "bg-amber-400 text-white" : "bg-white border border-amber-200 text-amber-700 hover:bg-amber-100"}`}>
                                                {i === 0 ? "בלי" : i === 1 ? "חצי" : "הכל"}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Slider */}
                                    <div className="space-y-1">
                                        <input type="range" min={0} max={maxRedeem} value={pointsRedeemed}
                                            onChange={e => handlePointsChange(parseInt(e.target.value))}
                                            className="w-full accent-amber-400" />
                                        <div className="flex justify-between text-[10px] text-slate-400">
                                            <span>0 ⭐</span>
                                            <span className="font-bold text-amber-600">{pointsRedeemed} ⭐ = {pointsRedeemed} ₪ הנחה</span>
                                            <span>{maxRedeem} ⭐</span>
                                        </div>
                                    </div>

                                    {/* Or type manually */}
                                    <div className="flex items-center gap-2 bg-white rounded-xl border border-amber-200 px-3 py-2">
                                        <input type="number" min={0} max={maxRedeem} value={pointsRedeemed}
                                            onChange={e => handlePointsChange(parseInt(e.target.value) || 0)}
                                            className="w-20 text-left font-black text-amber-600 text-sm outline-none bg-transparent"
                                            dir="ltr" />
                                        <span className="text-xs text-slate-400">⭐ נקודות לניצול</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 flex items-center gap-2 text-slate-400">
                            <span>⭐</span>
                            <span className="text-xs">ללקוח זה אין נקודות לניצול</span>
                        </div>
                    )}

                    {/* Live Breakdown */}
                    {usePoints && pointsRedeemed > 0 && (
                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 space-y-1.5">
                            <div className="flex justify-between text-sm text-slate-600">
                                <span>{totalDisplay} ₪</span>
                                <span>סה"כ מחיר</span>
                            </div>
                            <div className="flex justify-between text-sm text-amber-600 font-bold">
                                <span>- {pointsRedeemed} ₪</span>
                                <span>הנחת נקודות ⭐</span>
                            </div>
                            <div className="h-px bg-emerald-200" />
                            <div className="flex justify-between text-base font-black text-emerald-700">
                                <span>{cashAmount.toFixed(0)} ₪</span>
                                <span>לתשלום במזומן/אשראי</span>
                            </div>
                        </div>
                    )}

                    {/* Products */}
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                            <button type="button" onClick={() => setShowProductPicker(!showProductPicker)}
                                className="bg-indigo-600 text-white px-3 py-1 rounded-lg text-[10px] font-bold">
                                {showProductPicker ? "סגור" : "+ הוסף"}
                            </button>
                            <span className="text-[11px] font-bold text-indigo-900">🛍️ מוצרים מהמלאי</span>
                        </div>

                        {showProductPicker && (
                            <div className="bg-white rounded-xl border border-indigo-100 max-h-40 overflow-y-auto space-y-1 p-2 mb-2">
                                {allProducts.length === 0 ? (
                                    <p className="text-center text-xs text-slate-400 py-3">אין מוצרים</p>
                                ) : allProducts.map(p => (
                                    <div key={p.id} className="flex items-center justify-between p-1.5 hover:bg-slate-50 rounded-lg">
                                        <button onClick={() => {
                                            const ex = selectedProducts.find(sp => sp.product_id === p.id);
                                            if (ex) setSelectedProducts(selectedProducts.map(sp => sp.product_id === p.id ? { ...sp, quantity: sp.quantity + 1 } : sp));
                                            else setSelectedProducts([...selectedProducts, { product_id: p.id, quantity: 1, name: p.name, price: p.price, discount: 0 }]);
                                            setAmount(prev => (parseFloat(prev || "0") + Number(p.price)).toFixed(0));
                                        }} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-1 rounded-lg text-[10px] font-bold">+ הוסף</button>
                                        <div className="text-right">
                                            <div className="text-xs font-bold text-slate-800">{p.name}</div>
                                            <div className="text-[10px] text-slate-400">₪{p.price}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {selectedProducts.map(p => (
                            <div key={p.product_id} className="bg-white rounded-xl border border-indigo-100 p-2 mb-1 flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <button onClick={() => { if (p.quantity > 1) setSelectedProducts(selectedProducts.map(sp => sp.product_id === p.product_id ? { ...sp, quantity: sp.quantity - 1 } : sp)); else setSelectedProducts(selectedProducts.filter(sp => sp.product_id !== p.product_id)); setAmount(prev => Math.max(0, parseFloat(prev || "0") - Number(p.price)).toFixed(0)); }} className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center">-</button>
                                        <span className="text-xs font-bold w-4 text-center">{p.quantity}</span>
                                        <button onClick={() => { setSelectedProducts(selectedProducts.map(sp => sp.product_id === p.product_id ? { ...sp, quantity: sp.quantity + 1 } : sp)); setAmount(prev => (parseFloat(prev || "0") + Number(p.price)).toFixed(0)); }} className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center">+</button>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-slate-800">{p.name}</div>
                                        <div className="text-[10px] text-slate-400">₪{p.price * p.quantity}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-2 py-1">
                                    <input type="number" min={0} max={p.price * p.quantity} value={p.discount || ""} placeholder="0"
                                        onChange={e => { const d = parseFloat(e.target.value) || 0; const diff = d - (p.discount || 0); setSelectedProducts(selectedProducts.map(sp => sp.product_id === p.product_id ? { ...sp, discount: d } : sp)); setAmount(prev => Math.max(0, parseFloat(prev || "0") - diff).toFixed(0)); }}
                                        className="w-16 text-left text-[10px] font-bold text-rose-500 bg-transparent outline-none" dir="ltr" placeholder="0.00" />
                                    <span className="text-[10px] text-slate-400">הנחה (₪)</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Notes */}
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={1}
                        placeholder="הערות לתיעוד (אופציונלי)..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none resize-none" />
                </div>

                {/* Footer */}
                <div className="px-4 pb-4 flex gap-2">
                    <button onClick={onClose} className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors">
                        ביטול
                    </button>
                    <button onClick={handleSave} disabled={isSaving || (!amount && !usePoints)}
                        className="flex-[2] py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-xl shadow-lg transition-all disabled:opacity-50">
                        {isSaving ? "שומר..." : `אישור תשלום${usePoints && pointsRedeemed > 0 ? ` (${cashAmount.toFixed(0)} ₪ + ${pointsRedeemed} ⭐)` : ""} ✅`}
                    </button>
                </div>
            </div>
        </div>
    );
}
