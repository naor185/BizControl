"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "@/lib/api";

// The business's own words — "מניקוריסטית", "מטפל/ת", "מדריך/ה" instead of a hardcoded "אמן".
// They come from the server (its field's words with the owner's changes: GET /api/studio/upload/terms).
// Use them as labels and nouns only ("מניקוריסטית: דנה", `ביצועי ${staff_plural}`) — never inside a
// sentence whose verb has to agree in gender.
export type Terms = {
    staff: string; staff_plural: string;
    service: string; service_plural: string;
    client: string; client_plural: string;
    place: string;
    example_service?: string | null;   // a sample service from the field, for "לדוגמה: …" hints
};

// Shown only for the moment before the server answers.
const LOADING: Terms = {
    staff: "נותן/ת שירות", staff_plural: "נותני שירות", service: "שירות", service_plural: "שירותים",
    client: "לקוח/ה", client_plural: "לקוחות", place: "עסק",
};

let cached: { token: string | null; words: Promise<Terms> } | null = null;
const listeners = new Set<(t: Terms) => void>();

function load(): Promise<Terms> {
    const token = getToken();
    if (!cached || cached.token !== token) {
        const words = apiFetch<{ terms: Terms; example_service: string | null }>("/api/studio/upload/terms")
            .then(r => ({ ...LOADING, ...r.terms, example_service: r.example_service }))
            .catch(() => { cached = null; return LOADING; });
        cached = { token, words };
    }
    return cached.words;
}

// After the owner changes their field or words: every screen showing them updates.
export function refreshTerms(): void {
    cached = null;
    load().then(t => listeners.forEach(l => l(t)));
}

export function useTerms(): Terms {
    const [terms, setTerms] = useState<Terms>(LOADING);
    useEffect(() => {
        let alive = true;
        const update = (t: Terms) => { if (alive) setTerms(t); };
        listeners.add(update);
        load().then(update);
        return () => { alive = false; listeners.delete(update); };
    }, []);
    return terms;
}

// Fills the business's words into a fixed text: "{staff_plural}, תפקידים" → "מדריכים, תפקידים".
export function fillTerms(text: string, t: Terms): string {
    return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in t ? String(t[key as keyof Terms] ?? "") : whole));
}
