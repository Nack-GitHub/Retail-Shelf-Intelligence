"use client";

import { useEffect, useState } from "react";

/** The browser's own view of connectivity.
 *
 *  `navigator.onLine` is honest about "no network interface" and optimistic
 *  about everything else — a captive portal or a dead uplink still reads
 *  true. That is fine here: the queue is driven by requests actually failing,
 *  and this flag only decides what the UI says while they do.
 *
 *  The initial value is `true` rather than a read of navigator, because the
 *  server render has no navigator and a mismatch would hydrate wrong. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
