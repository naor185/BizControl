// Shapes returned by /api/migrations (app/api/migration_routes.py).

export type ConnectorEntity = { key: string; label: string; importable: boolean };

export type Connector = {
    slug: string;
    name: string;
    icon: string;
    version: string;
    auth_type: string;
    description: string;
    requires_mapping: boolean;
    entities: ConnectorEntity[];
    unsupported: string[];
};

export type MigrationStatus = "draft" | "scanning" | "preview" | "importing" | "completed" | "partial" | "failed" | "rolled_back";

export type Counts = {
    total: number;
    scanned: number;
    match: Record<string, number>;
    decision: Record<string, number>;
    result: Record<string, number>;
    warnings: number;
};

export type MigrationSummary = {
    id: string;
    code: string;
    source: string;
    source_name: string;
    entity_type: string;
    entity_label: string;
    status: MigrationStatus;
    file_name: string | null;
    error: string | null;
    created_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    rolled_back_at: string | null;
    row_count: number;
    summary: (Counts & { rollback?: RollbackStats }) | null;
};

export type ColumnSuggestion = {
    index: number;
    column: string;
    samples: (string | null)[];
    target: string | null;
    suggested?: string | null;
    confidence: number;
    status: "auto" | "review" | "none" | "empty";
    reason: string;
    date_order?: string | null;
};

export type FieldDef = { key: string; label: string; kind: string; required: boolean; multi: boolean; help: string };

export type MigrationOptions = {
    existing_action: "fill_empty" | "skip";
    date_order: "DMY" | "MDY" | "YMD" | null;
};

export type MigrationDetail = MigrationSummary & {
    headers: string[];
    suggestions: ColumnSuggestion[];
    mapping: Record<string, string>;
    options: MigrationOptions;
    dropped: { column: string; reason: string }[];
    source_info: Record<string, unknown>;
    fields: FieldDef[];
    counts: Counts;
    raw_purged: boolean;
};

export type RowIssue = { field: string; code: string; level: "error" | "warning" | "info"; message: string };

export type MigrationRowOut = {
    id: string;
    row_number: number;
    data: Record<string, unknown> | null;
    issues: RowIssue[];
    match_status: string | null;
    match_reason: string | null;
    decision: "create" | "merge" | "skip" | null;
    status: string;
    action: string | null;
    error: string | null;
    target: Record<string, unknown> | null;
    local: Record<string, unknown> | null;
};

export type RollbackStats = { deleted: number; restored_fields: number; kept_used: number; kept_edited: number; kept_fields: number };

export const MATCH_LABELS: Record<string, string> = {
    new: "חדשים",
    existing: "כבר קיימים",
    possible_duplicate: "אולי כפילות",
    conflict: "סתירה",
    invalid: "חסרים נתונים",
};

export const STATUS_LABELS: Record<MigrationStatus, string> = {
    draft: "מיפוי שדות",
    scanning: "סורק",
    preview: "תצוגה מקדימה",
    importing: "מייבא",
    completed: "הושלם",
    partial: "הושלם חלקית",
    failed: "נעצר",
    rolled_back: "בוטל",
};

export function fmtDateTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
