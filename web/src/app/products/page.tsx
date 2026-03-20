"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { getProducts, deleteProduct, Product, apiFetch } from "@/lib/api";
import ProductModal from "@/components/ProductModal";

export default function ProductsPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [salesHistory, setSalesHistory] = useState<any[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    const fetchProducts = async () => {
        try {
            setLoading(true);
            const [productsData, salesData] = await Promise.all([
                getProducts(),
                apiFetch<any[]>("/api/products/sales-history")
            ]);
            setProducts(productsData);
            setSalesHistory(salesData);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
    }, []);

    const handleDelete = async (id: string) => {
        if (!confirm("בטוח שברצונך למחוק מוצר זה מהקטלוג?")) return;
        try {
            await deleteProduct(id);
            fetchProducts();
        } catch (err) {
            alert("שגיאה במחיקת מוצר");
        }
    };

    const filtered = products.filter(p => 
        p.name.toLowerCase().includes(search.toLowerCase()) || 
        p.category?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <RequireAuth>
            <AppShell title="ניהול מוצרים ומלאי">
                <div className="space-y-8">
                    {/* Header Actions */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="relative flex-1 max-w-md">
                            <span className="absolute inset-y-0 right-4 flex items-center text-slate-400">🔍</span>
                            <input
                                type="text"
                                placeholder="חפש מוצר או קטגוריה..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pr-12 pl-4 py-3 bg-white border border-slate-100 rounded-2xl shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowHistory(!showHistory)}
                                className={`px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 ${showHistory ? 'bg-slate-200 text-slate-700' : 'bg-white border border-slate-200 text-slate-600 shadow-sm hover:bg-slate-50'}`}
                            >
                                <span>{showHistory ? "חזור לקטלוג" : "היסטוריית מכירות"}</span>
                                <span>📊</span>
                            </button>
                            <button
                                onClick={() => {
                                    setEditingProduct(null);
                                    setIsModalOpen(true);
                                }}
                                className="px-6 py-3 bg-zinc-900 text-white rounded-2xl font-bold shadow-lg hover:bg-zinc-800 transition-all flex items-center gap-2"
                            >
                                <span>הוספת מוצר חדש</span>
                                <span>+</span>
                            </button>
                        </div>
                    </div>

                    {showHistory ? (
                        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                            <div className="bg-slate-900 p-6 text-white">
                                <h3 className="text-xl font-bold">היסטוריית מכירות מוצרים</h3>
                                <p className="text-slate-400 text-sm mt-1">פירוט עסקאות ומכירת ציוד נלווה</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-right" dir="rtl">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">תאריך</th>
                                            <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">מוצר</th>
                                            <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">כמות</th>
                                            <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">נמכר ע״י</th>
                                            <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">סה״כ</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {salesHistory.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">אין עדיין היסטוריית מכירות</td>
                                            </tr>
                                        ) : (
                                            salesHistory.map((s) => (
                                                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-6 py-4 text-sm font-medium text-slate-500">{new Date(s.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                                                    <td className="px-6 py-4 text-sm font-bold text-slate-800">{s.product_name}</td>
                                                    <td className="px-6 py-4 text-sm font-bold text-slate-600">{s.quantity}</td>
                                                    <td className="px-6 py-4 text-sm font-medium text-indigo-600">{s.sold_by_name || "מערכת"}</td>
                                                    <td className="px-6 py-4 text-sm font-black text-slate-900" dir="ltr">₪{(s.total_price_cents / 100).toLocaleString()}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : ( 
                        <>
                        {loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {[1, 2, 3, 4].map(i => <div key={i} className="h-64 bg-slate-100 animate-pulse rounded-3xl" />)}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-slate-200">
                            <div className="text-4xl mb-4">📦</div>
                            <h3 className="text-xl font-bold text-slate-800">הקטלוג ריק</h3>
                            <p className="text-slate-400 mt-2">הוסף מוצרים כמו תכשיטים, קרמים או ציוד נלווה כדי להתחיל לנהל מלאי</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filtered.map((p) => (
                                <div key={p.id} className="group bg-white rounded-3xl border border-slate-100 p-6 shadow-sm hover:shadow-xl transition-all relative overflow-hidden flex flex-col">
                                    <div className="flex justify-between items-start mb-4">
                                        <span className="px-3 py-1 bg-slate-50 text-slate-500 text-[10px] font-black uppercase rounded-full tracking-widest">{p.category || "ללא קטגוריה"}</span>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => { setEditingProduct(p); setIsModalOpen(true); }} className="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100">✏️</button>
                                            <button onClick={() => handleDelete(p.id)} className="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100">✕</button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex-1">
                                        <h3 className="text-lg font-bold text-slate-800 mb-1">{p.name}</h3>
                                        <p className="text-xs text-slate-400 line-clamp-2 mb-4">{p.description || "אין תיאור למוצר זה"}</p>
                                    </div>

                                    <div className="pt-4 border-t border-slate-50 flex items-center justify-between mt-auto">
                                        <div className="text-2xl font-black text-slate-900" dir="ltr">₪{p.price.toLocaleString()}</div>
                                        <div className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${p.stock_quantity > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'}`}>
                                            {p.stock_quantity > 0 ? `במלאי: ${p.stock_quantity}` : 'אזל מהמלאי'}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    </>
                    )}
                </div>

                <ProductModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSuccess={fetchProducts}
                    product={editingProduct}
                />
            </AppShell>
        </RequireAuth>
    );
}
