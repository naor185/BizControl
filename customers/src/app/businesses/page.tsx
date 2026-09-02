"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { API } from "@/lib/api";

interface BusinessCard {
    id: string; slug: string; name: string; category: string;
    city?: string; address?: string; phone?: string;
    latitude?: number; longitude?: number; description?: string;
    claim_status: string;
}

const CATEGORY_LABELS: Record<string, string> = {
    tattoo: "סטודיו קעקועים", barber: "ספר / ברברשופ", nails: "ציפורניים",
    laser: "לייזר", pilates: "פילאטיס / כושר", spa: "ספא / קוסמטיקה",
    medical: "קליניקה / מרפאה", other: "אחר",
};

export default function BusinessesPage() {
    const [businesses, setBusinesses] = useState<BusinessCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [city, setCity] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams();
            if (q) p.set("q", q);
            if (city) p.set("city", city);
            const r = await fetch(`${API}/api/businesses?${p}`);
            const d = await r.json();
            setBusinesses(d.businesses || []);
        } catch { setBusinesses([]); }
        finally { setLoading(false); }
    }, [q, city]);

    useEffect(() => {
        const t = setTimeout(load, 300);
        return () => clearTimeout(t);
    }, [load]);

    return (
        <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9" }} dir="rtl">
            <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1.25rem" }}>
                <h1 style={{ fontWeight: 900, fontSize: "1.6rem", marginBottom: "0.4rem" }}>🗺️ עסקים באזור שלך</h1>
                <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                    עסקים שנמצאו ברשת ועדיין לא מנוהלים ב-BizFind. בעל עסק? תמצא את העסק שלך ותקבל עליו שליטה בחינם.
                </p>

                <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
                    <input
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="חיפוש לפי שם..."
                        style={{ flex: "2 1 200px", background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "0.7rem 1rem", color: "#f1f5f9", fontSize: "0.9rem" }}
                    />
                    <input
                        value={city}
                        onChange={e => setCity(e.target.value)}
                        placeholder="עיר..."
                        style={{ flex: "1 1 140px", background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "0.7rem 1rem", color: "#f1f5f9", fontSize: "0.9rem" }}
                    />
                </div>

                {loading && <div style={{ textAlign: "center", padding: "3rem 0", color: "#64748b" }}>טוען...</div>}
                {!loading && businesses.length === 0 && (
                    <div style={{ textAlign: "center", padding: "3rem 0", color: "#64748b" }}>לא נמצאו עסקים</div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
                    {businesses.map(b => (
                        <Link key={b.id} href={`/businesses/${b.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
                            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 16, padding: "1.25rem", height: "100%", transition: "border-color .2s" }}>
                                <div style={{ fontSize: "0.75rem", color: "#7c3aed", fontWeight: 700, marginBottom: "0.4rem" }}>
                                    {CATEGORY_LABELS[b.category] || b.category}
                                </div>
                                <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.3rem" }}>{b.name}</div>
                                {b.address && <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>📍 {b.address}{b.city ? `, ${b.city}` : ""}</div>}
                                {b.phone && <div style={{ color: "#94a3b8", fontSize: "0.85rem", direction: "ltr", textAlign: "right", marginTop: "0.2rem" }}>📞 {b.phone}</div>}
                                <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "#f59e0b", fontWeight: 700 }}>⚪ העסק הזה שלך? לחץ לתביעת בעלות</div>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
