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
