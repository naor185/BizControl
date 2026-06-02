"use client";
import { useEffect, useRef } from "react";

interface StudioCard {
    id: string; slug: string; name: string;
    business_type: string; business_type_label: string; business_type_icon: string;
    logo_url?: string; city?: string;
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
    } catch {}
    return null;
}

function loadLeaflet(): Promise<any> {
    return new Promise((resolve, reject) => {
        const win = window as any;
        if (win.L) { resolve(win.L); return; }

        if (!document.getElementById("leaflet-css")) {
            const css = document.createElement("link");
            css.id = "leaflet-css";
            css.rel = "stylesheet";
            css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
            document.head.appendChild(css);
        }

        const existing = document.getElementById("leaflet-js");
        if (existing) {
            existing.addEventListener("load", () => resolve(win.L));
            return;
        }

        const script = document.createElement("script");
        script.id = "leaflet-js";
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.onload = () => resolve(win.L);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

export default function MapView({ studios }: Props) {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstance = useRef<any>(null);

    useEffect(() => {
        if (!mapRef.current || mapInstance.current) return;

        loadLeaflet().then((L) => {
            if (!mapRef.current || mapInstance.current) return;

            const map = L.map(mapRef.current).setView([31.5, 34.75], 7);
            mapInstance.current = map;

            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: "© OpenStreetMap",
                maxZoom: 18,
            }).addTo(map);

            const byCity = new Map<string, StudioCard[]>();
            for (const s of studios) {
                const city = s.city || "אחר";
                if (!byCity.has(city)) byCity.set(city, []);
                byCity.get(city)!.push(s);
            }

            for (const city of Array.from(byCity.keys())) {
                geocodeCity(city).then(coords => {
                    if (!coords || !mapInstance.current) return;
                    const cityStudios = byCity.get(city) || [];
                    const color = CAT_COLORS[cityStudios[0]?.business_type || "other"] || "#64748b";

                    const icon = L.divIcon({
                        html: `<div style="background:${color};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)">${cityStudios.length}</div>`,
                        className: "", iconSize: [32, 32],
                    });

                    const popup = cityStudios.map(s =>
                        `<div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #f1f5f9">
                            <strong style="font-size:13px">${s.name}</strong><br/>
                            <span style="font-size:11px;color:#64748b">${s.business_type_label}</span><br/>
                            <a href="/b/${s.slug}" style="font-size:11px;color:#7c3aed">צפה בפרופיל ↗</a>
                        </div>`
                    ).join("");

                    L.marker(coords, { icon })
                        .addTo(mapInstance.current!)
                        .bindPopup(`<div dir="rtl" style="min-width:160px">${popup}</div>`);
                });
            }
        }).catch(() => {});

        return () => {
            if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
        };
    }, [studios]);

    return (
        <div style={{ borderRadius: 20, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <div ref={mapRef} style={{ height: 340, width: "100%" }} />
        </div>
    );
}
