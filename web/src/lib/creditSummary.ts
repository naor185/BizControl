import { tx } from "@/lib/i18n";

// What a credit note reset besides the money (services/sale_reversal — the owner, 2026-10-26: "everything resets"),
// said after it's issued: " · 20 נקודות שנצברו בוטלו · הקופון שוחרר לשימוש חוזר"
export type Undone = { points_taken: number; points_given: number; coupon: boolean; restocked: number } | null | undefined;

export function undoneWords(u: Undone): string {
    if (!u) return "";
    const parts: string[] = [];
    if (u.points_taken) parts.push(tx("{0} נקודות שנצברו בוטלו", { 0: u.points_taken }));
    if (u.points_given) parts.push(tx("{0} נקודות הוחזרו ללקוח", { 0: u.points_given }));
    if (u.coupon) parts.push(tx("הקופון שוחרר לשימוש חוזר"));
    if (u.restocked) parts.push(tx("{0} פריטים חזרו למלאי", { 0: u.restocked }));
    return parts.map(p => " · " + p).join("");
}
