import AfterMount from "@/components/AfterMount";

// The superadmin's screens speak the language the superadmin chose (lib/i18n tx) — drawn in the browser only, like the
// signed-in screens (RequireAuth), so the server's Hebrew first page never disagrees with an English one.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return <AfterMount>{children}</AfterMount>;
}
