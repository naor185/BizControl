"use client";

import { useEffect, useState } from "react";

export default function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      console.log("User accepted the install prompt");
    }
    setDeferredPrompt(null);
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        backgroundColor: "#000000",
        color: "#ffffff",
        padding: "8px 12px",
        borderRadius: "20px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        zIndex: 1000,
        fontSize: "13px",
        fontWeight: "600",
      }}
    >
      <button
        onClick={handleInstallClick}
        style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: "600", padding: 0 }}
      >
        📲 התקן אפליקציה
      </button>
      <button
        onClick={() => setIsVisible(false)}
        style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "0 0 0 4px" }}
      >
        ×
      </button>
    </div>
  );
}
