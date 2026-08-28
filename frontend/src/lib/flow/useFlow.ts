"use client";

import { useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useDemo } from "@/lib/store";
import { STEPS, type BlockedCopy, type StepId, type VisitSnapshot } from "@/lib/flow/steps";

/* The one place in /m/** that talks to the router.
 *
 * Screens say where they are and where they are going; whether that is a push
 * or a replace, and where their back control lands, comes from the map in
 * steps.ts rather than from each screen's own opinion. */

export interface Flow {
  /** the step this screen is */
  id: StepId;
  storeId: string | null;
  /** move on; the map decides push or replace unless told otherwise.
   *  `storeId` is for the moves that open a different store than the one on
   *  screen — starting the next stop on the route, say — where reading it off
   *  the current url would send the rep back to the shop they just left. */
  go: (to: StepId, options?: { replace?: boolean; storeId?: string }) => void;
  /** leave the field-rep flow entirely: the manager's web app, or the sign-in
   *  screen after signing out. Always a replace — what is being left behind is
   *  never somewhere to go back to. */
  exit: (href: string) => void;
  /** where this step goes back to — not where history came from */
  back: () => void;
  /** null when the screen is the start of the flow and shows no back control */
  canGoBack: boolean;
  /** true when the visit cannot support this screen; render FlowGuardBlock */
  blocked: boolean;
  blockedCopy: BlockedCopy;
  /** the way out offered when blocked */
  goFallback: () => void;
}

/** Reads the visit one field at a time. Building the object inside a zustand
 *  selector would hand useSyncExternalStore a new snapshot on every render. */
function useVisitSnapshot(): VisitSnapshot {
  const visitId = useDemo((s) => s.visitId);
  const categoryId = useDemo((s) => s.categoryId);
  const photo = useDemo((s) => s.photo);
  const analysis = useDemo((s) => s.analysis);
  const findings = useDemo((s) => s.findings);

  return useMemo(
    () => ({
      visitId,
      categoryId,
      hasPhoto: photo !== null,
      hasAnalysis: analysis !== null,
      findingCount: findings.length,
    }),
    [visitId, categoryId, photo, analysis, findings],
  );
}

export function useFlow(id: StepId): Flow {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const visit = useVisitSnapshot();
  const visitStoreId = useDemo((s) => s.storeId);

  // The url is authoritative while a store screen is open; the store's own id
  // covers the steps that have no store in their path.
  const storeId = params?.id ?? visitStoreId ?? null;

  const navigate = useCallback(
    (to: StepId, replace: boolean, forStoreId?: string) => {
      const href = STEPS[to].path(forStoreId ?? storeId) ?? "/m";
      if (replace) router.replace(href);
      else router.push(href);
    },
    [router, storeId],
  );

  const go = useCallback(
    (to: StepId, options?: { replace?: boolean; storeId?: string }) =>
      navigate(to, options?.replace ?? STEPS[to].arriveWith === "replace", options?.storeId),
    [navigate],
  );

  const exit = useCallback((href: string) => router.replace(href), [router]);

  const step = STEPS[id];

  const back = useCallback(() => {
    if (!step.back) return;
    // Replace rather than push: stepping back should shorten the trail, not
    // add to it. Going back twice from the same screen must not need four
    // presses to undo.
    navigate(step.back, true);
  }, [navigate, step.back]);

  const goFallback = useCallback(() => navigate(step.fallback, true), [navigate, step.fallback]);

  // Memoised because screens put this in dependency arrays. A fresh object per
  // render would re-run the effect that uploads a photograph, on every render.
  return useMemo(
    () => ({
      id,
      storeId,
      go,
      exit,
      back,
      canGoBack: step.back !== null,
      blocked: !step.canEnter(visit),
      blockedCopy: step.blocked,
      goFallback,
    }),
    [id, storeId, go, exit, back, goFallback, step, visit],
  );
}
