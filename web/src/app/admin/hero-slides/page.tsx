"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, API_BASE } from "@/lib/api";

type HeroSlide = {
    id: string;
    url: string;
    label: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
};

export default function HeroSlidesPage() {
    const router = useRouter();
    const [slides, setSlides] = useState<HeroSlide[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [label, setLabel] = useState("");
    const [sortOrder, setSortOrder] = useState(0);
    const [error, setError] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        try {
            const data = await apiFetch<HeroSlide[]>("/api/admin/hero-slides");
            setSlides(data);
        } catch {
            setError("שגיאה בטעינת השקופיות");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleUpload(e: React.FormEvent) {
        e.preventDefault();
        const file = fileRef.current?.files?.[0];
        if (!file) { setError("בחר קובץ תמונה"); return; }
        setUploading(true);
        setError("");
        try {
            const form = new FormData();
            form.append("file", file);
            form.append("label", label);
            form.append("sort_order", String(sortOrder));
            const token = typeof window !== "undefined" ? localStorage.getItem("bizcontrol_token") : null;
            const res = await fetch(`${API_BASE}/api/admin/hero-slides`, {
                method: "POST",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: form,
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.detail || "שגיאה בהעלאה");
            }
            setLabel("");
            setSortOrder(slides.length);
            if (fileRef.current) fileRef.current.value = "";
            await load();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "שגיאה בהעלאה");
        } finally {
            setUploading(false);
        }
    }

    async function toggleActive(slide: HeroSlide) {
        await apiFetch(`/api/admin/hero-slides/${slide.id}`, {
            method: "PATCH",
            body: JSON.stringify({ is_active: !slide.is_active }),
        });
        await load();
    }

    async function updateLabel(slide: HeroSlide, newLabel: string) {
        await apiFetch(`/api/admin/hero-slides/${slide.id}`, {
            method: "PATCH",
            body: JSON.stringify({ label: newLabel }),
        });
    }

    async function deleteSlide(id: string) {
        if (!confirm("למחוק שקופית זו?")) return;
        await apiFetch(`/api/admin/hero-slides/${id}`, { method: "DELETE" });
        await load();
    }

    async function moveSlide(slide: HeroSlide, dir: -1 | 1) {
        await apiFetch(`/api/admin/hero-slides/${slide.id}`, {
            method: "PATCH",
            body: JSON.stringify({ sort_order: slide.sort_order + dir }),
        });
        await load();
    }

    return (
        <div dir="rtl" style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "system-ui,sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
                <button onClick={() => router.back()} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.4rem 0.8rem", cursor: "pointer", color: "#64748b" }}>← חזור</button>
                <h1 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#0f172a", margin: 0 }}>🖼️ ניהול תמונות HERO — BizFind</h1>
            </div>

            {/* Upload form */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "1.5rem", marginBottom: "2rem", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#1e293b", marginBottom: "1rem", marginTop: 0 }}>הוספת שקופית חדשה</h2>
                <form onSubmit={handleUpload} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
                    <div style={{ flex: "2 1 220px" }}>
                        <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#64748b", marginBottom: "0.3rem" }}>קובץ תמונה *</label>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            required
                            style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.5rem", fontSize: "0.85rem", boxSizing: "border-box" }}
                        />
                    </div>
                    <div style={{ flex: "2 1 200px" }}>
                        <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#64748b", marginBottom: "0.3rem" }}>כיתוב (label)</label>
                        <input
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            placeholder="לדוגמה: ספרים וטיפוח"
                            style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.9rem", boxSizing: "border-box" }}
                        />
                    </div>
                    <div style={{ flex: "0 0 100px" }}>
                        <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#64748b", marginBottom: "0.3rem" }}>סדר</label>
                        <input
                            type="number"
                            value={sortOrder}
                            onChange={e => setSortOrder(Number(e.target.value))}
                            min={0}
                            style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.9rem", boxSizing: "border-box" }}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={uploading}
                        style={{ padding: "0.6rem 1.4rem", background: uploading ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 10, cursor: uploading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "0.9rem", flexShrink: 0 }}
                    >
                        {uploading ? "מעלה..." : "העלה תמונה"}
                    </button>
                </form>
                {error && <p style={{ color: "#ef4444", fontSize: "0.82rem", marginTop: "0.5rem", marginBottom: 0 }}>{error}</p>}
            </div>

            {/* Slides list */}
            {loading ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>טוען...</div>
            ) : slides.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", background: "#f8faff", borderRadius: 16, border: "1px dashed #cbd5e1" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🖼️</div>
                    <div>אין שקופיות עדיין. העלה תמונה למעלה.</div>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {slides.sort((a, b) => a.sort_order - b.sort_order).map((slide, idx) => (
                        <div key={slide.id} style={{
                            display: "flex", alignItems: "center", gap: "1rem",
                            background: "#fff", border: `1.5px solid ${slide.is_active ? "#bfdbfe" : "#e2e8f0"}`,
                            borderRadius: 14, padding: "0.75rem 1rem",
                            opacity: slide.is_active ? 1 : 0.55,
                            boxShadow: "0 1px 4px rgba(0,0,0,.04)",
                        }}>
                            <img
                                src={slide.url}
                                alt={slide.label}
                                style={{ width: 110, height: 70, objectFit: "cover", borderRadius: 10, flexShrink: 0 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <input
                                    defaultValue={slide.label}
                                    onBlur={e => updateLabel(slide, e.target.value)}
                                    placeholder="כיתוב..."
                                    style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 7, padding: "0.4rem 0.6rem", fontSize: "0.88rem", boxSizing: "border-box", fontWeight: 600 }}
                                />
                                <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.3rem" }}>סדר: {slide.sort_order}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flexShrink: 0 }}>
                                <button onClick={() => moveSlide(slide, -1)} disabled={idx === 0} title="העלה למעלה"
                                    style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7, padding: "0.3rem 0.65rem", cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.4 : 1 }}>▲</button>
                                <button onClick={() => moveSlide(slide, 1)} disabled={idx === slides.length - 1} title="הורד למטה"
                                    style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7, padding: "0.3rem 0.65rem", cursor: idx === slides.length - 1 ? "not-allowed" : "pointer", opacity: idx === slides.length - 1 ? 0.4 : 1 }}>▼</button>
                            </div>
                            <button
                                onClick={() => toggleActive(slide)}
                                style={{ padding: "0.4rem 0.85rem", background: slide.is_active ? "#d1fae5" : "#f1f5f9", color: slide.is_active ? "#065f46" : "#64748b", border: `1px solid ${slide.is_active ? "#6ee7b7" : "#e2e8f0"}`, borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.78rem", flexShrink: 0 }}
                            >
                                {slide.is_active ? "פעיל ✓" : "מושבת"}
                            </button>
                            <button
                                onClick={() => deleteSlide(slide.id)}
                                style={{ padding: "0.4rem 0.75rem", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", flexShrink: 0 }}
                            >
                                מחק
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <p style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "1.5rem", textAlign: "center" }}>
                השקופיות יופיעו בקרוסלה של עמוד הבית BizFind • שינויים נכנסים לתוקף מיידית
            </p>
        </div>
    );
}
