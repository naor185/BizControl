"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API } from "@/lib/api";

interface BookingStatus {
    status: "pending" | "approved" | "rejected";
    client_name: string;
    requested_at: string;
    service_note: string | null;
    artist_name: string | null;
    studio_name: string | null;
    studio_address: string | null;
    studio_logo: string | null;
    rejection_reason: string | null;
    appointment_id: string | null;
    appointment_status: string | null;
}

const STATUS_DISPLAY = {
    pending:  { emoji: "⏳", label: "ממתין לאישור", color: "text-yellow-600 bg-yellow-50 border-yellow-200" },
    approved: { emoji: "✅", label: "אושר!",         color: "text-green-700 bg-green-50 border-green-200"  },
    rejected: { emoji: "❌", label: "לא אושר",       color: "text-red-600 bg-red-50 border-red-200"        },
};

export default function BookingStatusPage() {
    const { token } = useParams<{ token: string }>();
    const [data, setData] = useState<BookingStatus | null>(null);
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${API}/api/public/booking/${token}`)
            .then(r => {
                if (!r.ok) throw new Error();
                return r.json();
            })
            .then(setData)
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [token]);

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
    );

    if (error || !data) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center" dir="rtl">
            <div className="text-5xl mb-4">🔍</div>
            <h1 className="text-xl font-bold text-gray-800 mb-2">הזמנה לא נמצאה</h1>
            <p className="text-gray-500">הלינק לא תקין או שההזמנה כבר אינה קיימת.</p>
        </div>
    );

    const st = STATUS_DISPLAY[data.status] || STATUS_DISPLAY.pending;

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
            <div className="bg-white rounded-2xl shadow-lg max-w-md w-full overflow-hidden">
                {/* Header */}
                <div className="bg-indigo-600 px-6 py-5 text-white text-center">
                    {data.studio_logo && (
                        <img src={data.studio_logo} alt={data.studio_name || ""} className="w-14 h-14 rounded-full object-cover mx-auto mb-3 border-2 border-white/40" />
                    )}
                    <h1 className="text-lg font-bold">{data.studio_name || "הסטודיו"}</h1>
                    <p className="text-indigo-200 text-sm mt-0.5">פרטי הזמנה</p>
                </div>

                {/* Status badge */}
                <div className="px-6 pt-5">
                    <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-base font-semibold ${st.color}`}>
                        <span className="text-xl">{st.emoji}</span>
                        <span>{st.label}</span>
                    </div>
                </div>

                {/* Details */}
                <div className="px-6 py-4 space-y-3 text-sm text-gray-700">
                    <Row label="לקוח" value={data.client_name} />
                    <Row label="תאריך ושעה" value={data.requested_at} />
                    {data.artist_name && <Row label="עם" value={data.artist_name} />}
                    {data.service_note && <Row label="שירות" value={data.service_note} />}
                    {data.studio_address && <Row label="כתובת" value={data.studio_address} />}
                    {data.rejection_reason && (
                        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700 text-xs">
                            <span className="font-semibold">סיבה: </span>{data.rejection_reason}
                        </div>
                    )}
                </div>

                {data.status === "pending" && (
                    <div className="px-6 pb-5">
                        <p className="text-center text-xs text-gray-400">הסטודיו יאשר את הבקשה בהקדם. תקבל הודעה בוואטסאפ.</p>
                    </div>
                )}

                {data.status === "approved" && (
                    <div className="px-6 pb-5">
                        <div className="text-center text-xs text-green-600 font-medium">🎉 התור שלך מאושר ונעול ביומן!</div>
                    </div>
                )}

                {data.status === "rejected" && (
                    <div className="px-6 pb-6">
                        <a href="/" className="block text-center bg-indigo-600 text-white rounded-xl py-3 font-semibold text-sm hover:bg-indigo-700 transition">
                            חפש זמן חלופי
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-2">
            <span className="text-gray-400 shrink-0">{label}</span>
            <span className="font-medium text-right">{value}</span>
        </div>
    );
}
