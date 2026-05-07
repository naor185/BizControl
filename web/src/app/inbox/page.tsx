"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

type Conversation = {
    phone: string;
    channel: string;
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
    channel: string;
};

// ── Channel config ────────────────────────────────────────────────────────────

const CHANNELS: Record<string, { label: string; icon: string; bubble: string; outBubble: string; badge: string; dot: string }> = {
    whatsapp: {
        label: "WhatsApp",
        icon: "💬",
        bubble: "bg-[#25D366] text-white",
        outBubble: "bg-white text-gray-800 border border-gray-100",
        badge: "bg-green-100 text-green-700",
        dot: "bg-green-500",
    },
    instagram: {
        label: "Instagram",
        icon: "📸",
        bubble: "bg-gradient-to-br from-purple-500 to-pink-500 text-white",
        outBubble: "bg-white text-gray-800 border border-gray-100",
        badge: "bg-pink-100 text-pink-700",
        dot: "bg-pink-500",
    },
    facebook: {
        label: "Facebook",
        icon: "👍",
        bubble: "bg-[#0084FF] text-white",
        outBubble: "bg-white text-gray-800 border border-gray-100",
        badge: "bg-blue-100 text-blue-700",
        dot: "bg-blue-500",
    },
};

const ch = (channel: string) => CHANNELS[channel] ?? CHANNELS.whatsapp;

const FILTER_TABS = [
    { key: "all",       label: "הכל",      icon: "📥" },
    { key: "whatsapp",  label: "WhatsApp", icon: "💬" },
    { key: "instagram", label: "Instagram", icon: "📸" },
    { key: "facebook",  label: "Facebook", icon: "👍" },
];

function formatTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
        return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function convKey(c: Conversation) { return `${c.channel}:${c.phone}`; }

export default function InboxPage() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [filterChannel, setFilterChannel] = useState("all");
    const [selected, setSelected] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [replyText, setReplyText] = useState("");
    const [sending, setSending] = useState(false);
    const [loadingConvs, setLoadingConvs] = useState(true);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [sendErr, setSendErr] = useState<string | null>(null);
    const [mobileView, setMobileView] = useState<"list" | "chat">("list");
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const loadConversations = useCallback(async () => {
        try {
            const data = await apiFetch<Conversation[]>("/api/inbox/conversations");
            setConversations(data);
        } catch { /* silent */ }
        finally { setLoadingConvs(false); }
    }, []);

    const loadMessages = useCallback(async (conv: Conversation) => {
        setLoadingMsgs(true);
        try {
            const data = await apiFetch<Message[]>(
                `/api/inbox/messages/${encodeURIComponent(conv.phone)}?channel=${conv.channel}`
            );
            setMessages(data);
            setConversations(prev => prev.map(c => convKey(c) === convKey(conv) ? { ...c, unread_count: 0 } : c));
        } catch { /* silent */ }
        finally { setLoadingMsgs(false); }
    }, []);

    useEffect(() => {
        loadConversations();
        const t = setInterval(loadConversations, 15_000);
        return () => clearInterval(t);
    }, [loadConversations]);

    useEffect(() => {
        if (selected) loadMessages(selected);
    }, [selected, loadMessages]);

    useEffect(() => {
        if (selected) {
            const t = setInterval(() => loadMessages(selected), 10_000);
            return () => clearInterval(t);
        }
    }, [selected, loadMessages]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSelect = (conv: Conversation) => {
        setSelected(conv);
        setReplyText("");
        setSendErr(null);
        setMobileView("chat");
    };

    const handleSend = async () => {
        if (!replyText.trim() || !selected) return;
        setSending(true);
        setSendErr(null);
        try {
            await apiFetch("/api/inbox/reply", {
                method: "POST",
                body: JSON.stringify({ phone: selected.phone, body: replyText.trim(), channel: selected.channel }),
            });
            setReplyText("");
            await loadMessages(selected);
            await loadConversations();
        } catch (e: any) {
            setSendErr(e?.message || "שגיאה בשליחה");
        } finally {
            setSending(false);
        }
    };

    const filtered = filterChannel === "all"
        ? conversations
        : conversations.filter(c => c.channel === filterChannel);

    const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);
    const displayName = selected ? (selected.client_name || selected.name || selected.phone) : "";
    const cfg = selected ? ch(selected.channel) : null;

    return (
        <RequireAuth>
            <AppShell title="הודעות">
                <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden" dir="rtl">

                    {/* ── Mobile: back button when in chat ── */}
                    {mobileView === "chat" && selected && (
                        <div className="md:hidden bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
                            <button onClick={() => setMobileView("list")} className="text-gray-500 text-xl">←</button>
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${cfg?.bubble ?? ""}`}>
                                {displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-gray-900 text-sm truncate">{displayName}</div>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg?.badge}`}>{cfg?.icon} {cfg?.label}</span>
                            </div>
                            {selected.client_id && (
                                <a href={`/clients/${selected.client_id}`} className="text-xs text-blue-500">פרופיל ←</a>
                            )}
                        </div>
                    )}

                    <div className="flex flex-1 overflow-hidden">

                        {/* ── Conversations Sidebar ── */}
                        <div className={`${mobileView === "chat" ? "hidden" : "flex"} md:flex w-full md:w-80 flex-shrink-0 flex-col border-l border-gray-100 bg-white`}>

                            {/* Header */}
                            <div className="px-4 pt-4 pb-2 flex-shrink-0">
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="font-bold text-gray-900 text-base">שיחות</h2>
                                    {totalUnread > 0 && (
                                        <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">{totalUnread} חדשות</span>
                                    )}
                                </div>

                                {/* Channel filter tabs */}
                                <div className="flex gap-1 overflow-x-auto pb-1">
                                    {FILTER_TABS.map(tab => {
                                        const cnt = tab.key === "all"
                                            ? conversations.length
                                            : conversations.filter(c => c.channel === tab.key).length;
                                        return (
                                            <button
                                                key={tab.key}
                                                onClick={() => setFilterChannel(tab.key)}
                                                className={[
                                                    "flex-shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-all whitespace-nowrap",
                                                    filterChannel === tab.key
                                                        ? "bg-black text-white"
                                                        : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                                                ].join(" ")}
                                            >
                                                {tab.icon} {tab.label}
                                                {cnt > 0 && <span className={`text-[10px] rounded-full px-1 ${filterChannel === tab.key ? "bg-white/20" : "bg-gray-300"}`}>{cnt}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* List */}
                            {loadingConvs ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <div className="animate-spin h-6 w-6 border-2 border-gray-200 border-t-gray-700 rounded-full" />
                                </div>
                            ) : filtered.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 py-10">
                                    <span className="text-4xl">💬</span>
                                    <p className="text-sm text-gray-400">אין שיחות עדיין</p>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
                                    {filtered.map(conv => {
                                        const config = ch(conv.channel);
                                        const isActive = selected ? convKey(conv) === convKey(selected) : false;
                                        const name = conv.client_name || conv.name || conv.phone;
                                        return (
                                            <button
                                                key={convKey(conv)}
                                                onClick={() => handleSelect(conv)}
                                                className={[
                                                    "w-full text-right px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3",
                                                    isActive ? "bg-gray-50 border-r-[3px] border-r-black" : "",
                                                ].join(" ")}
                                            >
                                                {/* Avatar */}
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${config.bubble}`}>
                                                    {name.charAt(0).toUpperCase()}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-1">
                                                        <span className="font-semibold text-gray-900 text-sm truncate">{name}</span>
                                                        <span className="text-[10px] text-gray-400 flex-shrink-0">{formatTime(conv.last_received_at)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between mt-0.5 gap-1">
                                                        <span className="text-xs text-gray-500 truncate flex-1">{conv.last_message}</span>
                                                        {conv.unread_count > 0 && (
                                                            <span className={`text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 flex-shrink-0 ${config.bubble}`}>
                                                                {conv.unread_count}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 inline-block ${config.badge}`}>
                                                        {config.icon} {config.label}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* ── Chat Area ── */}
                        <div className={`${mobileView === "list" ? "hidden" : "flex"} md:flex flex-1 flex-col bg-gray-50 min-w-0`}>

                            {!selected ? (
                                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                                    <div className="w-20 h-20 rounded-full bg-white shadow-lg flex items-center justify-center text-4xl">💬</div>
                                    <h3 className="font-bold text-gray-700 text-lg">בחר שיחה</h3>
                                    <p className="text-gray-400 text-sm">הודעות מ-WhatsApp, Instagram ו-Facebook</p>
                                </div>
                            ) : (
                                <>
                                    {/* Chat header — desktop only (mobile has its own above) */}
                                    <div className="hidden md:flex bg-white border-b border-gray-100 px-6 py-4 items-center gap-4 flex-shrink-0">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${cfg?.bubble}`}>
                                            {displayName.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-gray-900">{displayName}</div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg?.badge}`}>{cfg?.icon} {cfg?.label}</span>
                                                {selected.client_name && (
                                                    <span className="text-xs text-gray-400" dir="ltr">{selected.phone}</span>
                                                )}
                                            </div>
                                        </div>
                                        {selected.client_id && (
                                            <a href={`/clients/${selected.client_id}`} className="text-xs text-blue-500 hover:underline ml-auto">
                                                צפה בפרופיל לקוח ←
                                            </a>
                                        )}
                                        <div className="flex items-center gap-1 text-xs text-gray-400">
                                            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
                                            חי
                                        </div>
                                    </div>

                                    {/* Messages */}
                                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5">
                                        {loadingMsgs ? (
                                            <div className="flex justify-center py-10">
                                                <div className="animate-spin h-6 w-6 border-2 border-gray-300 border-t-gray-700 rounded-full" />
                                            </div>
                                        ) : messages.length === 0 ? (
                                            <div className="text-center text-gray-400 py-10 text-sm">אין הודעות עדיין</div>
                                        ) : messages.map((msg, i) => {
                                            const isOut = msg.direction === "out";
                                            const config = ch(msg.channel);
                                            const showDate = i === 0 || new Date(messages[i - 1].sent_at).toDateString() !== new Date(msg.sent_at).toDateString();
                                            return (
                                                <div key={msg.id}>
                                                    {showDate && (
                                                        <div className="text-center my-3">
                                                            <span className="text-[11px] text-gray-400 bg-gray-200 px-3 py-1 rounded-full">
                                                                {new Date(msg.sent_at).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className={`flex ${isOut ? "justify-start" : "justify-end"}`}>
                                                        <div className={`max-w-[72%] sm:max-w-[60%] px-4 py-2.5 rounded-2xl text-sm shadow-sm whitespace-pre-wrap ${
                                                            isOut
                                                                ? config.outBubble + " rounded-tr-sm"
                                                                : config.bubble + " rounded-tl-sm"
                                                        }`}>
                                                            {msg.body}
                                                            <div className={`text-[10px] mt-1 text-left ${isOut ? "text-gray-400" : "text-white/70"}`}>
                                                                {formatTime(msg.sent_at)}
                                                                {isOut && <span className="mr-1 opacity-70">✓✓</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        <div ref={messagesEndRef} />
                                    </div>

                                    {/* Reply box */}
                                    <div className="bg-white border-t border-gray-100 p-3 sm:p-4 flex-shrink-0">
                                        {sendErr && (
                                            <div className="text-xs text-red-500 bg-red-50 px-3 py-1.5 rounded-xl mb-2">{sendErr}</div>
                                        )}
                                        <div className="flex items-end gap-2">
                                            <textarea
                                                value={replyText}
                                                onChange={e => setReplyText(e.target.value)}
                                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                                placeholder={`כתוב ב-${cfg?.label ?? ""}...`}
                                                rows={2}
                                                className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-black/10"
                                            />
                                            <button
                                                onClick={handleSend}
                                                disabled={sending || !replyText.trim()}
                                                className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors flex-shrink-0 shadow-sm text-white disabled:opacity-40 ${
                                                    selected.channel === "instagram" ? "bg-gradient-to-br from-purple-500 to-pink-500"
                                                    : selected.channel === "facebook" ? "bg-[#0084FF]"
                                                    : "bg-[#25D366]"
                                                }`}
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
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </AppShell>
        </RequireAuth>
    );
}
