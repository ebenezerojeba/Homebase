"use client";

import { FileText, Send, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";

interface Msg {
  _id: string;
  mine: boolean;
  body: string;
  attachmentAssetIds: string[];
  createdAt: string;
  readByOther: boolean;
  pending?: boolean;
  failed?: boolean;
}
interface Page {
  conversation: { _id: string; tenancyId: string };
  messages: Msg[];
  hasMore: boolean;
  nextBefore: string | null;
}

/** Safety-net refresh while the live stream is connected; faster when it isn't. */
const SLOW_POLL_MS = 30_000;
const FAST_POLL_MS = 5000;

function time(iso: string) {
  return new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Real-time messaging: a Server-Sent Events stream signals changes; polling is only a fallback. */
export function Chat({ conversationId, otherName }: { conversationId: string; otherName: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [tenancyId, setTenancyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [live, setLive] = useState(false);
  const [older, setOlder] = useState<{ hasMore: boolean; before: string | null }>({ hasMore: false, before: null });
  const [text, setText] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploadKey, setUploadKey] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const p = await api<Page>(`/api/conversations/${conversationId}/messages?limit=50`);
      setTenancyId(p.conversation.tenancyId);
      setMessages((prev) => {
        const pending = prev.filter((m) => m.pending || m.failed);
        return [...p.messages, ...pending];
      });
      setOlder((o) => (o.before ? o : { hasMore: p.hasMore, before: p.nextBefore }));
      setError(null);
      setOffline(false);
    } catch (e) {
      if (typeof navigator !== "undefined" && !navigator.onLine) setOffline(true);
      else setError(e instanceof Error ? e.message : "Couldn't load messages");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const es = new EventSource(`/api/conversations/${conversationId}/stream`);
    es.addEventListener("ready", () => setLive(true));
    es.addEventListener("new_message", () => void load());
    es.addEventListener("read", () => void load());
    // EventSource reconnects by itself; meanwhile the poll below keeps the chat fresh.
    es.onerror = () => setLive(false);
    const on = () => {
      setOffline(false);
      void load();
    };
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      clearTimeout(first);
      es.close();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [conversationId, load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, live ? SLOW_POLL_MS : FAST_POLL_MS);
    return () => clearInterval(id);
  }, [live, load]);

  const lastId = messages.at(-1)?._id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastId]);

  async function loadOlder() {
    if (!older.before) return;
    const p = await api<Page>(`/api/conversations/${conversationId}/messages?limit=50&before=${encodeURIComponent(older.before)}`);
    setMessages((prev) => [...p.messages, ...prev]);
    setOlder({ hasMore: p.hasMore, before: p.nextBefore });
  }

  async function send(body: string, attachmentAssetIds: string[], clientId: string) {
    setMessages((prev) => [...prev.filter((m) => m._id !== clientId), { _id: clientId, mine: true, body, attachmentAssetIds, createdAt: new Date().toISOString(), readByOther: false, pending: true }]);
    try {
      await api(`/api/conversations/${conversationId}/messages`, { body: { body, attachmentAssetIds, clientId } });
      setMessages((prev) => prev.filter((m) => m._id !== clientId));
      await load();
    } catch {
      setMessages((prev) => prev.map((m) => (m._id === clientId ? { ...m, pending: false, failed: true } : m)));
    }
  }

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] flex-col overflow-hidden rounded-card border border-cream-300 bg-white shadow-card md:h-[calc(100dvh-11rem)]">
      <div className="flex items-center justify-between border-b border-cream-200 px-5 py-3">
        <p className="font-semibold text-ink-900">{otherName}</p>
        {offline ? (
          <span className="flex items-center gap-1.5 text-xs text-amber-700"><WifiOff className="size-3.5" aria-hidden /> Offline — will retry</span>
        ) : live ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-700"><span className="size-2 rounded-full bg-emerald-600" aria-hidden /> Live</span>
        ) : (
          <span className="text-xs text-ink-400">Connecting…</span>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-cream-50 px-4 py-4" role="log" aria-live="polite" aria-label="Messages">
        {loading ? (
          <div className="grid h-full place-items-center"><Spinner className="size-6 text-emerald-700" /></div>
        ) : error ? (
          <div className="grid h-full place-items-center text-center text-sm text-rose-700">
            <div>
              <p>{error}</p>
              <button className="mt-2 font-medium underline" onClick={() => void load()}>Try again</button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-ink-500">
            <p>No messages yet. Say hello — messages are kept on the tenancy record for both of you.</p>
          </div>
        ) : (
          <>
            {older.hasMore ? (
              <div className="text-center">
                <button className="text-xs font-medium text-emerald-700 hover:underline" onClick={() => void loadOlder()}>Load earlier messages</button>
              </div>
            ) : null}
            {messages.map((m) => (
              <div key={m._id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-xs sm:max-w-[70%]", m.mine ? "rounded-br-md bg-emerald-700 text-white" : "rounded-bl-md bg-white text-ink-900 ring-1 ring-cream-300")}>
                  {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                  {m.attachmentAssetIds.map((a) => (
                    <a key={a} href={`/api/assets/${a}`} target="_blank" rel="noopener" className={cn("mt-1 flex items-center gap-1.5 text-xs underline", m.mine ? "text-emerald-50" : "text-emerald-700")}>
                      <FileText className="size-3.5" aria-hidden /> Attachment
                    </a>
                  ))}
                  <p className={cn("mt-1 text-[11px]", m.mine ? "text-emerald-100" : "text-ink-400")}>
                    {m.pending ? "Sending…" : m.failed ? (
                      <button className="font-semibold text-amber-100 underline" onClick={() => void send(m.body, m.attachmentAssetIds, m._id)}>Not sent — tap to retry</button>
                    ) : (
                      <>
                        {time(m.createdAt)}
                        {m.mine ? (m.readByOther ? " · Read" : " · Delivered") : ""}
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="space-y-2 border-t border-cream-200 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const body = text.trim();
          if (!body && files.length === 0) return;
          const clientId = `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
          void send(body, files.map((f) => f.id), clientId);
          setText("");
          setFiles([]);
          setUploadKey((k) => k + 1);
        }}
      >
        {tenancyId ? <FileUpload key={uploadKey} kind="message_attachment" tenancyId={tenancyId} max={4} label="Attach" hint="Photo or PDF · 8 MB" onChange={setFiles} /> : null}
        <div className="flex items-end gap-2">
          <label htmlFor="msg" className="sr-only">Message</label>
          <textarea
            id="msg"
            rows={1}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Write a message…"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-cream-300 px-3.5 py-2.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-3 focus:ring-emerald-600/15"
          />
          <Button type="submit" aria-label="Send" className="h-11 w-11 px-0" disabled={!text.trim() && files.length === 0}>
            <Send className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
