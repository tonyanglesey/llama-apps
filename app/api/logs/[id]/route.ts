import { controlPlaneBase } from "@/lib/control-plane";

// Proxy the control plane's SSE build-log stream to the browser, same-origin,
// so the private orchestrator is never exposed. Streams straight through.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const lastEventId = req.headers.get("last-event-id");

  const upstream = await fetch(
    `${controlPlaneBase}/logs/${encodeURIComponent(id)}`,
    {
      cache: "no-store",
      headers: lastEventId ? { "last-event-id": lastEventId } : undefined,
      // Abort the upstream stream when the browser disconnects, so the control
      // plane stops polling.
      signal: req.signal,
    },
  );

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ error: `control plane ${upstream.status}` }),
      {
        status: upstream.status === 404 ? 404 : 502,
        headers: { "content-type": "application/json" },
      },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
