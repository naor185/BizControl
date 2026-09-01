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

    return (
        <div className="px-1.5 py-1 h-full w-full flex flex-col overflow-hidden text-white">
            <div className="flex items-center gap-1 text-[11px] font-bold leading-tight">
                <span className="shrink-0">{timeText}</span>
                <span className="truncate">{isWalkIn ? "🚶 " : ""}{clientName}</span>
            </div>
            {(title || artistName) && (
                <div className="text-[10px] opacity-90 truncate leading-tight">
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
