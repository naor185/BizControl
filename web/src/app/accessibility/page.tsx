import AccessibilityStatement from "@/components/AccessibilityStatement";

export const metadata = {
    title: "הצהרת נגישות | BizControl",
    description: "מידע על הנגישות של אתר BizControl והתאמות שבוצעו עבור אנשים עם מוגבלות.",
};

export default function AccessibilityPage() {
    return (
        <main className="min-h-screen bg-white">
            <AccessibilityStatement />
        </main>
    );
}
