import "./globals.css";
import InstallButton from "@/components/InstallButton";
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
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <QueryProvider>
          <LanguageProvider>
            <ToastProvider>
              {children}
              <InstallButton />
            </ToastProvider>
          </LanguageProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
