"use client";

import { toast } from "@/lib/toast";
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

    const [couponCode, setCouponCode] = useState("");
    const [couponDiscount, setCouponDiscount] = useState(0);
    const [couponLoading, setCouponLoading] = useState(false);
    const [couponError, setCouponError] = useState("");
    const [couponValid, setCouponValid] = useState(false);

    const [splitEnabled, setSplitEnabled] = useState(false);
    const [splitAmt1, setSplitAmt1] = useState<string>("");
    const [splitMethod2, setSplitMethod2] = useState<string>("bit");
    const [sendReceipt, setSendReceipt] = useState(true);

    useEffect(() => {
        if (appointment && isOpen) {
            setAmount((appointment.remaining_cents / 100).toFixed(0));
            setPointsRedeemed(0);
            setUsePoints(false);
            setNotes("");
            setMethod("cash");
            setType("payment");
            setSelectedProducts([]);
            setCouponCode("");
            setCouponDiscount(0);
            setCouponError("");
            setCouponValid(false);
            setSplitEnabled(false);
            setSplitAmt1("");
            setSplitMethod2("bit");
            setSendReceipt(true);
            getProducts().then(setAllProducts).catch(console.error);
        }
    }, [appointment, isOpen]);

    if (!isOpen || !appointment) return null;

    const availablePoints = appointment.client_loyalty_points;
    // 1 point = 1 ₪ discount
    const maxRedeem = Math.min(availablePoints, Math.round(parseFloat(amount || "0")));
    const discountAmount = usePoints ? pointsRedeemed : 0;
    const couponDiscountAmount = couponValid && couponDiscount > 0
        ? parseFloat(amount || "0") * couponDiscount / 100
        : 0;
    const cashAmount = Math.max(0, parseFloat(amount || "0") - discountAmount - couponDiscountAmount);
    const totalDisplay = parseFloat(amount || "0");

    // Split payment
    const splitAmt1Num = Math.max(0, Math.min(parseFloat(splitAmt1 || "0"), cashAmount));
    const splitAmt2Num = Math.max(0, cashAmount - splitAmt1Num);

    const handlePointsChange = (val: number) => {
        const clamped = Math.max(0, Math.min(val, maxRedeem));
        setPointsRedeemed(clamped);
    };

    const validateCoupon = async () => {
        if (!couponCode.trim()) return;
        setCouponLoading(true);
        setCouponError("");
        try {
            const res = await apiFetch(`/api/coupons/validate?code=${encodeURIComponent(couponCode.trim())}`);
            setCouponDiscount(res.discount_percent);
            setCouponValid(true);
            setCouponError("");
        } catch {
            setCouponDiscount(0);
            setCouponValid(false);
            setCouponError("קוד קופון לא תקין, כבר נוצל, או פג תוקפו");
        } finally {
            setCouponLoading(false);
        }
    };

    const handleSave = async () => {
        if (!amount && !usePoints) return;
        if (splitEnabled && splitAmt1Num <= 0) {
            toast.error("יש להזין סכום חלקי גדול מ-0");
            return;
        }
        try {
            setIsSaving(true);
            const base = {
                appointment_id: appointment.appointment_id,
                client_id: appointment.client_id,
                currency: "ILS",
                type,
                status: "paid",
                product_items: selectedProducts.map(p => ({
                    product_id: p.product_id,
                    quantity: p.quantity,
                    price_cents: Math.round(Math.max(0, p.price - (p.discount || 0)) * 100),
                })),
            };

            if (splitEnabled) {
                // First payment (includes points/coupon deduction)
                await apiFetch("/api/payments", {
                    method: "POST",
                    body: JSON.stringify({
                        ...base,
                        amount_cents: Math.round(splitAmt1Num * 100),
                        points_redeemed: usePoints ? pointsRedeemed : 0,
                        method,
                        notes: notes ? `${notes} [חלק 1 מפיצול]` : "[חלק 1 מפיצול]",
                        coupon_code: couponValid && couponCode.trim() ? couponCode.trim().toUpperCase() : null,
                        send_receipt: sendReceipt,
                    }),
                });
                // Second payment — no discounts (already applied to first), no second receipt
                await apiFetch("/api/payments", {
                    method: "POST",
                    body: JSON.stringify({
                        ...base,
                        amount_cents: Math.round(splitAmt2Num * 100),
                        points_redeemed: 0,
                        method: splitMethod2,
                        notes: notes ? `${notes} [חלק 2 מפיצול]` : "[חלק 2 מפיצול]",
                        coupon_code: null,
                        product_items: [],
                        send_receipt: false,
                    }),
                });
            } else {
                await apiFetch("/api/payments", {
                    method: "POST",
                    body: JSON.stringify({
                        ...base,
                        amount_cents: Math.round(parseFloat(amount || "0") * 100),
                        points_redeemed: usePoints ? pointsRedeemed : 0,
                        method,
                        notes,
                        coupon_code: couponValid && couponCode.trim() ? couponCode.trim().toUpperCase() : null,
                        send_receipt: sendReceipt,
                    }),
                });
            }
            onSuccess();
        } catch (e: unknown) {
            toast.error((e as { message?: string })?.message || "שגיאה בשמירת תשלום");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 animate-in fade-in duration-200" dir="rtl">
            <div className="bg-white rounded-2xl w-full max-w-[360px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="bg-sky-600 px-4 py-3 text-white flex justify-between items-center shrink-0">
                    <h3 className="text-sm font-bold truncate ml-2">💳 תשלום — {appointment.client_name}</h3>
                    <button onClick={onClose} className="text-white/70 hover:text-white text-lg leading-none">✕</button>
                </div>

                <div className="p-4 space-y-4 text-right overflow-y-auto flex-1">

                    {/* Method + Type */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">אמצעי תשלום</label>
                            <select title="אמצעי תשלום" value={method} onChange={e => setMethod(e.target.value)}
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
                            <select title="סוג פעולה" value={type} onChange={e => setType(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-slate-800 outline-none">
                                <option value="payment">תשלום יתרה</option>
                                <option value="deposit">מקדמה</option>
                            </select>
                        </div>
                    </div>

                    {/* Split payment toggle */}
                    <button
                        type="button"
                        onClick={() => {
                            setSplitEnabled(v => !v);
                            if (!splitEnabled) setSplitAmt1((cashAmount / 2).toFixed(0));
                        }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border-2 transition-all text-sm font-bold ${splitEnabled ? "border-sky-400 bg-sky-50 text-sky-800" : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"}`}
                    >
                        <div className={`w-9 h-5 rounded-full transition-colors relative ${splitEnabled ? "bg-sky-500" : "bg-slate-300"}`}>
                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${splitEnabled ? "left-4" : "left-0.5"}`} />
                        </div>
                        <span>פיצול תשלום — שתי שיטות</span>
                    </button>

                    {/* Split rows */}
                    {splitEnabled ? (
                        <div className="space-y-2">
                            <div className="flex gap-2 items-center">
                                <div className="flex-1">
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">חלק 1 (₪)</label>
                                    <input
                                        type="number" min={0} max={cashAmount} step={1}
                                        placeholder="0"
                                        title="סכום חלק ראשון"
                                        value={splitAmt1}
                                        onChange={e => setSplitAmt1(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-lg font-black text-slate-900 outline-none focus:ring-2 focus:ring-sky-400 text-left"
                                        dir="ltr"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">אמצעי תשלום</label>
                                    <select title="אמצעי תשלום חלק 1" value={method} onChange={e => setMethod(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2.5 text-xs font-bold text-slate-800 outline-none">
                                        <option value="cash">מזומן 💵</option>
                                        <option value="credit_card">אשראי 💳</option>
                                        <option value="bit">ביט 📱</option>
                                        <option value="paybox">פייבוקס</option>
                                        <option value="bank_transfer">העברה</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-2 items-center">
                                <div className="flex-1">
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">חלק 2 — יתרה (₪)</label>
                                    <div className="w-full bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-lg font-black text-emerald-700 text-left" dir="ltr">
                                        {splitAmt2Num.toFixed(0)}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">אמצעי תשלום</label>
                                    <select title="אמצעי תשלום חלק 2" value={splitMethod2} onChange={e => setSplitMethod2(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2.5 text-xs font-bold text-slate-800 outline-none">
                                        <option value="cash">מזומן 💵</option>
                                        <option value="credit_card">אשראי 💳</option>
                                        <option value="bit">ביט 📱</option>
                                        <option value="paybox">פייבוקס</option>
                                        <option value="bank_transfer">העברה</option>
                                    </select>
                                </div>
                            </div>
                            <div className="bg-sky-50 border border-sky-100 rounded-xl px-3 py-2 flex justify-between text-xs font-bold text-sky-800">
                                <span dir="ltr">{cashAmount.toFixed(0)} ₪</span>
                                <span>סה״כ ({splitAmt1Num.toFixed(0)} + {splitAmt2Num.toFixed(0)})</span>
                            </div>
                        </div>
                    ) : (
                    /* Amount */
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
                    )}

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
                    {((usePoints && pointsRedeemed > 0) || (couponValid && couponDiscount > 0)) && (
                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 space-y-1.5">
                            <div className="flex justify-between text-sm text-slate-600">
                                <span>{totalDisplay} ₪</span>
                                <span>סה"כ מחיר</span>
                            </div>
                            {couponValid && couponDiscount > 0 && (
                                <div className="flex justify-between text-sm text-indigo-600 font-bold">
                                    <span>- {couponDiscountAmount.toFixed(0)} ₪</span>
                                    <span>הנחת קופון 🎟️ ({couponDiscount}%)</span>
                                </div>
                            )}
                            {usePoints && pointsRedeemed > 0 && (
                                <div className="flex justify-between text-sm text-amber-600 font-bold">
                                    <span>- {pointsRedeemed} ₪</span>
                                    <span>הנחת נקודות ⭐</span>
                                </div>
                            )}
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
                                        className="w-16 text-left text-[10px] font-bold text-rose-500 bg-transparent outline-none" dir="ltr" />
                                    <span className="text-[10px] text-slate-400">הנחה (₪)</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Coupon Code */}
                    <div className={`rounded-2xl border-2 transition-all overflow-hidden ${couponValid ? "border-green-400 bg-green-50" : "border-slate-100 bg-slate-50"}`}>
                        <div className="px-4 py-3">
                            <p className="text-[11px] font-bold text-slate-600 mb-2 text-right">🎟️ קוד קופון (אופציונלי)</p>
                            <div className="flex gap-2" dir="ltr">
                                <button
                                    type="button"
                                    onClick={validateCoupon}
                                    disabled={couponLoading || !couponCode.trim() || couponValid}
                                    className="px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl disabled:opacity-50 shrink-0"
                                >
                                    {couponLoading ? "..." : couponValid ? "✓" : "אמת"}
                                </button>
                                <input
                                    type="text"
                                    value={couponCode}
                                    onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponValid(false); setCouponDiscount(0); setCouponError(""); }}
                                    onKeyDown={e => e.key === "Enter" && validateCoupon()}
                                    placeholder="NOA10"
                                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-400 text-left tracking-widest"
                                    dir="ltr"
                                />
                            </div>
                            {couponValid && (
                                <p className="text-xs text-green-700 font-bold mt-1 text-right">✅ קופון תקין — {couponDiscount}% הנחה ({couponDiscountAmount.toFixed(0)} ₪)</p>
                            )}
                            {couponError && (
                                <p className="text-xs text-red-500 mt-1 text-right">{couponError}</p>
                            )}
                        </div>
                    </div>

                    {/* Notes */}
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={1}
                        placeholder="הערות לתיעוד (אופציונלי)..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none resize-none" />

                    {/* Send receipt toggle */}
                    <button
                        type="button"
                        onClick={() => setSendReceipt(v => !v)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors ${sendReceipt ? "bg-sky-50 border-sky-200" : "bg-slate-50 border-slate-200"}`}
                    >
                        <span className={`text-xs font-bold ${sendReceipt ? "text-sky-700" : "text-slate-500"}`}>
                            {sendReceipt ? "📨 שלח קבלה ללקוח" : "🔕 לא לשלוח קבלה ללקוח"}
                        </span>
                        <div className={`relative w-9 h-5 rounded-full transition-colors ${sendReceipt ? "bg-sky-500" : "bg-slate-300"}`}>
                            <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${sendReceipt ? "right-0.5" : "left-0.5"}`} />
                        </div>
                    </button>
                </div>

                {/* Footer */}
                <div className="px-4 pb-4 pt-3 flex gap-2 shrink-0 border-t border-slate-100">
                    <button onClick={onClose} className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors">
                        ביטול
                    </button>
                    <button onClick={handleSave} disabled={isSaving || (!amount && !usePoints)}
                        className="flex-[2] py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-xl shadow-lg transition-all disabled:opacity-50">
                        {isSaving ? "שומר..." : (
                            (usePoints && pointsRedeemed > 0) || (couponValid && couponDiscount > 0)
                                ? `אישור תשלום (${cashAmount.toFixed(0)} ₪) ✅`
                                : "אישור תשלום ✅"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
