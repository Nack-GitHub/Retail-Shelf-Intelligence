"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { Button } from "@/components/ui/Button";
import { CountUp } from "@/components/ui/Progress";
import { OsaStatusPill, osaStatusOf, Pill } from "@/components/ui/Badge";
import { SkuThumb } from "@/components/shelf/SkuThumb";
import { BLOCKED_REASONS } from "@/lib/constants";
import { fetchStore, fetchTodaysRoute } from "@/lib/api/routes";
import { useResource } from "@/lib/api/useResource";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import { messageOf } from "@/lib/api/errors";
import { useFlow } from "@/lib/flow/useFlow";
import { FlowGuardBlock } from "@/components/mobile/FlowGuardBlock";
import { useDemo, useOsaAfter, useVisitStats } from "@/lib/store";
import { listItem, stagger, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

export default function CheckoutScreen() {
  const { id } = useParams<{ id: string }>();
  const flow = useFlow("CHECKOUT");
  const store = useResource(() => fetchStore(id), [id]).data;
  const route = useResource(() => fetchTodaysRoute(), []).data;

  const analysis = useDemo((s) => s.analysis);
  const checkedInAt = useDemo((s) => s.checkedInAt);
  const checkedOutAt = useDemo((s) => s.checkedOutAt);
  const closeOutVisit = useDemo((s) => s.closeOutVisit);
  const checkout = useDemo((s) => s.checkout);
  const tasks = useDemo((s) => s.tasks);
  const requests = useDemo((s) => s.replenishmentRequests);
  const resetVisit = useDemo((s) => s.resetVisit);
  const beginVisit = useDemo((s) => s.beginVisit);
  const osaAfter = useOsaAfter();
  const stats = useVisitStats();

  const [closing, setClosing] = useState(true);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Checkout is what makes the visit real: it closes the row and computes
  // osa_after from the AFTER-phase captures. The screen waits for it rather
  // than showing an estimate it would later contradict.
  useEffect(() => {
    let cancelled = false;
    closeOutVisit()
      .catch((err) => {
        if (!cancelled) setCloseError(messageOf(err));
      })
      .finally(() => {
        if (!cancelled) setClosing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [closeOutVisit]);

  /** Real elapsed time, or null. It used to add 17 minutes to make a
   *  seconds-long demo visit look plausible — which put a fabricated duration
   *  on the rep's screen while the manager's dashboard, computing
   *  checked_out_at - checked_in_at for the same visit, read zero. Two screens
   *  disagreeing about one visit is worse than one screen saying "<1". */
  const minutes = useMemo(() => {
    if (!checkedInAt || !checkedOutAt) return null;
    return Math.round((checkedOutAt - checkedInAt) / 60000);
  }, [checkedInAt, checkedOutAt]);

  const osaBefore = checkout?.osaBefore ?? analysis?.osaScore ?? null;
  const stops = route ?? [];
  const nextIndex = stops.findIndex((s) => s.id === id) + 1;
  const nextStore = nextIndex > 0 ? (stops[nextIndex] ?? null) : null;
  const blocked = tasks.filter((t) => t.status === "BLOCKED");

  function goNext() {
    // Replace, not push: this visit is closed, and its summary reads off state
    // that has just been thrown away. Leaving it one back press behind put a
    // page of blank figures in front of the rep for a shop they had finished.
    if (nextStore) {
      beginVisit(nextStore.id);
      flow.go("CHECKIN", { storeId: nextStore.id, replace: true });
    } else {
      resetVisit();
      flow.go("ROUTE");
    }
  }

  if (flow.blocked) return <FlowGuardBlock flow={flow} />;

  return (
    <>
      <MobileHeader title="สรุปการเข้าร้าน" subtitle={store?.name} progress={1} onBack={flow.back} />

      <Scroll className="px-4 pt-4 pb-5">
        <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="flex flex-col gap-3">
          <motion.div
            variants={listItem}
            className="rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]"
          >
            {osaAfter === null ? (
              /* No AFTER photo, so there is no measured improvement. Estimating
                 one from how many tasks were ticked would read high and would
                 disagree with the manager's dashboard for the same visit. */
              <>
                <p className="text-[13px] font-medium text-muted">OSA ของการเข้าร้านนี้</p>
                <p className="mt-1.5 flex items-baseline gap-1">
                  <span className="tnum text-[40px] font-bold leading-none tracking-tight">
                    {osaBefore ?? "—"}
                  </span>
                  <span className="text-[20px] font-bold text-muted">%</span>
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-muted">
                  ยังไม่ได้ถ่ายภาพหลังเติมของ จึงยังไม่มีค่า OSA หลังการเติม
                  ถ่ายภาพชั้นวางอีกครั้งเพื่อวัดผลที่เกิดขึ้นจริง
                </p>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-muted">OSA ก่อน → หลัง</p>
                    <div className="mt-1.5 flex items-baseline gap-2.5">
                      <span className="tnum text-[26px] font-bold leading-none text-muted">
                        {osaBefore ?? "—"}%
                      </span>
                      <span className="text-muted" aria-hidden>→</span>
                      <span className="flex items-baseline text-[40px] font-bold leading-none tracking-tight text-ok">
                        <CountUp to={osaAfter} />%
                      </span>
                    </div>
                  </div>
                  <OsaStatusPill status={osaStatusOf(osaAfter)} />
                </div>

                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-pill bg-surface-2">
                  <motion.div
                    className="h-full rounded-pill bg-muted"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: (osaBefore ?? 0) / 100 }}
                    style={{ originX: 0 }}
                    transition={{ duration: 0.5, ease: easeOut }}
                  />
                </div>
                <div className="-mt-2.5 h-2.5 w-full overflow-hidden rounded-pill">
                  <motion.div
                    className="h-full rounded-pill bg-ok"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: osaAfter / 100 }}
                    style={{ originX: 0 }}
                    transition={{ duration: 0.8, ease: easeOut, delay: 0.35 }}
                  />
                </div>
                {osaBefore !== null && (
                  <p className="mt-3 text-[13px] text-muted">
                    เปลี่ยนแปลง{" "}
                    <span className="tnum font-semibold text-ok">
                      {osaAfter - osaBefore >= 0 ? "+" : ""}
                      {osaAfter - osaBefore}
                    </span>{" "}
                    จุด จากการเติมของ <span className="tnum">{stats.fixed.length}</span> รายการ
                  </p>
                )}
              </>
            )}
          </motion.div>

          <motion.div variants={listItem} className="grid grid-cols-2 gap-3">
            <SummaryTile
              label="เวลาที่ใช้ในร้าน"
              value={minutes === null ? "—" : minutes < 1 ? "<1" : `${minutes}`}
              unit="นาที"
              icon={<ClockIcon />}
            />
            <SummaryTile label="ช่องว่างที่พบ" value={`${stats.total}`} unit="จุด" icon={<GapIcon />} />
            <SummaryTile label="เติมของสำเร็จ" value={`${stats.fixed.length}`} unit="รายการ" tone="ok" icon={<CheckIcon />} />
            <SummaryTile label="ส่งต่อซัพพลายเชน" value={`${requests.length}`} unit="รายการ" tone="warn" icon={<TruckIcon />} />
          </motion.div>

          {stats.rejected.length > 0 && (
            <motion.div variants={listItem} className="rounded-card border border-line bg-bg px-4 py-3.5">
              <p className="text-[14px] font-semibold">
                ตีกลับผล AI <span className="tnum">{stats.rejected.length}</span> จุด
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                ส่งเข้าคิวปรับปรุงโมเดลแล้ว — ข้อมูลนี้ใช้พัฒนาโมเดลเท่านั้น
                ไม่ถูกนำไปประเมินผลงานรายบุคคล
              </p>
            </motion.div>
          )}

          {blocked.length > 0 && (
            <motion.div variants={listItem} className="rounded-card border border-line bg-bg">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-[15px] font-semibold">งานที่ค้างและถูกส่งต่อ</h2>
              </div>
              <ul className="divide-y divide-line">
                {blocked.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <SkuThumb code={t.skuCode} className="size-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">
                        {t.skuBrand} {t.skuName}
                      </p>
                      <p className="text-[13px] text-muted">{t.positionLabel}</p>
                    </div>
                    <Pill tone={t.blockedReason === "OUT_OF_BACKSTOCK" ? "primary" : "neutral"} className="text-[12px]">
                      {BLOCKED_REASONS.find((r) => r.id === t.blockedReason)?.label}
                    </Pill>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}

          <motion.p variants={listItem} className="px-1 text-[13px] leading-relaxed text-muted">
            ระบบจะไม่ส่งข้อความหรือดำเนินการใด ๆ กับร้านค้าโดยอัตโนมัติ
            ทุกการติดต่อร้านต้องทำโดยคนเท่านั้น
          </motion.p>
        </motion.div>
      </Scroll>

      <BottomBar>
        <Button size="lg" full onClick={goNext}>
          {nextStore ? `ไปร้านถัดไป · ${nextStore.name}` : "จบเส้นทางวันนี้"}
        </Button>
        <button
          type="button"
          onClick={() => {
            resetVisit();
            flow.go("ROUTE");
          }}
          className="mt-2 h-10 w-full rounded-btn text-[14px] font-medium text-muted transition-colors hover:bg-surface-2"
        >
          กลับหน้าเส้นทาง
        </button>
      </BottomBar>
    </>
  );
}

function SummaryTile({
  label,
  value,
  unit,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "ok" | "warn";
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-bg p-4">
      <span
        className={cn(
          "grid size-8 place-items-center rounded-chip",
          tone === "ok" ? "bg-ok-soft text-ok" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted",
        )}
      >
        {icon}
      </span>
      <p className="mt-2.5 text-[13px] leading-tight text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="tnum text-[24px] font-bold leading-none">{value}</span>
        <span className="text-[13px] text-muted">{unit}</span>
      </p>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5.2l3.2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function GapIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M10 5v14" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TruckIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 7h13v10H3zM16 10h3.5l1.5 3v4h-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="7" cy="18.5" r="1.6" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="18.5" r="1.6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
