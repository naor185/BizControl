"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaStatus {
    connected: boolean;
    status: string;
    instance_id: string | null;
    phone_number: string | null;
    managed: boolean;
    last_connected_at: string | null;
    messages_this_month: number;
}

interface QrData {
    type: "qr" | "already_connected" | string;
    qr_base64?: string;
    phone_number?: string;
    message?: string;
}

type SetupTab = "qr" | "manual";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
    authorized: "מחובר",
    notAuthorized: "לא מחובר",
    blocked: "חסום",
    sleepMode: "מצב שינה",
    starting: "מתחיל...",
    not_configured: "לא מוגדר",
    disconnected: "מנותק",
    unknown: "לא ידוע",
};

function PhoneDisplay({ phone }: { phone: string | null }) {
    if (!phone) return null;
    const clean = phone.replace(/^972/, "0");
    return <span dir="ltr">{clean}</span>;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function WhatsAppPage() {
    const [status, setStatus] = useState<WaStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [setupTab, setSetupTab] = useState<SetupTab>("qr");
    const [qrData, setQrData] = useState<QrData | null>(null);
    const [qrLoading, setQrLoading] = useState(false);
    const [qrError, setQrError] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Manual creds
    const [instanceId, setInstanceId] = useState("");
    const [apiToken, setApiToken] = useState("");
    const [savingCreds, setSavingCreds] = useState(false);
    const [credsErr, setCredsErr] = useState<string | null>(null);

    // Test send
    const [testPhone, setTestPhone] = useState("");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

    const loadStatus = useCallback(async () => {
        try {
            const s = await apiFetch<WaStatus>("/api/whatsapp/status");
            setStatus(s);
            return s;
        } catch { return null; }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    // Poll for connection when QR is shown
    const startPolling = useCallback(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
            const s = await loadStatus();
            if (s?.connected) {
                if (pollRef.current) clearInterval(pollRef.current);
                setQrData(null);
            }
        }, 4000);
    }, [loadStatus]);

    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    const fetchQr = async () => {
        setQrLoading(true); setQrError(null); setQrData(null);
        try {
            const data = await apiFetch<QrData>("/api/whatsapp/qr");
            setQrData(data);
            if (data.type === "qr") startPolling();
            else loadStatus();
        } catch (e: unknown) {
            setQrError((e as Error).message);
        } finally { setQrLoading(false); }
    };

    const disconnect = async () => {
        if (!confirm("לנתק את WhatsApp מהעסק?")) return;
        setDisconnecting(true);
        try {
            await apiFetch("/api/whatsapp/disconnect", { method: "POST" });
            setStatus(null);
            setQrData(null);
            if (pollRef.current) clearInterval(pollRef.current);
            loadStatus();
        } catch (e: unknown) { alert((e as Error).message); }
        finally { setDisconnecting(false); }
    };

    const saveCreds = async () => {
        if (!instanceId.trim() || !apiToken.trim()) { setCredsErr("Instance ID ו-Token נדרשים"); return; }
        setSavingCreds(true); setCredsErr(null);
        try {
            const r = await apiFetch<{ ok: boolean; status: string; connected: boolean }>("/api/whatsapp/save-credentials", {
                method: "POST",
                body: JSON.stringify({ instance_id: instanceId.trim(), api_token: apiToken.trim() }),
            });
            if (r.connected) {
                loadStatus();
            } else {
                loadStatus();
                setSetupTab("qr");
                fetchQr();
            }
        } catch (e: unknown) { setCredsErr((e as Error).message); }
        finally { setSavingCreds(false); }
    };

    const handleTest = async () => {
        if (!testPhone.trim()) return;
        setTesting(true); setTestResult(null);
        try {
            await apiFetch("/api/studio/automation/test-whatsapp", {
                method: "POST",
                body: JSON.stringify({ phone: testPhone.trim() }),
            });
            setTestResult({ ok: true, msg: "✅ ההודעה נשלחה בהצלחה!" });
        } catch (e: unknown) {
            setTestResult({ ok: false, msg: (e as Error).message || "שגיאה בשליחה" });
        } finally { setTesting(false); }
    };

    const isConnected = status?.connected ?? false;

    return (
        <RequireAuth>
            <AppShell title="💬 WhatsApp">
                <div className="max-w-2xl mx-auto pb-16 space-y-6" dir="rtl">

                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500" />
                        </div>
                    ) : isConnected ? (
                        /* ── CONNECTED STATE ── */
                        <ConnectedPanel
                            status={status!}
                            onDisconnect={disconnect}
                            disconnecting={disconnecting}
                            testPhone={testPhone}
                            setTestPhone={setTestPhone}
                            onTest={handleTest}
                            testing={testing}
                            testResult={testResult}
                        />
                    ) : (
                        /* ── SETUP STATE ── */
                        <div className="space-y-5">
                            {/* Header */}
                            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 flex items-center gap-4">
                                <div className="text-3xl">🔴</div>
                                <div>
                                    <div className="font-bold text-rose-800">WhatsApp לא מחובר</div>
                                    <div className="text-sm text-rose-600 mt-0.5">
                                        {status?.status ? STATUS_LABEL[status.status] || status.status : ""}
                                        — חבר כדי לשלוח הודעות אוטומטיות ותזכורות
                                    </div>
                                </div>
                            </div>

                            {/* Setup tabs */}
                            <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
                                {(["qr", "manual"] as SetupTab[]).map(t => (
                                    <button key={t} type="button" onClick={() => setSetupTab(t)}
                                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${setupTab === t ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                                        {t === "qr" ? "📱 חיבור QR" : "⚙️ הגדרות ידניות"}
                                    </button>
                                ))}
                            </div>

                            {setupTab === "qr" && (
                                <QrPanel
                                    qrData={qrData} qrLoading={qrLoading} qrError={qrError}
                                    onFetchQr={fetchQr}
                                    instanceId={instanceId} setInstanceId={setInstanceId}
                                    apiToken={apiToken} setApiToken={setApiToken}
                                    onSaveCreds={saveCreds} savingCreds={savingCreds} credsErr={credsErr}
                                />
                            )}

                            {setupTab === "manual" && (
                                <ManualPanel
                                    instanceId={instanceId} setInstanceId={setInstanceId}
                                    apiToken={apiToken} setApiToken={setApiToken}
                                    onSave={saveCreds} saving={savingCreds} err={credsErr}
                                />
                            )}
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}

// ── Connected Panel ───────────────────────────────────────────────────────────

function ConnectedPanel({ status, onDisconnect, disconnecting, testPhone, setTestPhone, onTest, testing, testResult }: {
    status: WaStatus; onDisconnect: () => void; disconnecting: boolean;
    testPhone: string; setTestPhone: (v: string) => void;
    onTest: () => void; testing: boolean; testResult: { ok: boolean; msg: string } | null;
}) {
    return (
        <div className="space-y-5">
            {/* Status card */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-2xl">💬</div>
                        <div>
                            <div className="font-bold text-slate-800 text-lg">WhatsApp מחובר</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-sm text-emerald-600 font-semibold">פעיל</span>
                            </div>
                        </div>
                    </div>
                    <button type="button" onClick={onDisconnect} disabled={disconnecting}
                        className="px-4 py-2 text-sm font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors disabled:opacity-50">
                        {disconnecting ? "מנתק..." : "🔌 נתק"}
                    </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <InfoBox label="מספר מחובר" value={status.phone_number
                        ? status.phone_number.replace(/^972/, "0")
                        : "—"} />
                    <InfoBox label="הודעות החודש" value={status.messages_this_month.toLocaleString()} />
                    <InfoBox label="חיבור אחרון"
                        value={status.last_connected_at
                            ? new Date(status.last_connected_at).toLocaleDateString("he-IL")
                            : "—"} />
                </div>

                {status.managed && (
                    <div className="mt-3 text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-1.5">
                        ✨ Instance מנוהל על ידי BizControl
                    </div>
                )}
            </div>

            {/* Test message */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h3 className="font-bold text-slate-800 mb-3">🧪 בדיקת שליחה</h3>
                <div className="flex gap-2">
                    <input value={testPhone} onChange={e => setTestPhone(e.target.value)} type="tel"
                        placeholder="050-0000000" dir="ltr"
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400" />
                    <button type="button" onClick={onTest} disabled={testing || !testPhone.trim()}
                        className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors">
                        {testing ? "שולח..." : "שלח בדיקה"}
                    </button>
                </div>
                {testResult && (
                    <p className={`text-sm mt-2 font-medium ${testResult.ok ? "text-emerald-600" : "text-rose-600"}`}>
                        {testResult.msg}
                    </p>
                )}
            </div>

            {/* Webhook info */}
            <WebhookBox instanceId={status.instance_id || ""} />
        </div>
    );
}

// ── QR Panel ──────────────────────────────────────────────────────────────────

function QrPanel({ qrData, qrLoading, qrError, onFetchQr, instanceId, setInstanceId, apiToken, setApiToken, onSaveCreds, savingCreds, credsErr }: {
    qrData: QrData | null; qrLoading: boolean; qrError: string | null; onFetchQr: () => void;
    instanceId: string; setInstanceId: (v: string) => void;
    apiToken: string; setApiToken: (v: string) => void;
    onSaveCreds: () => void; savingCreds: boolean; credsErr: string | null;
}) {
    const hasPartner = false; // Would be set via env check from backend

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
            <div>
                <h2 className="text-lg font-black text-slate-800">חיבור דרך QR Code</h2>
                <p className="text-sm text-slate-500 mt-1">סרוק את הקוד מהאפליקציה של WhatsApp במכשיר שלך</p>
            </div>

            {/* QR Display */}
            {!qrData && (
                <div className="text-center py-6">
                    <div className="text-5xl mb-4">📱</div>
                    <p className="text-sm text-slate-500 mb-5">
                        לפני שתלחץ "הצג QR", יש להזין Instance ID ו-API Token מחשבון Green API שלך:
                    </p>
                    <div className="space-y-3 text-right mb-5">
                        <div>
                            <label className={lbl}>Instance ID</label>
                            <input value={instanceId} onChange={e => setInstanceId(e.target.value)}
                                placeholder="1234567890" dir="ltr" className={inp} />
                        </div>
                        <div>
                            <label className={lbl}>API Token</label>
                            <input value={apiToken} onChange={e => setApiToken(e.target.value)}
                                placeholder="xxxxxxxx..." dir="ltr" type="password" className={inp} />
                        </div>
                        {credsErr && <p className="text-rose-600 text-sm">{credsErr}</p>}
                    </div>
                    <button type="button" onClick={() => { onSaveCreds(); }}
                        disabled={savingCreds || !instanceId || !apiToken}
                        className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-2xl text-sm transition-colors">
                        {savingCreds ? "שומר..." : "📲 שמור והצג QR"}
                    </button>
                </div>
            )}

            {qrLoading && (
                <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto" />
                    <p className="text-sm text-slate-400 mt-3">מייצר QR Code...</p>
                </div>
            )}

            {qrError && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
                    {qrError}
                    <button type="button" onClick={onFetchQr} className="block mt-2 text-rose-600 underline font-semibold">נסה שוב</button>
                </div>
            )}

            {qrData?.type === "qr" && qrData.qr_base64 && (
                <div className="text-center">
                    <div className="inline-block bg-white border-4 border-slate-200 rounded-2xl p-3 shadow-lg">
                        <img
                            src={`data:image/png;base64,${qrData.qr_base64}`}
                            alt="QR Code"
                            className="w-56 h-56"
                        />
                    </div>
                    <p className="text-sm text-slate-500 mt-3">סרוק דרך WhatsApp → הגדרות → מכשירים מקושרים</p>
                    <p className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
                        ממתין לסריקה...
                    </p>
                </div>
            )}

            {qrData?.type === "already_connected" && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                    <div className="text-3xl mb-2">✅</div>
                    <div className="font-bold text-emerald-800">WhatsApp כבר מחובר!</div>
                    {qrData.phone_number && (
                        <div className="text-sm text-emerald-600 mt-1" dir="ltr">
                            {qrData.phone_number.replace(/^972/, "0")}
                        </div>
                    )}
                </div>
            )}

            {!qrData && instanceId && apiToken && (
                <button type="button" onClick={onFetchQr} disabled={qrLoading}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-2xl text-sm transition-colors">
                    📲 הצג QR Code
                </button>
            )}
        </div>
    );
}

// ── Manual Panel ──────────────────────────────────────────────────────────────

function ManualPanel({ instanceId, setInstanceId, apiToken, setApiToken, onSave, saving, err }: {
    instanceId: string; setInstanceId: (v: string) => void;
    apiToken: string; setApiToken: (v: string) => void;
    onSave: () => void; saving: boolean; err: string | null;
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
            <div>
                <h2 className="text-lg font-black text-slate-800">הגדרות ידניות — Green API</h2>
                <p className="text-sm text-slate-500 mt-1">
                    צור Instance ב-<a href="https://green-api.com" target="_blank" rel="noopener" className="text-emerald-600 underline">green-api.com</a> והזן את הפרטים:
                </p>
            </div>

            <div>
                <label className={lbl}>Instance ID</label>
                <input value={instanceId} onChange={e => setInstanceId(e.target.value)}
                    placeholder="1234567890" dir="ltr" className={inp} />
            </div>
            <div>
                <label className={lbl}>API Token Instance</label>
                <input value={apiToken} onChange={e => setApiToken(e.target.value)}
                    placeholder="xxxxxxxx..." dir="ltr" type="password" className={inp} />
            </div>

            {err && <p className="text-rose-600 text-sm">{err}</p>}

            <button type="button" onClick={onSave} disabled={saving || !instanceId || !apiToken}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-2xl text-sm transition-colors">
                {saving ? "שומר..." : "💾 שמור פרטי חיבור"}
            </button>

            <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
                <strong className="text-slate-800">איך יוצרים Instance ב-Green API:</strong>
                <ol className="list-decimal list-inside mt-2 space-y-1 text-slate-500">
                    <li>היכנס ל-green-api.com</li>
                    <li>לחץ "Create Instance" → בחר Free/Paid plan</li>
                    <li>העתק את Instance ID ו-API Token</li>
                    <li>הדבק כאן ולחץ "שמור"</li>
                    <li>לאחר השמירה — לחץ "חיבור QR" כדי לקשר את הטלפון שלך</li>
                </ol>
            </div>
        </div>
    );
}

// ── Webhook Info ──────────────────────────────────────────────────────────────

function WebhookBox({ instanceId }: { instanceId: string }) {
    const [copied, setCopied] = useState(false);
    const domain = process.env.NEXT_PUBLIC_API_BASE || "";
    const url = `${domain}/api/webhook/green/${instanceId || "{instance_id}"}`;

    const copy = () => {
        navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="font-bold text-slate-800 mb-3">🔗 Webhook URL</h3>
            <p className="text-xs text-slate-500 mb-3">
                הגדר כתובת זו ב-Green API → Instance Settings → Webhooks לקבלת הודעות נכנסות:
            </p>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <code className="flex-1 text-xs font-mono text-slate-600 break-all" dir="ltr">{url}</code>
                <button type="button" onClick={copy}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-slate-200 hover:bg-slate-100 transition-colors">
                    {copied ? "✓ הועתק" : "העתק"}
                </button>
            </div>
        </div>
    );
}

// ── Shared ────────────────────────────────────────────────────────────────────

function InfoBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-400 mb-1">{label}</div>
            <div className="font-bold text-slate-800 text-sm" dir="ltr">{value}</div>
        </div>
    );
}

const lbl = "block text-xs font-semibold text-slate-500 mb-1";
const inp = "w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-400";
