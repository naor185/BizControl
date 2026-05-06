"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

type Conversation = {
    phone: string;
    name: string | null;
    client_id: string | null;
    client_name: string | null;
    last_message: string;
    last_received_at: string;
    unread_count: number;
};

type Message = {
    id: string;
    body: string;
    direction: "in" | "out";
    sent_at: string;
    is_read: boolean;
};

function formatTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

export default function InboxPage() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [replyText, setReplyText] = useState("");
    const [sending, setSending] = useState(false);
    const [loadingConvs, setLoadingConvs] = useState(true);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [sendErr, setSendErr] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadConversations = useCallback(async () => {
        try {
            const data = await apiFetch<Conversation[]>("/api/inbox/conversations");
            setConversations(data);
        } catch {
            // silent
        } finally {
            setLoadingConvs(false);
        }
    }, []);

    const loadMessages = useCallback(async (phone: string) => {
        setLoadingMsgs(true);
        try {
            const data = await apiFetch<Message[]>(`/api/inbox/messages/${encodeURIComponent(phone)}`);
            setMessages(data);
            // Mark as read locally
            setConversations(prev => prev.map(c => c.phone === phone ? { ...c, unread_count: 0 } : c));
        } catch {
            // silent
        } finally {
            setLoadingMsgs(false);
        }
    }, []);

    useEffect(() => {
        loadConversations();
        pollRef.current = setInterval(loadConversations, 15000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [loadConversations]);

    useEffect(() => {
        if (selectedPhone) loadMessages(selectedPhone);
    }, [selectedPhone, loadMessages]);

    // Auto-poll new messages in open conversation
    useEffect(() => {
        if (!selectedPhone) return;
        const t = setInterval(() => loadMessages(selectedPhone), 10000);
        return () => clearInterval(t);
    }, [selectedPhone, loadMessages]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = async () => {
        if (!replyText.trim() || !selectedPhone) return;
        setSending(true);
        setSendErr(null);
        try {
            await apiFetch("/api/inbox/reply", {
                method: "POST",
                body: JSON.stringify({ phone: selectedPhone, body: replyText.trim() }),
            });
            setReplyText("");
            await loadMessages(selectedPhone);
            await loadConversations();
        } catch (e: any) {
            setSendErr(e?.message || "שגיאה בשליחה");
        } finally {
            setSending(false);
        }
    };

    const selected = conversations.find(c => c.phone === selectedPhone);
    const displayName = selected?.client_name || selected?.name || selectedPhone;

    return (
        <RequireAuth>
            <AppShell title="תיבת הודעות">
                <div className="flex h-[calc(100vh-5rem)] overflow-hidden">

                    {/* Conversations list */}
                    <div className="w-80 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col">
                        <div className="p-4 border-b border-slate-100">
                            <h2 className="font-bold text-slate-800 text-lg">שיחות</h2>
                            <p className="text-xs text-slate-500 mt-0.5">הודעות נכנסות מוואטסאפ</p>
                        </div>

                        {loadingConvs ? (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="animate-spin h-6 w-6 border-2 border-slate-300 border-t-slate-700 rounded-full" />
                            </div>
                        ) : conversations.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
                                <span className="text-5xl">💬</span>
                                <p className="text-sm text-slate-500">אין שיחות עדיין.</p>
                                <p className="text-xs text-slate-400">הודעות יופיעו כאן כשלקוחות יענו.</p>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto">
                                {conversations.map(conv => (
                                    <button
                                        key={conv.phone}
                                        onClick={() => setSelectedPhone(conv.phone)}
                                        className={`w-full text-right px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-start gap-3 ${selectedPhone === conv.phone ? "bg-blue-50 border-r-2 border-r-blue-500" : ""}`}
                                    >
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center flex-shrink-0 text-slate-600 font-bold text-sm">
                                            {(conv.client_name || conv.name || conv.phone).charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-slate-800 text-sm truncate">
                                                    {conv.client_name || conv.name || conv.phone}
                                                </span>
                                                <span className="text-[10px] text-slate-400 flex-shrink-0 mr-1">
                                                    {formatTime(conv.last_received_at)}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between mt-0.5">
                                                <span className="text-xs text-slate-500 truncate flex-1">{conv.last_message}</span>
                                                {conv.unread_count > 0 && (
                                                    <span className="bg-green-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 mr-1 flex-shrink-0">
                                                        {conv.unread_count}
                                                    </span>
                                                )}
                                            </div>
                                            {conv.client_name && (
                                                <span className="text-[10px] text-blue-500 dir-ltr">{conv.phone}</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Chat area */}
                    {!selectedPhone ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-50">
                            <div className="w-20 h-20 rounded-full bg-white shadow-lg flex items-center justify-center text-4xl">💬</div>
                            <h3 className="font-bold text-slate-700 text-xl">בחר שיחה</h3>
                            <p className="text-slate-500 text-sm">בחר שיחה מהרשימה משמאל כדי לצפות בהודעות ולענות</p>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col bg-slate-50 min-w-0">

                            {/* Chat header */}
                            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                                    {(displayName || "?").charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-bold text-slate-800">{displayName}</div>
                                    {selected?.client_name && (
                                        <div className="text-xs text-slate-400" dir="ltr">{selected.phone}</div>
                                    )}
                                    {selected?.client_id && (
                                        <a href={`/clients/${selected.client_id}`}
                                            className="text-xs text-blue-500 hover:underline">
                                            צפה בפרופיל לקוח ←
                                        </a>
                                    )}
                                </div>
                                <div className="mr-auto flex items-center gap-2 text-xs text-slate-400">
                                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
                                    מתרענן כל 10 שניות
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                                {loadingMsgs ? (
                                    <div className="flex justify-center py-10">
                                        <div className="animate-spin h-6 w-6 border-2 border-slate-300 border-t-slate-700 rounded-full" />
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="text-center text-slate-400 py-10 text-sm">אין הודעות עדיין</div>
                                ) : (
                                    messages.map((msg, i) => {
                                        const isOut = msg.direction === "out";
                                        const showDate = i === 0 || new Date(messages[i - 1].sent_at).toDateString() !== new Date(msg.sent_at).toDateString();
                                        return (
                                            <div key={msg.id}>
                                                {showDate && (
                                                    <div className="text-center my-3">
                                                        <span className="text-[10px] text-slate-400 bg-slate-200 px-3 py-1 rounded-full">
                                                            {new Date(msg.sent_at).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className={`flex ${isOut ? "justify-start" : "justify-end"}`}>
                                                    <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm shadow-sm whitespace-pre-wrap ${
                                                        isOut
                                                            ? "bg-white text-slate-800 rounded-tr-sm border border-slate-100"
                                                            : "bg-green-500 text-white rounded-tl-sm"
                                                    }`}>
                                                        {msg.body}
                                                        <div className={`text-[10px] mt-1 ${isOut ? "text-slate-400" : "text-green-100"} text-left`}>
                                                            {formatTime(msg.sent_at)}
                                                            {isOut && <span className="mr-1">✓✓</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Reply box */}
                            <div className="bg-white border-t border-slate-200 p-4">
                                {sendErr && (
                                    <div className="text-xs text-red-500 bg-red-50 px-3 py-1.5 rounded-lg mb-2">{sendErr}</div>
                                )}
                                <div className="flex items-end gap-3">
                                    <textarea
                                        value={replyText}
                                        onChange={e => setReplyText(e.target.value)}
                                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                        placeholder="כתוב הודעה... (Enter לשליחה, Shift+Enter לשורה חדשה)"
                                        rows={2}
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 text-sm resize-none"
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={sending || !replyText.trim()}
                                        className="w-12 h-12 bg-green-500 hover:bg-green-600 disabled:bg-slate-300 text-white rounded-2xl flex items-center justify-center transition-colors flex-shrink-0 shadow-md"
                                    >
                                        {sending ? (
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <svg className="w-5 h-5 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
