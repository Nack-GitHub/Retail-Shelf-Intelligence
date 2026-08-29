"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "@/lib/api/errors";

export type ResourceState = "LOADING" | "READY" | "ERROR";

export interface Resource<T> {
  data: T | null;
  state: ResourceState;
  /** Thai, ready to show the user */
  error: string | null;
  reload: () => void;
}

/** Loads one thing from the API and reports all three states it can be in.
 *
 *  SPEC §8: a screen that loads data must always be able to say "loading",
 *  "that failed, here is why", or "there is nothing here" — a blank screen
 *  that explains nothing is a bug, not a neutral state. Having one hook do
 *  this is what stops the twentieth screen from being the one that forgets.
 *
 *  `load` is called on mount and whenever `deps` change; pass a stable deps
 *  array the same way you would to useEffect. */
export function useResource<T>(load: () => Promise<T>, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<ResourceState>("LOADING");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // The latest load wins. Without this, a slow first request can resolve after
  // a fast second one and overwrite fresher data with staler data.
  const runId = useRef(0);

  /* Going back to LOADING is a reaction to the inputs changing, so it happens
     during render rather than inside the effect. Doing it in the effect meant
     one paint in which the deps had already moved on but the screen still
     showed the previous resource's data as though it were current — the area
     dashboard briefly showed the old area's numbers under the new area's name.
     Adjusting state during render is the documented way to reset on a change;
     React re-runs this component before committing anything. */
  const inputs = [...deps, nonce];
  const [lastInputs, setLastInputs] = useState<unknown[]>(inputs);
  if (
    inputs.length !== lastInputs.length ||
    inputs.some((value, i) => !Object.is(value, lastInputs[i]))
  ) {
    setLastInputs(inputs);
    setState("LOADING");
    setError(null);
  }

  useEffect(() => {
    const id = ++runId.current;

    // `load` is read from this render's closure rather than through a ref:
    // the effect is scheduled by the same render, so the two are the same
    // function, and a ref written during render is not allowed.
    load()
      .then((result) => {
        if (id !== runId.current) return;
        setData(result);
        setState("READY");
      })
      .catch((err) => {
        if (id !== runId.current) return;
        setError(messageOf(err));
        setState("ERROR");
      });
    // `load` is intentionally excluded: callers pass an inline closure, and
    // depending on it would re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, state, error, reload };
}
