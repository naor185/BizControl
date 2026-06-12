"use client";

import { toast } from "@/lib/toast";
import { useState, useEffect, useRef } from "react";
import { Product, createProduct, updateProduct, apiFetch } from "@/lib/api";

interface ProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    product?: Product | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function ProductModal({ isOpen, onClose, onSuccess, product }: ProductModalProps) {
    const [name, setName] = useState("");
    const [price, setPrice] = useState("");
    const [category, setCategory] = useState("");
    const [description, setDescription] = useState("");
    const [stockQuantity, setStockQuantity] = useState("0");
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [loading, setLoading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (product) {
            setName(product.name);
            setPrice(product.price.toString());
            setCategory(product.category || "");
            setDescription(product.description || "");
            setStockQuantity(product.stock_quantity?.toString() || "0");
            setImageUrl(product.image_url || null);
        } else {
            setName(""); setPrice(""); setCategory("");
            setDescription(""); setStockQuantity("0"); setImageUrl(null);
        }
    }, [product, isOpen]);

    if (!isOpen) return null;

    const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const token = localStorage.getItem("bizcontrol_token") || "";
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(`${API_BASE}/api/studio/upload/image`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: form,
            });
            if (!res.ok) throw new Error("שגיאה בהעלאת תמונה");
            const data = await res.json();
            const url = data.url || `${API_BASE}/uploads/${data.filename}`;
            setImageUrl(url);
        } catch (err: any) {
            toast.error(err?.message || "שגיאה בהעלאת תמונה");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const data: Partial<Product> = {
                name,
                price: parseFloat(price),
                category,
                description,
                stock_quantity: parseInt(stockQuantity) || 0,
                image_url: imageUrl || undefined,
            };
            if (product) await updateProduct(product.id, data);
            else await createProduct(data);
            onSuccess();
            onClose();
        } catch (err: any) {
            toast.error("שגיאה בשמירת מוצר:\n" + (err?.message || String(err)));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/50 shrink-0">
                    <h2 className="text-xl font-bold text-slate-800">{product ? "עריכת מוצר" : "הוספת מוצר חדש 🎁"}</h2>
                    <button type="button" onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400">✕</button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">

                    {/* Image upload */}
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">תמונת מוצר</label>
                        <div
                            className="relative w-full h-36 rounded-2xl border-2 border-dashed border-slate-200 overflow-hidden cursor-pointer hover:border-indigo-400 transition-colors flex items-center justify-center bg-slate-50"
                            onClick={() => fileRef.current?.click()}
                        >
                            {imageUrl ? (
                                <>
                                    <img src={imageUrl} alt="תמונת מוצר" className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <span className="text-white text-sm font-bold">החלף תמונה</span>
                                    </div>
                                </>
                            ) : uploading ? (
                                <div className="text-slate-400 text-sm flex flex-col items-center gap-2">
                                    <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                                    <span>מעלה...</span>
                                </div>
                            ) : (
                                <div className="text-slate-400 text-sm flex flex-col items-center gap-2">
                                    <span className="text-3xl">📷</span>
                                    <span>לחץ להעלאת תמונה</span>
                                    <span className="text-xs text-slate-300">JPG, PNG, WebP</span>
                                </div>
                            )}
                        </div>
                        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
                        {imageUrl && (
                            <button type="button" onClick={() => setImageUrl(null)} className="mt-1 text-xs text-rose-400 hover:text-rose-600">
                                הסר תמונה
                            </button>
                        )}
                    </div>

                    {/* Name */}
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">שם המוצר</label>
                        <input required value={name} onChange={e => setName(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500"
                            placeholder="למשל: קנואה, בוסם ארמף..." />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">מחיר (₪)</label>
                            <input required type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-left" dir="ltr" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">קטגוריה</label>
                            <input value={category} onChange={e => setCategory(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="אופציונלי" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">כמות במלאי</label>
                        <input required type="number" value={stockQuantity} onChange={e => setStockQuantity(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-left" dir="ltr" />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">תיאור</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 h-20 resize-none"
                            placeholder="תיאור קצר..." />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose}
                            className="flex-1 px-6 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all">
                            ביטול
                        </button>
                        <button type="submit" disabled={loading || uploading}
                            className="flex-[2] px-6 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all shadow-lg disabled:opacity-50">
                            {loading ? "שומר..." : product ? "עדכן מוצר" : "הוסף לקטלוג"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
