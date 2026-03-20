export default function Table({
    columns,
    rows,
}: {
    columns: { key: string; label: string }[];
    rows: Record<string, any>[];
}) {
    return (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                    <tr>
                        {columns.map((c) => (
                            <th key={c.key} className="px-4 py-3 text-right font-medium">
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, idx) => (
                        <tr key={idx} className="border-t">
                            {columns.map((c) => (
                                <td key={c.key} className="px-4 py-3">
                                    {String(r[c.key] ?? "")}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
