"use client";

import { usePlan } from "@/lib/usePlan";
import { Switch } from "@/components/ui/switch";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { isWorker } from "@/lib/workerPerms";
import { apiFetch, getCurrentUserId } from "@/lib/api";
import { toast } from "@/lib/toast";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import PinModal from "@/components/PinModal";
import { Tag, Gift, X } from "lucide-react";

import { tx, intl } from "@/lib/i18n";
type Product = { id: string; name: string; price: number; category: string | null; stock_quantity: number; image_url: string | null; };
type CartItem = { key: string; product_id: string | null; description: string; quantity: number; unit_price_cents: number; };
type ClientResult = { id: string; full_name: string; name?: string; phone: string | null; is_club_member?: boolean; loyalty_points?: number; };
type TransactionOut = {
    id: string; client_name: string | null; total_cents: number; discount_cents: number; method: string;
    items: { description: string; quantity: number; unit_price_cents: number; total_price_cents: number }[];
    points_earned: number; created_at: string; receipt_message_job_id?: string | null;
};

const PAYMENT_METHODS = [
    { key: "cash",          label: tx("מזומן"),   icon: "💵" },
    { key: "credit",        label: tx("אשראי"),   icon: "💳" },
    { key: "bit",           label: "Bit",     icon: "📱" },
    { key: "paybox",        label: "PayBox",  icon: "📲" },
    { key: "bank_transfer", label: tx("העברה"),   icon: "🏦" },
];
const METHOD_LABELS: Record<string, string> = { cash:tx("מזומן"), credit:tx("אשראי"), bit:"Bit", paybox:"PayBox", bank_transfer:tx("העברה בנקאית"), credit_card:tx("אשראי"), other:tx("אחר") };

// ── Receipt Modal ─────────────────────────────────────────────────────────────
function ReceiptModal({ txn, clientId, onClose, onBack }: { txn: TransactionOut; clientId: string | null; onClose: () => void; onBack: () => void }) {
    const [invoiceId, setInvoiceId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [receiptCanceled, setReceiptCanceled] = useState(false);
    const [cancelingReceipt, setCancelingReceipt] = useState(false);

    const cancelReceiptSend = async () => {
        if (!txn.receipt_message_job_id) return;
        setCancelingReceipt(true);
        try {
            const res = await apiFetch<{ ok: boolean; already_sent: boolean }>(
                `/api/pos/cancel-receipt/${txn.receipt_message_job_id}`,
                { method: "POST" }
            );
            if (res.already_sent) {
                toast.error(tx("הקבלה כבר נשלחה — לא ניתן לבטל"));
            } else {
                setReceiptCanceled(true);
                toast.success(tx("שליחת הקבלה בוואטסאפ בוטלה"));
            }
        } catch (e: unknown) {
            toast.error((e as Error).message || tx("שגיאה בביטול השליחה"));
        } finally {
            setCancelingReceipt(false);
        }
    };

    const createInvoice = async () => {
        setCreating(true);
        try {
            const inv = await apiFetch<{ id: string }>("/api/invoices", {
                method: "POST",
                body: JSON.stringify({
                    doc_type: "invoice_tax_receipt",   // the business's own: a VAT-exempt one gets a receipt
                    client_id: clientId || undefined,
                    client_name: txn.client_name || undefined,
                    payment_method: txn.method,
                    source: "pos",
                    source_id: txn.id,
                    items: [
                        ...txn.items.map(i => ({
                            description: i.description,
                            quantity: i.quantity,
                            unit_price_cents: i.unit_price_cents,
                        })),
                        // the receipt is what was paid — the discount too
                        ...(txn.discount_cents > 0 ? [{ description: tx("הנחה"), quantity: 1, unit_price_cents: -txn.discount_cents }] : []),
                    ],
                }),
            });
            setInvoiceId(inv.id);
        } catch (e: unknown) {
            toast.error((e as Error).message || tx("שגיאה בהפקת חשבונית"));
        } finally { setCreating(false); }
    };

    const downloadPdf = async () => {
        if (!invoiceId) return;
        try {
            const inv = await apiFetch<any>(`/api/invoices/${invoiceId}`);
            const isCredit = inv.doc_type === "credit";
            const hasVat = inv.shows_vat ?? (inv.business_type !== "osek_patur" && (inv.vat_amount_ils || 0) > 0); const vatNote = inv.vat_note ?? (hasVat ? null : 'עוסק פטור, אינו חייב במע"מ');
            const acc = isCredit ? "#c0392b" : "#1a1a2e";
            const fmtN = (n: number) => `₪${Math.abs(n || 0).toFixed(2)}`;
            const fmtD = (s: string) => new Date(s).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
            const mLabels: Record<string, string> = { cash: "מזומן", bit: "Bit", paybox: "PayBox", credit_card: "כרטיס אשראי", bank_transfer: "העברה בנקאית", check: "צ'ק", other: "אחר", credit: "אשראי" };
            const rows = (inv.items || []).map((it: any) => `<tr><td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f0f0f0">${it.description}</td><td style="padding:8px 10px;text-align:center;border-bottom:1px solid #f0f0f0">${it.quantity}</td><td style="padding:8px 10px;text-align:center;border-bottom:1px solid #f0f0f0">${fmtN(it.unit_with_vat_ils ?? (it.unit_price_cents || 0) / 100)}</td><td style="padding:8px 10px;text-align:left;border-bottom:1px solid #f0f0f0;font-weight:700">${fmtN(it.total_with_vat_ils ?? (it.total_price_cents || 0) / 100)}</td></tr>`).join("");
            const w = window.open("", "_blank");
            if (!w) return;
            w.document.write(`<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"><title>${inv.doc_type_label || "קבלה"} #${inv.doc_number}</title><style>@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Heebo',Arial,sans-serif;direction:rtl;background:#fff;color:#1a1a2e}.page{max-width:680px;margin:0 auto}.header{background:${acc};color:#fff;padding:24px 28px 20px}.biz-bar{background:#f8f9fa;padding:14px 28px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#444}.section{padding:20px 28px;border-bottom:1px solid #f0f0f0}table{width:100%;border-collapse:collapse}thead tr{background:${acc};color:#fff}thead th{padding:10px;font-size:12px;font-weight:700}.totals{padding:20px 28px}.total-row{display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:6px}.total-final{display:flex;justify-content:space-between;font-size:18px;font-weight:900;color:${acc};padding-top:10px;border-top:2px solid ${acc};margin-top:6px}.footer{background:#f0f0f0;text-align:center;padding:12px;font-size:11px;color:#888;margin-top:20px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><div class="page"><div class="header"><div style="font-size:18px;font-weight:700;float:left">#${inv.doc_number}</div><div style="font-size:22px;font-weight:900">${inv.business_name || "העסק שלי"}</div><div style="font-size:12px;opacity:.75">${inv.doc_type_label || "קבלה"}</div></div><div class="biz-bar">${inv.business_number ? "ח.פ/ע.מ: " + inv.business_number : ""}${inv.business_address ? " &nbsp;|&nbsp; " + inv.business_address + (inv.business_city ? ", " + inv.business_city : "") : ""}${inv.business_phone ? " &nbsp;|&nbsp; טל: " + inv.business_phone : ""}<span style="float:left">תאריך: ${fmtD(inv.issued_at || new Date().toISOString())}</span></div>${inv.client_name ? '<div class="section"><div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:8px">לכבוד</div><div style="font-size:16px;font-weight:700">' + inv.client_name + "</div>" + (inv.client_phone ? '<div style="font-size:13px;color:#64748b">' + inv.client_phone + "</div>" : "") + "</div>" : ""}<div class="section" style="padding-bottom:0"><table><thead><tr><th style="text-align:right;padding:10px">תיאור</th><th style="text-align:center;padding:10px">כמות</th><th style="text-align:center;padding:10px">מחיר</th><th style="text-align:left;padding:10px">סה"כ</th></tr></thead><tbody>${rows}</tbody></table></div><div class="totals">${hasVat ? '<div class="total-row"><span>לפני מע"מ</span><span>' + fmtN(inv.subtotal_ils || 0) + '</span></div><div class="total-row"><span>מע"מ ' + (inv.vat_rate ?? 18) + '%</span><span>' + fmtN(inv.vat_amount_ils || 0) + "</span></div>" : ""}<div class="total-final"><span>סה"כ לתשלום</span><span>${fmtN(Math.abs(inv.total_ils || 0))}</span></div>${vatNote ? '<div style="font-size:11px;color:#94a3b8;margin-top:6px">* ' + vatNote + '</div>' : ""}${inv.payment_method ? '<div style="font-size:12px;color:#64748b;margin-top:12px">אמצעי תשלום: ' + (mLabels[inv.payment_method] || inv.payment_method) + "</div>" : ""}</div><div class="footer">הופק באמצעות מערכת BizControl | מסמך ממוחשב חתום דיגיטלית</div></div><script>window.onload=()=>{window.print()}<\/script></body></html>`);
            w.document.close();
        } catch { toast.error("שגיאה בטעינת הקבלה"); }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="bg-emerald-600 text-white px-5 py-4 text-center">
                    <div className="text-2xl mb-1">✅</div>
                    <div className="text-lg font-bold">{tx("תשלום בוצע!")}</div>
                    {txn.client_name && <div className="text-emerald-100 text-xs mt-0.5">{txn.client_name}</div>}
                </div>
                <div className="p-4 space-y-2">
                    <div className="space-y-1">
                        {txn.items.map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                                <span className="text-slate-600">{item.description} ×{item.quantity}</span>
                                <span className="font-semibold">₪{(item.total_price_cents/100).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                    <div className="border-t pt-2">
                        {txn.discount_cents > 0 && (
                            <div className="flex justify-between text-sm text-rose-600">
                                <span>{tx("הנחה")}</span><span>-₪{(txn.discount_cents/100).toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between font-bold text-base">
                            <span>{tx("סה״כ")}</span>
                            <span className="text-emerald-700">₪{(txn.total_cents/100).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                            <span>{tx("אמצעי תשלום")}</span><span>{METHOD_LABELS[txn.method] || txn.method}</span>
                        </div>
                    </div>
                    {txn.points_earned > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-center text-xs text-amber-700 font-bold">
                            +{txn.points_earned} {tx("נקודות נוספו")}
                        </div>
                    )}
                    {txn.receipt_message_job_id && !receiptCanceled && (
                        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 text-xs">
                            <span className="text-blue-700 font-semibold">{tx("📲 קבלה נשלחת בוואטסאפ ללקוח...")}</span>
                            <button type="button" onClick={cancelReceiptSend} disabled={cancelingReceipt}
                                className="text-rose-600 font-bold underline disabled:opacity-50 shrink-0 ms-2">
                                {cancelingReceipt ? tx("מבטל...") : tx("בטל שליחה")}
                            </button>
                        </div>
                    )}
                    {receiptCanceled && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-center text-xs text-slate-500 font-semibold">
                            {tx("שליחת הקבלה בוואטסאפ בוטלה")}
                        </div>
                    )}
                </div>
                <div className="px-4 pb-4 space-y-2">
                    {/* the documents are the management's (a worker at the till: the sale's receipt goes out by itself) */}
                    {isWorker() ? null : !invoiceId ? (
                        <button type="button" onClick={createInvoice} disabled={creating}
                            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                            {creating ? tx("מפיק...") : tx("🧾 הפק קבלה")}
                        </button>
                    ) : (
                        <button type="button" onClick={downloadPdf}
                            className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                            {tx("📄 הורד PDF")}
                        </button>
                    )}
                    <button onClick={onClose} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                        {tx("מכירה חדשה")}
                    </button>
                    {/* back to where the till was opened from — the calendar, לוח בקרה (the owner, 2026-10-27) */}
                    <button type="button" onClick={onBack} className="w-full border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold py-2.5 rounded-xl text-sm transition-colors">
                        {tx("חזרה")}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function PosPage() {
    const router = useRouter();
    const plan = usePlan();            // paying with points, the club's and the gift card's links follow the plan
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [method, setMethod] = useState("cash");
    // who sold the items — asked only when the cart has items (an earring, a cream); the one at the till unless changed.
    // Work done through an appointment is the appointment's artist's (the owner, 2026-10-24)
    const [team, setTeam] = useState<{ id: string; display_name: string | null; email: string }[]>([]);
    const [performerId, setPerformerId] = useState<string>("");
    const [client, setClient] = useState<ClientResult | null>(null);
    const [clientSearch, setClientSearch] = useState("");
    const [clientResults, setClientResults] = useState<ClientResult[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [receipt, setReceipt] = useState<TransactionOut | null>(null);
    // Identifies this specific cart+checkout attempt so a stalled/lost response
    // followed by a resubmit reuses the server's existing transaction instead
    // of creating a duplicate sale. Regenerated whenever the cart is cleared.
    const checkoutKeyRef = useRef<string>(crypto.randomUUID());
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
    const [calcDisplay, setCalcDisplay] = useState("0");
    const [itemDesc, setItemDesc] = useState("");
    // The business's treatments, ready under the description — a tap writes it (several join: "א + ב"), so nothing has to
    // be typed (the owner, 2026-10-12). Their prices fill the calculator only while no amount was typed by hand.
    const [services, setServices] = useState<{ id: string; name: string; price_cents: number }[]>([]);
    const [autoPrice, setAutoPrice] = useState<string | null>(null);
    const [discountPct, setDiscountPct] = useState(0);
    const [showDiscountPicker, setShowDiscountPicker] = useState(false);
    // A discount needs the business owner's PIN, whoever is at the till; it stays open until the sale is done
    // (the owner, 2026-10-12)
    const [discountUnlocked, setDiscountUnlocked] = useState(false);
    const [askOwnerPin, setAskOwnerPin] = useState(false);
    const [couponCode, setCouponCode] = useState("");
    const [couponDiscount, setCouponDiscount] = useState(0);
    const [couponLoading, setCouponLoading] = useState(false);
    const [couponError, setCouponError] = useState("");
    const [showAddClient, setShowAddClient] = useState(false);
    const [newClientName, setNewClientName] = useState("");
    const [newClientPhone, setNewClientPhone] = useState("");
    const [addingClient, setAddingClient] = useState(false);
    const [pointsRedeemed, setPointsRedeemed] = useState(0);
    const [usePoints, setUsePoints] = useState(false);
    const [giftCardCode, setGiftCardCode] = useState("");
    const [giftCardInfo, setGiftCardInfo] = useState<{ balance_ils: number; recipient_name: string } | null>(null);
    const [giftCardDiscount, setGiftCardDiscount] = useState(0);
    const [giftCardLoading, setGiftCardLoading] = useState(false);
    const [giftCardError, setGiftCardError] = useState("");
    // Send WhatsApp receipt toggle
    const [sendReceipt, setSendReceipt] = useState(true);

    // Mobile: which panel is active
    const [mobileTab, setMobileTab] = useState<"pad" | "cart">("pad");

    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        apiFetch<Product[]>("/api/products/?is_active=true").then(setProducts).catch(() => {});
        apiFetch<{ id: string; name: string; price_cents: number }[]>("/api/services").then(setServices).catch(() => {});
        apiFetch<{ id: string; display_name: string | null; email: string }[]>("/api/users/artists")
            .then(list => { setTeam(list); setPerformerId(p => p || getCurrentUserId() || list[0]?.id || ""); })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        if (!clientSearch.trim()) { setClientResults([]); return; }
        setSearchLoading(true);
        searchTimer.current = setTimeout(async () => {
            try { const r = await apiFetch<ClientResult[]>(`/api/clients/?q=${encodeURIComponent(clientSearch)}&limit=5`); setClientResults(r); } catch {}
            setSearchLoading(false);
        }, 300);
    }, [clientSearch]);

    const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean))) as string[];
    const filteredProducts = categoryFilter ? products.filter(p => p.category === categoryFilter) : products;

    const handleNumKey = useCallback((k: string) => {
        setCalcDisplay(prev => {
            if (k === "⌫") return prev.length <= 1 ? "0" : prev.slice(0, -1);
            if (k === "." && prev.includes(".")) return prev;
            if (k === "." && prev === "0") return "0.";
            if (prev === "0" && k !== ".") return k;
            return prev + k;
        });
    }, []);

    const pickedNames = itemDesc.split(" + ").map(n => n.trim()).filter(Boolean);
    const toggleService = (name: string) => {
        const names = pickedNames.includes(name) ? pickedNames.filter(n => n !== name) : [...pickedNames, name];
        setItemDesc(names.join(" + "));
        if (calcDisplay === "0" || calcDisplay === autoPrice) {
            const sum = names.reduce((t, n) => t + (services.find(s => s.name === n)?.price_cents || 0), 0) / 100;
            const shown = sum > 0 ? String(sum) : "0";
            setCalcDisplay(shown);
            setAutoPrice(sum > 0 ? shown : null);
        }
    };

    const handleAddItem = useCallback(() => {
        const price = parseFloat(calcDisplay);
        if (isNaN(price) || price <= 0) { toast.error(tx("הכנס מחיר")); return; }
        setCart(prev => [...prev, { key: `m-${Date.now()}`, product_id: null, description: itemDesc.trim() || tx("פריט"), quantity: 1, unit_price_cents: Math.round(price * 100) }]);
        setCalcDisplay("0"); setItemDesc(""); setAutoPrice(null);
        if (window.innerWidth < 768) setMobileTab("cart");
    }, [calcDisplay, itemDesc]);

    const addProduct = (product: Product) => {
        const currentQty = cart.find(i => i.product_id === product.id)?.quantity ?? 0;
        if (product.stock_quantity > 0 && currentQty >= product.stock_quantity) {
            toast.error(tx("נגמר המלאי — נותרו {0} יחידות בלבד", { 0: product.stock_quantity }));
            return;
        }
        setCart(prev => {
            const ex = prev.find(i => i.product_id === product.id);
            if (ex) return prev.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
            return [...prev, { key: product.id, product_id: product.id, description: product.name, quantity: 1, unit_price_cents: Math.round(Number(product.price) * 100) }];
        });
        if (window.innerWidth < 768) setMobileTab("cart");
    };

    const updateQty = (key: string, delta: number) => {
        if (delta > 0) {
            const item = cart.find(i => i.key === key);
            if (item?.product_id) {
                const product = products.find(p => p.id === item.product_id);
                if (product && product.stock_quantity > 0 && item.quantity >= product.stock_quantity) {
                    toast.error(tx("נגמר המלאי — נותרו {0} יחידות בלבד", { 0: product.stock_quantity }));
                    return;
                }
            }
        }
        setCart(prev => prev.map(i => i.key === key ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i).filter(i => i.quantity > 0));
    };
    const removeItem = (key: string) => setCart(prev => prev.filter(i => i.key !== key));

    const validateGiftCard = async () => {
        const code = giftCardCode.trim().toUpperCase();
        if (!code) return;
        setGiftCardLoading(true); setGiftCardError(""); setGiftCardInfo(null);
        try {
            const r = await apiFetch<{ balance_ils: number; recipient_name: string; status: string }>(
                `/api/public/gift-cards/${encodeURIComponent(code)}`
            );
            if (r.status !== "active") { setGiftCardError(tx("כרטיס לא פעיל")); return; }
            setGiftCardInfo(r);
            setGiftCardDiscount(Math.floor(r.balance_ils));
        } catch { setGiftCardError(tx("קוד לא תקין")); }
        finally { setGiftCardLoading(false); }
    };

    const validateCoupon = async () => {
        if (!couponCode.trim()) return;
        setCouponLoading(true); setCouponError("");
        try {
            const who = client?.id ? `&client_id=${client.id}` : "";
            const r = await apiFetch<{ discount_percent: number }>(`/api/coupons/validate?code=${encodeURIComponent(couponCode.trim().toUpperCase())}${who}`);
            setCouponDiscount(r.discount_percent);
            toast.success(tx("קופון תקין — {0}% הנחה", { 0: r.discount_percent }));
        } catch (e: unknown) { setCouponError((e as { message?: string })?.message || tx("קוד לא תקין")); setCouponDiscount(0); }
        finally { setCouponLoading(false); }
    };

    const subtotal = cart.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);
    const discountCents = Math.round(subtotal * (discountPct + couponDiscount) / 100);
    const availablePoints = client?.loyalty_points ?? 0;
    const maxRedeemPoints = Math.min(availablePoints, Math.floor(Math.max(0, (subtotal - discountCents) / 100)));
    const pointsDiscount = usePoints ? Math.min(pointsRedeemed, maxRedeemPoints) : 0;
    const pointsDiscountCents = pointsDiscount * 100;
    const giftCardDiscountCents = giftCardInfo ? Math.min(giftCardDiscount * 100, Math.max(0, subtotal - discountCents - pointsDiscountCents)) : 0;
    const total = Math.max(0, subtotal - discountCents - pointsDiscountCents - giftCardDiscountCents);
    const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
    const hasItems = cart.some(i => !!i.product_id);        // items from the catalog — an earring, a cream

    // The card terminal isn't connected — send the client a link to pay instead (services/payment_requests): Bit /
    // PayBox / a bank transfer and "שילמתי"; the business approves it on לוח בקרה and the sale is recorded then, with
    // its receipt and who sold the items. Not with club points, a gift card or a coupon — those are taken here.
    const [sendingLink, setSendingLink] = useState(false);
    const linkBlocked = pointsDiscount > 0 || !!giftCardInfo || couponDiscount > 0;
    const sendPayLink = async () => {
        if (!client?.phone || cart.length === 0) return;
        setSendingLink(true);
        try {
            await apiFetch("/api/payment-requests", {
                method: "POST",
                body: JSON.stringify({
                    client_id: client.id,
                    items: cart.map(i => ({ product_id: i.product_id, description: i.description, quantity: i.quantity, unit_price_cents: i.unit_price_cents })),
                    discount_cents: discountCents,
                    performer_id: hasItems ? (performerId || null) : null,
                }),
            });
            toast.success(tx("הקישור לתשלום נשלח ל-{0} בוואטסאפ — כשישלם, יופיע לאישור בלוח הבקרה", { 0: client.full_name }));
            setCart([]); setCalcDisplay("0"); setItemDesc(""); setClient(null); setClientSearch(""); setDiscountUnlocked(false);
            setDiscountPct(0);
        } catch (e) {
            toast.error((e as Error)?.message || tx("השליחה נכשלה"));
        } finally {
            setSendingLink(false);
        }
    };

    const handleCheckout = async () => {
        if (cart.length === 0) { toast.error(tx("העגלה ריקה")); return; }
        setLoading(true);
        try {
            const txn = await apiFetch<TransactionOut>("/api/pos/checkout", {
                method: "POST",
                body: JSON.stringify({
                    items: cart.map(i => ({ product_id: i.product_id, description: i.description, quantity: i.quantity, unit_price_cents: i.unit_price_cents })),
                    method,
                    client_id: client?.id || null,
                    discount_cents: discountCents + pointsDiscountCents + giftCardDiscountCents,
                    points_redeemed: pointsDiscount,
                    coupon_code: couponDiscount > 0 ? couponCode.trim().toUpperCase() : null,
                    send_receipt: client?.phone ? sendReceipt : false,
                    idempotency_key: checkoutKeyRef.current,
                    performer_id: hasItems ? (performerId || null) : null,
                }),
            });
            checkoutKeyRef.current = crypto.randomUUID();
            setReceipt(txn);
            // Redeem gift card if used
            if (giftCardInfo && giftCardDiscountCents > 0) {
                try {
                    await apiFetch("/api/gift-cards/redeem", {
                        method: "POST",
                        body: JSON.stringify({
                            code: giftCardCode.trim().toUpperCase(),
                            amount_cents: giftCardDiscountCents,
                            client_id: client?.id || null,
                        }),
                    });
                } catch { /* silent — sale already processed */ }
            }
            setCart([]); setCalcDisplay("0"); setItemDesc(""); setClient(null); setClientSearch(""); setDiscountUnlocked(false);
            setDiscountPct(0); setCouponCode(""); setCouponDiscount(0); setCouponError("");
            setUsePoints(false); setPointsRedeemed(0);
            setGiftCardCode(""); setGiftCardInfo(null); setGiftCardDiscount(0); setGiftCardError("");
            setMobileTab("pad");
        } catch (err) { toast.error(err instanceof Error ? err.message : tx("שגיאה בתשלום")); }
        finally { setLoading(false); }
    };

    const handleAddClient = async () => {
        if (!newClientName.trim()) return;
        setAddingClient(true);
        try {
            const c = await apiFetch<ClientResult>("/api/clients/", { method: "POST", body: JSON.stringify({ name: newClientName.trim(), phone: newClientPhone.trim() || null }) });
            setClient(c); setShowAddClient(false); setNewClientName(""); setNewClientPhone("");
            toast.success(tx("לקוח נוסף"));
        } catch { toast.error(tx("שגיאה")); }
        finally { setAddingClient(false); }
    };

    // ── Left Panel (Calculator + Products) ────────────────────────────────────
    const LeftPanel = (
        <div className="flex flex-col h-full overflow-hidden bg-white">
            {/* Calc display */}
            <div className="bg-slate-900 text-white px-4 py-2 shrink-0">
                <div className="text-xs text-slate-400 h-4 truncate">{itemDesc || " "}</div>
                <div className="text-2xl font-mono font-bold text-start">
                    ₪{parseFloat(calcDisplay || "0").toLocaleString(intl(), { minimumFractionDigits: calcDisplay.includes(".") ? calcDisplay.split(".")[1]?.length || 0 : 0 })}
                </div>
            </div>
            {/* Desc input */}
            <div className="px-4 md:px-2 pt-2 shrink-0">
                <input value={itemDesc} onChange={e => setItemDesc(e.target.value)} placeholder={tx("תיאור...")}
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    onKeyDown={e => e.key === "Enter" && handleAddItem()} />
            </div>
            {services.length > 0 && (
                <div data-tour="pos-services" className="flex md:flex-wrap gap-1.5 px-4 md:px-3 pt-2 overflow-x-auto md:overflow-visible shrink-0" role="group" aria-label={tx("טיפולים מוכנים")}>
                    {services.map(svc => {
                        const on = pickedNames.includes(svc.name);
                        return (
                            <button key={svc.id} type="button" onClick={() => toggleService(svc.name)} aria-pressed={on}
                                className={`shrink-0 min-h-9 px-3 rounded-full text-sm font-semibold border transition-colors ${on ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-700 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50"}`}>
                                {svc.name}
                            </button>
                        );
                    })}
                </div>
            )}
            {/* Numpad */}
            {/* the keys: big enough for a thumb, not huge (the owner, 2026-10-12) */}
            <div data-tour="pos-pad" className="grid grid-cols-3 gap-2 px-4 md:px-3 pt-2 shrink-0">
                {[["7","8","9"],["4","5","6"],["1","2","3"],[".", "0","⌫"]].flat().map(k => (
                    <button key={k} type="button" onClick={() => handleNumKey(k)}
                        className={`h-12 md:h-14 rounded-xl font-bold text-xl transition-all active:scale-95 ${k === "⌫" ? "bg-rose-50 text-rose-500 border border-rose-200 hover:bg-rose-100" : "bg-slate-50 border border-slate-200 text-slate-800 hover:bg-emerald-50 hover:border-emerald-300"}`}>
                        {k}
                    </button>
                ))}
            </div>
            {/* Add button */}
            <div className="px-4 md:px-2 pt-2 shrink-0">
                <button type="button" data-tour="pos-add" onClick={handleAddItem} disabled={calcDisplay === "0" || parseFloat(calcDisplay) <= 0}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm transition-all active:scale-95 shadow-sm">
                    {tx("+ הוסף לעגלה")}
                </button>
            </div>
            {/* Category filter */}
            <div className="flex gap-1 px-4 md:px-2 pt-2 overflow-x-auto shrink-0">
                {[null, ...categories].map(cat => (
                    <button key={cat ?? "all"} type="button" onClick={() => setCategoryFilter(cat)}
                        className={`shrink-0 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${categoryFilter === cat ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                        {cat ?? tx("הכל")}
                    </button>
                ))}
            </div>
            {/* Products */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 md:p-2">
                {filteredProducts.length === 0 ? (
                    <div className="text-center text-slate-300 mt-6 text-xs">
                        <div className="text-2xl mb-1">📦</div>{tx("אין מוצרים")}
                        <a href="/products" className="block text-blue-400 hover:underline mt-1">{tx("הוסף מוצרים")}</a>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                        {filteredProducts.map(p => (
                            <button key={p.id} type="button" onClick={() => addProduct(p)} disabled={p.stock_quantity === 0}
                                className={`bg-white rounded-xl border p-2 text-start transition-all active:scale-95 ${p.stock_quantity === 0 ? "opacity-40 cursor-not-allowed border-slate-100" : "border-slate-200 hover:border-emerald-400 hover:shadow-sm"}`}>
                                {p.image_url
                                    ? <img src={p.image_url} alt={p.name} className="w-full h-10 object-cover rounded-lg mb-1" />
                                    : <div className="w-full h-10 bg-slate-100 rounded-lg mb-1 flex items-center justify-center text-base">📦</div>}
                                <div className="font-semibold text-slate-800 text-xs truncate leading-tight">{p.name}</div>
                                <div className="text-emerald-700 font-bold text-xs">₪{Number(p.price).toFixed(2)}</div>
                                <div className={`text-[9px] ${p.stock_quantity <= 3 ? "text-rose-500" : "text-slate-400"}`}>
                                    {p.stock_quantity === 0 ? tx("אזל") : tx("{0} במלאי", { 0: p.stock_quantity })}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    // ── Right Panel (Cart + Checkout) ─────────────────────────────────────────
    const RightPanel = (
        <div className="flex flex-col h-full overflow-hidden bg-slate-50">
            {/* Client — prominent */}
            <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-slate-700">{tx("👤 לקוח")}</span>
                    <button type="button" onClick={() => setShowAddClient(true)} className="text-sm text-emerald-600 font-bold hover:text-emerald-700">{tx("+ לקוח חדש")}</button>
                </div>
                {client ? (
                    <div className="flex items-center gap-2 bg-emerald-50 border-2 border-emerald-300 rounded-xl px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                            <div className="text-base font-bold text-emerald-800 truncate flex items-center gap-1.5">
                                {client.full_name || client.name}
                                {client.is_club_member && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">👑 VIP</span>}
                            </div>
                        </div>
                        <button type="button" onClick={() => { setClient(null); setClientSearch(""); }} className="text-emerald-300 hover:text-rose-500 text-xl leading-none">×</button>
                    </div>
                ) : (
                    <div className="relative">
                        <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder={tx("חפש שם או טלפון...")}
                            className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400" />
                        {searchLoading && <div className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />}
                        {clientResults.length > 0 && (
                            <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-30">
                                {clientResults.map(c => (
                                    <button key={c.id} type="button" onClick={() => { setClient({ ...c, name: c.full_name }); setClientSearch(""); setClientResults([]); }}
                                        className="w-full text-start px-4 py-2.5 hover:bg-emerald-50 transition-colors border-b border-slate-100 last:border-0">
                                        <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                                            {c.full_name}
                                            {c.is_club_member && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 rounded-full">👑</span>}
                                        </div>
                                        {c.phone && <div className="text-xs text-slate-400">{c.phone}</div>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Cart items — fills available height */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
                {cart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-300 py-12">
                        <div className="text-6xl mb-3">🛒</div>
                        <div className="text-sm font-medium">{tx("העגלה ריקה")}</div>
                    </div>
                ) : cart.map(item => (
                    <div key={item.key} className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 px-4 py-3 shadow-sm">
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-800 truncate">{item.description}</div>
                            <div className="text-xs text-slate-400 mt-0.5">₪{(item.unit_price_cents/100).toFixed(2)}</div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => updateQty(item.key, -1)} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 text-base font-bold">−</button>
                            <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                            <button type="button" onClick={() => updateQty(item.key, 1)} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 text-base font-bold">+</button>
                        </div>
                        <div className="text-sm font-bold text-slate-900 min-w-[4rem] text-left" dir="ltr">₪{((item.unit_price_cents*item.quantity)/100).toFixed(2)}</div>
                        <button type="button" onClick={() => removeItem(item.key)} className="text-slate-300 hover:text-rose-400 text-lg leading-none">×</button>
                    </div>
                ))}
            </div>

            {/* Bottom: totals + payment + checkout — compact, no scroll */}
            <div className="bg-white border-t border-slate-100 px-3 py-2 space-y-2 shrink-0">
                {/* Discount + Coupon — same row */}
                <div className="flex gap-2 items-center">
                    {/* Discount toggle */}
                    <div className="relative">
                        <button type="button" onClick={() => discountUnlocked ? setShowDiscountPicker(s => !s) : setAskOwnerPin(true)}
                            className={`flex items-center gap-1.5 text-sm font-bold px-3 min-h-11 rounded-xl border transition-all ${discountPct > 0 ? "bg-rose-50 border-rose-300 text-rose-700" : "bg-slate-50 border-slate-200 text-slate-600"}`}>
                            <Tag className="w-4 h-4" aria-hidden /> {discountPct > 0 ? `${discountPct}%` : tx("הנחה")}
                            {discountPct > 0 && <span role="button" aria-label={tx("בטל הנחה")} onClick={e => { e.stopPropagation(); setDiscountPct(0); }} className="ms-0.5 hover:text-rose-600"><X className="w-4 h-4" aria-hidden /></span>}
                        </button>
                        {showDiscountPicker && (
                            <div className="absolute bottom-full mb-1 start-0 z-40 bg-white border border-slate-200 rounded-xl shadow-xl p-2 w-64">
                                <div className="grid grid-cols-3 gap-1.5 mb-2">
                                    {[5,10,15,20,25,30].map(pct => (
                                        <button key={pct} type="button" onClick={() => { setDiscountPct(pct); setShowDiscountPicker(false); }}
                                            className={`min-h-10 rounded-lg text-sm font-bold border transition-all ${discountPct === pct ? "bg-rose-500 text-white border-rose-500" : "bg-white border-slate-200 text-slate-700 hover:border-rose-300"}`}>
                                            {pct}%
                                        </button>
                                    ))}
                                </div>
                                <div className="flex gap-1">
                                    <input type="number" inputMode="decimal" min="0" max="100" placeholder={tx("אחוז אחר")} className="flex-1 min-w-0 min-h-10 border border-slate-200 rounded-lg px-2 text-base focus:outline-none focus:ring-1 focus:ring-rose-400"
                                        onKeyDown={e => { if (e.key === "Enter") { setDiscountPct(parseFloat((e.target as HTMLInputElement).value) || 0); setShowDiscountPicker(false); } }} />
                                    <button type="button" onClick={() => setShowDiscountPicker(false)} aria-label={tx("סגור")} className="w-10 min-h-10 flex items-center justify-center text-slate-400"><X className="w-4 h-4" aria-hidden /></button>
                                </div>
                            </div>
                        )}
                    </div>
                    {/* Coupon */}
                    <div className="flex-1 flex gap-1 items-center">
                        <input value={couponCode} onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponDiscount(0); setCouponError(""); }}
                            placeholder={tx("קוד קופון...")}
                            className={`flex-1 min-w-0 min-h-11 border rounded-xl px-3 text-base font-mono focus:outline-none focus:ring-1 ${couponDiscount > 0 ? "border-emerald-400 bg-emerald-50" : couponError ? "border-rose-400" : "border-slate-200"}`}
                            onKeyDown={e => e.key === "Enter" && validateCoupon()} />
                        <button type="button" onClick={validateCoupon} disabled={!couponCode.trim() || couponLoading}
                            className="shrink-0 bg-slate-800 text-white px-4 min-h-11 rounded-xl text-sm font-bold disabled:opacity-40">
                            {couponLoading ? "..." : tx("אמת")}
                        </button>
                    </div>
                </div>
                {(couponError || couponDiscount > 0) && (
                    <div className={`text-xs -mt-1 ${couponDiscount > 0 ? "text-emerald-600" : "text-rose-500"}`}>
                        {couponDiscount > 0 ? tx("✓ קופון {0}% הופעל", { 0: couponDiscount }) : couponError}
                    </div>
                )}

                {/* Gift card redemption */}
                <div className="flex-1 flex gap-2 items-center">
                    <Gift className="w-5 h-5 shrink-0 text-violet-600" aria-hidden />
                    <input value={giftCardCode}
                        onChange={e => { setGiftCardCode(e.target.value.toUpperCase()); setGiftCardInfo(null); setGiftCardDiscount(0); setGiftCardError(""); }}
                        placeholder={tx("קוד גיפט קארד...")}
                        className={`flex-1 min-w-0 min-h-11 border rounded-xl px-3 text-base font-mono focus:outline-none focus:ring-1 ${giftCardInfo ? "border-violet-400 bg-violet-50" : giftCardError ? "border-rose-400" : "border-slate-200"}`}
                        onKeyDown={e => e.key === "Enter" && validateGiftCard()} />
                    <button type="button" onClick={validateGiftCard} disabled={!giftCardCode.trim() || giftCardLoading}
                        className="shrink-0 bg-violet-700 text-white px-4 min-h-11 rounded-xl text-sm font-bold disabled:opacity-40">
                        {giftCardLoading ? "..." : tx("אמת")}
                    </button>
                </div>
                {(giftCardError || giftCardInfo) && (
                    <div className={`text-xs -mt-1 ${giftCardInfo ? "text-violet-600" : "text-rose-500"}`}>
                        {giftCardInfo
                            ? tx("✓ כרטיס של {0} · יתרה ₪{1} · ינוכה ₪{2}", { 0: giftCardInfo.recipient_name, 1: giftCardInfo.balance_ils, 2: (giftCardDiscountCents / 100).toFixed(0) })
                            : giftCardError}
                    </div>
                )}

                {/* Points redemption — only when club member with points */}
                {client && availablePoints > 0 && plan.has("customer_club") && (
                    <div className={`rounded-xl border-2 transition-all px-3 py-2 ${usePoints ? "border-amber-400 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                        <div className="flex items-center justify-between">
                            <Switch size="sm" checked={usePoints} onColor="bg-amber-400"
                                title={usePoints ? tx("בטל ניצול נקודות") : tx("נצל נקודות")}
                                onChange={() => { setUsePoints(v => !v); if (!usePoints) setPointsRedeemed(maxRedeemPoints || availablePoints); else setPointsRedeemed(0); }} />
                            <div className="text-start">
                                <span className="text-xs font-bold text-slate-700">{tx("⭐ ניצול נקודות")}</span>
                                <span className="text-[10px] text-slate-400 ms-1">({availablePoints}{tx(" זמינות)")}</span>
                            </div>
                        </div>
                        {usePoints && (
                            <div className="flex items-center gap-2 mt-2">
                                <input type="range" min={0} max={availablePoints} value={pointsRedeemed}
                                    title={tx("כמות נקודות לניצול")}
                                    onChange={e => setPointsRedeemed(parseInt(e.target.value))}
                                    className="flex-1 accent-amber-400" />
                                <span className="text-xs font-bold text-amber-600 shrink-0 min-w-14 text-left" dir="ltr">
                                    {pointsRedeemed} ⭐ = ₪{pointsDiscount}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Totals — compact */}
                <div className="bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                    <div className="flex justify-between text-xs text-slate-500">
                        <span>{tx("סכום ביניים")}</span><span>₪{(subtotal/100).toFixed(2)}</span>
                    </div>
                    {discountCents > 0 && (
                        <div className="flex justify-between text-xs text-rose-600">
                            <span>{tx("הנחה (")}{discountPct + couponDiscount}%)</span><span>-₪{(discountCents/100).toFixed(2)}</span>
                        </div>
                    )}
                    {pointsDiscount > 0 && (
                        <div className="flex justify-between text-xs text-amber-600 font-bold">
                            <span>-₪{pointsDiscount.toFixed(2)}</span>
                            <span>{tx("ניצול ")}{pointsDiscount}{tx(" נקודות ⭐")}</span>
                        </div>
                    )}
                    {giftCardDiscountCents > 0 && (
                        <div className="flex justify-between text-xs text-violet-600 font-bold">
                            <span>-₪{(giftCardDiscountCents / 100).toFixed(2)}</span>
                            <span>{tx("גיפט קארד 🎁")}</span>
                        </div>
                    )}
                    <div className="flex justify-between font-bold text-sm text-slate-900 border-t border-slate-200 pt-1.5 mt-1">
                        <span>{tx("סה״כ לתשלום")}</span>
                        <span className="text-emerald-700">₪{(total/100).toFixed(2)}</span>
                    </div>
                </div>

                {/* Who sold the items (counts in the team's sales) — only when the cart has items */}
                {hasItems && team.length > 1 && (
                    <label className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 border border-slate-200 bg-white">
                        <span className="text-xs font-semibold text-slate-700">{tx("מי מכר")}</span>
                        <select value={performerId} onChange={e => setPerformerId(e.target.value)}
                            className="text-sm font-bold text-slate-800 bg-transparent outline-none max-w-[60%]">
                            {team.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                        </select>
                    </label>
                )}

                {/* Payment methods — big buttons */}
                <div className="grid grid-cols-5 gap-1.5">
                    {PAYMENT_METHODS.map(pm => (
                        <button key={pm.key} type="button" onClick={() => setMethod(pm.key)}
                            className={`rounded-2xl py-3 text-center transition-all border-2 active:scale-95 ${method === pm.key ? "bg-emerald-600 text-white border-emerald-600 shadow-md" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50"}`}>
                            <div className="text-xl leading-none">{pm.icon}</div>
                            <div className="text-[10px] font-bold mt-1 leading-tight">{pm.label}</div>
                        </button>
                    ))}
                </div>

                {/* Send receipt toggle — only when client has phone */}
                {client?.phone && (
                    <div className={`flex items-center justify-between rounded-xl px-3 py-2 border transition-all ${sendReceipt ? "bg-blue-50 border-blue-200" : "bg-slate-50 border-slate-200"}`}>
                        <span className="text-xs font-semibold text-slate-700">{tx("📲 שלח קבלה בוואטסאפ")}</span>
                        <Switch size="sm" checked={sendReceipt} onChange={setSendReceipt} onColor="bg-blue-500"
                            title={sendReceipt ? tx("בטל שליחת קבלה") : tx("שלח קבלה")} />
                    </div>
                )}

                {/* Checkout */}
                <button type="button" data-tour="pos-checkout" onClick={handleCheckout} disabled={loading || cart.length === 0}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-2xl text-sm transition-all shadow-md active:scale-95">
                    {loading ? tx("מעבד...") : tx("💳 גבה ₪{0}", { 0: (total/100).toFixed(2) })}
                </button>
                {client?.phone && cart.length > 0 && (
                    <button type="button" onClick={sendPayLink} disabled={sendingLink || linkBlocked}
                        title={linkBlocked ? tx("קישור לתשלום — בלי נקודות, גיפט קארד או קופון") : undefined}
                        className="w-full bg-white border-2 border-sky-500 text-sky-700 hover:bg-sky-50 disabled:opacity-50 font-bold py-2.5 rounded-2xl text-sm transition-all">
                        {sendingLink ? tx("שולח...") : tx("📲 שליחת קישור לתשלום בוואטסאפ")}
                    </button>
                )}
            </div>
        </div>
    );

    return (
        <RequireAuth>
        <AppShell title={tx("קופה")} fullBleed>
        <div className="h-full overflow-hidden bg-slate-100">

            {/* ── DESKTOP: 2 columns side by side ── */}
            <div className="hidden md:flex h-full">
                <div className="w-80 shrink-0 border-e border-slate-200 shadow-sm">{LeftPanel}</div>
                <div className="flex-1 min-w-0">{RightPanel}</div>
            </div>

            {/* ── MOBILE: Tab switching ── */}
            <div className="flex flex-col md:hidden h-full">
                {/* Mobile tab bar */}
                <div className="flex bg-white border-b border-slate-200 shrink-0">
                    <button type="button" onClick={() => setMobileTab("pad")}
                        className={`flex-1 py-2.5 text-sm font-bold transition-colors ${mobileTab === "pad" ? "text-emerald-600 border-b-2 border-emerald-600" : "text-slate-500"}`}>
                        {tx("🧮 מחשבון")}
                    </button>
                    <button type="button" onClick={() => setMobileTab("cart")}
                        className={`flex-1 py-2.5 text-sm font-bold transition-colors relative ${mobileTab === "cart" ? "text-emerald-600 border-b-2 border-emerald-600" : "text-slate-500"}`}>
                        {tx("🛒 עגלה")}
                        {cartCount > 0 && (
                            <span className="absolute top-1.5 start-6 bg-emerald-600 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                {cartCount}
                            </span>
                        )}
                    </button>
                </div>
                {/* Mobile panel */}
                <div className="flex-1 min-h-0">
                    {mobileTab === "pad" ? LeftPanel : RightPanel}
                </div>
            </div>
        </div>

        {/* Modals */}
        {receipt && <ReceiptModal txn={receipt} clientId={client?.id ?? null} onClose={() => setReceipt(null)}
            onBack={() => { setReceipt(null); if (window.history.length > 1) router.back(); else router.push("/dashboard"); }} />}
        {showAddClient && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAddClient(false)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-5" onClick={e => e.stopPropagation()}>
                    <div className="text-sm font-bold text-slate-800 mb-3">{tx("הוסף לקוח חדש")}</div>
                    <div className="space-y-2">
                        <input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder={tx("שם מלא *")} autoFocus
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            onKeyDown={e => e.key === "Enter" && handleAddClient()} />
                        <input value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} placeholder={tx("טלפון")} type="tel"
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            onKeyDown={e => e.key === "Enter" && handleAddClient()} />
                    </div>
                    <div className="flex gap-2 mt-3">
                        <button type="button" onClick={handleAddClient} disabled={!newClientName.trim() || addingClient}
                            className="flex-1 bg-emerald-600 text-white font-bold py-2 rounded-xl text-sm disabled:opacity-50">
                            {addingClient ? "..." : tx("הוסף")}
                        </button>
                        <button type="button" onClick={() => setShowAddClient(false)}
                            className="px-4 border border-slate-200 rounded-xl text-sm text-slate-600">{tx("ביטול")}</button>
                    </div>
                </div>
            </div>
        )}
        {askOwnerPin && (
            <PinModal mode="verify" heading={tx("אישור הנחה")} hint={tx("הזן את ה-PIN של בעל העסק כדי לתת הנחה")}
                onSuccess={() => { setAskOwnerPin(false); setDiscountUnlocked(true); setShowDiscountPicker(true); }}
                onClose={() => setAskOwnerPin(false)} />
        )}
        </AppShell>
        </RequireAuth>
    );
}
