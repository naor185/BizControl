"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Locale, LOCALE_KEY, LOCALES, TranslationKey, savedLocale, translations } from "@/lib/i18n";
import { EN } from "@/lib/en";
import { apiFetch, getToken } from "@/lib/api";

// The system's language (the owner, 2026-10-12/19: Hebrew or English — the whole system). t("key") — the old keyed
// texts (lib/i18n); tr("טקסט בעברית", {n: 3}) — a screen's own Hebrew text, in English from lib/en.ts when the
// language is English (as it is while it has no English yet). intl — for dates and numbers ("he-IL" / "en-GB").
// setLocale — the user's choice, kept on the device and in the account; adopt — the account's choice, as the server
// says it (AppShell, from /api/auth/me), kept on the device only.

type LangCtx = {
    locale: Locale;
    dir: "rtl" | "ltr";
    intl: string;
    setLocale: (l: Locale) => void;
    adopt: (l: string | null | undefined) => void;
    t: (key: TranslationKey) => string;
    tr: (he: string, vars?: Record<string, string | number>) => string;
};

const fill = (s: string, vars?: Record<string, string | number>) =>
    vars ? Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s) : s;

const LangContext = createContext<LangCtx>({
    locale: "he",
    dir: "rtl",
    intl: "he-IL",
    setLocale: () => {},
    adopt: () => {},
    t: (k) => k,
    tr: (he, vars) => fill(he, vars),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>("he");

    useEffect(() => {
        const saved = savedLocale();             // the device's, for the first paint — the account's comes with /me
        // after hydration on purpose: the server's page is Hebrew, so the first client paint must be too
        if (saved !== "he") setLocaleState(saved);   // eslint-disable-line react-hooks/set-state-in-effect
    }, []);

    useEffect(() => {
        const info = LOCALES.find(l => l.code === locale)!;
        document.documentElement.lang = locale;
        document.documentElement.dir = info.dir;
    }, [locale]);

    const keep = (l: Locale) => {
        try { localStorage.setItem(LOCALE_KEY, l); } catch { /* the device keeps nothing — the account does */ }
        setLocaleState(l);
    };
    const setLocale = (l: Locale) => {
        keep(l);
        if (getToken()) apiFetch("/api/auth/me/locale", { method: "PUT", body: JSON.stringify({ locale: l }) }).catch(() => {});
    };
    const adopt = useCallback((l: string | null | undefined) => {
        if (l === "he" || l === "en") keep(l);
    }, []);

    const t = (key: TranslationKey): string =>
        (translations[locale] as Record<string, string>)[key] ??
        (translations["he"] as Record<string, string>)[key] ??
        key;
    const tr = (he: string, vars?: Record<string, string | number>) => fill(locale === "en" ? EN[he] ?? he : he, vars);

    const dir = LOCALES.find(l => l.code === locale)!.dir;

    return (
        <LangContext.Provider value={{ locale, dir, intl: locale === "en" ? "en-GB" : "he-IL", setLocale, adopt, t, tr }}>
            {children}
        </LangContext.Provider>
    );
}

export function useLang() {
    return useContext(LangContext);
}
