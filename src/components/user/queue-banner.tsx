"use client";

import { useEffect, useState } from "react";
import { api, QueueStatus } from "@/lib/api-client";
import { formatEta } from "./video-card";

/** Small live pill showing studio availability / waitlist length. */
export function QueueBanner() {
  const [q, setQ] = useState<QueueStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.getQueue();
        if (alive) setQ(s);
      } catch {
        if (alive) setQ({ state: "offline", waiting: 0, waitSeconds: 0 });
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!q) return null;

  const cfg = {
    ready: {
      dot: "bg-emerald-400",
      ring: "border-emerald-500/20 bg-emerald-500/5 text-emerald-200/90",
      text: "Studio ready · no wait",
    },
    busy: {
      dot: "bg-violet-400",
      ring: "border-violet-500/20 bg-violet-500/5 text-violet-200/90",
      text: `${q.waiting} video${q.waiting === 1 ? "" : "s"} in line · new requests wait ${formatEta(q.waitSeconds)}`,
    },
    warming: {
      dot: "bg-sky-400",
      ring: "border-sky-500/20 bg-sky-500/5 text-sky-200/90",
      text: "Studio warming up · requests are saved and will start automatically",
    },
    offline: {
      dot: "bg-amber-400",
      ring: "border-amber-500/20 bg-amber-500/5 text-amber-200/90",
      text: "Studio is offline · your request will wait until it's back",
    },
  }[q.state];

  return (
    <div className="flex justify-center mb-2" id="queue-banner">
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] backdrop-blur transition-colors ${cfg.ring}`}
      >
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${cfg.dot}`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.dot}`} />
        </span>
        {cfg.text}
      </div>
    </div>
  );
}
