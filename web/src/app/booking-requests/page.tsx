"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch } from "@/lib/api";
import { CheckCircle2, XCircle, Clock, Phone, Mail, Calendar, User, MessageSquare } from "lucide-react";

interface BookingRequest {
    id: string;
    artist_name?: string;
    client_name: string;
    client_phone: string;
    client_email?: string;
    service_note?: string;
    requested_at_local: string;
    status: "pending" | "approved" | "rejected";
    rejection_reason?: string;
    appointment_id?: string;
    created_at: string;
}

const STATUS_CONFIG = {
    pending:  { label: "ממתין לאישור", color: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
    approved: { label: "אושר",         color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
    rejected: { label: "נדחה",         color: "bg-red-100 text-red-600", dot: "bg-red-400" },
};

type Filter = "all" | "pending" | "approved" | "rejected";

export default function BookingRequestsPage() {
    const [requests, setRequests] = useState<BookingRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<Filter>("pending");
    const [actionId, setActionId] = useState<string | null>(null);
    const [rejectModal, setRejectModal] = useState<{ id: string } | null>(null);
    const [rejectReason, setRejectReason] = useState("");

    async function load() {
        setLoading(true);
        try {
            const data = await apiFetch<BookingRequest[]>("/api/booking-requests");
            setRequests(data);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }

    useEffect(() => { load(); }, []);

    const filtered = filter === "all" ? requests : requests.filter(r => r.status === filter);
    const pendingCount = requests.filter(r => r.status === "pending").length;

    async function approve(id: string) {
        setActionId(id);
        try {
            await apiFetch(`/api/booking-requests/${id}/approve`, { method: "PATCH" });
            await load();
        } catch (e: unknown) {
            alert(e instanceof Error ? e.message : "שגיאה");
        } finally { setActionId(null); }
    }

    async function reject(id: string) {
        setActionId(id);
        try {
            await apiFetch(`/api/booking-requests/${id}/reject`, {
                method: "PATCH",
                body: JSON.stringify({ reason: rejectReason || null }),
            });
            setRejectModal(null);
            setRejectReason("");
            await load();
        } catch (e: unknown) {
            alert(e instanceof Error ? e.message : "שגיאה");
        } finally { setActionId(null); }
    }

    return (
        <div className="p-4 md:p-6 max-w-3xl mx-auto" dir="rtl">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900">בקשות תורים</h1>
                    <p className="text-sm text-zinc-500 mt-0.5">
                        {pendingCount > 0 ? `${pendingCount} בקשות ממתינות לאישורך` : "אין בקשות ממתינות"}
                    </p>
                </div>
                <button onClick={load} className="text-sm text-zinc-500 hover:text-zinc-700 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors">
                    רענן
                </button>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 mb-5 bg-zinc-100 p-1 rounded-xl w-fit">
                {([
                    { key: "pending", label: "ממתינים" },
                    { key: "approved", label: "אושרו" },
                    { key: "rejected", label: "נדחו" },
                    { key: "all", label: "הכל" },
                ] as { key: Filter; label: string }[]).map(({ key, label }) => (
                    <button key={key} onClick={() => setFilter(key)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}>
                        {label}
                        {key === "pending" && pendingCount > 0 && (
                            <span className="mr-1.5 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5">{pendingCount}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* List */}
            {loading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white rounded-2xl border border-zinc-200 p-5 animate-pulse">
                            <div className="h-4 w-32 bg-zinc-200 rounded mb-3" />
                            <div className="h-3 w-48 bg-zinc-100 rounded" />
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-zinc-400">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">אין בקשות</p>
                </div>
            ) : (
                <AnimatePresence mode="popLayout">
                    <div className="space-y-3">
                        {filtered.map(req => {
                            const sc = STATUS_CONFIG[req.status];
                            const isPending = req.status === "pending";
                            return (
                                <motion.div key={req.id}
                                    layout
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.97 }}
                                    className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">

                                    {/* Top bar */}
                                    <div className={`h-1 w-full ${sc.dot}`} />

                                    <div className="p-5">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                {/* Client name + status */}
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-semibold text-zinc-900 text-base">{req.client_name}</h3>
                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sc.color}`}>{sc.label}</span>
                                                </div>

                                                {/* Details */}
                                                <div className="mt-2 space-y-1">
                                                    <div className="flex items-center gap-1.5 text-sm text-zinc-500">
                                                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                                                        <span>{req.requested_at_local}</span>
                                                    </div>
                                                    {req.artist_name && (
                                                        <div className="flex items-center gap-1.5 text-sm text-zinc-500">
                                                            <User className="h-3.5 w-3.5 shrink-0" />
                                                            <span>{req.artist_name}</span>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-1.5 text-sm text-zinc-500">
                                                        <Phone className="h-3.5 w-3.5 shrink-0" />
                                                        <a href={`tel:${req.client_phone}`} className="hover:text-zinc-800 hover:underline">{req.client_phone}</a>
                                                    </div>
                                                    {req.client_email && (
                                                        <div className="flex items-center gap-1.5 text-sm text-zinc-500">
                                                            <Mail className="h-3.5 w-3.5 shrink-0" />
                                                            <span className="truncate">{req.client_email}</span>
                                                        </div>
                                                    )}
                                                    {req.service_note && (
                                                        <div className="flex items-start gap-1.5 text-sm text-zinc-500">
                                                            <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                                            <span className="text-zinc-600 italic">{req.service_note}</span>
                                                        </div>
                                                    )}
                                                    {req.rejection_reason && (
                                                        <div className="text-sm text-red-500 mt-1">סיבת דחייה: {req.rejection_reason}</div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* WhatsApp quick action */}
                                            <a href={`https://wa.me/${req.client_phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"
                                                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors text-lg">
                                                💬
                                            </a>
                                        </div>

                                        {/* Actions */}
                                        {isPending && (
                                            <div className="flex gap-2 mt-4">
                                                <button onClick={() => approve(req.id)}
                                                    disabled={actionId === req.id}
                                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 active:scale-95">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    {actionId === req.id ? "מאשר..." : "אשר תור"}
                                                </button>
                                                <button onClick={() => { setRejectModal({ id: req.id }); setRejectReason(""); }}
                                                    disabled={actionId === req.id}
                                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-50 active:scale-95">
                                                    <XCircle className="h-4 w-4" />
                                                    דחה
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </AnimatePresence>
            )}

            {/* Reject modal */}
            <AnimatePresence>
                {rejectModal && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                        onClick={e => { if (e.target === e.currentTarget) setRejectModal(null); }}>
                        <motion.div
                            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
                            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-semibold text-zinc-800 mb-1">דחיית בקשה</h3>
                            <p className="text-sm text-zinc-500 mb-4">הלקוח יקבל הודעת וואטסאפ עם הסיבה.</p>
                            <textarea
                                value={rejectReason}
                                onChange={e => setRejectReason(e.target.value)}
                                placeholder="סיבה (אופציונלי)..."
                                rows={3}
                                className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-zinc-900 mb-4"
                            />
                            <div className="flex gap-2">
                                <button onClick={() => reject(rejectModal.id)}
                                    disabled={actionId === rejectModal.id}
                                    className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50">
                                    {actionId === rejectModal.id ? "שולח..." : "אשר דחייה"}
                                </button>
                                <button onClick={() => setRejectModal(null)}
                                    className="flex-1 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 text-sm font-medium hover:bg-zinc-50 transition-colors">
                                    ביטול
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
