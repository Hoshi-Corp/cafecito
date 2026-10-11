import { authenticate, failure } from "@/server/http";
import { subscribe } from "@/server/events";

/** Server-Sent Events: one JSON `GroupEvent` per message, a comment every 25 s to keep proxies from closing it. */
export async function GET(req: Request, ctx: RouteContext<"/api/groups/[id]/events">) {
  try {
    const { groupId, meId } = await authenticate(ctx.params);
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const write = (text: string) => controller.enqueue(encoder.encode(text));
        const close = () => {
          cleanup();
          try {
            controller.close();
          } catch {} // already closed
        };
        const unsubscribe = subscribe(groupId, {
          memberId: meId,
          send: (event) => write(`data: ${JSON.stringify(event)}\n\n`),
          close,
        });
        const beat = setInterval(() => write(": ping\n\n"), 25_000);
        cleanup = () => (clearInterval(beat), unsubscribe());
        req.signal.addEventListener("abort", close);
        write(": open\n\n");
      },
      cancel: () => cleanup(),
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no", // nginx would otherwise hold the stream back
      },
    });
  } catch (e) {
    return failure(e);
  }
}
