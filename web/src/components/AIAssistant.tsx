"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { apiFetch, API_BASE, getToken } from "@/lib/api";

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    tools?: string[];
    streaming?: boolean;
};

type Suggestions = { suggestions: string[] };

const PAGE_LABELS: Record<string, string> = {
    "/dashboard": "לוח בקרה",
    "/calendar": "יומן",
    "/clients": "לקוחות",
    "/appointments": "תורים",
    "/payments": "תשלומים",
    "/expenses": "הוצאות",
    "/products": "מוצרים",
    "/team": "צוות",
    "/wallet": "עיצוב כרטיס מועדון",
    "/automation": "אוטומציה",
    "/tiers": "רמות חברות",
    "/stamps": "כרטיסי חותמת",
    "/leads": "לידים",
    "/billing": "חיוב",
};

function getPageLabel(pathname: string): string {
    const exact = PAGE_LABELS[pathname];
    if (exact) return exact;
    for (const [key, label] of Object.entries(PAGE_LABELS)) {
        if (pathname.startsWith(key + "/")) return label;
    }
    return pathname;
}

function TypingDots() {
    return (
        <div className="flex items-center gap-1 px-1 py-0.5">
            {[0, 1, 2].map(i => (
                <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-indigo-400"
                    style={{
                        animation: `ai-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                />
            ))}
        </div>
    );
}

function ToolBadge({ name }: { name: string }) {
    const labels: Record<string, string> = {
        get_today_appointments: "📅 תורים",
        get_monthly_revenue: "💰 הכנסות",
        search_client: "🔍 לקוח",
        get_dashboard_stats: "📊 סטטיסטיקות",
        get_wallet_status: "💳 Wallet",
        get_inactive_clients: "👥 לקוחות לא פעילים",
        get_top_artists: "🎨 עובדים",
        get_system_help: "📖 עזרה",
    };
    return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
            {labels[name] || name}
        </span>
    );
}

function MessageBubble({ msg }: { msg: Message }) {
    const isUser = msg.role === "user";
    return (
        <div className={`flex ${isUser ? "justify-start" : "justify-end"} gap-2`}>
            {!isUser && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 mt-auto"
                    style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}>
                    ✨
                </div>
            )}
            <div className={`max-w-[82%] space-y-1`}>
                <div
                    className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        isUser
                            ? "bg-indigo-600 text-white rounded-bl-sm"
                            : "bg-white border border-slate-100 text-slate-800 rounded-br-sm shadow-sm"
                    }`}
                >
                    {msg.streaming && !msg.content ? <TypingDots /> : msg.content}
                </div>
                {msg.tools && msg.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-1">
                        {msg.tools.map(t => <ToolBadge key={t} name={t} />)}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function AIAssistant() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [hasUnread, setHasUnread] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Load suggestions once
    useEffect(() => {
        apiFetch<Suggestions>("/api/ai/suggestions")
            .then(s => setSuggestions(s.suggestions))
            .catch(() => {});
    }, []);

    // Scroll to bottom on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Focus input when opened
    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 100);
            setHasUnread(false);
        }
    }, [open]);

    const sendMessage = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || loading) return;

        setInput("");
        const userMsg: Message = { id: Date.now().toString(), role: "user", content: trimmed };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);

        const aiMsgId = `ai-${Date.now()}`;
        setMessages(prev => [...prev, { id: aiMsgId, role: "assistant", content: "", streaming: true }]);

        abortRef.current = new AbortController();

        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/api/ai/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    message: trimmed,
                    conversation_id: conversationId,
                    current_page: getPageLabel(pathname || ""),
                }),
                signal: abortRef.current.signal,
            });

            if (!res.ok || !res.body) {
                throw new Error("שגיאה בחיבור לעוזר");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = "";
            const toolsUsed: string[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n");

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const data = line.slice(6).trim();
                    if (data === "[DONE]") break;

                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.type === "conversation_id") {
                            setConversationId(parsed.id);
                        } else if (parsed.type === "text") {
                            accumulated += parsed.content;
                            setMessages(prev => prev.map(m =>
                                m.id === aiMsgId
                                    ? { ...m, content: accumulated, streaming: true }
                                    : m
                            ));
                        } else if (parsed.type === "tool") {
                            if (!toolsUsed.includes(parsed.name)) toolsUsed.push(parsed.name);
                        }
                    } catch { /* ignore parse errors */ }
                }
            }

            setMessages(prev => prev.map(m =>
                m.id === aiMsgId
                    ? { ...m, content: accumulated, streaming: false, tools: toolsUsed }
                    : m
            ));

            if (!open) setHasUnread(true);

        } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === "AbortError";
            setMessages(prev => prev.map(m =>
                m.id === aiMsgId
                    ? {
                        ...m,
                        content: isAbort ? "הופסק." : "שגיאה בחיבור לעוזר AI. נסה שוב.",
                        streaming: false,
                    }
                    : m
            ));
        } finally {
            setLoading(false);
        }
    }, [loading, conversationId, pathname, open]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    const handleStop = () => {
        abortRef.current?.abort();
    };

    const handleNewChat = () => {
        setConversationId(null);
        setMessages([]);
    };

    const showSuggestions = messages.length === 0 && suggestions.length > 0;

    return (
        <>
            {/* CSS animations */}
            <style>{`
                @keyframes ai-bounce {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
                    30% { transform: translateY(-4px); opacity: 1; }
                }
                @keyframes ai-slide-up {
                    from { opacity: 0; transform: translateY(16px) scale(0.97); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes ai-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .ai-panel { animation: ai-slide-up 0.2s ease-out; }
                .ai-msg { animation: ai-fade-in 0.15s ease-out; }
            `}</style>

            {/* Floating button */}
            <button
                onClick={() => setOpen(o => !o)}
                className="fixed bottom-20 left-4 md:bottom-6 md:left-6 z-50 w-13 h-13 rounded-2xl shadow-xl flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95"
                style={{
                    width: 52,
                    height: 52,
                    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                    boxShadow: "0 8px 32px -4px rgba(79,70,229,0.5), 0 0 0 3px rgba(79,70,229,0.15)",
                }}
                aria-label="פתח עוזר AI"
            >
                {open ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                ) : (
                    <>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7v2a7 7 0 0 1-7 7H10a7 7 0 0 1-7-7v-2a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                            <circle cx="9" cy="13" r="1" fill="white" stroke="none" />
                            <circle cx="15" cy="13" r="1" fill="white" stroke="none" />
                        </svg>
                        {hasUnread && (
                            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
                        )}
                    </>
                )}
            </button>

            {/* Chat panel */}
            {open && (
                <div
                    dir="rtl"
                    className="ai-panel fixed z-50 bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-100"
                    style={{
                        bottom: 84,
                        left: 16,
                        width: "min(420px, calc(100vw - 32px))",
                        height: "min(600px, calc(100vh - 120px))",
                    }}
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between px-4 py-3 shrink-0"
                        style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-black text-xs">
                                ✨
                            </div>
                            <div>
                                <div className="text-white font-bold text-sm leading-none">ויקי</div>
                                <div className="text-white/60 text-[10px] mt-0.5">העוזרת האישית שלך</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {messages.length > 0 && (
                                <button
                                    onClick={handleNewChat}
                                    className="text-white/70 hover:text-white text-[11px] font-medium bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-lg transition-colors"
                                >
                                    שיחה חדשה
                                </button>
                            )}
                            <a
                                href="https://wa.me/972528518805?text=%D7%A9%D7%9C%D7%95%D7%9D%2C%20%D7%90%D7%A0%D7%99%20%D7%A6%D7%A8%D7%99%D7%9A%20%D7%A2%D7%96%D7%A8%D7%94%20%D7%A2%D7%9D%20BizControl"
                                target="_blank"
                                rel="noopener noreferrer"
                                title="שירות לקוחות"
                                className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                </svg>
                            </a>
                            <button
                                onClick={() => setOpen(false)}
                                className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
                        {showSuggestions ? (
                            <div className="space-y-4">
                                {/* Welcome bubble */}
                                <div className="flex justify-end gap-2 pt-1">
                                    <div className="max-w-[88%]">
                                        <div className="rounded-2xl rounded-br-sm px-4 py-3 bg-white border border-slate-100 shadow-sm text-sm text-slate-800 leading-relaxed">
                                            היי, שלום לך! 👋<br />
                                            אני <strong>ויקי</strong>, העוזרת האישית שלך.<br />
                                            תוכל להתייעץ איתי על כל דבר שקשור למערכת ואעזור לך בשמחה.<br /><br />
                                            <span className="text-slate-500">איך אפשר לעזור לך?</span>
                                        </div>
                                    </div>
                                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 mt-auto"
                                        style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}>
                                        ✨
                                    </div>
                                </div>

                                {/* Quick template buttons */}
                                <div className="space-y-1.5">
                                    <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide px-1">שאלות נפוצות</p>
                                    <div className="grid grid-cols-1 gap-1.5">
                                        {suggestions.slice(0, 5).map((q, i) => (
                                            <button
                                                key={i}
                                                onClick={() => sendMessage(q)}
                                                className="text-right text-sm px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 transition-all shadow-sm flex items-center gap-2"
                                            >
                                                <span className="text-base leading-none shrink-0">
                                                    {["💰","📅","👥","💳","❓"][i] ?? "💬"}
                                                </span>
                                                <span className="truncate">{q}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            messages.map(msg => (
                                <div key={msg.id} className="ai-msg">
                                    <MessageBubble msg={msg} />
                                </div>
                            ))
                        )}
                        <div ref={bottomRef} />
                    </div>

                    {/* Input */}
                    <div className="shrink-0 border-t border-slate-100 bg-white p-3">
                        <div className="flex items-end gap-2">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="שאל שאלה על העסק..."
                                rows={1}
                                disabled={loading}
                                className="flex-1 resize-none rounded-xl border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 bg-slate-50 disabled:opacity-50 transition max-h-28 overflow-y-auto leading-relaxed"
                                style={{ minHeight: 42 }}
                                onInput={e => {
                                    const el = e.currentTarget;
                                    el.style.height = "auto";
                                    el.style.height = Math.min(el.scrollHeight, 112) + "px";
                                }}
                            />
                            {loading ? (
                                <button
                                    onClick={handleStop}
                                    className="shrink-0 w-10 h-10 rounded-xl bg-red-100 hover:bg-red-200 text-red-600 flex items-center justify-center transition-colors"
                                    title="הפסק"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="4" y="4" width="16" height="16" rx="2" />
                                    </svg>
                                </button>
                            ) : (
                                <button
                                    onClick={() => sendMessage(input)}
                                    disabled={!input.trim()}
                                    className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                                    style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="22" y1="2" x2="11" y2="13" />
                                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                    </svg>
                                </button>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-400 text-center mt-1.5">
                            ויקי · AI · נתונים בזמן אמת מהמערכת
                        </p>
                    </div>
                </div>
            )}
        </>
    );
}
