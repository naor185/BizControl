"use client";
import { useEffect, useRef } from "react";
import { imgUrl } from "@/lib/api";

interface StudioCard {
    id: string; slug: string; name: string;
    business_type: string; business_type_label: string; business_type_icon: string;
    logo_url?: string; city?: string; description?: string;
    self_booking_enabled: boolean; avg_rating?: number; review_count: number;
}

interface Props { studios: StudioCard[]; }

const CAT_COLORS: Record<string, string> = {
    barber: "#0ea5e9", tattoo: "#7c3aed", nails: "#ec4899",
    spa: "#10b981", pilates: "#f59e0b", laser: "#6366f1",
    medical: "#14b8a6", other: "#64748b",
};

const cityCache = new Map<string, [number, number]>();

async function geocodeCity(city: string): Promise<[number, number] | null> {
    if (cityCache.has(city)) return cityCache.get(city)!;
    try {
        const r = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + ", ישראל")}&format=json&limit=1`,
            { headers: { "Accept-Language": "he" } }
        );
        const d = await r.json();
        if (d[0]) {
            const coords: [number, number] = [parseFloat(d[0].lat), parseFloat(d[0].lon)];
            cityCache.set(city, coords);
            return coords;
        }
    } catch { }
    return null;
}

export default function MapView({ studios }: Props) {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);

    useEffect(() => {
        if (!mapRef.current || mapInstanceRef.current) return;

        (async () => {
            const L = (await import("leaflet")).default;
            await import("leaflet/dist/leaflet.css" as any);

            // Fix default icon paths broken by webpack
            delete (L.Icon.Default.prototype as any)._getIconUrl;
            L.Icon.Default.mergeOptions({
                iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
                iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
                shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
            });

            const map = L.map(mapRef.current!, {
                center: [31.7, 34.9],
                zoom: 8,
                zoomControl: true,
            });
            mapInstanceRef.current = map;

            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
                maxZoom: 18,
            }).addTo(map);

            // Group studios by city
            const byCity = new Map<string, StudioCard[]>();
            for (const s of studios) {
                const city = s.city?.trim() || "";
                if (!city) continue;
                const arr = byCity.get(city) || [];
                arr.push(s);
                byCity.set(city, arr);
            }

            // Geocode each unique city and add markers
            for (const [city, cityStudios] of Array.from(byCity.entries())) {
                const coords = await geocodeCity(city);
                if (!coords) continue;

                // Slight jitter for multiple studios in same city
                cityStudios.forEach((s, i) => {
                    const offset = cityStudios.length > 1 ? (i - (cityStudios.length - 1) / 2) * 0.005 : 0;
                    const color = CAT_COLORS[s.business_type] || CAT_COLORS.other;

                    const icon = L.divIcon({
                        className: "",
                        html: `<div style="
                            width:36px;height:36px;border-radius:50%;
                            background:${color};
                            border:3px solid #fff;
                            box-shadow:0 2px 8px rgba(0,0,0,.35);
                            display:flex;align-items:center;justify-content:center;
                            font-size:1rem;cursor:pointer;
                        ">${s.business_type_icon}</div>`,
                        iconSize: [36, 36],
                        iconAnchor: [18, 18],
                        popupAnchor: [0, -20],
                    });

                    const logoHtml = s.logo_url
                        ? `<img src="${imgUrl(s.logo_url)}" style="width:40px;height:40px;border-radius:10px;object-fit:cover;flex-shrink:0;" />`
                        : `<div style="width:40px;height:40px;border-radius:10px;background:${color};display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">${s.business_type_icon}</div>`;

                    const ratingHtml = s.avg_rating && s.review_count > 0
                        ? `<span style="color:#fbbf24;font-size:0.75rem;">★ ${s.avg_rating.toFixed(1)}</span>`
                        : "";

                    const popup = L.popup({ maxWidth: 240, minWidth: 200 }).setContent(`
                        <div dir="rtl" style="font-family:system-ui,sans-serif;padding:0.25rem 0;">
                            <div style="display:flex;gap:0.6rem;align-items:center;margin-bottom:0.5rem;">
                                ${logoHtml}
                                <div>
                                    <div style="font-weight:800;font-size:0.9rem;color:#1e293b;">${s.name}</div>
                                    <div style="font-size:0.72rem;color:#64748b;">${s.business_type_icon} ${s.business_type_label} · 📍 ${city}</div>
                                    ${ratingHtml}
                                </div>
                            </div>
                            ${s.description ? `<div style="font-size:0.75rem;color:#64748b;line-height:1.5;margin-bottom:0.5rem;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${s.description}</div>` : ""}
                            ${s.self_booking_enabled ? `<div style="font-size:0.7rem;font-weight:700;color:#166534;background:#dcfce7;border-radius:6px;padding:0.2rem 0.5rem;display:inline-block;margin-bottom:0.5rem;">📅 הזמנה אונליין</div>` : ""}
                            <a href="/b/${s.slug}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;text-decoration:none;border-radius:8px;padding:0.4rem 0.75rem;font-weight:700;font-size:0.8rem;">
                                צפה בפרופיל ←
                            </a>
                        </div>
                    `);

                    L.marker([coords[0] + offset, coords[1] + offset], { icon })
                        .bindPopup(popup)
                        .addTo(map);
                });
            }

            // Fit to markers if any
            const citiesWithCoords: [number, number][] = [];
            for (const city of Array.from(byCity.keys())) {
                const c = cityCache.get(city);
                if (c) citiesWithCoords.push(c);
            }
            if (citiesWithCoords.length > 0) {
                map.fitBounds(L.latLngBounds(citiesWithCoords).pad(0.2));
            }
        })();

        return () => {
            mapInstanceRef.current?.remove();
            mapInstanceRef.current = null;
        };
    }, []); // eslint-disable-line

    // Update markers when studios change
    useEffect(() => {
        // Re-render handled by key on parent; skip for now
    }, [studios]);

    return (
        <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,255,255,.08)" }}>
            <div ref={mapRef} style={{ height: "60vh", minHeight: 400, width: "100%" }} />
            <div style={{ position: "absolute", bottom: 12, right: 12, background: "rgba(15,23,42,.85)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "#94a3b8", pointerEvents: "none" }}>
                🗺️ לחץ על סמן לפרטי העסק
            </div>
        </div>
    );
}
