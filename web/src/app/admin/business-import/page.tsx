"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Business = {
    id: string;
    name: string;
    slug: string;
    category: string;
    city: string | null;
    address: string | null;
    phone: string | null;
    claim_status: string;
    created_at: string | null;
};

// The business types — and the OpenStreetMap tag each one is imported with — come from the one list
// (Super Admin > business types). Picking a type sets its tag, so a type is not imported with another
// type's tag by mistake (importing health funds labeled as tattoo studios was a real bug); the tag can
// still be changed on purpose. A type that does not exist yet is added in the business types page first.
type BusinessTypeRow = { business_type: string; display_name: string; osm_tag: string | null; is_active: boolean };

const CLAIM_STATUS_LABELS: Record<string, string> = {
    unclaimed: "⚪ לא נתבע",
    pending: "🟡 אימות בתהליך",
    claimed: "🟢 נתבע",
};

export default function BusinessImportPage() {
    const router = useRouter();

    const [city, setCity] = useState("");
    const [types, setTypes] = useState<BusinessTypeRow[]>([]);
    const [category, setCategory] = useState("");
    const [osmTag, setOsmTag] = useState("");
    const typeLabel = (key: string) => types.find(t => t.business_type === key)?.display_name || key;
    const pickType = (key: string, from: BusinessTypeRow[] = types) => {
        setCategory(key);
        setOsmTag(from.find(t => t.business_type === key)?.osm_tag || "");
    };
    useEffect(() => {
        apiFetch<BusinessTypeRow[]>("/api/admin/business-types")
            .then(rows => {
                const active = rows.filter(r => r.is_active);
                setTypes(active);
                const first = active.find(r => r.osm_tag) || active[0];
                if (first) pickType(first.business_type, active);
            })
            .catch(() => setTypes([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const [limit, setLimit] = useState(50);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<{ found: number; created: number; skipped: number } | null>(null);
    const [error, setError] = useState("");

    const [businesses, setBusinesses] = useState<Business[]>([]);
    const [total, setTotal] = useState(0);
    const [loadingList, setLoadingList] = useState(true);
    const [filterCity, setFilterCity] = useState("");
    const [filterStatus, setFilterStatus] = useState("");
    const [rematchingId, setRematchingId] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);

    const loadList = useCallback(async () => {
        setLoadingList(true);
        try {
            const params = new URLSearchParams();
            if (filterCity) params.set("city", filterCity);
            if (filterStatus) params.set("claim_status", filterStatus);
            const data = await apiFetch<{ businesses: Business[]; total: number }>(`/api/admin/businesses?${params}`);
            setBusinesses(data.businesses);
            setTotal(data.total);
        } catch {
            // silent — table just stays empty
        } finally {
            setLoadingList(false);
        }
    }, [filterCity, filterStatus]);

    useEffect(() => { loadList(); }, [loadList]);

    async function handleImport(e: React.FormEvent) {
        e.preventDefault();
        if (!city.trim()) { setError("הזן שם עיר"); return; }
        if (!category || !osmTag.trim()) { setError("בחר סוג עסק והזן תגית OSM"); return; }
        setImporting(true);
        setError("");
        setResult(null);
        try {
            const data = await apiFetch<{ found: number; created: number; skipped: number }>("/api/admin/businesses/import", {
                method: "POST",
                body: JSON.stringify({ city: city.trim(), category, osm_tag: osmTag.trim(), limit }),
            });
            setResult(data);
            await loadList();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "שגיאה בייבוא");
        } finally {
            setImporting(false);
        }
    }

    async function rematchGoogle(businessId: string) {
        setRematchingId(businessId);
        try {
            await apiFetch(`/api/admin/businesses/${businessId}/google-match`, { method: "DELETE" });
        } catch {
            // silent — worst case the old match just stays as-is
        } finally {
            setRematchingId(null);
        }
    }

    async function deleteBusiness(businessId: string) {
        if (!confirm("למחוק את העסק הזה? הפעולה בלתי הפיכה.")) return;
        try {
            await apiFetch(`/api/admin/businesses/${businessId}`, { method: "DELETE" });
            setSelected(prev => { const next = new Set(prev); next.delete(businessId); return next; });
            await loadList();
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : "שגיאה במחיקה");
        }
    }

    async function deleteSelected() {
        if (selected.size === 0) return;
        if (!confirm(`למחוק ${selected.size} עסקים? הפעולה בלתי הפיכה.`)) return;
        setDeleting(true);
        try {
            for (const id of selected) {
                await apiFetch(`/api/admin/businesses/${id}`, { method: "DELETE" }).catch(() => {});
            }
            setSelected(new Set());
            await loadList();
        } finally {
            setDeleting(false);
        }
    }

    function toggleSelected(id: string) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    return (
        <div dir="rtl" style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "system-ui,sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
                <button onClick={() => router.back()} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.4rem 0.8rem", cursor: "pointer", color: "#64748b" }}>← חזור</button>
                <h1 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#0f172a", margin: 0 }}>🗺️ ייבוא עסקים — BizFind</h1>
            </div>

            {/* Import form */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "1.5rem", marginBottom: "2rem", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#1e293b", marginBottom: "0.4rem", marginTop: 0 }}>ייבוא עסקים חדשים מ-OpenStreetMap</h2>
                <p style={{ fontSize: "0.82rem", color: "#94a3b8", marginBottom: "1.25rem" }}>
                    מושך עסקים אמיתיים לפי עיר וקטגוריה, יוצר להם עמוד לא-מאומת ב-BizFind. בטוח להריץ שוב על אותה עיר — עסקים שכבר יובאו לא ישוכפלו.
                </p>
                <form onSubmit={handleImport} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
                    <div style={{ flex: "1 1 180px" }}>
                        <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#64748b", marginBottom: "0.3rem" }}>עיר *</label>
                        <input
                            value={city}
                            onChange={e => setCity(e.target.value)}
                            placeholder="לדוגמה: ראשון לציון"
                            style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.9rem", boxSizing: "border-box" }}
                        />
                    </div>
                    <div style={{ flex: "1 1 220px" }}>
                        <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#64748b", marginBottom: "0.3rem" }}>סוג עסק *</label>
                        <select
                            value={category}
                            onChange={e => pickType(e.target.value)}
                            style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.9rem", boxSizing: "border-box" }}
                        >
                            {types.map(t => <option key={t.business_type} value={t.business_type}>{t.display_name}</option>)}
                        </select>
                        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.25rem" }}>סוג חסר? מוסיפים אותו בניהול תחומי העסק</div>
                    </div>
                    <div style={{ flex: "1 1 180px" }}>
                        <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#64748b", marginBottom: "0.3rem" }}>תגית OSM (key=value)</label>
                        <input
                            value={osmTag}
                            onChange={e => setOsmTag(e.target.value)}
                            placeholder="לדוגמה: shop=bakery"
                            dir="ltr"
                            style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.9rem", boxSizing: "border-box" }}
                        />
                    </div>
                    <div style={{ flex: "0 0 100px" }}>
                        <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#64748b", marginBottom: "0.3rem" }}>מקסימום</label>
                        <input
                            type="number"
                            value={limit}
                            onChange={e => setLimit(Number(e.target.value))}
                            min={1}
                            max={200}
                            style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.9rem", boxSizing: "border-box" }}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={importing}
                        style={{ padding: "0.6rem 1.4rem", background: importing ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 10, cursor: importing ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "0.9rem", flexShrink: 0 }}
                    >
                        {importing ? "מייבא..." : "ייבוא"}
                    </button>
                </form>
                {error && <div style={{ marginTop: "1rem", color: "#dc2626", fontSize: "0.85rem", fontWeight: 600 }}>{error}</div>}
                {result && (
                    <div style={{ marginTop: "1rem", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.85rem 1rem", fontSize: "0.85rem", color: "#166534", fontWeight: 600 }}>
                        ✅ נמצאו {result.found} עסקים — נוצרו {result.created} חדשים, {result.skipped} כבר היו קיימים.
                    </div>
                )}
            </div>

            {/* Imported list */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "1.5rem", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
                    <h2 style={{ fontWeight: 800, fontSize: "1rem", color: "#1e293b", margin: 0 }}>עסקים שיובאו ({total})</h2>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                        <input
                            placeholder="סינון לפי עיר"
                            value={filterCity}
                            onChange={e => setFilterCity(e.target.value)}
                            style={{ border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.4rem 0.7rem", fontSize: "0.82rem" }}
                        />
                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value)}
                            style={{ border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "0.4rem 0.7rem", fontSize: "0.82rem" }}
                        >
                            <option value="">כל הסטטוסים</option>
                            <option value="unclaimed">⚪ לא נתבע</option>
                            <option value="pending">🟡 אימות בתהליך</option>
                            <option value="claimed">🟢 נתבע</option>
                        </select>
                    </div>
                </div>

                {selected.size > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.6rem 0.9rem", marginBottom: "0.75rem" }}>
                        <span style={{ fontSize: "0.82rem", color: "#991b1b", fontWeight: 600 }}>{selected.size} נבחרו</span>
                        <button type="button" onClick={deleteSelected} disabled={deleting}
                            style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, padding: "0.35rem 0.85rem", fontSize: "0.8rem", fontWeight: 700, cursor: deleting ? "not-allowed" : "pointer" }}>
                            {deleting ? "מוחק..." : "🗑️ מחק נבחרים"}
                        </button>
                        <button type="button" onClick={() => setSelected(new Set())}
                            style={{ background: "none", border: "none", color: "#991b1b", fontSize: "0.8rem", cursor: "pointer", textDecoration: "underline" }}>
                            בטל בחירה
                        </button>
                    </div>
                )}

                {loadingList && <div style={{ color: "#94a3b8", fontSize: "0.85rem", textAlign: "center", padding: "2rem 0" }}>טוען...</div>}
                {!loadingList && businesses.length === 0 && <div style={{ color: "#94a3b8", fontSize: "0.85rem", textAlign: "center", padding: "2rem 0" }}>אין עדיין עסקים מיובאים</div>}
                {!loadingList && businesses.length > 0 && (
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b", textAlign: "right" }}>
                                    <th style={{ padding: "0.5rem", width: 28 }}></th>
                                    <th style={{ padding: "0.5rem" }}>שם</th>
                                    <th style={{ padding: "0.5rem" }}>קטגוריה</th>
                                    <th style={{ padding: "0.5rem" }}>עיר</th>
                                    <th style={{ padding: "0.5rem" }}>כתובת</th>
                                    <th style={{ padding: "0.5rem" }}>טלפון</th>
                                    <th style={{ padding: "0.5rem" }}>סטטוס</th>
                                    <th style={{ padding: "0.5rem" }}></th>
                                    <th style={{ padding: "0.5rem" }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {businesses.map(b => (
                                    <tr key={b.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                        <td style={{ padding: "0.5rem" }}>
                                            {b.claim_status === "unclaimed" && (
                                                <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggleSelected(b.id)} />
                                            )}
                                        </td>
                                        <td style={{ padding: "0.5rem", fontWeight: 600, color: "#1e293b" }}>{b.name}</td>
                                        <td style={{ padding: "0.5rem", color: "#64748b" }}>{typeLabel(b.category)}</td>
                                        <td style={{ padding: "0.5rem", color: "#64748b" }}>{b.city || "—"}</td>
                                        <td style={{ padding: "0.5rem", color: "#64748b" }}>{b.address || "—"}</td>
                                        <td style={{ padding: "0.5rem", color: "#64748b", direction: "ltr", textAlign: "right" }}>{b.phone || "—"}</td>
                                        <td style={{ padding: "0.5rem" }}>{CLAIM_STATUS_LABELS[b.claim_status] || b.claim_status}</td>
                                        <td style={{ padding: "0.5rem" }}>
                                            {b.claim_status === "unclaimed" && (
                                                <button
                                                    type="button"
                                                    onClick={() => rematchGoogle(b.id)}
                                                    disabled={rematchingId === b.id}
                                                    style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 7, padding: "0.2rem 0.55rem", fontSize: "0.72rem", color: "#64748b", cursor: rematchingId === b.id ? "not-allowed" : "pointer" }}
                                                    title="אם התמונה/דירוג שגויים — נקה את ההתאמה לגוגל ותאולץ התאמה מחדש בכניסה הבאה"
                                                >
                                                    {rematchingId === b.id ? "..." : "🔄 גוגל"}
                                                </button>
                                            )}
                                        </td>
                                        <td style={{ padding: "0.5rem" }}>
                                            {b.claim_status === "unclaimed" && (
                                                <button
                                                    type="button"
                                                    onClick={() => deleteBusiness(b.id)}
                                                    style={{ background: "none", border: "1px solid #fecaca", borderRadius: 7, padding: "0.2rem 0.55rem", fontSize: "0.72rem", color: "#dc2626", cursor: "pointer" }}
                                                    title="מחק לצמיתות"
                                                >
                                                    🗑️
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
