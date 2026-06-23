"use client";

import { useEffect, useRef, useState } from "react";

interface LogLine {
  seq: number;
  stream: "stdout" | "stderr";
  line: string;
}

export function BuildLogs({
  deploymentId,
  initialStatus,
}: {
  deploymentId: string;
  initialStatus: string;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const [connected, setConnected] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const es = new EventSource(`/api/logs/${deploymentId}`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        setLines((prev) => [...prev, JSON.parse(e.data) as LogLine]);
      } catch {
        /* ignore malformed frame */
      }
    };
    es.addEventListener("done", (e) => {
      try {
        setStatus(JSON.parse((e as MessageEvent).data).status);
      } catch {
        /* ignore */
      }
      es.close();
      setConnected(false);
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [deploymentId]);

  // Auto-scroll to the bottom on new lines, unless the user scrolled up.
  useEffect(() => {
    const el = boxRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = boxRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const building = status === "queued" || status === "building";

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-xs">
        <span className="flex items-center gap-2 text-zinc-400">
          <span
            className={`h-2 w-2 rounded-full ${
              building
                ? "animate-pulse bg-amber-500"
                : status === "running"
                  ? "bg-emerald-500"
                  : status === "failed"
                    ? "bg-red-500"
                    : "bg-zinc-500"
            }`}
          />
          {building ? "building…" : status}
        </span>
        <span className="text-zinc-600">{lines.length} lines</span>
      </div>
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="h-96 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-zinc-600">
            {connected ? "Waiting for output…" : "Connecting…"}
          </p>
        ) : (
          lines.map((l) => (
            <div
              key={l.seq}
              // Build tools (Nix, npm, Docker) stream normal progress to
              // stderr, so don't equate stderr with errors — keep it neutral,
              // just slightly dimmer. Failure is signaled by the status dot.
              className={
                l.stream === "stderr" ? "text-zinc-400" : "text-zinc-200"
              }
            >
              {l.line.replace(/\n$/, "") || " "}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
