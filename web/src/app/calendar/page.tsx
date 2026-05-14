"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import PaymentModal from "@/components/PaymentModal";

const IL_HOLIDAYS = [
    { date: "2025-09-22", name: "🍎 ראש השנה א׳",   info: 'ראש השנה תשפ"ו' },
    { date: "2025-09-23", name: "🍎 ראש השנה ב׳",   info: 'ראש השנה — יום שני' },
    { date: "2025-10-01", name: "🤍 יום כיפור",      info: 'יום הכיפורים תשפ"ו' },
    { date: "2025-10-06", name: "🌿 סוכות א׳",       info: 'חג הסוכות א׳' },
    { date: "2025-10-13", name: "🌿 הושענא רבה",     info: 'הושענא רבה' },
    { date: "2025-10-14", name: "🌿 שמחת תורה",      info: 'שמיני עצרת / שמחת תורה' },
    { date: "2025-12-14", name: "🕎 חנוכה א׳",       info: 'חנוכה — נר ראשון' },
    { date: "2025-12-15", name: "🕎 חנוכה ב׳",       info: 'חנוכה — נר שני' },
    { date: "2025-12-16", name: "🕎 חנוכה ג׳",       info: 'חנוכה — נר שלישי' },
    { date: "2025-12-17", name: "🕎 חנוכה ד׳",       info: 'חנוכה — נר רביעי' },
    { date: "2025-12-18", name: "🕎 חנוכה ה׳",       info: 'חנוכה — נר חמישי' },
    { date: "2025-12-19", name: "🕎 חנוכה ו׳",       info: 'חנוכה — נר שישי' },
    { date: "2025-12-20", name: "🕎 חנוכה ז׳",       info: 'חנוכה — נר שביעי' },
    { date: "2025-12-21", name: "🕎 חנוכה ח׳",       info: 'זאת חנוכה — נר שמיני' },
    { date: "2026-02-13", name: '🌳 ט"ו בשבט',       info: 'ט"ו בשבט תשפ"ו — חג האילנות' },
    { date: "2026-03-04", name: "🎭 פורים",           info: 'פורים תשפ"ו' },
    { date: "2026-03-05", name: "🎭 שושן פורים",      info: 'שושן פורים תשפ"ו' },
    { date: "2026-04-01", name: "🫓 ערב פסח",         info: 'ערב פסח תשפ"ו' },
    { date: "2026-04-02", name: "🫓 פסח א׳",          info: 'פסח — יום ראשון' },
    { date: "2026-04-08", name: "🫓 פסח ז׳",          info: 'פסח — יום שביעי' },
    { date: "2026-04-09", name: "🫓 אסרו חג",         info: 'אסרו חג פסח' },
    { date: "2026-04-16", name: "🕯️ יום השואה",      info: 'יום הזיכרון לשואה ולגבורה' },
    { date: "2026-05-05", name: "🪖 יום הזיכרון",    info: 'יום הזיכרון לחללי מערכות ישראל' },
    { date: "2026-05-06", name: "🇮🇱 יום העצמאות",   info: 'יום העצמאות ה-78 למדינת ישראל' },
    { date: "2026-05-14", name: '🔥 ל"ג בעומר',       info: 'ל"ג בעומר תשפ"ו' },
    { date: "2026-05-22", name: "📜 שבועות א׳",       info: 'שבועות תשפ"ו — יום ראשון' },
    { date: "2026-05-23", name: "📜 שבועות ב׳",       info: 'שבועות — יום שני' },
    { date: "2026-08-01", name: "😢 תשעה באב",        info: 'תשעה באב תשפ"ו' },
    { date: "2026-09-11", name: "🍎 ראש השנה א׳",   info: 'ראש השנה תשפ"ז' },
    { date: "2026-09-12", name: "🍎 ראש השנה ב׳",   info: 'ראש השנה תשפ"ז — יום שני' },
];

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import heLocale from '@fullcalendar/core/locales/he';

type Client = { id: string; full_name: string; phone?: string | null; is_walk_in?: boolean; cancellation_count?: number; no_show_count?: number; };
type Artist = { id: string; email: string; display_name?: string | null };
type Appointment = {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    status: string;
    client_id?: string | null;
    client_name?: string | null;
    artist_name?: string | null;
    artist_color?: string | null;
    notes?: string | null;
    google_event_id?: string | null;
    paid_cents?: number;
    remaining_cents?: number;
    client_loyalty_points?: number;
};

// Colors based on Status
const STATUS_COLORS: Record<string, string> = {
    "scheduled": "#3b82f6", // Blue
    "completed": "#10b981", // Green
    "cancelled": "#ef4444", // Red
};

export default function CalendarPage() {
    const router = useRouter();
    const calendarRef = useRef<FullCalendar>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [artists, setArtists] = useState<Artist[]>([]);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [calendarStartHour, setCalendarStartHour] = useState("08:00:00");
    const [calendarEndHour, setCalendarEndHour] = useState("23:00:00");
    const [toast, setToast] = useState<{message: string; type: "success"|"error"} | null>(null);
    const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : false);
    const [showHolidays, setShowHolidays] = useState(() => {
        if (typeof window === "undefined") return true;
        const saved = localStorage.getItem("biz_show_holidays");
        return saved === null ? true : saved === "true";
    });
    const [currentDateRange, setCurrentDateRange] = useState("");
    const [holidayPopup, setHolidayPopup] = useState<{ name: string; info: string } | null>(null);

    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const toggleHolidays = useCallback(() => {
        setShowHolidays(prev => {
            const next = !prev;
            localStorage.setItem("biz_show_holidays", String(next));
            return next;
        });
    }, []);

    const handleDatesSet = useCallback((info: any) => {
        const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
        const start = new Date(info.start);
        const end   = new Date(info.end);
        end.setDate(end.getDate() - 1);
        if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
            setCurrentDateRange(`${start.getDate()}–${end.getDate()} ב${HE_MONTHS[start.getMonth()]} ${start.getFullYear()}`);
        } else {
            setCurrentDateRange(`${start.getDate()}/${start.getMonth()+1} – ${end.getDate()}/${end.getMonth()+1} ${start.getFullYear()}`);
        }
    }, []);

    const showToast = (message: string, type: "success"|"error" = "success") => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500);
    };

    // Filter range: load a wide range by default to populate the calendar
    const [from, setFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30); // 1 month ago
        return d.toISOString();
    });
    const [to, setTo] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 90); // 3 months ahead
        return d.toISOString();
    });

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null); // null = Creating new

    // Delete Modal State
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteReason, setDeleteReason] = useState("");

    // Payment Modal State
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [paymentAppt, setPaymentAppt] = useState<any>(null);

    // Modal Form State
    const [title, setTitle] = useState("");
    const [startAt, setStartAt] = useState("");
    const [endAt, setEndAt] = useState("");
    const [clientId, setClientId] = useState("");
    const [clientSearch, setClientSearch] = useState("");
    const [isWalkIn, setIsWalkIn] = useState(false);
    const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
    const [artistId, setArtistId] = useState("");
    const [status, setStatus] = useState("scheduled");
    const [notes, setNotes] = useState("");
    const [depositAmount, setDepositAmount] = useState<number | "">("");
    const [defaultDepositAmount, setDefaultDepositAmount] = useState(0);
    const [depositMinDuration, setDepositMinDuration] = useState<number | null>(null);

    // New client mini-form state
    const [showNewClientForm, setShowNewClientForm] = useState(false);
    const [newClientName, setNewClientName] = useState("");
    const [newClientPhone, setNewClientPhone] = useState("");
    const [newClientClub, setNewClientClub] = useState(false);
    const [newClientLoading, setNewClientLoading] = useState(false);
    const [newClientErr, setNewClientErr] = useState<string | null>(null);

    const loadData = async () => {
        setLoading(true);
        setErr(null);
        try {
            const [c, a, arts, settings] = await Promise.all([
                apiFetch<Client[]>("/api/clients?limit=500"),
                apiFetch<Appointment[]>(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
                apiFetch<Artist[]>("/api/users/artists"),
                apiFetch<any>("/api/studio/automation")
            ]);
            setClients(c);
            setAppointments(a);
            setArtists(arts);
            if (settings) {
                if (settings.calendar_start_hour) setCalendarStartHour(`${settings.calendar_start_hour}:00`);
                if (settings.calendar_end_hour) setCalendarEndHour(`${settings.calendar_end_hour}:00`);
                if (settings.deposit_fixed_amount_ils) setDefaultDepositAmount(settings.deposit_fixed_amount_ils);
                if (settings.deposit_min_duration_minutes) setDepositMinDuration(settings.deposit_min_duration_minutes);
            }
        } catch (e: any) {
            setErr(e?.message || "שגיאה בטעינת נתוני היומן");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to]);

    const holidayEvents = useMemo(() => {
        if (!showHolidays) return [];
        return IL_HOLIDAYS.map(h => ({
            id: `holiday-${h.date}`,
            title: h.name,
            start: h.date,
            allDay: true,
            display: "block" as const,
            backgroundColor: "#fef9c3",
            borderColor: "#fde047",
            textColor: "#713f12",
            classNames: ["holiday-event"],
            extendedProps: { isHoliday: true, holidayInfo: h.info, holidayName: h.name },
        }));
    }, [showHolidays]);

    // Format appointments for FullCalendar
    const events = useMemo(() => {
        return appointments
            .filter(app => app.status !== "canceled" && app.status !== "no_show")
            .map(app => {
                const isExternalGoogle = app.id === "00000000-0000-0000-0000-000000000000";
                const clientObj = clients.find(c => c.id === app.client_id);
                const walkInBadge = clientObj?.is_walk_in ? "🚶 " : "";
                
                // Payment status indicator
                const paidCents = app.paid_cents || 0;
                const remainingCents = app.remaining_cents ?? null;
                const isFullyPaid = paidCents > 0 && (remainingCents !== null && remainingCents <= 0);
                const isPartiallyPaid = paidCents > 0 && (remainingCents === null || remainingCents > 0);
                const paymentBadge = isFullyPaid ? "✅ " : isPartiallyPaid ? "💰 " : "";

                return {
                    id: app.id,
                    title: isExternalGoogle ? `📅 ${app.title}` : `${paymentBadge}${walkInBadge}${app.title} - ${app.client_name || 'ללא לקוח'}`,
                    start: app.starts_at,
                    end: app.ends_at,
                    backgroundColor: app.artist_color || STATUS_COLORS[app.status] || STATUS_COLORS["scheduled"],
                    borderColor: app.artist_color || STATUS_COLORS[app.status] || STATUS_COLORS["scheduled"],
                    editable: !isExternalGoogle,
                    extendedProps: {
                        ...app,
                        isExternalGoogle
                    }
                };
            });
    }, [appointments, clients]);

    function autoDeposit(startIso: string, endIso: string): number | "" {
        if (!defaultDepositAmount) return "";
        if (depositMinDuration) {
            const diffMin = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
            if (diffMin < depositMinDuration) return "";
        }
        return defaultDepositAmount;
    }

    async function handleCreateNewClient() {
        if (!newClientName.trim()) { setNewClientErr("שם חובה"); return; }
        setNewClientErr(null);
        setNewClientLoading(true);
        try {
            const created = await apiFetch<Client>("/api/clients", {
                method: "POST",
                body: JSON.stringify({
                    full_name: newClientName.trim(),
                    phone: newClientPhone.trim() || null,
                    is_club_member: newClientClub,
                }),
            });
            setClients(prev => [created, ...prev]);
            setClientId(created.id);
            setClientSearch(created.full_name);
            setIsWalkIn(false);
            setShowNewClientForm(false);
            setNewClientName(""); setNewClientPhone(""); setNewClientClub(false);
        } catch (e: any) {
            const msg = String(e?.message || "");
            setNewClientErr(msg.includes("כבר קיים") || msg.includes("already") || msg.includes("duplicate")
                ? "לקוח עם מספר טלפון זה כבר קיים במערכת"
                : msg || "שגיאה ביצירת לקוח");
        } finally {
            setNewClientLoading(false);
        }
    }

    // Handle Calendar Actions
    const handleDateSelect = (selectInfo: any) => {
        // Unselect the area on UI
        let calendarApi = selectInfo.view.calendar;
        calendarApi.unselect();

        // Open Modal for New Event
        setSelectedEventId(null);
        setTitle("");

        const localStart = new Date(selectInfo.startStr);
        const localEnd = new Date(selectInfo.endStr);
        const pad = (n: number) => String(n).padStart(2, "0");
        const formatForInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

        const startStr = formatForInput(localStart);
        const endStr   = formatForInput(localEnd);
        setStartAt(startStr);
        setEndAt(endStr);
        setDepositAmount(autoDeposit(localStart.toISOString(), localEnd.toISOString()));

        setClientId("");
        setClientSearch("");
        setIsWalkIn(false);
        setArtistId("");
        setStatus("scheduled");
        setNotes("");
        setShowNewClientForm(false);
        setIsModalOpen(true);
    };

    const handleEventClick = (clickInfo: any) => {
        const app = clickInfo.event.extendedProps;
        if (app.isHoliday) {
            setHolidayPopup({ name: app.holidayName, info: app.holidayInfo });
            return;
        }
        if (app.isExternalGoogle) {
            showToast("זהו אירוע מיומן גוגל — לא ניתן לערוך אותו מכאן.", "error");
            return;
        }

        setSelectedEventId(app.id);
        setTitle(app.title);

        const pad = (n: number) => String(n).padStart(2, "0");
        const formatForInput = (dStr: string) => {
            const d = new Date(dStr);
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };

        setStartAt(formatForInput(app.starts_at));
        setEndAt(formatForInput(app.ends_at));
        setClientId(app.client_id || "");
        setClientSearch(app.client_name || "");
        setIsWalkIn(!!(clients.find(c => c.id === app.client_id)?.is_walk_in));

        // Find matching artist ID if possible. Currently artist_name is returned. We might need a heuristic or the API to return artist_id.
        // Assuming the app has artist_name, let's try to match it, otherwise leave blank to force selection.
        const foundArtist = artists.find(a => a.display_name === app.artist_name || a.email === app.artist_name);
        setArtistId(foundArtist?.id || "");

        setStatus(app.status);
        setNotes(app.notes || "");
        setDepositAmount(app.deposit_amount_cents ? Math.round(app.deposit_amount_cents / 100) : "");
        setIsModalOpen(true);
    };

    const handleEventDrop = async (dropInfo: any) => {
        const app = dropInfo.event.extendedProps;
        if (app.isExternalGoogle) {
            alert("לא ניתן להזיז אירועים מגוגל קלנדר חיצוני.");
            dropInfo.revert();
            return;
        }

        // Update appointment time on drag & drop
        const eventId = dropInfo.event.id;
        try {
            await apiFetch(`/api/appointments/${eventId}`, {
                method: "PATCH",
                body: JSON.stringify({
                    starts_at: dropInfo.event.startStr,
                    ends_at: dropInfo.event.endStr,
                })
            });
            // Update local state smoothly
            setAppointments(prev => prev.map(a => a.id === eventId ? { ...a, starts_at: dropInfo.event.startStr, ends_at: dropInfo.event.endStr } : a));
        } catch (e: any) {
            alert("שגיאה בהזזת התור: " + (e?.message || ""));
            dropInfo.revert(); // revert visual change on failure
        }
    };

    const handleSaveAppointment = async () => {
        if (!title || !startAt || !endAt || !artistId || !clientId) {
            alert("יש למלא את כל שדות החובה: כותרת, זמנים, מקעקע ולקוח.");
            return;
        }

        try {
            const body = {
                title,
                client_id: clientId,
                artist_id: artistId,
                starts_at: new Date(startAt).toISOString(),
                ends_at: new Date(endAt).toISOString(),
                status,
                notes: notes || null,
                deposit_amount_cents: depositAmount !== "" ? Math.round(Number(depositAmount) * 100) : 0,
            };

            if (selectedEventId) {
                // UPDATE
                await apiFetch(`/api/appointments/${selectedEventId}`, { method: "PATCH", body: JSON.stringify(body) });
            } else {
                // CREATE
                await apiFetch("/api/appointments", { method: "POST", body: JSON.stringify(body) });
            }

            setIsModalOpen(false);
            loadData(); // reload
        } catch (e: any) {
            alert(e?.message || "שגיאה בשמירת התור");
        }
    };

    const handlePaymentClick = () => {
        if (!selectedEventId) return;
        const appt = appointments.find(a => a.id === selectedEventId);
        if (!appt) return;

        setPaymentAppt({
            appointment_id: appt.id,
            client_id: appt.client_id,
            client_name: appt.client_name,
            client_loyalty_points: appt.client_loyalty_points || 0,
            remaining_cents: appt.remaining_cents || 0
        });
        setIsPaymentModalOpen(true);
    };

    const handlePaymentSuccess = () => {
        setIsPaymentModalOpen(false);
        setIsModalOpen(false);
        loadData();
        showToast("✅ התשלום אושר בהצלחה!");
    };

    const handleDeleteClick = () => {
        setDeleteReason("");
        setIsDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!selectedEventId) return;
        try {
            const url = deleteReason ? `/api/appointments/${selectedEventId}?reason=${deleteReason}` : `/api/appointments/${selectedEventId}`;
            await apiFetch(url, { method: "DELETE" });
            setIsDeleteModalOpen(false);
            setIsModalOpen(false);
            loadData();
        } catch (e: any) {
            alert(e?.message || "שגיאה במחיקת התור");
        }
    };

    const filteredClients = useMemo(() => {
        return clients.filter(c =>
            (c.full_name || "").toLowerCase().includes(clientSearch.toLowerCase()) ||
            (c.phone || "").includes(clientSearch)
        );
    }, [clients, clientSearch]);

    return (
        <RequireAuth>
            <AppShell
                title="יומן תורים"
                titleAction={
                    <button
                        onClick={() => router.push("/clients?create=1")}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors shadow-sm"
                    >
                        <span className="text-sm leading-none">+</span>
                        לקוח חדש
                    </button>
                }
            >
                {/* Toast Notification */}
                {toast && (
                    <div
                        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl text-white text-sm font-bold transition-all animate-in fade-in slide-in-from-bottom-4 duration-300 ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"}`}
                    >
                        {toast.message}
                    </div>
                )}
                <style dangerouslySetInnerHTML={{
                    __html: `
                    .fc .fc-toolbar.fc-header-toolbar { margin-bottom: 0.5rem !important; }
                    .fc .fc-button { padding: 0.3rem 0.7rem !important; font-size: 0.85rem !important; border-radius: 8px !important; }
                    .fc .fc-button:active { transform: scale(0.95) !important; }
                    .fc .fc-today-button { min-width: 3.5rem !important; }
                    .fc .fc-toolbar-title { font-size: 1.1rem !important; font-weight: bold !important; }
                    .fc-timegrid-slot { height: 1.5em !important; }
                    .fc .fc-toolbar.fc-footer-toolbar { margin-top: 0.4rem !important; justify-content: center !important; }
                    .fc .fc-toolbar.fc-footer-toolbar .fc-button { min-width: 3.5rem !important; }
                    .holiday-event { font-size: 0.7rem !important; opacity: 0.9; }
                    @media (max-width: 640px) {
                        .fc .fc-toolbar-title { font-size: 0.8rem !important; }
                        .fc .fc-button { padding: 0.2rem 0.45rem !important; font-size: 0.72rem !important; min-width: 1.8rem !important; }
                        .fc .fc-today-button { min-width: 2.8rem !important; }
                        .fc-timegrid-slot-label { font-size: 0.6rem !important; }
                        .fc-timegrid-axis { width: 2.2rem !important; }
                        .fc-event { font-size: 0.68rem !important; border-radius: 4px !important; }
                        .fc-event-title { font-size: 0.68rem !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }
                        .fc-timegrid-event .fc-event-main { padding: 1px 3px !important; }
                        .fc-col-header-cell { font-size: 0.68rem !important; }
                        .fc-col-header-cell-cushion { padding: 2px 1px !important; }
                        .fc .fc-toolbar.fc-footer-toolbar .fc-button { padding: 0.3rem 0.8rem !important; font-size: 0.78rem !important; min-width: 3rem !important; }
                    }
                `}} />
                <div className="p-2 md:p-4 max-w-[1600px] w-full mx-auto flex flex-col h-[calc(100vh-5rem-4rem)] md:h-[calc(100vh-5rem)]">

                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                            {currentDateRange && (
                                <span className="text-sm font-semibold text-slate-700">{currentDateRange}</span>
                            )}
                            {loading && <div className="animate-spin h-4 w-4 border-2 border-slate-800 border-t-transparent rounded-full flex-shrink-0"></div>}
                            {err && <div className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded">{err}</div>}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={toggleHolidays}
                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                    showHolidays
                                        ? "bg-yellow-50 border-yellow-300 text-yellow-800"
                                        : "bg-slate-50 border-slate-200 text-slate-400"
                                }`}
                            >
                                🗓️ {showHolidays ? "חגים" : "חגים"}
                                <span className={`w-6 h-3.5 rounded-full transition-colors flex-shrink-0 relative ${showHolidays ? "bg-yellow-400" : "bg-slate-300"}`}>
                                    <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all ${showHolidays ? "left-3" : "left-0.5"}`} />
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Calendar Container */}
                    <div className="flex-1 bg-white rounded-xl shadow-lg p-2 sm:p-3 border border-slate-100 overflow-hidden relative">
                        <FullCalendar
                            ref={calendarRef}
                            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                            initialView="timeGridWeek"
                            headerToolbar={isMobile ? {
                                left: "prev,next",
                                center: "title",
                                right: "today"
                            } : {
                                left: "prev,next today",
                                center: "title",
                                right: "timeGridDay,timeGridWeek,dayGridMonth"
                            }}
                            footerToolbar={isMobile ? {
                                center: "timeGridDay,timeGridWeek,dayGridMonth"
                            } : false}
                            locales={[heLocale]}
                            locale="he"
                            direction="rtl"
                            selectable={true}
                            editable={true}
                            selectMirror={true}
                            longPressDelay={300}
                            eventLongPressDelay={300}
                            selectLongPressDelay={300}
                            dayMaxEvents={true}
                            nowIndicator={true}
                            allDaySlot={showHolidays}
                            slotMinTime={calendarStartHour}
                            slotMaxTime={calendarEndHour}
                            expandRows={true}
                            stickyHeaderDates={true}
                            slotDuration="00:30:00"
                            slotLabelInterval="01:00"
                            slotEventOverlap={false}
                            events={[...events, ...holidayEvents]}
                            select={handleDateSelect}
                            eventClick={handleEventClick}
                            eventDrop={handleEventDrop}
                            eventResize={handleEventDrop}
                            datesSet={handleDatesSet}
                            height="100%"
                        />
                    </div>
                </div>

                {/* Appointment Modal */}
                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg shadow-2xl overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col animate-in slide-in-from-bottom sm:zoom-in-95 duration-300">
                            <div className="bg-slate-50 border-b border-slate-100 p-5 flex items-center justify-between flex-shrink-0">
                                <h3 className="text-xl font-bold text-slate-800">{selectedEventId ? "עריכת תור" : "קביעת תור חדש"}</h3>
                                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 bg-white rounded-full shadow-sm hover:shadow transition-all">✕</button>
                            </div>

                            <div className="p-5 space-y-3 overflow-y-auto flex-1">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">כותרת הטיפול</label>
                                    <input value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
                                </div>

                                {/* Date & Time */}
                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className="block text-sm font-semibold text-slate-700 mb-1">התחלה</label>
                                        <input
                                            type="datetime-local"
                                            value={startAt}
                                            onChange={e => {
                                                const newVal = e.target.value;
                                                setStartAt(newVal);
                                                if (newVal && endAt) {
                                                    const [d] = newVal.split("T");
                                                    const [, t] = endAt.split("T");
                                                    setEndAt(`${d}T${t}`);
                                                }
                                            }}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                            dir="ltr"
                                        />
                                    </div>
                                    <div className="w-28">
                                        <label className="block text-sm font-semibold text-slate-700 mb-1">סיום</label>
                                        <input
                                            type="time"
                                            value={endAt.split("T")[1] || ""}
                                            onChange={e => {
                                                const [d] = startAt.split("T");
                                                setEndAt(`${d}T${e.target.value}`);
                                            }}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                            dir="ltr"
                                        />
                                    </div>
                                </div>

                                {/* Client section */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">לקוח</label>
                                    {/* Row 1: action buttons */}
                                    <div className="flex gap-2 mb-2">
                                        <button
                                            type="button"
                                            onClick={() => { setShowNewClientForm(v => !v); setNewClientErr(null); }}
                                            className={`flex-1 py-2 px-3 rounded-xl text-sm font-bold border-2 transition-all ${showNewClientForm ? "bg-blue-600 border-blue-600 text-white" : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"}`}
                                        >
                                            + צור לקוח חדש
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    const wi = await apiFetch<Client>("/api/clients/walk-in");
                                                    setClientId(wi.id);
                                                    setClientSearch("לקוח מזדמן 🚶");
                                                    setIsWalkIn(true);
                                                    setIsClientDropdownOpen(false);
                                                    setShowNewClientForm(false);
                                                } catch (e: any) { showToast("שגיאה בלקוח מזדמן", "error"); }
                                            }}
                                            className={`flex-1 py-2 px-3 rounded-xl text-sm font-bold border-2 transition-all ${isWalkIn ? "bg-orange-500 border-orange-500 text-white" : "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"}`}
                                        >
                                            🚶 {isWalkIn ? "מזדמן ✓" : "לקוח מזדמן"}
                                        </button>
                                    </div>

                                    {/* New client mini-form */}
                                    {showNewClientForm && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-2 space-y-2">
                                            <input
                                                type="text"
                                                placeholder="שם מלא *"
                                                value={newClientName}
                                                onChange={e => setNewClientName(e.target.value)}
                                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                                            />
                                            <input
                                                type="tel"
                                                placeholder="מספר טלפון"
                                                value={newClientPhone}
                                                onChange={e => setNewClientPhone(e.target.value)}
                                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                                                dir="ltr"
                                            />
                                            <label className="flex items-center gap-2 text-sm text-blue-800 cursor-pointer">
                                                <input type="checkbox" checked={newClientClub} onChange={e => setNewClientClub(e.target.checked)} className="accent-blue-600" />
                                                הוסף למועדון לקוחות
                                            </label>
                                            {newClientErr && <p className="text-xs text-red-600">{newClientErr}</p>}
                                            <button
                                                type="button"
                                                onClick={handleCreateNewClient}
                                                disabled={newClientLoading}
                                                className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                            >
                                                {newClientLoading ? "יוצר..." : "צור לקוח"}
                                            </button>
                                        </div>
                                    )}

                                    {/* Row 2: search */}
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="חפש לפי שם או טלפון..."
                                            value={clientSearch}
                                            onChange={e => { setClientSearch(e.target.value); setClientId(""); setIsWalkIn(false); setIsClientDropdownOpen(true); }}
                                            onFocus={() => setIsClientDropdownOpen(true)}
                                            onBlur={() => setTimeout(() => setIsClientDropdownOpen(false), 200)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        {clientSearch && clientId && (
                                            <button type="button" onClick={() => { setClientSearch(""); setClientId(""); setIsWalkIn(false); }}
                                                className="absolute left-3 top-1.5 text-slate-400 hover:text-red-500 font-bold text-2xl leading-none">&times;</button>
                                        )}
                                    </div>
                                    {isClientDropdownOpen && (
                                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                                            {filteredClients.filter(c => !c.is_walk_in).length > 0 ? (
                                                filteredClients.filter(c => !c.is_walk_in).map(c => (
                                                    <div key={c.id} className="px-4 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 text-right"
                                                        onMouseDown={() => { setClientId(c.id); setClientSearch(c.full_name || c.phone || ""); setIsWalkIn(false); setIsClientDropdownOpen(false); }}>
                                                        <div className="font-semibold text-slate-800 text-sm">{c.full_name}</div>
                                                        {c.phone && <div className="text-xs text-slate-500" dir="ltr">{c.phone}</div>}
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="px-4 py-3 text-sm text-slate-500 text-center">לא נמצאו לקוחות</div>
                                            )}
                                        </div>
                                    )}
                                    {clientId && !isWalkIn && (() => {
                                        const sc = clients.find(c => c.id === clientId);
                                        if (sc && ((sc.cancellation_count || 0) > 0 || (sc.no_show_count || 0) > 0)) {
                                            return (
                                                <div className="mt-2 text-sm font-medium text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 flex items-start gap-2">
                                                    <span>⚠️</span>
                                                    <span>
                                                        לקוח מועד לפורענות:
                                                        {(sc.cancellation_count || 0) > 0 && ` ביטל ${sc.cancellation_count} תורים`}
                                                        {(sc.cancellation_count || 0) > 0 && (sc.no_show_count || 0) > 0 && " ו-"}
                                                        {(sc.no_show_count || 0) > 0 && `לא הגיע ל-${sc.no_show_count} תורים`}.
                                                    </span>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>

                                {/* Artist */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">מקעקע/ת</label>
                                    <select value={artistId} onChange={e => setArtistId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500">
                                        <option value="">בחירה...</option>
                                        {artists.map(a => <option key={a.id} value={a.id}>{a.display_name || a.email}</option>)}
                                    </select>
                                </div>

                                {/* Deposit */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">מקדמה (₪) 💳</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={depositAmount}
                                        onChange={e => setDepositAmount(e.target.value === "" ? "" : Number(e.target.value))}
                                        className="w-full bg-slate-50 border border-emerald-300 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">הערות פנימיות</label>
                                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
                                </div>
                            </div>

                            <div className="bg-slate-50 p-5 flex justify-between items-center rounded-b-3xl border-t border-slate-100 flex-shrink-0">
                                <div>
                                    {selectedEventId && (
                                        <button onClick={handleDeleteClick} className="px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors flex items-center gap-1">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            מחק תור
                                        </button>
                                    )}
                                    {selectedEventId && new Date(startAt) < new Date() && status !== "cancelled" && (
                                        <button
                                            onClick={handlePaymentClick}
                                            className="px-4 py-2 text-sm font-bold text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors flex items-center gap-1"
                                        >
                                            <span className="text-lg">💳</span>
                                            לחייב לתשלום
                                        </button>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={() => setIsModalOpen(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">סגור</button>
                                    <button onClick={handleSaveAppointment} className="px-6 py-2 text-sm font-bold text-white bg-slate-900 shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 rounded-xl transition-all">
                                        {selectedEventId ? "שמור שינויים" : "קבע תור חדש"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Delete Confirmation Modal */}
                {isDeleteModalOpen && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200" dir="rtl">
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-800 mb-2">מחיקת תור</h3>
                                <p className="text-sm text-slate-500 mb-5">מדוע התור נמחק מיומן המערכת?</p>

                                <div className="space-y-3">
                                    <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${deleteReason === "" ? "border-slate-800 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}>
                                        <input type="radio" name="deleteReason" checked={deleteReason === ""} onChange={() => setDeleteReason("")} className="mt-1" />
                                        <div>
                                            <div className="font-semibold text-slate-800 text-sm">ביטול רגיל / טעות ברישום</div>
                                            <div className="text-xs text-slate-500">התור פשוט יימחק מבלי להשפיע על הלקוח.</div>
                                        </div>
                                    </label>

                                    <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${deleteReason === "client_cancelled" ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:bg-slate-50"}`}>
                                        <input type="radio" name="deleteReason" checked={deleteReason === "client_cancelled"} onChange={() => setDeleteReason("client_cancelled")} className="mt-1" />
                                        <div>
                                            <div className="font-semibold text-orange-800 text-sm">הלקוח הודיע על ביטול</div>
                                            <div className="text-xs text-orange-600/80">ייספר ללקוח כביטול תור.</div>
                                        </div>
                                    </label>

                                    <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${deleteReason === "no_show" ? "border-red-500 bg-red-50" : "border-slate-200 hover:bg-slate-50"}`}>
                                        <input type="radio" name="deleteReason" checked={deleteReason === "no_show"} onChange={() => setDeleteReason("no_show")} className="mt-1" />
                                        <div>
                                            <div className="font-semibold text-red-800 text-sm">הלקוח לא הגיע (No-Show)</div>
                                            <div className="text-xs text-red-600/80">ייספר ללקוח כהברזה.</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div className="bg-slate-50 p-4 flex justify-end gap-3 rounded-b-3xl border-t border-slate-100">
                                <button onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">בטל החלטה</button>
                                <button onClick={confirmDelete} className="px-5 py-2 text-sm font-bold text-white bg-red-600 shadow-lg shadow-red-600/20 hover:bg-red-700 hover:-translate-y-0.5 rounded-xl transition-all">
                                    אישור מחיקה
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Holiday popup */}
                {holidayPopup && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setHolidayPopup(null)}>
                        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-xs w-full text-center animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                            <div className="text-4xl mb-2">{holidayPopup.name.split(" ")[0]}</div>
                            <h3 className="text-lg font-bold text-slate-900 mb-1">{holidayPopup.name.slice(2)}</h3>
                            <p className="text-sm text-slate-500 mb-4">{holidayPopup.info}</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { toggleHolidays(); setHolidayPopup(null); }}
                                    className="flex-1 py-2 rounded-xl text-sm border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
                                >
                                    הסתר חגים
                                </button>
                                <button
                                    onClick={() => setHolidayPopup(null)}
                                    className="flex-1 py-2 rounded-xl text-sm bg-slate-900 text-white font-semibold hover:bg-slate-700 transition-colors"
                                >
                                    סגור
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Mobile FAB */}
                <button
                    className="fixed bottom-24 left-4 z-40 sm:hidden w-14 h-14 bg-slate-900 text-white rounded-full shadow-2xl shadow-slate-900/40 flex items-center justify-center text-3xl font-light active:scale-95 transition-transform"
                    onClick={() => {
                        const now = new Date();
                        const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);
                        const pad = (n: number) => String(n).padStart(2, "0");
                        const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                        setSelectedEventId(null);
                        setTitle("");
                        setStartAt(fmt(now));
                        setEndAt(fmt(later));
                        setDepositAmount(autoDeposit(now.toISOString(), later.toISOString()));
                        setClientId(""); setClientSearch(""); setIsWalkIn(false);
                        setArtistId(""); setStatus("scheduled"); setNotes("");
                        setShowNewClientForm(false);
                        setIsModalOpen(true);
                    }}
                >
                    +
                </button>

                <PaymentModal
                    isOpen={isPaymentModalOpen}
                    onClose={() => setIsPaymentModalOpen(false)}
                    onSuccess={handlePaymentSuccess}
                    appointment={paymentAppt}
                />

            </AppShell>
        </RequireAuth>
    );
}
