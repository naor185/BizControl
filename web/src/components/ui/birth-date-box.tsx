"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/LanguageProvider";

// A birth date as three lists — day, month, year. The month calendar (PickerBox) opened on this month, its days after
// today grey: a client born on the 21st tapped 21 and nothing happened, the year list unseen (the owner, 2026-11-04).
// The year starts empty, so no one is saved as born this year by mistake. The value is "1995-11-21" once all three
// are chosen, "" until then.
interface BirthDateBoxProps {
    value: string;
    onChange: (value: string) => void;
    label: string;
    /** The look of each of the three lists */
    className?: string;
    style?: React.CSSProperties;
    disabled?: boolean;
}

const WORDS = {
    he: { day: "יום", month: "חודש", year: "שנה" },
    en: { day: "Day", month: "Month", year: "Year" },
} as const;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

type Parts = { d: string; m: string; y: string };

function split(value: string): Parts {
    const hit = ISO.exec(value);
    return hit ? { d: String(Number(hit[3])), m: String(Number(hit[2])), y: hit[1] } : { d: "", m: "", y: "" };
}

function daysIn(m: number, y: number): number {
    return new Date(y || 2024, m, 0).getDate();      // no year yet: a leap year, so 29 February can be picked
}

export default function BirthDateBox({ value, onChange, label, className, style, disabled }: BirthDateBoxProps) {
    const { locale } = useLang();
    const words = WORDS[locale] ?? WORDS.he;
    const [parts, setParts] = useState<Parts>(() => split(value));
    // a value from outside (the client's card loaded) replaces what is shown — not the "" sent while choosing
    const [seen, setSeen] = useState(value);
    if (value !== seen) {
        setSeen(value);
        setParts(split(value));
    }

    const now = new Date();
    const thisYear = now.getFullYear();
    const future = (p: Parts) => Number(p.y) === thisYear
        && (Number(p.m) > now.getMonth() + 1 || (Number(p.m) === now.getMonth() + 1 && Number(p.d) > now.getDate()));

    const pick = (change: Partial<Parts>) => {
        let next = { ...parts, ...change };
        if (next.d && next.m && Number(next.d) > daysIn(Number(next.m), Number(next.y))) next = { ...next, d: "" };
        if (future(next)) next = { ...next, d: "", m: "" };
        const out = next.d && next.m && next.y
            ? `${next.y}-${next.m.padStart(2, "0")}-${next.d.padStart(2, "0")}` : "";
        setParts(next);
        setSeen(out);
        onChange(out);
    };

    const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2026, i, 1)));
    const lastDay = parts.m ? daysIn(Number(parts.m), Number(parts.y)) : 31;
    const years = Array.from({ length: 101 }, (_, i) => thisYear - i);
    const box = cn("w-full min-w-0 tabular-nums", className);

    return (
        <div role="group" aria-label={label} className="grid grid-cols-[1fr_1.6fr_1.3fr] gap-2">
            <select value={parts.d} onChange={e => pick({ d: e.target.value })} disabled={disabled} aria-label={words.day}
                className={box} style={style}>
                <option value="">{words.day}</option>
                {Array.from({ length: lastDay }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}</option>)}
            </select>
            <select value={parts.m} onChange={e => pick({ m: e.target.value })} disabled={disabled} aria-label={words.month}
                className={box} style={style}>
                <option value="">{words.month}</option>
                {monthNames.map((n, i) => <option key={i} value={String(i + 1)}>{n}</option>)}
            </select>
            <select value={parts.y} onChange={e => pick({ y: e.target.value })} disabled={disabled} aria-label={words.year}
                className={box} style={style}>
                <option value="">{words.year}</option>
                {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
        </div>
    );
}
