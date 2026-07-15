"use client";
import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function AutoLoginInner() {
    const router = useRouter();
    const params = useSearchParams();

    useEffect(() => {
        const code = params.get("code");
        const rawNext = params.get("next");
        // Only allow same-app relative paths — a bare "/x" — never an absolute
        // or protocol-relative URL, which could redirect off-site after login
        // (open-redirect phishing vector).
        const dest = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/onboarding";

        if (!code) {
            router.replace("/login");
            return;
        }

        // Exchange the one-time code for a real JWT — code never stays in history
        fetch(`${API}/api/auth/use-handoff`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
        })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(data => {
                localStorage.setItem("bizcontrol_token", data.access_token);
                localStorage.removeItem("biz_studio_token");
                router.replace(dest);
            })
            .catch(() => router.replace("/login"));
    }, [params, router]);

    return (
        <div style={{
            minHeight: "100vh", display: "flex", alignItems: "center",
            justifyContent: "center", background: "#f8fafc",
            fontFamily: "system-ui, sans-serif", flexDirection: "column", gap: "1rem",
        }}>
            <div style={{
                width: 48, height: 48, borderRadius: "50%",
                border: "4px solid #e2e8f0", borderTopColor: "#7c3aed",
                animation: "spin 0.8s linear infinite",
            }} />
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>מתחבר לחשבון שלך...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

export default function AutoLoginPage() {
    return (
        <Suspense fallback={null}>
            <AutoLoginInner />
        </Suspense>
    );
}
