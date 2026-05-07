import "./globals.css";
import InstallButton from "@/components/InstallButton";
import { LanguageProvider } from "@/components/LanguageProvider";

export const metadata = {
  title: "BizControl",
  description: "Studio CRM",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <LanguageProvider>
          {children}
          <InstallButton />
        </LanguageProvider>
      </body>
    </html>
  );
}
