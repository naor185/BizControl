"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Product = {
    id: string;
    name: string;
    price: number;
    category: string | null;
    stock_quantity: number;
    image_url: string | null;
};

type CartItem = {
    key: string;             // product_id or "manual-{n}"
    product_id: string | null;
    description: string;
    quantity: number;
    unit_price_cents: number;
};

type ClientResult = {
    id: string;
    name: string;
    phone: string | null;
};

type TransactionOut = {
    id: string;
    client_name: string | null;
    cashier_name: string | null;
    total_cents: number;
    discount_cents: number;
    method: string;
    items: { description: string; quantity: number; unit_price_cents: number; total_price_cents: number }[];
    points_earned: number;
    created_at: string;
};

const METHOD_LABELS: Record<string, string> = {
    cash: "מזומן",
    bit: "Bit",
    credit: "אשראי",
    credit_card: "כרטיס אשראי",
    bank_transfer: "העברה בנקאית",
    apple_pay: "Apple Pay",
    google_pay: "Google Pay",
    other: "אחר",
};

const METHOD_ICONS: Record<string, string> = {
    cash: "💵",
    bit: "📱",
    credit: "💳",
    credit_card: "💳",
    bank_transfer: "🏦",
    apple_pay: "",
    google_pay: "",
    other: "🔄",
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
                    {/* Items */}
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
                                <span>הנחה</span>
                                <span>-₪{(txn.discount_cents / 100).toFixed(2)}</span>
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
                    <button
                        onClick={onClose}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors"
                    >
                        מכירה חדשה
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PosPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [method, setMethod] = useState("cash");
    const [discount, setDiscount] = useState("");
    const [client, setClient] = useState<ClientResult | null>(null);
    const [clientSearch, setClientSearch] = useState("");
    const [clientResults, setClientResults] = useState<ClientResult[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [receipt, setReceipt] = useState<TransactionOut | null>(null);
    const [manualDesc, setManualDesc] = useState("");
    const [manualPrice, setManualPrice] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        apiFetch<Product[]>("/api/products/?is_active=true")
            .then(setProducts)
            .catch(() => { });
    }, []);

    // Client search with debounce
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

    const addProduct = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(i => i.product_id === product.id);
            if (existing) {
                return prev.map(i => i.product_id === product.id
                    ? { ...i, quantity: i.quantity + 1 }
                    : i
                );
            }
            return [...prev, {
                key: product.id,
                product_id: product.id,
                description: product.name,
                quantity: 1,
                unit_price_cents: Math.round(Number(product.price) * 100),
            }];
        });
    };

    const addManual = () => {
        const priceNum = parseFloat(manualPrice);
        if (!manualDesc.trim() || isNaN(priceNum) || priceNum <= 0) {
            toast.error("הכנס תיאור ומחיר תקין");
            return;
        }
        const key = `manual-${Date.now()}`;
        setCart(prev => [...prev, {
            key,
            product_id: null,
            description: manualDesc.trim(),
            quantity: 1,
            unit_price_cents: Math.round(priceNum * 100),
        }]);
        setManualDesc("");
        setManualPrice("");
    };

    const updateQty = (key: string, delta: number) => {
        setCart(prev => prev
            .map(i => i.key === key ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
            .filter(i => i.quantity > 0)
        );
    };

    const removeItem = (key: string) => setCart(prev => prev.filter(i => i.key !== key));

    const pendingCents = Math.max(0, Math.round(parseFloat(manualPrice || "0") * 100));
    const subtotal = cart.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0) + pendingCents;
    const discountCents = Math.min(subtotal, Math.max(0, Math.round(parseFloat(discount || "0") * 100)));
    const total = subtotal - discountCents;

    const handleCheckout = async () => {
        if (cart.length === 0 && pendingCents === 0) { toast.error("הוסף פריט או סכום לגבייה"); return; }
        setLoading(true);
        try {
            const pendingItem = pendingCents > 0 ? [{
                product_id: null,
                description: manualDesc.trim() || "שירות",
                quantity: 1,
                unit_price_cents: pendingCents,
            }] : [];
            const txn = await apiFetch<TransactionOut>("/api/pos/checkout", {
                method: "POST",
                body: JSON.stringify({
                    items: [
                        ...cart.map(i => ({
                            product_id: i.product_id,
                            description: i.description,
                            quantity: i.quantity,
                            unit_price_cents: i.unit_price_cents,
                        })),
                        ...pendingItem,
                    ],
                    method,
                    client_id: client?.id || null,
                    discount_cents: discountCents,
                }),
            });
            setReceipt(txn);
            setCart([]);
            setClient(null);
            setClientSearch("");
            setDiscount("");
            setManualDesc("");
            setManualPrice("");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "שגיאה בעיבוד העסקה";
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    const filteredProducts = categoryFilter
        ? products.filter(p => p.category === categoryFilter)
        : products;

    return (
        <div className="flex h-screen overflow-hidden bg-slate-50" dir="rtl">
            {/* ── Left: Product Grid ─────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <div className="bg-white border-b px-6 py-4 flex items-center gap-4 shrink-0">
                    <h1 className="text-xl font-bold text-slate-800">🛒 קופה</h1>
                    <div className="flex-1" />
                    {/* Category filters */}
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={() => setCategoryFilter(null)}
                            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${categoryFilter === null ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                        >
                            הכל
                        </button>
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setCategoryFilter(cat)}
                                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${categoryFilter === cat ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {filteredProducts.length === 0 ? (
                        <div className="text-center text-slate-400 mt-16">
                            <div className="text-4xl mb-2">📦</div>
                            <div>אין מוצרים פעילים</div>
                            <a href="/products" className="text-blue-500 text-sm mt-1 block hover:underline">הוסף מוצרים בקטלוג</a>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {filteredProducts.map(product => (
                                <button
                                    key={product.id}
                                    onClick={() => addProduct(product)}
                                    disabled={product.stock_quantity === 0}
                                    className={`bg-white rounded-2xl border-2 p-4 text-right transition-all shadow-sm hover:shadow-md active:scale-95 ${
                                        product.stock_quantity === 0
                                            ? "opacity-40 cursor-not-allowed border-slate-100"
                                            : "border-slate-200 hover:border-emerald-400"
                                    }`}
                                >
                                    {product.image_url ? (
                                        <img src={product.image_url} alt={product.name} className="w-full h-20 object-cover rounded-xl mb-2" />
                                    ) : (
                                        <div className="w-full h-20 bg-slate-100 rounded-xl mb-2 flex items-center justify-center text-2xl">
                                            📦
                                        </div>
                                    )}
                                    <div className="font-semibold text-slate-800 text-sm leading-tight truncate">{product.name}</div>
                                    <div className="text-emerald-700 font-bold mt-1">₪{Number(product.price).toFixed(2)}</div>
                                    <div className={`text-[10px] mt-0.5 ${product.stock_quantity <= 3 ? "text-rose-500" : "text-slate-400"}`}>
                                        {product.stock_quantity === 0 ? "אזל המלאי" : `${product.stock_quantity} במלאי`}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Manual item */}
                    <div className="mt-6 bg-white rounded-2xl border border-dashed border-slate-300 p-4">
                        <div className="text-sm font-semibold text-slate-600 mb-3">הוספה ידנית</div>
                        <div className="flex gap-2">
                            <input
                                value={manualDesc}
                                onChange={e => setManualDesc(e.target.value)}
                                placeholder="תיאור השירות / מוצר"
                                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                onKeyDown={e => e.key === "Enter" && addManual()}
                            />
                            <div className="relative">
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₪</span>
                                <input
                                    value={manualPrice}
                                    onChange={e => setManualPrice(e.target.value)}
                                    placeholder="0.00"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-28 border border-slate-200 rounded-xl pr-7 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                    onKeyDown={e => e.key === "Enter" && addManual()}
                                />
                            </div>
                            <button
                                onClick={addManual}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 rounded-xl font-bold text-sm transition-colors"
                            >
                                הוסף
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Right: Cart & Checkout ─────────────────────────────────── */}
            <div className="w-96 shrink-0 bg-white border-r flex flex-col shadow-xl">
                <div className="px-5 py-4 border-b">
                    <div className="text-base font-bold text-slate-800">עגלת קנייה</div>
                    {cart.length > 0 && (
                        <div className="text-xs text-slate-400">{cart.reduce((s, i) => s + i.quantity, 0)} פריטים</div>
                    )}
                </div>

                {/* Cart items */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                    {cart.length === 0 ? (
                        <div className="text-center text-slate-300 mt-10 text-sm">העגלה ריקה</div>
                    ) : cart.map(item => (
                        <div key={item.key} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2.5">
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-slate-800 truncate">{item.description}</div>
                                <div className="text-xs text-slate-500">₪{(item.unit_price_cents / 100).toFixed(2)} ליחידה</div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => updateQty(item.key, -1)} className="w-6 h-6 rounded-lg bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-600 font-bold text-sm transition-colors">−</button>
                                <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                                <button onClick={() => updateQty(item.key, 1)} className="w-6 h-6 rounded-lg bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-600 font-bold text-sm transition-colors">+</button>
                            </div>
                            <div className="text-sm font-bold text-slate-800 min-w-12 text-left">
                                ₪{((item.unit_price_cents * item.quantity) / 100).toFixed(2)}
                            </div>
                            <button onClick={() => removeItem(item.key)} className="text-slate-300 hover:text-rose-500 transition-colors text-lg leading-none">×</button>
                        </div>
                    ))}
                </div>

                {/* Bottom section */}
                <div className="border-t px-4 py-4 space-y-4">
                    {/* Quick manual charge */}
                    <div>
                        <div className="text-xs font-semibold text-slate-500 mb-1.5">הוסף פריט ידני</div>
                        <div className="flex gap-1.5">
                            <input
                                value={manualDesc}
                                onChange={e => setManualDesc(e.target.value)}
                                placeholder="תיאור..."
                                className="flex-1 min-w-0 border border-slate-200 rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                onKeyDown={e => e.key === "Enter" && addManual()}
                            />
                            <div className="relative w-24 shrink-0">
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₪</span>
                                <input
                                    value={manualPrice}
                                    onChange={e => setManualPrice(e.target.value)}
                                    placeholder="0"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-full border border-slate-200 rounded-xl pr-6 pl-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                    onKeyDown={e => e.key === "Enter" && addManual()}
                                />
                            </div>
                            <button
                                onClick={addManual}
                                className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white px-3 rounded-xl font-bold text-sm transition-colors"
                            >
                                +
                            </button>
                        </div>
                    </div>

                    {/* Client search */}
                    <div>
                        <div className="text-xs font-semibold text-slate-500 mb-1.5">לקוח (אופציונלי)</div>
                        {client ? (
                            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                                <div className="flex-1">
                                    <div className="text-sm font-semibold text-emerald-800">{client.name}</div>
                                    {client.phone && <div className="text-xs text-emerald-600">{client.phone}</div>}
                                </div>
                                <button onClick={() => { setClient(null); setClientSearch(""); }} className="text-emerald-400 hover:text-rose-500 transition-colors">×</button>
                            </div>
                        ) : (
                            <div className="relative">
                                <input
                                    value={clientSearch}
                                    onChange={e => setClientSearch(e.target.value)}
                                    placeholder="חפש שם או טלפון..."
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                />
                                {searchLoading && (
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2">
                                        <div className="w-3 h-3 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
                                    </div>
                                )}
                                {clientResults.length > 0 && (
                                    <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-30">
                                        {clientResults.map(c => (
                                            <button
                                                key={c.id}
                                                onClick={() => { setClient(c); setClientSearch(""); setClientResults([]); }}
                                                className="w-full text-right px-3 py-2.5 hover:bg-emerald-50 transition-colors border-b border-slate-100 last:border-0"
                                            >
                                                <div className="text-sm font-semibold text-slate-800">{c.name}</div>
                                                {c.phone && <div className="text-xs text-slate-400">{c.phone}</div>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Discount */}
                    <div className="flex items-center gap-2">
                        <div className="text-xs font-semibold text-slate-500 shrink-0">הנחה</div>
                        <div className="relative flex-1">
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₪</span>
                            <input
                                value={discount}
                                onChange={e => setDiscount(e.target.value)}
                                type="number"
                                min="0"
                                step="1"
                                placeholder="0"
                                className="w-full border border-slate-200 rounded-xl pr-7 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                        </div>
                    </div>

                    {/* Totals */}
                    <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                        <div className="flex justify-between text-sm text-slate-600">
                            <span>סכום ביניים</span>
                            <span>₪{(subtotal / 100).toFixed(2)}</span>
                        </div>
                        {discountCents > 0 && (
                            <div className="flex justify-between text-sm text-rose-600">
                                <span>הנחה</span>
                                <span>-₪{(discountCents / 100).toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-base font-bold text-slate-900 border-t pt-1 mt-1">
                            <span>סה״כ לתשלום</span>
                            <span className="text-emerald-700">₪{(total / 100).toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Payment methods */}
                    <div>
                        <div className="text-xs font-semibold text-slate-500 mb-2">אמצעי תשלום</div>
                        <div className="grid grid-cols-4 gap-1.5">
                            {Object.entries(METHOD_LABELS).map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => setMethod(key)}
                                    className={`rounded-xl py-2 px-1 text-center transition-all border ${
                                        method === key
                                            ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                                            : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
                                    }`}
                                >
                                    <div className="text-base leading-none">{METHOD_ICONS[key]}</div>
                                    <div className="text-[9px] font-semibold mt-0.5 leading-tight">{label}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Checkout button */}
                    <button
                        onClick={handleCheckout}
                        disabled={loading || cart.length === 0}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-base transition-all shadow-lg active:scale-95"
                    >
                        {loading ? "מעבד..." : `גבה ₪${(total / 100).toFixed(2)}`}
                    </button>
                </div>
            </div>

            {/* Receipt Modal */}
            {receipt && <ReceiptModal txn={receipt} onClose={() => setReceipt(null)} />}
        </div>
    );
}
