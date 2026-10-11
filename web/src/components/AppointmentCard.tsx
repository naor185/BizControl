import { statusMeta } from "@/lib/appointment-status";

// Compact, info-first calendar-event card: client, time, service, staff,
// status — everything else (notes, deposit, full payment breakdown) only
// shows up once the appointment is opened, not crammed into the calendar grid.
interface AppointmentCardProps {
    timeText: string;
    title: string;
    clientName: string;
    artistName?: string | null;
    status: string;
    paidCents?: number;
    remainingCents?: number | null;
    isWalkIn?: boolean;
    isExternalGoogle?: boolean;
}

export default function AppointmentCard({
    timeText, title, clientName, artistName, status,
    paidCents = 0, remainingCents = null, isWalkIn, isExternalGoogle,
}: AppointmentCardProps) {
    if (isExternalGoogle) {
        return <div className="px-1 py-0.5 text-[11px] font-medium text-white truncate">📅 {title}</div>;
    }

    const isFullyPaid = paidCents > 0 && remainingCents !== null && remainingCents <= 0;
    const isPartiallyPaid = paidCents > 0 && (remainingCents === null || remainingCents > 0);
    const paymentIcon = isFullyPaid ? "✅" : isPartiallyPaid ? "💰" : null;
    const meta = statusMeta(status);
    const startText = timeText.split(/\s+[-–]\s+/)[0];

    return (
        // On a phone the columns are narrow: the client's name and the service wrap onto lines of their own, between
        // words, instead of being cut to "ק…" (the owner, 2026-10-11); a block narrower than 6rem shows only the start
        // time, one narrower than 3.5rem (a whole week on a phone) smaller letters. From md up — one line each, as before.
        <div className="@container px-1 md:px-1.5 py-1 h-full w-full flex flex-col overflow-hidden text-white">
            <div className="flex flex-wrap md:flex-nowrap items-center gap-x-1 text-[11px] @max-[3.5rem]:text-[9px] font-bold leading-tight">
                <span className="tabular-nums whitespace-nowrap md:shrink-0">
                    <span className="@max-[6rem]:hidden">{timeText}</span>
                    <span className="hidden @max-[6rem]:inline">{startText}</span>
                </span>
                <span className="min-w-0 break-words md:truncate">{isWalkIn ? "🚶 " : ""}{clientName}</span>
            </div>
            {(title || artistName) && (
                <div className="text-[10px] @max-[3.5rem]:text-[8.5px] opacity-90 leading-tight break-words md:truncate">
                    {title}{title && artistName ? " · " : ""}{artistName}
                </div>
            )}
            <span className="mt-auto text-[10px] leading-none flex items-center gap-1" title={meta.label}>
                {paymentIcon}
                {status !== "scheduled" && <span>{meta.icon}</span>}
            </span>
        </div>
    );
}
