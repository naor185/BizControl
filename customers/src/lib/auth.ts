const CUSTOMER_KEY = "biz_customer";

export interface Customer {
    id: string;
    phone: string;
    first_name: string;
    last_name: string;
    full_name: string;
    city: string | null;
    favorites: string[];
}

export function getCustomer(): Customer | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(CUSTOMER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function saveCustomer(c: Customer) {
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(c));
}

export function clearCustomer() {
    localStorage.removeItem(CUSTOMER_KEY);
    localStorage.removeItem("biz_customer_token");
}
