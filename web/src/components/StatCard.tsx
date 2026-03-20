export default function StatCard({
    label,
    value,
    hint,
}: {
    label: string;
    value: string;
    hint?: string;
}) {
    return (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-zinc-500">{label}</div>
            <div className="mt-2 text-2xl font-semibold">{value}</div>
            {hint ? <div className="mt-1 text-xs text-zinc-400">{hint}</div> : null}
        </div>
    );
}
