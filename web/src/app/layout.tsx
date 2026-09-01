import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";
import { ToastProvider } from "@/components/ui/toast";
import { QueryProvider } from "@/components/QueryProvider";

export const metadata = {
  title: "BizControl",
  description: "Studio CRM",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BizControl",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
    shortcut: "/icons/icon-192.png",
  },
};

export const viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom was enabled (maximumScale: 5) on an app-like dashboard UI
  // (already configured as appleWebApp-capable, and now wrapped in a native
  // Capacitor shell) — native apps don't pinch-zoom their own chrome, and a
  // resize mid-gesture was crashing the whole page with an unhandled
  // client-side exception (almost certainly a chart/ResizeObserver-based
  // component choking on a transient zero/negative size during the pinch).
  // Disabling zoom removes the crash trigger entirely and matches how a
  // real app behaves.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <QueryProvider>
          <LanguageProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </LanguageProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
