"use client";
import { useEffect } from "react";
import { getStudioToken, goToBizControl } from "@/lib/handoff";

// Business management now lives only in BizControl — this route stays in
// place just so old bookmarks/links land somewhere useful instead of a 404.
export default function StudioDashboardRedirect() {
    useEffect(() => {
        if (getStudioToken()) {
            goToBizControl("/dashboard");
        } else {
            window.location.href = "/studio/login";
        }
    }, []);

    return (
        <div style={{
            minHeight: "100vh", display: "flex", alignItems: "center",
            justifyContent: "center", background: "#f8fafc",
            fontFamily: "system-ui, sans-serif", flexDirection: "column", gap: "1rem",
        }}>
            <div style={{
                width: 44, height: 44, borderRadius: "50%",
                border: "4px solid #ede9fe", borderTopColor: "#7c3aed",
                animation: "spin .8s linear infinite",
            }} />
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>מעביר אותך ל-BizControl...</p>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}
