export default function Topbar({ title }: { title: string }) {
    return (
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
            <div className="flex items-center justify-between px-6 py-4">
                <div>
                    <div className="text-lg font-semibold">{title}</div>
                    <div className="text-xs text-zinc-500">NC Tattoo / Test Studio</div>
                </div>

                <div className="flex items-center gap-2">
                    <button className="rounded-xl border px-3 py-2 text-sm hover:bg-zinc-50">
                        Refresh
                    </button>
                    <button className="rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white hover:opacity-90">
                        New
                    </button>
                </div>
            </div>
        </header>
    );
}
