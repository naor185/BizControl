"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/LanguageProvider";
import BottomSheet from "@/components/ui/bottom-sheet";

// A date / time box that looks the same on every phone, its value drawn here, in the middle.
// - time: the phone's own time box lies on top of it, invisible, only to open its wheel. An iPhone draws its own time
//   box at a width of its own, whatever width it's given — two side by side ran onto each other (the owner,
//   2026-10-11); overflow-hidden keeps the invisible box inside this one.
// - date: a month of our own opens, in the system's language and direction — the phone's own date picker spoke the
//   language the app is registered in with Apple (English), whatever the system was set to (the owner, 2026-10-12).
interface PickerBoxProps {
    type: "date" | "time";
    value: string;
    onChange: (value: string) => void;
    label: string;
    /** What the box shows — the value itself when not given */
    display?: React.ReactNode;
    /** The look of the visible box */
    className?: string;
}

export default function PickerBox({ type, value, onChange, label, display, className }: PickerBoxProps) {
    const [open, setOpen] = useState(false);
    const box = cn("w-full text-center tabular-nums", className);

    if (type === "date") {
        return (
            <>
                <button type="button" onClick={() => setOpen(true)} aria-label={label}
                    className={cn(box, "block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500")}>
                    {display ?? (value || "—")}
                </button>
                <MonthSheet open={open} value={value} label={label}
                    onPick={d => { onChange(d); setOpen(false); }} onClose={() => setOpen(false)} />
            </>
        );
    }
    return (
        <div className="relative overflow-hidden min-w-0">
            <input
                type="time"
                value={value}
                onChange={e => onChange(e.target.value)}
                onClick={e => { try { e.currentTarget.showPicker?.(); } catch { /* the tap opens it anyway */ } }}
                aria-label={label}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className={cn(box, "pointer-events-none peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-blue-500")}>
                {display ?? (value || "--:--")}
            </div>
        </div>
    );
}

const WORDS = {
    he: { today: "היום", prev: "החודש הקודם", next: "החודש הבא" },
    en: { today: "Today", prev: "Previous month", next: "Next month" },
    ar: { today: "اليوم", prev: "الشهر السابق", next: "الشهر التالي" },
} as const;

/** "2026-10-12" — the date's own day, never shifted by the time zone */
function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function MonthSheet({ open, value, label, onPick, onClose }: {
    open: boolean; value: string; label: string; onPick: (d: string) => void; onClose: () => void;
}) {
    const { locale, dir } = useLang();
    const words = WORDS[locale] ?? WORDS.he;
    const chosen = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
    const start = chosen ? new Date(`${chosen}T12:00:00`) : new Date();
    const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
    const [shownFor, setShownFor] = useState(chosen);
    if (open && shownFor !== chosen) {            // opened again on another date — start on its month
        setShownFor(chosen);
        setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    }

    const today = iso(new Date());
    const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month);
    const weekdays = Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2026, 9, 11 + i)));   // 11.10.2026 is a Sunday
    const cells: (Date | null)[] = [
        ...Array.from({ length: month.getDay() }, () => null),
        ...Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() },
            (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
    ];
    const step = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));
    // in a right-to-left language the next month is to the left
    const Back = dir === "rtl" ? ChevronRight : ChevronLeft;
    const Forward = dir === "rtl" ? ChevronLeft : ChevronRight;

    return (
        <BottomSheet open={open} onClose={onClose} title={label}>
            <div dir={dir} className="select-none">
                <div className="flex items-center justify-between mb-3">
                    <button type="button" onClick={() => step(-1)} aria-label={words.prev}
                        className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-600">
                        <Back className="w-5 h-5" aria-hidden />
                    </button>
                    <div className="font-bold text-slate-800">{title}</div>
                    <button type="button" onClick={() => step(1)} aria-label={words.next}
                        className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-600">
                        <Forward className="w-5 h-5" aria-hidden />
                    </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                    {weekdays.map((w, i) => <div key={i} className="text-xs font-semibold text-slate-400 py-1">{w}</div>)}
                    {cells.map((d, i) => {
                        if (!d) return <div key={`e${i}`} />;
                        const v = iso(d);
                        return (
                            <button key={v} type="button" onClick={() => onPick(v)}
                                aria-label={new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d)}
                                aria-pressed={v === chosen}
                                className={cn("h-11 rounded-full text-base font-semibold tabular-nums transition-colors",
                                    v === chosen ? "bg-sky-600 text-white"
                                        : v === today ? "text-sky-700 ring-1 ring-inset ring-sky-300 hover:bg-sky-50"
                                            : "text-slate-700 hover:bg-slate-100")}>
                                {d.getDate()}
                            </button>
                        );
                    })}
                </div>
                <button type="button" onClick={() => onPick(today)}
                    className="mt-4 w-full min-h-11 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
                    {words.today}
                </button>
            </div>
        </BottomSheet>
    );
}
