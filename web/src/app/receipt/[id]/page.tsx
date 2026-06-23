"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// Empty string = relative URL → Next.js rewrites proxy /api/* to backend (same as lib/api.ts)
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

type ReceiptItem = {
  description: string;
  quantity: number;
  unit_price_ils: number;
  total_price_ils: number;
};

type Receipt = {
  id: string;
  doc_type: string;
  doc_type_label: string;
  doc_number: number;
  status: string;
  issued_at: string;
  client_name: string | null;
  client_phone: string | null;
  business_name: string | null;
  business_number: string | null;
  business_address: string | null;
  business_city: string | null;
  business_phone: string | null;
  business_email: string | null;
  business_logo_url: string | null;
  subtotal_ils: number;
  vat_rate: number | null;
  vat_amount_ils: number;
  total_ils: number;
  tip_ils: number;
  payment_method: string | null;
  payment_method_label: string;
  notes: string | null;
  items: ReceiptItem[];
  points_earned: number | null;
  loyalty_points_total: number | null;
};

function fmt(n: number) {
  return `₪${Math.abs(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PublicReceiptPage() {
  const params = useParams();
  const id = params.id as string;

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/api/public/receipts/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("קבלה לא נמצאה");
        return r.json();
      })
      .then(setReceipt)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <p className="text-gray-500 text-lg">טוען קבלה...</p>
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <div className="text-center">
          <p className="text-2xl mb-2">😕</p>
          <p className="text-gray-600">{error || "קבלה לא נמצאה"}</p>
        </div>
      </div>
    );
  }

  const hasVat = receipt.vat_amount_ils > 0;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .receipt-card { box-shadow: none !important; border: none !important; max-width: 100% !important; }
        }
      `}</style>
      <div className="min-h-screen bg-gray-100 py-8 px-4" dir="rtl">
        {/* Print button */}
        <div className="max-w-lg mx-auto mb-4 no-print flex justify-end">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg shadow-sm hover:bg-gray-50 text-sm font-medium transition"
          >
            🖨️ הדפסה / שמור PDF
          </button>
        </div>

        {/* Receipt card */}
        <div className="receipt-card max-w-lg mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-[#1a1a2e] text-white px-6 py-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xl font-bold">{receipt.business_name || "העסק"}</p>
                <p className="text-gray-300 text-sm mt-0.5">{receipt.doc_type_label}</p>
              </div>
              <div className="text-left">
                <p className="text-2xl font-bold">#{receipt.doc_number}</p>
                <p className="text-gray-300 text-xs mt-0.5">{receipt.issued_at}</p>
              </div>
            </div>
          </div>

          {/* Business info */}
          {(receipt.business_number || receipt.business_address || receipt.business_phone || receipt.business_email) && (
            <div className="bg-gray-50 border-b border-gray-100 px-6 py-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
              {receipt.business_number && <span>ח.פ/ע.מ: {receipt.business_number}</span>}
              {receipt.business_address && <span>{receipt.business_address}{receipt.business_city ? `, ${receipt.business_city}` : ""}</span>}
              {receipt.business_phone && <span>טל: {receipt.business_phone}</span>}
              {receipt.business_email && <span>{receipt.business_email}</span>}
            </div>
          )}

          <div className="px-6 py-5 space-y-5">
            {/* Client */}
            {(receipt.client_name || receipt.client_phone) && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">לכבוד</p>
                {receipt.client_name && <p className="font-semibold text-gray-800">{receipt.client_name}</p>}
                {receipt.client_phone && <p className="text-sm text-gray-500">{receipt.client_phone}</p>}
              </div>
            )}

            {/* Items */}
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-gray-500 text-xs">
                    <th className="text-right py-2 px-2 font-medium rounded-r-md">תיאור</th>
                    <th className="text-center py-2 px-2 font-medium">כמות</th>
                    <th className="text-left py-2 px-2 font-medium rounded-l-md">סה&quot;כ</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2.5 px-2 text-gray-700">{item.description}</td>
                      <td className="py-2.5 px-2 text-center text-gray-500">
                        {String(item.quantity).replace(/\.0+$/, "")}
                      </td>
                      <td className="py-2.5 px-2 text-left font-medium text-gray-800">
                        {fmt(item.total_price_ils)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="border-t border-gray-100 pt-3 space-y-1.5">
              {hasVat && (
                <>
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>סכום לפני מע&quot;מ</span>
                    <span>{fmt(receipt.subtotal_ils)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>מע&quot;מ {receipt.vat_rate?.toFixed(0)}%</span>
                    <span>{fmt(receipt.vat_amount_ils)}</span>
                  </div>
                </>
              )}
              {receipt.tip_ils > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>טיפ</span>
                  <span>{fmt(receipt.tip_ils)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
                <span>סה&quot;כ לתשלום</span>
                <span className="text-lg">{fmt(receipt.total_ils)}</span>
              </div>
              {!hasVat && (
                <p className="text-xs text-gray-400">* עוסק פטור, אינו חייב במע&quot;מ</p>
              )}
            </div>

            {/* Payment method */}
            {receipt.payment_method_label && (
              <div className="flex items-center gap-2 bg-green-50 text-green-800 rounded-lg px-4 py-2.5 text-sm">
                <span>✅</span>
                <span>שולם ב{receipt.payment_method_label}</span>
              </div>
            )}

            {/* Club member points */}
            {receipt.loyalty_points_total !== null && receipt.loyalty_points_total !== undefined && (
              <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-800">
                {receipt.points_earned ? (
                  <>
                    <p className="font-bold">⭐ בקנייה זו צברת {receipt.points_earned} נקודות למימוש בקנייה הבאה שלך!</p>
                    <p className="mt-0.5 text-green-700">סך הכל נקודות: {receipt.loyalty_points_total}</p>
                  </>
                ) : (
                  <p className="font-medium">⭐ סך הכל נקודות מועדון: {receipt.loyalty_points_total}</p>
                )}
              </div>
            )}

            {/* Notes */}
            {receipt.notes && (
              <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
                <span className="font-medium text-gray-700">הערות: </span>
                {receipt.notes}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 border-t border-gray-100 px-6 py-3 text-center text-xs text-gray-400">
            הופק באמצעות מערכת BizControl | מסמך ממוחשב
          </div>
        </div>
      </div>
    </>
  );
}
