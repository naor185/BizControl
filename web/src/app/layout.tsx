import "./globals.css";
import InstallButton from "@/components/InstallButton";
import { LanguageProvider } from "@/components/LanguageProvider";
import { ToastProvider } from "@/components/ui/toast";
import { QueryProvider } from "@/components/QueryProvider";

export const metadata = {
  title: "BizControl",
  description: "Studio CRM",
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
    shortcut: "/logo.png",
  },
};

export const viewport = {
  themeColor: "#000000",
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
