"use client";

import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";

type ToastItem = { id: number; msg: string; type: "error" | "success" | "info" };

const CONFIG = {
    error:   { bg: "bg-red-50",     border: "border-red-200",   text: "text-red-800",   icon: "✕" },
    success: { bg: "bg-green-50",   border: "border-green-200", text: "text-green-800", icon: "✓" },
    info:    { bg: "bg-blue-50",    border: "border-blue-200",  text: "text-blue-800",  icon: "ℹ" },
};

export default function GlobalToast() {
    const [items, setItems] = useState<ToastItem[]>([]);

    useEffect(() => {
        let counter = 0;
        toast._register((msg, type) => {
            const id = ++counter;
            setItems(prev => [...prev.slice(-4), { id, msg, type }]);
            setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 5000);
        });
        return () => toast._unregister();
    }, []);

    if (items.length === 0) return null;

    return (
        <div className="fixed bottom-24 left-4 right-4 md:left-auto md:right-6 md:w-96 z-[300] flex flex-col gap-2">
            {items.map(item => {
                const c = CONFIG[item.type];
                return (
                    <div key={item.id} dir="rtl"
                        className={`flex items-start gap-3 px-4 py-3.5 rounded-2xl border shadow-lg ${c.bg} ${c.border} animate-toast-in`}>
                        <span className={`text-base font-bold mt-0.5 ${c.text}`}>{c.icon}</span>
                        <p className={`flex-1 text-sm font-medium leading-snug ${c.text}`}>{item.msg}</p>
                        <button
                            onClick={() => setItems(prev => prev.filter(t => t.id !== item.id))}
                            className="text-slate-400 hover:text-slate-600 text-xs leading-none mt-0.5"
                        >✕</button>
                    </div>
                );
            })}
        </div>
    );
}
