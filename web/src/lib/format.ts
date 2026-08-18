/**
 * Format a Date as a "YYYY-MM-DD" string using its LOCAL calendar day —
 * never `date.toISOString().split("T")[0]`. Israel is UTC+2/+3, so
 * toISOString() (which converts to UTC first) rolls local midnight back to
 * the previous day for part of the day: e.g. July 31st at local midnight
 * becomes "2026-07-30" once shifted to UTC. Use this everywhere a Date needs
 * to become a plain calendar-day string (date inputs, "today", "last day of
 * month", etc).
 */
export function toLocalDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Format a date string to a localized display format.
 */
export function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

/**
 * Format a number as ILS currency.
 */
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat("he-IL", {
        style: "currency",
        currency: "ILS",
        minimumFractionDigits: 0,
    }).format(amount);
}

/**
 * Format a phone number for display.
 */
export function formatPhone(phone: string): string {
    return phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
}
