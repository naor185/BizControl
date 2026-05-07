"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Locale, LOCALES, TranslationKey, translations } from "@/lib/i18n";

const LS_KEY = "biz_locale";

type LangCtx = {
    locale: Locale;
    dir: "rtl" | "ltr";
    setLocale: (l: Locale) => void;
    t: (key: TranslationKey) => string;
};

const LangContext = createContext<LangCtx>({
    locale: "he",
    dir: "rtl",
    setLocale: () => {},
    t: (k) => k,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>("he");

    useEffect(() => {
        const saved = localStorage.getItem(LS_KEY) as Locale | null;
        if (saved && ["he", "en", "ar"].includes(saved)) setLocaleState(saved);
    }, []);

    useEffect(() => {
        const info = LOCALES.find(l => l.code === locale)!;
        document.documentElement.lang = locale;
        document.documentElement.dir = info.dir;
    }, [locale]);

    const setLocale = (l: Locale) => {
        localStorage.setItem(LS_KEY, l);
        setLocaleState(l);
    };

    const t = (key: TranslationKey): string =>
        (translations[locale] as Record<string, string>)[key] ??
        (translations["he"] as Record<string, string>)[key] ??
        key;

    const dir = LOCALES.find(l => l.code === locale)!.dir;

    return (
        <LangContext.Provider value={{ locale, dir, setLocale, t }}>
            {children}
        </LangContext.Provider>
    );
}

export function useLang() {
    return useContext(LangContext);
}
