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
    const [pointsRedeemed, setPointsRedeemed] = useState<string>("0");
    const [isSaving, setIsSaving] = useState(false);

    // Products integration
    const [allProducts, setAllProducts] = useState<Product[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<{product_id: string, quantity: number, name: string, price: number, discount: number}[]>([]);
    const [showProductPicker, setShowProductPicker] = useState(false);

    useEffect(() => {
        if (appointment && isOpen) {
            setAmount((appointment.remaining_cents / 100).toString());
            setPointsRedeemed("0");
            setNotes("");
            setMethod("cash");
            setType("payment");
            setSelectedProducts([]);
            
            // Load products
            getProducts().then(setAllProducts).catch(console.error);
        }
    }, [appointment, isOpen]);


    if (!isOpen || !appointment) return null;

    const handleSave = async () => {
        if (!amount && (!pointsRedeemed || pointsRedeemed === "0")) return;
        try {
            setIsSaving(true);
            await apiFetch("/api/payments", {
                method: "POST",
                body: JSON.stringify({
                    appointment_id: appointment.appointment_id,
                    client_id: appointment.client_id,
                    amount_cents: Math.round(parseFloat(amount || "0") * 100),
                    points_redeemed: parseInt(pointsRedeemed || "0", 10),
                    currency: "ILS",
                    type: type,
                    method: method,
                    status: "paid",
                    notes: notes,
                    product_items: selectedProducts.map(p => ({
                        product_id: p.product_id,
                        quantity: p.quantity,
                        price_cents: Math.round(Math.max(0, p.price - (p.discount || 0)) * 100)
                    }))
                })
            });
            onSuccess();
        } catch (e: any) {
            alert(e?.message || "שגיאה בשמירת תשלום");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 animate-in fade-in duration-200" dir="rtl">
            <div className="bg-white rounded-2xl w-full max-w-[340px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="bg-sky-600 p-3 text-white text-right">
                    <div className="flex justify-between items-center">
                        <h3 className="text-sm font-bold truncate ml-2">תשלום: {appointment.client_name}</h3>
                        <button onClick={onClose} className="text-white/60 hover:text-white text-lg">✕</button>
                    </div>
                </div>

                <div className="p-3 space-y-3 text-right">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">אמצעי תשלום</label>
                            <select
                                value={method}
                                onChange={e => setMethod(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-xs font-bold text-slate-800 outline-none"
                            >
                                <option value="cash">מזומן 💵</option>
                                <option value="credit_card">אשראי 💳</option>
                                <option value="bit">ביט (Bit) 📱</option>
                                <option value="paybox">פייבוקס (Paybox)</option>
                                <option value="bank_transfer">העברה בנקאית</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">סוג פעולה</label>
                            <select
                                value={type}
                                onChange={e => setType(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-xs font-bold text-slate-800 outline-none"
                            >
                                <option value="payment">תשלום יתרה</option>
                                <option value="deposit">מקדמה</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 text-right">סכום ומימוש נקודות</label>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="relative">
                                <input
                                    type="number"
                                    step="0.1"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    className="w-full bg-slate-100 border-none rounded-lg px-4 py-2 text-lg font-black text-slate-900 focus:ring-2 focus:ring-emerald-500/20 outline-none text-left appearance-none"
                                    dir="ltr"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">₪</span>
                                <div className="text-[10px] text-slate-400 mt-0.5 text-right">חיוב בכסף</div>
                            </div>
                            <div className="relative">
                                <input
                                    type="number"
                                    min="0"
                                    max={appointment.client_loyalty_points}
                                    value={pointsRedeemed}
                                    onChange={e => setPointsRedeemed(e.target.value)}
                                    className="w-full bg-slate-100 border-none rounded-lg px-4 py-2 text-lg font-black text-rose-500 focus:ring-2 focus:ring-emerald-500/20 outline-none text-left appearance-none"
                                    dir="ltr"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">⭐</span>
                                <div className="text-[10px] text-slate-400 mt-0.5 text-right">{appointment.client_loyalty_points} נק׳</div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">הערות לתיעוד</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={1}
                            placeholder="הערות..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none resize-none"
                        />
                    </div>

                    <div className="pt-3 border-t-2 border-slate-100">
                        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-2.5 mb-2">
                            <div className="flex justify-between items-center">
                                <div className="text-right">
                                    <h4 className="text-[11px] font-black text-indigo-900">הוספת מוצר מהמלאי? 🛍️</h4>
                                </div>
                                <button 
                                    type="button"
                                    onClick={() => setShowProductPicker(!showProductPicker)}
                                    className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-all"
                                >
                                    {showProductPicker ? "סגור" : "+ פתח"}
                                </button>
                            </div>
                        </div>

                        {showProductPicker && (
                            <div className="bg-slate-50 rounded-2xl p-3 mb-3 border border-slate-100 max-h-48 overflow-y-auto space-y-2">
                                {allProducts.length === 0 ? (
                                    <div className="text-center py-4 text-xs text-slate-400">אין מוצרים במלאי</div>
                                ) : (
                                    allProducts.map(p => (
                                        <div key={p.id} className="flex items-center justify-between p-2 hover:bg-white rounded-xl transition-colors">
                                            <div className="text-right">
                                                <div className="text-sm font-bold text-slate-800">{p.name}</div>
                                                <div className="text-[10px] text-slate-500">₪{p.price} | מלאי: {p.stock_quantity}</div>
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    const existing = selectedProducts.find(sp => sp.product_id === p.id);
                                                    if (existing) {
                                                        setSelectedProducts(selectedProducts.map(sp => 
                                                            sp.product_id === p.id ? {...sp, quantity: sp.quantity + 1} : sp
                                                        ));
                                                    } else {
                                                        setSelectedProducts([...selectedProducts, {
                                                            product_id: p.id,
                                                            quantity: 1,
                                                            name: p.name,
                                                            price: p.price,
                                                            discount: 0
                                                        }]);
                                                    }
                                                    // Increment total amount by product price
                                                    setAmount(prev => (parseFloat(prev || "0") + Number(p.price)).toFixed(2));
                                                }}
                                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-3 py-1 rounded-lg text-xs font-bold"
                                            >
                                                + הוסף
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                                {selectedProducts.map(p => (
                                    <div key={p.product_id} className="bg-emerald-50/50 p-2 rounded-xl border border-emerald-100 flex flex-col gap-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <button 
                                                    onClick={() => {
                                                        if (p.quantity > 1) {
                                                            setSelectedProducts(selectedProducts.map(sp => 
                                                                sp.product_id === p.product_id ? {...sp, quantity: sp.quantity - 1} : sp
                                                            ));
                                                        } else {
                                                            setSelectedProducts(selectedProducts.filter(sp => sp.product_id !== p.product_id));
                                                        }
                                                        // Decrement total amount by product price
                                                        setAmount(prev => Math.max(0, parseFloat(prev || "0") - Number(p.price)).toFixed(2));
                                                    }}
                                                    className="w-6 h-6 flex items-center justify-center bg-white rounded-full text-emerald-600 font-bold shadow-sm"
                                                >
                                                    -
                                                </button>
                                                <span className="text-xs font-bold text-slate-700 w-4 text-center">{p.quantity}</span>
                                                <button 
                                                    onClick={() => {
                                                        setSelectedProducts(selectedProducts.map(sp => 
                                                            sp.product_id === p.product_id ? {...sp, quantity: sp.quantity + 1} : sp
                                                        ));
                                                        // Increment total amount by product price
                                                        setAmount(prev => (parseFloat(prev || "0") + Number(p.price)).toFixed(2));
                                                    }}
                                                    className="w-6 h-6 flex items-center justify-center bg-white rounded-full text-emerald-600 font-bold shadow-sm"
                                                >
                                                    +
                                                </button>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs font-bold text-slate-800">{p.name}</div>
                                                <div className="text-[10px] text-slate-500">מחיר מלא: ₪{p.price * p.quantity}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 bg-white/50 p-1.5 rounded-lg border border-emerald-100">
                                            <label className="text-[10px] font-bold text-slate-500 whitespace-nowrap">הנחה (₪):</label>
                                            <input 
                                                type="number"
                                                min="0"
                                                max={p.price * p.quantity}
                                                value={p.discount || ""}
                                                onChange={e => {
                                                    const d = e.target.value === "" ? 0 : parseFloat(e.target.value);
                                                    const diff = d - (p.discount || 0);
                                                    setSelectedProducts(selectedProducts.map(sp => 
                                                        sp.product_id === p.product_id ? {...sp, discount: d} : sp
                                                    ));
                                                    // Adjust total amount by discount diff
                                                    setAmount(prev => Math.max(0, parseFloat(prev || "0") - diff).toFixed(2));
                                                }}
                                                className="w-full bg-transparent border-none text-[10px] font-bold text-rose-500 p-0 outline-none text-left"
                                                placeholder="0.00"
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>
                                ))}
                    </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2 text-xs font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        ביטול
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || (!amount && (!pointsRedeemed || pointsRedeemed === "0"))}
                        className="flex-[2] py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-lg shadow-lg transition-all disabled:opacity-50"
                    >
                        {isSaving ? "שומר..." : "אישור תשלום ✅"}
                    </button>
                </div>
            </div>
        </div>
    );
}
