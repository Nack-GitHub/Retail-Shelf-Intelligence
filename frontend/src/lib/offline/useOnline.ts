"use client";

import { useSyncExternalStore } from "react";

/** The browser's own view of connectivity.
 *
 *  `navigator.onLine` is honest about "no network interface" and optimistic
 *  about everything else — a captive portal or a dead uplink still reads
 *  true. That is fine here: the queue is driven by requests actually failing,
 *  and this flag only decides what the UI says while they do.
 *
 *  Connectivity is an external store, so it is read as one. The previous
 *  version held it in state and seeded it from an effect, which meant every
 *  consumer rendered once with a hardcoded `true` before the effect corrected
 *  it — a rep opening the sync screen with no signal saw "ออนไลน์" flash first.
 *  The server snapshot keeps that `true` because there is no navigator during
 *  the server render and a mismatch would hydrate wrong. */

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
