"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Artist = { id: string; display_name: string; calendar_color: string | null };
type StudioInfo = {
    studio_name: string;
    primary_color: string;
    logo_filename: string | null;
    start_hour: string;
    end_hour: string;
    slot_minutes: number;
    artists: Artist[];
    self_booking_enabled: boolean;
};

type Step = "landing" | "artist" | "date" | "time" | "details" | "success";

const HE_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function fmtDate(d: Date) {
    return `${d.getDate()} ${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtTime(t: string) {
    return t; // already HH:MM
}
function isoDate(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BookingPage() {
    const params = useParams();
    const slug = params.slug as string;

    const [info, setInfo] = useState<StudioInfo | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    const [step, setStep] = useState<Step>("landing");

    // Selections
    const [artist, setArtist] = useState<Artist | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [calMonth, setCalMonth] = useState(() => new Date());
    const [slots, setSlots] = useState<string[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [selectedTime, setSelectedTime] = useState<string | null>(null);
    const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
    const [booking, setBooking] = useState(false);
    const [bookErr, setBookErr] = useState<string | null>(null);
    const [confirmation, setConfirmation] = useState<{ starts_at: string; artist_name: string } | null>(null);

    // Load studio info
    useEffect(() => {
        fetch(`${API}/api/public/book/${slug}`)
            .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
            .then(setInfo)
            .catch(() => setLoadErr("הסטודיו לא נמצא או שהזמנה מקוונת אינה פעילה."));
    }, [slug]);

    const primary = info?.primary_color ?? "#000000";

    // Load slots when date + artist selected
    const loadSlots = useCallback(async (date: Date, artistId: string) => {
        setLoadingSlots(true);
        setSlots([]);
        try {
            const r = await fetch(`${API}/api/public/book/${slug}/slots?artist_id=${artistId}&date=${isoDate(date)}`);
            const data = await r.json();
            setSlots(Array.isArray(data) ? data : []);
        } catch {
            setSlots([]);
        } finally {
            setLoadingSlots(false);
        }
    }, [slug]);

    useEffect(() => {
        if (selectedDate && artist) loadSlots(selectedDate, artist.id);
    }, [selectedDate, artist, loadSlots]);

    // Auto-select single artist
    useEffect(() => {
        if (info?.artists.length === 1) setArtist(info.artists[0]);
    }, [info]);

    const goToDate = () => {
        setSelectedDate(null);
        setSelectedTime(null);
        setStep("date");
    };

    const selectDate = (d: Date) => {
        setSelectedDate(d);
        setSelectedTime(null);
        setStep("time");
    };

    const handleBook = async () => {
        if (!artist || !selectedDate || !selectedTime) return;
        setBooking(true);
        setBookErr(null);
        try {
            const r = await fetch(`${API}/api/public/book/${slug}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    artist_id: artist.id,
                    date: isoDate(selectedDate),
                    time: selectedTime,
                    name: form.name.trim(),
                    phone: form.phone.trim(),
                    email: form.email.trim() || null,
                    notes: form.notes.trim() || null,
                }),
            });
            if (!r.ok) {
                const err = await r.json();
                throw new Error(err.detail || "שגיאה בהזמנה");
            }
            const data = await r.json();
            setConfirmation({ starts_at: data.starts_at, artist_name: data.artist_name });
            setStep("success");
        } catch (e: any) {
            setBookErr(e.message || "שגיאה בהזמנה");
        } finally {
            setBooking(false);
        }
    };

    // Calendar helpers
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
    const firstDow = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1).getDay(); // 0=Sun

    // ── Render ────────────────────────────────────────────────────────────────

    if (loadErr) return (
        <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
            <div className="text-center">
                <div className="text-5xl mb-4">🚫</div>
                <p className="text-gray-600 text-sm">{loadErr}</p>
            </div>
        </div>
    );

    if (!info) return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="animate-spin w-8 h-8 border-4 border-gray-200 border-t-gray-800 rounded-full" />
        </div>
    );

    const logoUrl = info.logo_filename ? `${API}/uploads/${info.logo_filename}` : null;

    return (
        <div dir="rtl" className="min-h-screen bg-gray-50 flex flex-col items-center pb-16">

            {/* ── LANDING ── */}
            {step === "landing" && (
                <div className="w-full max-w-md flex flex-col items-center px-6 py-12 gap-8">
                    {logoUrl ? (
                        <img src={logoUrl} alt={info.studio_name} className="h-20 w-20 object-contain rounded-2xl shadow-md" />
                    ) : (
                        <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl font-bold shadow-md" style={{ background: primary }}>
                            {info.studio_name.charAt(0)}
                        </div>
                    )}
                    <div className="text-center">
                        <h1 className="text-2xl font-bold text-gray-900">{info.studio_name}</h1>
                        <p className="text-gray-500 text-sm mt-1">הזמנת תור מקוונת</p>
                    </div>

                    {!info.self_booking_enabled ? (
                        <div className="text-center bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4">
                            <p className="text-amber-700 text-sm">ההזמנה המקוונת אינה פעילה כרגע.</p>
                            <p className="text-amber-500 text-xs mt-1">אנא פנה לסטודיו ישירות.</p>
                        </div>
                    ) : (
                        <button
                            onClick={() => info.artists.length === 1 ? goToDate() : setStep("artist")}
                            className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-[0.98] transition-transform"
                            style={{ background: primary }}
                        >
                            קבע תור עכשיו
                        </button>
                    )}
                </div>
            )}

            {/* ── ARTIST SELECT ── */}
            {step === "artist" && (
                <div className="w-full max-w-md px-4 py-8 space-y-4">
                    <StepHeader title="בחר/י אמן/ית" onBack={() => setStep("landing")} color={primary} />
                    <div className="space-y-2">
                        {info.artists.map(a => (
                            <button
                                key={a.id}
                                onClick={() => { setArtist(a); goToDate(); }}
                                className="w-full flex items-center gap-4 bg-white rounded-2xl px-4 py-4 border border-gray-100 hover:border-gray-300 transition-all active:scale-[0.99] shadow-sm"
                            >
                                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                                    style={{ background: a.calendar_color || primary }}>
                                    {(a.display_name).charAt(0)}
                                </div>
                                <span className="font-semibold text-gray-900 text-base">{a.display_name}</span>
                                <span className="mr-auto text-gray-400">←</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── DATE SELECT ── */}
            {step === "date" && (
                <div className="w-full max-w-md px-4 py-8 space-y-4">
                    <StepHeader title="בחר/י תאריך" onBack={() => info!.artists.length > 1 ? setStep("artist") : setStep("landing")} color={primary} />

                    {/* Month nav */}
                    <div className="flex items-center justify-between px-2">
                        <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">‹</button>
                        <span className="font-semibold text-gray-900">{HE_MONTHS[calMonth.getMonth()]} {calMonth.getFullYear()}</span>
                        <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">›</button>
                    </div>

                    {/* Calendar grid */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                        <div className="grid grid-cols-7 mb-2">
                            {HE_DAYS.map(d => <div key={d} className="text-center text-xs text-gray-400 font-semibold py-1">{d}</div>)}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                            {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), i + 1);
                                const isPast = d < today;
                                const isSel = selectedDate && isoDate(d) === isoDate(selectedDate);
                                const isToday = isoDate(d) === isoDate(today);
                                return (
                                    <button
                                        key={i}
                                        disabled={isPast}
                                        onClick={() => selectDate(d)}
                                        className={[
                                            "aspect-square rounded-xl text-sm font-semibold flex items-center justify-center transition-all",
                                            isPast ? "text-gray-300 cursor-not-allowed" :
                                            isSel ? "text-white shadow-md" :
                                            isToday ? "border-2 text-gray-900 hover:text-white" :
                                            "text-gray-700 hover:text-white",
                                        ].join(" ")}
                                        style={isSel ? { background: primary } : isToday ? { borderColor: primary, color: primary } : {}}
                                        onMouseEnter={e => !isPast && !isSel && ((e.currentTarget as HTMLButtonElement).style.background = primary)}
                                        onMouseLeave={e => !isPast && !isSel && ((e.currentTarget as HTMLButtonElement).style.background = "")}
                                    >
                                        {i + 1}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ── TIME SELECT ── */}
            {step === "time" && selectedDate && (
                <div className="w-full max-w-md px-4 py-8 space-y-4">
                    <StepHeader title={`שעות פנויות — ${fmtDate(selectedDate)}`} onBack={() => setStep("date")} color={primary} />

                    {loadingSlots ? (
                        <div className="flex justify-center py-10">
                            <div className="animate-spin w-8 h-8 border-4 border-gray-200 border-t-gray-800 rounded-full" />
                        </div>
                    ) : slots.length === 0 ? (
                        <div className="text-center py-10 bg-white rounded-2xl border border-gray-100">
                            <div className="text-3xl mb-2">😕</div>
                            <p className="text-gray-500 text-sm">אין שעות פנויות בתאריך זה</p>
                            <button onClick={() => setStep("date")} className="mt-4 text-sm font-semibold underline" style={{ color: primary }}>בחר תאריך אחר</button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-2">
                            {slots.map(t => (
                                <button
                                    key={t}
                                    onClick={() => { setSelectedTime(t); setStep("details"); }}
                                    className={[
                                        "py-3 rounded-2xl text-sm font-bold border transition-all active:scale-95",
                                        selectedTime === t ? "text-white border-transparent shadow-md" : "bg-white border-gray-200 text-gray-800 hover:border-gray-400",
                                    ].join(" ")}
                                    style={selectedTime === t ? { background: primary } : {}}
                                >
                                    {fmtTime(t)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── DETAILS FORM ── */}
            {step === "details" && (
                <div className="w-full max-w-md px-4 py-8 space-y-4">
                    <StepHeader title="פרטי הזמנה" onBack={() => setStep("time")} color={primary} />

                    {/* Summary */}
                    <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-1 text-sm shadow-sm">
                        <div className="flex justify-between"><span className="text-gray-500">תאריך</span><span className="font-semibold">{selectedDate ? fmtDate(selectedDate) : ""}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">שעה</span><span className="font-semibold">{selectedTime}</span></div>
                        {artist && <div className="flex justify-between"><span className="text-gray-500">אמן/ית</span><span className="font-semibold">{artist.display_name}</span></div>}
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="text-xs text-gray-500 block mb-1">שם מלא *</label>
                            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="ישראל ישראלי"
                                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-black/10" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 block mb-1">טלפון *</label>
                            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                                placeholder="05X-XXXXXXX" dir="ltr" type="tel"
                                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 block mb-1">אימייל (לא חובה)</label>
                            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                placeholder="email@example.com" dir="ltr" type="email"
                                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 block mb-1">הערות (לא חובה)</label>
                            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                placeholder="מה תרצה לעשות? רעיון לקעקוע, גודל..."
                                rows={3}
                                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-right resize-none focus:outline-none focus:ring-2 focus:ring-black/10" />
                        </div>
                    </div>

                    {bookErr && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-xl">{bookErr}</div>}

                    <button
                        onClick={handleBook}
                        disabled={booking || !form.name.trim() || !form.phone.trim()}
                        className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-lg disabled:opacity-40 active:scale-[0.98] transition-all"
                        style={{ background: primary }}
                    >
                        {booking ? "שולח..." : "אישור הזמנה"}
                    </button>
                </div>
            )}

            {/* ── SUCCESS ── */}
            {step === "success" && confirmation && (
                <div className="w-full max-w-md px-6 py-12 flex flex-col items-center gap-6 text-center">
                    <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl shadow-lg" style={{ background: primary }}>
                        ✅
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">ההזמנה אושרה!</h2>
                        <p className="text-gray-500 text-sm mt-1">נתראה ב{info.studio_name}</p>
                    </div>
                    <div className="w-full bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-2 text-sm text-right">
                        <div className="flex justify-between">
                            <span className="text-gray-500">תאריך</span>
                            <span className="font-semibold">{selectedDate ? fmtDate(selectedDate) : ""}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">שעה</span>
                            <span className="font-semibold">{selectedTime}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">אמן/ית</span>
                            <span className="font-semibold">{confirmation.artist_name}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">שם</span>
                            <span className="font-semibold">{form.name}</span>
                        </div>
                    </div>
                    <p className="text-xs text-gray-400">אנא שמור/י את פרטי ההזמנה. נשלח תזכורת לפני.</p>
                </div>
            )}
        </div>
    );
}

// ── Shared components ─────────────────────────────────────────────────────────

function StepHeader({ title, onBack, color }: { title: string; onBack: () => void; color: string }) {
    return (
        <div className="flex items-center gap-3 mb-2">
            <button onClick={onBack} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-600 flex-shrink-0 hover:bg-gray-50">
                →
            </button>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        </div>
    );
}
