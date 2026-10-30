import { authed } from "@/server/http";
import { getConversationForActor } from "@/server/services/messaging";
import { subscribeConversation } from "@/server/services/realtime";

export const dynamic = "force-dynamic";
// Vercel keeps a streaming function open up to this limit; the stream closes a little earlier and
// the browser's EventSource reconnects automatically.
export const maxDuration = 300;

const STREAM_MS = 280_000;
const HEARTBEAT_MS = 20_000;

/**
 * Server-Sent Events for one conversation. Participants only (checked once on connect; the client
 * re-fetches messages through the authorised API whenever an event arrives).
 */
export const GET = authed<{ id: string }>({ roles: ["landlord", "tenant"] }, async ({ req, actor, params }) => {
  const conversation = await getConversationForActor(actor, params.id);
  const encoder = new TextEncoder();
  let cleanup: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(limit);
        await cleanup?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      write("retry: 3000\n\n");
      write(`event: ready\ndata: {}\n\n`);
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const limit = setTimeout(() => void close(), STREAM_MS);
      req.signal.addEventListener("abort", () => void close());

      cleanup = await subscribeConversation(conversation._id.toString(), (e) => {
        write(`event: ${e.type}\ndata: ${JSON.stringify({ at: e.at })}\n\n`);
      });
    },
    async cancel() {
      await cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});
