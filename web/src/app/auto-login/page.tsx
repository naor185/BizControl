"use client";
import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Receives ?t=JWT_TOKEN from BizFind, stores it as bizcontrol_token, redirects to onboarding
function AutoLoginInner() {
    const router = useRouter();
    const params = useSearchParams();

    useEffect(() => {
        const token = params.get("t");
        const dest  = params.get("next") || "/onboarding";

        if (!token) {
            router.replace("/login");
            return;
        }

        // Store token in BizControl's expected key
        localStorage.setItem("bizcontrol_token", token);
        // Also clear any stale BizFind key to avoid confusion
        localStorage.removeItem("biz_studio_token");

        router.replace(dest);
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
