"use client";

import { useEffect, useRef } from "react";
import { drain } from "@/lib/api/sync";
import { isAvailable, list } from "@/lib/offline/queue";
import { useOnline } from "@/lib/offline/useOnline";

/** Drains the offline queue wherever the rep happens to be.
 *
 *  This used to live only on /m/sync, which meant queued work sat on the
 *  device until someone thought to open that screen — while the processing
 *  screen was telling them it would be sent "automatically" and offering
 *  "next shelf" as an equally good next step. A rep who took that option and
 *  finished their day never triggered a send at all.
 *
 *  Renders nothing; it exists for the effect. */
export function QueueDrainer() {
  const online = useOnline();
  const draining = useRef(false);

  useEffect(() => {
    if (!online || draining.current) return;
    let cancelled = false;

    void (async () => {
      if (!(await isAvailable())) return;
      const pending = (await list()).filter((o) => o.status !== "DONE");
      if (pending.length === 0 || cancelled) return;

      draining.current = true;
      try {
        await drain();
      } finally {
        draining.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [online]);

  return null;
}
