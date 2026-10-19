"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/LanguageProvider";
import BottomSheet from "@/components/ui/bottom-sheet";

// A date / time box that looks the same on every phone, its value drawn here.
// - time: the phone's own time box lies on top of it, invisible, only to open its wheel. An iPhone draws its own time
//   box at a width of its own, whatever width it's given — two side by side ran onto each other (the owner,
//   2026-10-11); overflow-hidden keeps the invisible box inside this one.
// - date: a month of our own opens, in the system's language and direction — the phone's own date picker spoke the
//   language the app is registered in with Apple (English), whatever the system was set to (the owner, 2026-10-12).
//   Every date box in the system is one of these.
interface PickerBoxProps {
    type: "date" | "time";
    value: string;
    onChange: (value: string) => void;
    label: string;
    /** What the box shows — the value itself (a date as "12.10.2026") when not given */
    display?: React.ReactNode;
    /** The look of the visible box */
    className?: string;
    style?: React.CSSProperties;
    /** date: the first / last day that can be picked ("2026-10-12") */
    min?: string;
    max?: string;
    disabled?: boolean;
    /** date: the month offers "ניקוי" to empty the box (default — the phone's own picker had "Reset" too) */
    clearable?: boolean;
}

const WORDS = {
    he: { today: "היום", clear: "ניקוי", choose: "בחירת תאריך", prev: "החודש הקודם", next: "החודש הבא", month: "חודש", year: "שנה" },
    en: { today: "Today", clear: "Clear", choose: "Choose a date", prev: "Previous month", next: "Next month", month: "Month", year: "Year" },
} as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-12" — the date's own day, never shifted by the time zone */
function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function day(v: string): Date {
    return new Date(`${v}T12:00:00`);
}

export default function PickerBox({ type, value, onChange, label, display, className, style, min, max, disabled, clearable = true }: PickerBoxProps) {
    const { locale } = useLang();
    const [open, setOpen] = useState(false);
    const box = cn("w-full text-center tabular-nums", className);

    if (type === "date") {
        const words = WORDS[locale] ?? WORDS.he;
        const shown = display ?? (ISO.test(value)
            ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(day(value))
            : <span className="opacity-50">{words.choose}</span>);
        return (
            <>
                <button type="button" onClick={() => setOpen(true)} aria-label={label} disabled={disabled} style={style}
                    className={cn(box, "block disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500")}>
                    {shown}
                </button>
                {open && (
                    <MonthSheet value={value} label={label} min={min} max={max} clearable={clearable}
                        onPick={d => { onChange(d); setOpen(false); }} onClose={() => setOpen(false)} />
                )}
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
                disabled={disabled}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className={cn(box, "pointer-events-none peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-blue-500")} style={style}>
                {display ?? (value || "--:--")}
            </div>
        </div>
    );
}

function MonthSheet({ value, label, min, max, clearable, onPick, onClose }: {
    value: string; label: string; min?: string; max?: string; clearable: boolean;
    onPick: (d: string) => void; onClose: () => void;
}) {
    const { locale, dir } = useLang();
    const words = WORDS[locale] ?? WORDS.he;
    const chosen = ISO.test(value) ? value : "";
    const lo = min && ISO.test(min) ? min : "";
    const hi = max && ISO.test(max) ? max : "";
    const today = iso(new Date());
    // opens on the chosen day's month — or today's, kept within min / max
    const [month, setMonth] = useState(() => {
        const d = day(chosen || (hi && today > hi ? hi : lo && today < lo ? lo : today));
        return new Date(d.getFullYear(), d.getMonth(), 1);
    });

    const thisYear = new Date().getFullYear();
    const firstYear = lo ? day(lo).getFullYear() : thisYear - 100;      // far enough back for a birthday
    const lastYear = hi ? day(hi).getFullYear() : thisYear + 10;
    const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i);
    const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2026, i, 1)));
    const weekdays = Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2026, 9, 11 + i)));   // 11.10.2026 is a Sunday
    const cells: (Date | null)[] = [
        ...Array.from({ length: month.getDay() }, () => null),
        ...Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() },
            (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
    ];
    const allowed = (v: string) => (!lo || v >= lo) && (!hi || v <= hi);
    const go = (y: number, m: number) => setMonth(new Date(y, m, 1));
    // in a right-to-left language the next month is to the left
    const Back = dir === "rtl" ? ChevronRight : ChevronLeft;
    const Forward = dir === "rtl" ? ChevronLeft : ChevronRight;
    const select = "min-h-11 rounded-xl border border-slate-200 bg-white px-2 text-base font-bold text-slate-800";

    return (
        <BottomSheet open onClose={onClose} title={label}>
            <div dir={dir} className="select-none">
                <div className="flex items-center justify-between gap-2 mb-3">
                    <button type="button" onClick={() => go(month.getFullYear(), month.getMonth() - 1)} aria-label={words.prev}
                        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-600">
                        <Back className="w-5 h-5" aria-hidden />
                    </button>
                    <div className="flex items-center gap-2 min-w-0">
                        <select value={month.getMonth()} onChange={e => go(month.getFullYear(), Number(e.target.value))} aria-label={words.month} className={select}>
                            {monthNames.map((n, i) => <option key={i} value={i}>{n}</option>)}
                        </select>
                        <select value={month.getFullYear()} onChange={e => go(Number(e.target.value), month.getMonth())} aria-label={words.year} className={cn(select, "tabular-nums")}>
                            {(years.includes(month.getFullYear()) ? years : [month.getFullYear(), ...years]).map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                    <button type="button" onClick={() => go(month.getFullYear(), month.getMonth() + 1)} aria-label={words.next}
                        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-600">
                        <Forward className="w-5 h-5" aria-hidden />
                    </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                    {weekdays.map((w, i) => <div key={i} className="text-xs font-semibold text-slate-400 py-1">{w}</div>)}
                    {cells.map((d, i) => {
                        if (!d) return <div key={`e${i}`} />;
                        const v = iso(d);
                        const ok = allowed(v);
                        return (
                            <button key={v} type="button" onClick={() => onPick(v)} disabled={!ok}
                                aria-label={new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d)}
                                aria-pressed={v === chosen}
                                className={cn("h-11 rounded-full text-base font-semibold tabular-nums transition-colors disabled:text-slate-300 disabled:hover:bg-transparent",
                                    v === chosen ? "bg-sky-600 text-white"
                                        : v === today ? "text-sky-700 ring-1 ring-inset ring-sky-300 hover:bg-sky-50"
                                            : "text-slate-700 hover:bg-slate-100")}>
                                {d.getDate()}
                            </button>
                        );
                    })}
                </div>
                <div className="mt-4 flex gap-2">
                    {allowed(today) && (
                        <button type="button" onClick={() => onPick(today)}
                            className="flex-1 min-h-11 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
                            {words.today}
                        </button>
                    )}
                    {clearable && chosen && (
                        <button type="button" onClick={() => onPick("")}
                            className="flex-1 min-h-11 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50">
                            {words.clear}
                        </button>
                    )}
                </div>
            </div>
        </BottomSheet>
    );
}
