"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";

// ── Types ─────────────────────────────────────────────────────────────────────

type Product = {
    id: string; name: string; price: number;
    category: string | null; stock_quantity: number; image_url: string | null;
};
type CartItem = {
    key: string; product_id: string | null;
    description: string; quantity: number; unit_price_cents: number;
};
type ClientResult = { id: string; name: string; phone: string | null; is_club_member?: boolean; };
type TransactionOut = {
    id: string; client_name: string | null; cashier_name: string | null;
    total_cents: number; discount_cents: number; method: string;
    items: { description: string; quantity: number; unit_price_cents: number; total_price_cents: number }[];
    points_earned: number; created_at: string;
};

const PAYMENT_METHODS = [
    { key: "cash",          label: "מזומן",        icon: "💵" },
    { key: "credit",        label: "אשראי",        icon: "💳" },
    { key: "bit",           label: "Bit",          icon: "📱" },
    { key: "paybox",        label: "PayBox",       icon: "📲" },
    { key: "bank_transfer", label: "העברה",        icon: "🏦" },
];

const METHOD_LABELS: Record<string, string> = {
    cash: "מזומן", credit: "אשראי", bit: "Bit",
    paybox: "PayBox", bank_transfer: "העברה בנקאית",
    credit_card: "אשראי", apple_pay: "Apple Pay", other: "אחר",
};

// ── Receipt Modal ─────────────────────────────────────────────────────────────
function ReceiptModal({ txn, onClose }: { txn: TransactionOut; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="bg-emerald-600 text-white px-6 py-5 text-center">
                    <div className="text-3xl mb-1">✅</div>
                    <div className="text-xl font-bold">תשלום בוצע בהצלחה!</div>
                    {txn.client_name && <div className="text-emerald-100 text-sm mt-1">{txn.client_name}</div>}
                </div>
                <div className="p-5 space-y-3">
                    <div className="space-y-1.5">
                        {txn.items.map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                                <span className="text-slate-700">{item.description} × {item.quantity}</span>
                                <span className="font-semibold">₪{(item.total_price_cents / 100).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                    <div className="border-t pt-3 space-y-1">
                        {txn.discount_cents > 0 && (
                            <div className="flex justify-between text-sm text-rose-600">
                                <span>הנחה</span><span>-₪{(txn.discount_cents / 100).toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-base font-bold">
                            <span>סה״כ</span>
                            <span className="text-emerald-700">₪{(txn.total_cents / 100).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-500">
                            <span>אמצעי תשלום</span>
                            <span>{METHOD_LABELS[txn.method] || txn.method}</span>
                        </div>
                    </div>
                    {txn.points_earned > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center text-sm">
                            <span className="text-amber-700 font-bold">+{txn.points_earned} נקודות</span>
                            <span className="text-amber-600"> נוספו ללקוח</span>
                        </div>
                    )}
                </div>
                <div className="px-5 pb-5">
                    <button onClick={onClose} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors">
                        מכירה חדשה
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Numpad ────────────────────────────────────────────────────────────────────
function Numpad({ display, onKey }: { display: string; onKey: (k: string) => void }) {
    const keys = [
        ["7","8","9"],
        ["4","5","6"],
        ["1","2","3"],
        [".","0","⌫"],
    ];
    return (
        <div className="grid grid-cols-3 gap-2">
            {keys.flat().map(k => (
                <button key={k} type="button" onClick={() => onKey(k)}
                    className={`h-12 rounded-xl font-bold text-lg transition-all active:scale-95 shadow-sm ${
                        k === "⌫"
                            ? "bg-rose-50 text-rose-500 border border-rose-200 hover:bg-rose-100"
                            : "bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 hover:border-emerald-300"
                    }`}>
                    {k}
                </button>
            ))}
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function PosPage() {
    // Data
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [method, setMethod] = useState("cash");
    const [client, setClient] = useState<ClientResult | null>(null);
    const [clientSearch, setClientSearch] = useState("");
    const [clientResults, setClientResults] = useState<ClientResult[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [receipt, setReceipt] = useState<TransactionOut | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

    // Calculator state
    const [calcDisplay, setCalcDisplay] = useState("0");
    const [itemDesc, setItemDesc] = useState("");

    // Discount state — % mode
    const [showDiscount, setShowDiscount] = useState(false);
    const [discountPct, setDiscountPct] = useState<number>(0);
    const [discountInput, setDiscountInput] = useState("");

    // Coupon
    const [couponCode, setCouponCode] = useState("");
    const [couponDiscount, setCouponDiscount] = useState<number>(0);
    const [couponLoading, setCouponLoading] = useState(false);
    const [couponError, setCouponError] = useState("");

    // New client
    const [showAddClient, setShowAddClient] = useState(false);
    const [newClientName, setNewClientName] = useState("");
    const [newClientPhone, setNewClientPhone] = useState("");
    const [addingClient, setAddingClient] = useState(false);

    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        apiFetch<Product[]>("/api/products/?is_active=true").then(setProducts).catch(() => {});
    }, []);

    useEffect(() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        if (!clientSearch.trim()) { setClientResults([]); return; }
        setSearchLoading(true);
        searchTimer.current = setTimeout(async () => {
            try {
                const res = await apiFetch<ClientResult[]>(`/api/clients/?q=${encodeURIComponent(clientSearch)}&limit=6`);
                setClientResults(res);
            } catch { }
            setSearchLoading(false);
        }, 300);
    }, [clientSearch]);

    const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean))) as string[];
    const filteredProducts = categoryFilter ? products.filter(p => p.category === categoryFilter) : products;

    // ── Calculator logic ───────────────────────────────────────────────────────
    const handleNumKey = useCallback((k: string) => {
        setCalcDisplay(prev => {
            if (k === "⌫") return prev.length <= 1 ? "0" : prev.slice(0, -1);
            if (k === "." && prev.includes(".")) return prev;
            if (k === "." && prev === "0") return "0.";
            if (prev === "0" && k !== ".") return k;
            return prev + k;
        });
    }, []);

    const handleAddItem = useCallback(() => {
        const price = parseFloat(calcDisplay);
        if (isNaN(price) || price <= 0) { toast.error("הכנס מחיר תקין"); return; }
        const desc = itemDesc.trim() || "פריט";
        const key = `manual-${Date.now()}`;
        setCart(prev => [...prev, { key, product_id: null, description: desc, quantity: 1, unit_price_cents: Math.round(price * 100) }]);
        setCalcDisplay("0");
        setItemDesc("");
    }, [calcDisplay, itemDesc]);

    const addProduct = (product: Product) => {
        setItemDesc(product.name);
        setCalcDisplay(String(Number(product.price).toFixed(2)));
        setCart(prev => {
            const existing = prev.find(i => i.product_id === product.id);
            if (existing) return prev.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
            return [...prev, { key: product.id, product_id: product.id, description: product.name, quantity: 1, unit_price_cents: Math.round(Number(product.price) * 100) }];
        });
    };

    const updateQty = (key: string, delta: number) => {
        setCart(prev => prev.map(i => i.key === key ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i).filter(i => i.quantity > 0));
    };

    const removeItem = (key: string) => setCart(prev => prev.filter(i => i.key !== key));

    // ── Discount ───────────────────────────────────────────────────────────────
    const applyDiscount = (pct: number) => {
        setDiscountPct(pct);
        setDiscountInput(String(pct));
        setShowDiscount(false);
    };

    // ── Coupon ─────────────────────────────────────────────────────────────────
    const validateCoupon = async () => {
        if (!couponCode.trim()) return;
        setCouponLoading(true); setCouponError("");
        try {
            const res = await apiFetch<{ discount_percent: number; client_name: string | null }>(`/api/coupons/validate?code=${encodeURIComponent(couponCode.trim().toUpperCase())}`);
            setCouponDiscount(res.discount_percent);
            toast.success(`קוד קופון תקין — ${res.discount_percent}% הנחה`);
        } catch {
            setCouponError("קוד לא תקין או כבר שומש");
            setCouponDiscount(0);
        } finally { setCouponLoading(false); }
    };

    // ── Totals ─────────────────────────────────────────────────────────────────
    const subtotal = cart.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);
    const discountCentsFromPct = discountPct > 0 ? Math.round(subtotal * discountPct / 100) : 0;
    const couponDiscountCents = couponDiscount > 0 ? Math.round(subtotal * couponDiscount / 100) : 0;
    const discountCents = Math.min(subtotal, discountCentsFromPct + couponDiscountCents);
    const total = subtotal - discountCents;

    // ── Checkout ───────────────────────────────────────────────────────────────
    const handleCheckout = async () => {
        if (cart.length === 0) { toast.error("הוסף פריט לעגלה"); return; }
        setLoading(true);
        try {
            const txn = await apiFetch<TransactionOut>("/api/pos/checkout", {
                method: "POST",
                body: JSON.stringify({
                    items: cart.map(i => ({ product_id: i.product_id, description: i.description, quantity: i.quantity, unit_price_cents: i.unit_price_cents })),
                    method,
                    client_id: client?.id || null,
                    discount_cents: discountCents,
                    coupon_code: couponDiscount > 0 ? couponCode.trim().toUpperCase() : null,
                }),
            });
            setReceipt(txn);
            setCart([]); setCalcDisplay("0"); setItemDesc("");
            setClient(null); setClientSearch("");
            setDiscountPct(0); setDiscountInput(""); setCouponCode(""); setCouponDiscount(0); setCouponError("");
        } catch { toast.error("שגיאה בעיבוד התשלום"); }
        finally { setLoading(false); }
    };

    const handleAddClient = async () => {
        if (!newClientName.trim()) return;
        setAddingClient(true);
        try {
            const c = await apiFetch<ClientResult>("/api/clients/", { method: "POST", body: JSON.stringify({ name: newClientName.trim(), phone: newClientPhone.trim() || null }) });
            setClient(c); setShowAddClient(false); setNewClientName(""); setNewClientPhone("");
            toast.success("לקוח נוסף בהצלחה");
        } catch { toast.error("שגיאה בהוספת לקוח"); }
        finally { setAddingClient(false); }
    };

    return (
        <RequireAuth>
        <AppShell title="קופה" fullBleed>
        <div className="flex h-full overflow-hidden bg-slate-100" dir="rtl">

            {/* ══════════════════════════════════════════════════
                LEFT — Calculator + Products
            ══════════════════════════════════════════════════ */}
            <div className="flex flex-col w-72 shrink-0 bg-white border-l border-slate-200 shadow-sm overflow-hidden">

                {/* ── Calculator ── */}
                <div className="p-3 border-b border-slate-100 bg-slate-50">
                    {/* Display */}
                    <div className="bg-slate-900 text-white rounded-xl px-4 py-3 mb-2 text-right">
                        <div className="text-xs text-slate-400 mb-0.5 h-4">
                            {itemDesc || <span className="opacity-0">_</span>}
                        </div>
                        <div className="text-3xl font-mono font-bold tracking-tight">
                            ₪{parseFloat(calcDisplay || "0").toLocaleString("he-IL", { minimumFractionDigits: calcDisplay.includes(".") ? calcDisplay.split(".")[1]?.length || 0 : 0 })}
                        </div>
                    </div>

                    {/* Description input */}
                    <input
                        value={itemDesc}
                        onChange={e => setItemDesc(e.target.value)}
                        placeholder="תיאור (אופציונלי)..."
                        className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                        onKeyDown={e => e.key === "Enter" && handleAddItem()}
                    />

                    {/* Numpad */}
                    <Numpad display={calcDisplay} onKey={handleNumKey} />

                    {/* Add to cart button */}
                    <button
                        type="button"
                        onClick={handleAddItem}
                        disabled={calcDisplay === "0" || parseFloat(calcDisplay) <= 0}
                        className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold py-3 rounded-xl text-sm transition-all active:scale-95 shadow-sm"
                    >
                        + הוסף לעגלה
                    </button>
                </div>

                {/* ── Products ── */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Category filter */}
                    <div className="px-3 py-2 border-b border-slate-100 flex gap-1.5 overflow-x-auto shrink-0">
                        <button type="button" onClick={() => setCategoryFilter(null)}
                            className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${categoryFilter === null ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                            הכל
                        </button>
                        {categories.map(cat => (
                            <button key={cat} type="button" onClick={() => setCategoryFilter(cat)}
                                className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${categoryFilter === cat ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                                {cat}
                            </button>
                        ))}
                    </div>

                    {/* Products grid */}
                    <div className="flex-1 overflow-y-auto p-2">
                        {filteredProducts.length === 0 ? (
                            <div className="text-center text-slate-400 mt-8 text-sm">
                                <div className="text-3xl mb-2">📦</div>
                                <div>אין מוצרים</div>
                                <a href="/products" className="text-blue-500 text-xs mt-1 block hover:underline">הוסף מוצרים</a>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-1.5">
                                {filteredProducts.map(product => (
                                    <button
                                        key={product.id} type="button"
                                        onClick={() => addProduct(product)}
                                        disabled={product.stock_quantity === 0}
                                        className={`bg-white rounded-xl border p-2 text-right transition-all shadow-sm active:scale-95 ${product.stock_quantity === 0 ? "opacity-40 cursor-not-allowed border-slate-100" : "border-slate-200 hover:border-emerald-400 hover:shadow-md"}`}
                                    >
                                        {product.image_url ? (
                                            <img src={product.image_url} alt={product.name} className="w-full h-14 object-cover rounded-lg mb-1.5" />
                                        ) : (
                                            <div className="w-full h-14 bg-slate-100 rounded-lg mb-1.5 flex items-center justify-center text-xl">📦</div>
                                        )}
                                        <div className="font-semibold text-slate-800 text-xs leading-tight truncate">{product.name}</div>
                                        <div className="text-emerald-700 font-bold text-sm mt-0.5">₪{Number(product.price).toFixed(2)}</div>
                                        <div className={`text-[9px] mt-0.5 ${product.stock_quantity <= 3 ? "text-rose-500" : "text-slate-400"}`}>
                                            {product.stock_quantity === 0 ? "אזל" : `${product.stock_quantity} במלאי`}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ══════════════════════════════════════════════════
                RIGHT — Cart + Checkout
            ══════════════════════════════════════════════════ */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* ── Top: Client selector ── */}
                <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
                    <div className="flex items-center justify-between mb-1.5">
                        <div className="text-xs font-bold text-slate-500">👤 לקוח</div>
                        <button type="button" onClick={() => setShowAddClient(true)}
                            className="text-xs text-emerald-600 font-semibold hover:text-emerald-700">
                            + לקוח חדש
                        </button>
                    </div>
                    {client ? (
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                            <div className="flex-1">
                                <div className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                                    {client.name}
                                    {client.is_club_member && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">👑 VIP</span>}
                                </div>
                                {client.phone && <div className="text-xs text-emerald-600">{client.phone}</div>}
                            </div>
                            <button type="button" onClick={() => { setClient(null); setClientSearch(""); }} className="text-emerald-300 hover:text-rose-500 text-xl leading-none">×</button>
                        </div>
                    ) : (
                        <div className="relative">
                            <input
                                value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                                placeholder="חפש שם או טלפון..."
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                            {searchLoading && <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />}
                            {clientResults.length > 0 && (
                                <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-30">
                                    {clientResults.map(c => (
                                        <button key={c.id} type="button"
                                            onClick={() => { setClient(c); setClientSearch(""); setClientResults([]); }}
                                            className="w-full text-right px-3 py-2.5 hover:bg-emerald-50 transition-colors border-b border-slate-100 last:border-0">
                                            <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                                                {c.name}
                                                {c.is_club_member && <span className="text-[10px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded-full">👑</span>}
                                            </div>
                                            {c.phone && <div className="text-xs text-slate-400">{c.phone}</div>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Cart items (scrollable) ── */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                    {cart.length === 0 ? (
                        <div className="text-center text-slate-300 mt-16">
                            <div className="text-5xl mb-3">🛒</div>
                            <div className="text-sm font-medium">העגלה ריקה</div>
                            <div className="text-xs mt-1">הוסף מוצרים מהרשימה משמאל</div>
                        </div>
                    ) : cart.map(item => (
                        <div key={item.key} className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-slate-800 truncate">{item.description}</div>
                                <div className="text-xs text-slate-400">₪{(item.unit_price_cents / 100).toFixed(2)} / יחידה</div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button type="button" onClick={() => updateQty(item.key, -1)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold transition-colors">−</button>
                                <span className="w-6 text-center text-sm font-bold text-slate-800">{item.quantity}</span>
                                <button type="button" onClick={() => updateQty(item.key, 1)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold transition-colors">+</button>
                            </div>
                            <div className="text-sm font-bold text-slate-900 min-w-[4rem] text-left" dir="ltr">
                                ₪{((item.unit_price_cents * item.quantity) / 100).toFixed(2)}
                            </div>
                            <button type="button" onClick={() => removeItem(item.key)} className="text-slate-200 hover:text-rose-500 transition-colors text-xl leading-none">×</button>
                        </div>
                    ))}
                </div>

                {/* ── Bottom: Discount / Coupon / Totals / Payment ── */}
                <div className="bg-white border-t border-slate-200 px-4 py-3 space-y-3 shrink-0">

                    {/* Discount % toggle */}
                    <div>
                        <button type="button" onClick={() => setShowDiscount(s => !s)}
                            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${discountPct > 0 ? "bg-rose-50 border-rose-300 text-rose-700" : "bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                            🏷️ הנחה {discountPct > 0 ? `${discountPct}%` : "/ %"}
                            {discountPct > 0 && (
                                <span onClick={e => { e.stopPropagation(); setDiscountPct(0); setDiscountInput(""); }} className="mr-1 text-rose-400 hover:text-rose-600">×</span>
                            )}
                        </button>

                        {showDiscount && (
                            <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                                <div className="text-xs font-bold text-slate-500 mb-2">בחר אחוז הנחה:</div>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {[5, 10, 15, 20, 25, 30].map(pct => (
                                        <button key={pct} type="button" onClick={() => applyDiscount(pct)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${discountPct === pct ? "bg-rose-500 text-white border-rose-500" : "bg-white border-slate-200 text-slate-700 hover:border-rose-300 hover:text-rose-600"}`}>
                                            {pct}%
                                        </button>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="number" min="0" max="100" step="1"
                                        value={discountInput} onChange={e => setDiscountInput(e.target.value)}
                                        placeholder="אחוז מותאם..."
                                        className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                                        onKeyDown={e => e.key === "Enter" && applyDiscount(parseFloat(discountInput) || 0)}
                                    />
                                    <button type="button" onClick={() => applyDiscount(parseFloat(discountInput) || 0)}
                                        className="px-3 py-1.5 bg-rose-500 text-white rounded-lg text-sm font-bold hover:bg-rose-600 transition-colors">
                                        אשר
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Coupon code */}
                    <div className="flex gap-2">
                        <input
                            value={couponCode}
                            onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponDiscount(0); setCouponError(""); }}
                            placeholder="קוד קופון..."
                            className={`flex-1 border rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400 ${couponDiscount > 0 ? "border-emerald-400 bg-emerald-50" : couponError ? "border-rose-400" : "border-slate-200"}`}
                            onKeyDown={e => e.key === "Enter" && validateCoupon()}
                        />
                        <button type="button" onClick={validateCoupon} disabled={!couponCode.trim() || couponLoading}
                            className="shrink-0 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white px-3 rounded-xl text-xs font-bold transition-colors">
                            {couponLoading ? "..." : "אמת"}
                        </button>
                        {couponDiscount > 0 && (
                            <button type="button" onClick={() => { setCouponCode(""); setCouponDiscount(0); }} className="text-rose-400 hover:text-rose-600 text-xl px-1">×</button>
                        )}
                    </div>
                    {couponError && <div className="text-xs text-rose-500 -mt-2">{couponError}</div>}
                    {couponDiscount > 0 && <div className="text-xs text-emerald-600 -mt-2 font-semibold">✓ קופון {couponDiscount}% הופעל</div>}

                    {/* Totals */}
                    <div className="bg-slate-50 rounded-xl px-3 py-2.5 space-y-1 border border-slate-100">
                        <div className="flex justify-between text-sm text-slate-500">
                            <span>סכום ביניים</span>
                            <span>₪{(subtotal / 100).toFixed(2)}</span>
                        </div>
                        {discountCentsFromPct > 0 && (
                            <div className="flex justify-between text-sm text-rose-600">
                                <span>הנחה {discountPct}%</span>
                                <span>-₪{(discountCentsFromPct / 100).toFixed(2)}</span>
                            </div>
                        )}
                        {couponDiscountCents > 0 && (
                            <div className="flex justify-between text-sm text-violet-600">
                                <span>קופון ({couponDiscount}%)</span>
                                <span>-₪{(couponDiscountCents / 100).toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-base font-bold text-slate-900 border-t pt-1.5 mt-1">
                            <span>סה״כ לתשלום</span>
                            <span className="text-emerald-700">₪{(total / 100).toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Payment methods */}
                    <div className="grid grid-cols-5 gap-1.5">
                        {PAYMENT_METHODS.map(pm => (
                            <button key={pm.key} type="button" onClick={() => setMethod(pm.key)}
                                className={`rounded-xl py-2 px-1 text-center transition-all border ${method === pm.key ? "bg-emerald-600 text-white border-emerald-600 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"}`}>
                                <div className="text-base leading-none">{pm.icon}</div>
                                <div className="text-[9px] font-semibold mt-0.5 leading-tight">{pm.label}</div>
                            </button>
                        ))}
                    </div>

                    {/* Checkout button */}
                    <button type="button" onClick={handleCheckout} disabled={loading || cart.length === 0}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl text-base transition-all shadow-lg active:scale-95">
                        {loading ? "מעבד..." : `💳 גבה ₪${(total / 100).toFixed(2)}`}
                    </button>
                </div>
            </div>

            {/* Modals */}
            {receipt && <ReceiptModal txn={receipt} onClose={() => setReceipt(null)} />}

            {showAddClient && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddClient(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()} dir="rtl">
                        <div className="text-base font-bold text-slate-800 mb-4">הוסף לקוח חדש</div>
                        <div className="space-y-3">
                            <input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="שם מלא *"
                                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" autoFocus
                                onKeyDown={e => e.key === "Enter" && handleAddClient()} />
                            <input value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} placeholder="טלפון (אופציונלי)" type="tel"
                                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                onKeyDown={e => e.key === "Enter" && handleAddClient()} />
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button type="button" onClick={handleAddClient} disabled={!newClientName.trim() || addingClient}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                                {addingClient ? "מוסיף..." : "הוסף לקוח"}
                            </button>
                            <button type="button" onClick={() => setShowAddClient(false)}
                                className="px-4 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                                ביטול
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
        </AppShell>
        </RequireAuth>
    );
}
