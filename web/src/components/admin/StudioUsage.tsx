"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { apiFetch } from "@/lib/api";

// The superadmin's view of one business's use of what its plan counts (GET /api/admin/studios/{id}/usage —
// app/core/features.get_usage_dashboard). The business owner sees the same month in "ניצול החודש".
type Row = { quota_key: string; period_type: string; used: number; limit: number | null };

const LABELS: Record<string, string> = {
    whatsapp: "הודעות WhatsApp", broadcasts: "תפוצות", invoice_ai_scan: "סריקות חשבוניות",
    ai_theme_generate: "עיצוב דף ב-AI", staff_seats: "אנשי צוות", multi_location: "סניפים",
};
const PERIOD: Record<string, string> = { monthly: "החודש", lifetime: "סה״כ", daily: "היום", weekly: "השבוע", yearly: "השנה" };

export default function StudioUsage({ studioId }: { studioId: string }) {
    const [rows, setRows] = useState<Row[] | null>(null);
    useEffect(() => {
        apiFetch<Row[]>(`/api/admin/studios/${studioId}/usage`).then(setRows).catch(() => setRows([]));
    }, [studioId]);
    if (!rows || rows.length === 0) return null;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
                <Gauge className="w-4 h-4 text-gray-500" aria-hidden />
                <h2 className="text-sm font-semibold text-gray-700">ניצול לפי המסלול</h2>
            </div>
            <div className="divide-y divide-gray-50">
                {rows.map(r => {
                    const over = r.limit !== null && r.used >= r.limit;
                    return (
                        <div key={r.quota_key} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                            <span className="text-gray-700">{LABELS[r.quota_key] ?? r.quota_key}</span>
                            <span className={`tabular-nums ${over ? "text-rose-600 font-semibold" : "text-gray-500"}`}>
                                {r.used.toLocaleString("he-IL")}
                                {r.limit !== null ? ` / ${r.limit.toLocaleString("he-IL")}` : ""} {PERIOD[r.period_type] ?? ""}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
