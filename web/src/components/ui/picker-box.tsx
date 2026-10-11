"use client";

import { cn } from "@/lib/utils";

// A date / time box that looks the same on every phone. The value is drawn here, in the middle; the phone's own box
// lies on top of it, invisible, only to open its picker (the wheel on an iPhone). An iPhone draws its own time box at
// a width of its own, whatever width it's given — two of them side by side ran past the screen's edge and onto each
// other (the owner, 2026-10-11). overflow-hidden keeps the invisible box inside this one, so a tap never lands on the
// box beside it.
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
    return (
        <div className="relative overflow-hidden min-w-0">
            <input
                type={type}
                value={value}
                onChange={e => onChange(e.target.value)}
                onClick={e => { try { e.currentTarget.showPicker?.(); } catch { /* the tap opens it anyway */ } }}
                aria-label={label}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className={cn("w-full text-center tabular-nums pointer-events-none peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-blue-500", className)}>
                {display ?? (value || "--:--")}
            </div>
        </div>
    );
}
