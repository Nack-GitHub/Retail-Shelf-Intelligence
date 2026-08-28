"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Logo } from "@/components/ui/Logo";
import { RiskBadge } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Progress";
import { Button } from "@/components/ui/Button";
import { Scroll } from "@/components/mobile/Chrome";
import { StateSwitcher } from "@/components/mobile/StateSwitcher";
import { useFlow } from "@/lib/flow/useFlow";
import { useDemo } from "@/lib/store";
import { listItem, stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { useSession } from "@/components/auth/AuthGate";
import { areaName, logout } from "@/lib/api/auth";
import { currentPosition, fetchTodaysRoute } from "@/lib/api/routes";
import { useResource } from "@/lib/api/useResource";
import { isAvailable, list as queueList } from "@/lib/offline/queue";
import { useOnline } from "@/lib/offline/useOnline";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import type { Store } from "@/types";

type View = "LIST" | "EMPTY" | "SYNCING";

/** Minutes per store, used only for the "roughly this long" header estimate.
 *  A real per-store duration arrives with visit history; until a store has
 *  been visited there is nothing to average, so one honest constant beats a
 *  fabricated per-store number. */
const MINUTES_PER_STORE = 22;

export default function TodayRouteScreen() {
  const flow = useFlow("ROUTE");
  const [view, setView] = useState<View>("LIST");
  const beginVisit = useDemo((s) => s.beginVisit);
  // Read straight from the offline queue: a badge driven by a separate
  // in-memory list would disagree with the sync screen the moment either moved.
  const [pendingSync, setPendingSync] = useState(0);
  useEffect(() => {
    void (async () => {
      if (!(await isAvailable())) return;
      setPendingSync((await queueList()).filter((o) => o.status !== "DONE").length);
    })();
  }, []);
  const { user } = useSession();

  const route = useResource<Store[]>(async () => {
    // Location is asked for, never required: the API falls back to the area
    // centroid, so a rep who declines still gets a route ordered by risk.
    const position = await currentPosition();
    return fetchTodaysRoute(position ?? undefined);
  }, []);

  const stores = useMemo(() => route.data ?? [], [route.data]);
  const totalMinutes = stores.length * MINUTES_PER_STORE;
  const totalDistanceKm = useMemo(
    () => stores.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0),
    [stores],
  );

  const today = useMemo(
    () =>
      new Date().toLocaleDateString("th-TH", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [],
  );

  function open(storeId: string) {
    beginVisit(storeId);
    // The store id is passed explicitly: the visit has only just been opened,
    // and reading it back off the current screen would give the previous one.
    flow.go("CHECKIN", { storeId });
  }

  return (
    <>
      <header className="sticky top-0 z-30 shrink-0 border-b border-line bg-bg/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <Logo size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">
              เส้นทางวันนี้
            </p>
            <p className="truncate text-[13px] leading-tight text-muted">
              {today} · {areaName(user?.areaId)}
            </p>
          </div>
          <SyncChip count={pendingSync} />
          <button
            type="button"
            onClick={() => {
              logout();
              flow.exit("/m/login");
            }}
            title="ออกจากระบบ / สลับบัญชี"
            className="flex items-center gap-1 rounded-btn border border-line bg-surface px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:border-danger hover:text-danger"
          >
            ออก
          </button>
        </div>
        <AnimatePresence>
          {view === "SYNCING" && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-primary-soft"
            >
              <div className="flex items-center gap-2 px-4 py-2.5">
                <motion.span
                  className="size-3.5 rounded-full border-2 border-primary/30 border-t-primary"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                />
                <p className="text-[13px] font-medium text-primary-ink">
                  กำลังซิงก์เส้นทางล่าสุด…
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <Scroll className="px-4 pt-4 pb-6">
        {route.state === "LOADING" ? (
          <LoadingBlock label="กำลังโหลดเส้นทางวันนี้…" />
        ) : route.state === "ERROR" ? (
          <ErrorBlock message={route.error ?? ""} onRetry={route.reload} />
        ) : view === "EMPTY" || stores.length === 0 ? (
          <EmptyRoute />
        ) : (
          <>
            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mb-4 flex items-center justify-between rounded-card border border-line bg-bg px-4 py-3"
            >
              <div>
                <p className="text-[13px] text-muted">แผนวันนี้</p>
                <p className="text-[15px] font-semibold">
                  <span className="tnum">{stores.length}</span> ร้าน ·{" "}
                  <span className="tnum">{Math.round(totalMinutes / 60)}</span> ชม. โดยประมาณ
                </p>
              </div>
              <div className="text-right">
                <p className="text-[13px] text-muted">ระยะทางรวม</p>
                <p className="tnum text-[15px] font-semibold">
                  {totalDistanceKm.toFixed(1)} กม.
                </p>
              </div>
            </motion.div>

            <motion.ul
              variants={stagger(0.055, 0.1)}
              initial="hidden"
              animate="show"
              className="flex flex-col gap-3"
            >
              {(view === "SYNCING" ? stores.slice(0, 3) : stores).map((s, i) => (
                <motion.li key={s.id} variants={listItem}>
                  <motion.button
                    type="button"
                    onClick={() => open(s.id)}
                    whileTap={{ scale: 0.985 }}
                    className="w-full rounded-card border border-line bg-bg p-4 text-left shadow-[var(--shadow-card)] transition-colors hover:border-line-strong"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "tnum mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                          i === 0 ? "bg-primary text-white" : "bg-surface-2 text-muted",
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="text-[16px] font-semibold leading-snug">{s.name}</h2>
                          <RiskBadge band={s.riskBand} className="mt-0.5 shrink-0" />
                        </div>
                        <p className="mt-0.5 text-[13px] text-muted">
                          {s.chain} · {s.visitWindow}
                        </p>

                        <div className="mt-3 flex items-center gap-4">
                          {s.distanceKm !== null && (
                            <Meta icon={<PinIcon />} label={`${s.distanceKm} กม.`} />
                          )}
                          <Meta
                            icon={<ClockIcon />}
                            label={
                              s.daysSinceLastVisit === null
                                ? "ยังไม่เคยเข้า"
                                : `เข้าล่าสุด ${s.daysSinceLastVisit} วันก่อน`
                            }
                          />
                        </div>

                        {/* A store nobody has photographed has no OSA. Drawing
                            an empty bar would read as a shelf stripped bare. */}
                        {s.lastOsa === null ? (
                          <p className="mt-3 text-[13px] text-muted">ยังไม่เคยตรวจชั้นวางที่ร้านนี้</p>
                        ) : (
                          <div className="mt-3 flex items-center gap-3">
                            <span className="text-[13px] text-muted">OSA ครั้งก่อน</span>
                            <Bar
                              value={s.lastOsa}
                              tone={s.lastOsa >= 90 ? "ok" : s.lastOsa >= 75 ? "warn" : "danger"}
                              className="flex-1"
                              delay={0.12 + i * 0.05}
                            />
                            <span className="tnum w-10 text-right text-[14px] font-semibold">
                              {s.lastOsa}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.button>
                </motion.li>
              ))}
            </motion.ul>
          </>
        )}

        <div className="mt-5">
          <StateSwitcher
            value={view}
            onChange={setView}
            options={[
              { value: "LIST", label: "มีร้าน" },
              { value: "EMPTY", label: "ไม่มีร้าน" },
              { value: "SYNCING", label: "กำลังซิงก์" },
            ]}
          />
        </div>
      </Scroll>
    </>
  );
}

function SyncChip({ count }: { count: number }) {
  const online = useOnline();
  return (
    <Link
      href="/m/sync"
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium transition-colors",
        count > 0 ? "bg-warn-soft text-[#b45f04]" : "bg-ok-soft text-[#07794a]",
      )}
      aria-label={count > 0 ? `รอซิงก์ ${count} รายการ` : "ซิงก์ครบแล้ว"}
    >
      <span className="relative flex size-2">
        {count > 0 && online && (
          <span
            className="absolute inline-flex size-2 rounded-full bg-warn"
            style={{ animation: "pulse-ring 1.8s ease-out infinite" }}
          />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", count > 0 ? "bg-warn" : "bg-ok")} />
      </span>
      {count > 0 ? <span className="tnum">รอซิงก์ {count}</span> : "ซิงก์แล้ว"}
    </Link>
  );
}

function Meta({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-muted">
      <span className="text-faint">{icon}</span>
      {label}
    </span>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 21s7-5.4 7-11a7 7 0 10-14 0c0 5.6 7 11 7 11z" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5.2l3.2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EmptyRoute() {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      role="status"
      className="flex flex-col items-center rounded-card border border-line bg-bg px-6 py-14 text-center"
    >
      <div className="grid size-16 place-items-center rounded-full bg-ok-soft">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-ok" aria-hidden>
          <path d="M5 13l4 4 10-10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="mt-4 text-[17px] font-semibold">ไม่มีร้านที่ต้องเข้าวันนี้</h2>
      <p className="mt-1.5 max-w-[260px] text-[14px] leading-relaxed text-muted">
        เส้นทางของคุณว่างอยู่ หากต้องการตรวจร้านเพิ่ม สามารถขอเพิ่มร้านจากผู้จัดการพื้นที่ได้
      </p>
      <Button variant="secondary" className="mt-5">
        ขอเพิ่มร้านในเส้นทาง
      </Button>
    </motion.div>
  );
}
