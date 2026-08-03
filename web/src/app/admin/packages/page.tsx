"use client";
import ModuleTreeEditor from "@/components/admin/ModuleTreeEditor";

export default function PackagesPage() {
    return (
        <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a,#1e1b4b)", padding: "2rem", fontFamily: "sans-serif", direction: "rtl" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
                    <a href="/admin" style={{ color: "#a78bfa", textDecoration: "none", fontSize: "0.9rem" }}>← חזרה לאדמין</a>
                    <h1 style={{ color: "#fff", fontSize: "1.8rem", fontWeight: 800, margin: 0 }}>📦 עורך חבילות</h1>
                    <span style={{ color: "#64748b", fontSize: "0.85rem" }}>שלוט מה כלול בכל plan — ללא שינוי קוד</span>
                    <a href="/admin/plans" style={{ marginRight: "auto", color: "#a78bfa", textDecoration: "none", fontSize: "0.85rem", background: "rgba(167,139,250,.12)", padding: "0.4rem 0.9rem", borderRadius: 10 }}>
                        🎛️ מרכז ניהול מסלולים ←
                    </a>
                </div>
                <ModuleTreeEditor showSearch />
            </div>
        </div>
    );
}
