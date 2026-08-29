"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { PageHeader } from "@/components/web/WebShell";
import { EvidenceViewer } from "@/components/web/EvidenceViewer";
import { Sparkline, LineChart } from "@/components/charts/LineChart";
import { CountUp, Bar } from "@/components/ui/Progress";
import { RiskBadge, Pill, OsaStatusPill } from "@/components/ui/Badge";
import { osaStatusOf } from "@/lib/osa";
import { OsaSource } from "@/components/ui/OsaSource";
import { Button } from "@/components/ui/Button";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import { fetchStore } from "@/lib/api/routes";
import { fetchCategories } from "@/lib/api/catalog";
import { fetchOsaTrend, fetchStoreHistory, type VisitCapture } from "@/lib/api/analytics";
import { useResource } from "@/lib/api/useResource";
import { fillWeeklyGaps, measuredWeeks } from "@/lib/trend";
import { fadeUp, listItem, stagger, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

const STORE_FORMATS: Record<string, string> = {
  HYPER: "ไฮเปอร์มาร์เก็ต",
  SUPER: "ซูเปอร์มาร์เก็ต",
  CVS: "ร้านสะดวกซื้อ",
  TRAD: "ร้านค้าดั้งเดิม",
};

const POLICY_LABELS: Record<string, string> = {
  ALLOWED: "อนุญาต",
  RESTRICTED: "มีเงื่อนไข",
  FORBIDDEN: "ไม่อนุญาต",
};

export default function StoreDetail() {
  const { id } = useParams<{ id: string }>();
  /* `?capture=<id>` — how the relabel queue hands a reviewer the photograph
     behind a crop. Without it that screen could only show a 200px cut-out of a
     shelf and no way to see the shelf. */
  const requestedCapture = useSearchParams().get("capture");

  const store = useResource(() => fetchStore(id), [id]);
  /* Only so the figure above can name the shelf it came from. A manager
     comparing stores needs to know they are not comparing the coffee bay in
     one with the milk bay in another. */
  const categories = useResource(() => fetchCategories(id), [id]);
  const history = useResource(() => fetchStoreHistory(id), [id]);
  const trend = useResource(() => fetchOsaTrend({ storeId: id, days: 84 }), [id]);

  const [evidence, setEvidence] = useState<{
    capture: VisitCapture;
    visitedAt: string | null;
    gapsFound: number;
    gapsFixed: number;
  } | null>(null);

  const visits = useMemo(() => history.data ?? [], [history.data]);

  /* Open the requested capture once the timeline it lives in has arrived.
     Adjusted during render rather than in an effect, the same way the viewer
     itself resets when it is handed a different capture — an effect would
     paint the page once without the panel and then again with it.

     Marked as handled exactly once, even when the id matches nothing: a
     capture belonging to another store must leave the page rendering
     normally, and reopening the panel after the reader closes it would trap
     them on the photograph they just dismissed. */
  const [openedFromUrl, setOpenedFromUrl] = useState<string | null>(null);
  if (requestedCapture && requestedCapture !== openedFromUrl && visits.length > 0) {
    setOpenedFromUrl(requestedCapture);
    for (const v of visits) {
      const capture = v.captures.find((c) => c.captureId === requestedCapture);
      if (capture) {
        setEvidence({
          capture,
          visitedAt: v.checkedInAt,
          gapsFound: v.gapsFound,
          gapsFixed: v.gapsFixed,
        });
        break;
      }
    }
  }

  /* Gap-filled, so the x axis is a week apart everywhere. A store photographed
     on 29 มิ.ย., 3 ส.ค. and 24 ส.ค. used to draw its five-week gap and its
     three-week gap at the same width. */
  const weeks = useMemo(() => fillWeeklyGaps(trend.data ?? []), [trend.data]);
  const points = useMemo(
    () =>
      weeks.map((p) => ({
        label: new Date(p.bucket).toLocaleDateString("th-TH", { day: "numeric", month: "short" }),
        value: p.osa,
      })),
    [weeks],
  );
  // The "enough data" guard counts real readings, never the blanks.
  const measured = measuredWeeks(weeks);

  const s = store.data;
  const osa = s?.lastOsa ?? null;
  const measuredShelf =
    (categories.data ?? []).find((c) => c.id === s?.lastOsaCategory)?.name ?? null;

  if (store.state === "LOADING") return <LoadingBlock label="กำลังโหลดข้อมูลร้าน…" />;
  if (store.state === "ERROR" || !s) {
    return (
      <div className="p-8">
        <ErrorBlock message={store.error ?? ""} onRetry={store.reload} />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={`${s.chain} · ${s.externalCode} · ${s.address}`}
        back={{ href: "/w", label: "ภาพรวมพื้นที่" }}
        actions={<RiskBadge band={s.riskBand} />}
      />

      <div className="px-6 py-6 lg:px-8">
        <motion.div variants={stagger(0.07)} initial="hidden" animate="show" className="grid gap-5 xl:grid-cols-3">
          {/* ---- OSA summary ---- */}
          <motion.section
            variants={listItem}
            className="rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium text-muted">OSA ล่าสุดของร้าน</p>
                {osa === null ? (
                  <p className="mt-2 text-[15px] font-semibold text-muted">ยังไม่เคยตรวจ</p>
                ) : (
                  <>
                    <p className="mt-1 flex items-baseline gap-1">
                      <CountUp to={osa} className="text-[40px] font-bold leading-none tracking-tight" />
                      <span className="text-[20px] font-bold text-muted">%</span>
                    </p>
                    <OsaSource store={s} categoryName={measuredShelf} className="mt-1" />
                  </>
                )}
              </div>
              {osa !== null && <OsaStatusPill status={osaStatusOf(osa)} />}
            </div>

            {measured >= 2 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-[12px] text-muted">แนวโน้มรายสัปดาห์</p>
                <Sparkline
                  values={points.map((p) => p.value)}
                  width={150}
                  height={40}
                  color="#1b6fe8"
                />
              </div>
            )}

            <dl className="mt-4 space-y-2.5 border-t border-line pt-4">
              <Fact label="SKU ที่ขาดซ้ำ" value={`${s.repeatGapSkus} รายการ`} />
              <Fact
                label="เข้าตรวจครั้งล่าสุด"
                value={
                  s.daysSinceLastVisit === null
                    ? "ยังไม่เคยเข้า"
                    : `${s.daysSinceLastVisit} วันก่อน`
                }
              />
              <Fact label="รูปแบบร้าน" value={STORE_FORMATS[s.storeFormat] ?? s.storeFormat} />
              <Fact label="นโยบายการถ่ายภาพ" value={POLICY_LABELS[s.photoPolicy] ?? s.photoPolicy} />
            </dl>
          </motion.section>

          {/* ---- trend ---- */}
          <motion.section
            variants={listItem}
            className="rounded-card border border-line bg-bg shadow-[var(--shadow-card)] xl:col-span-2"
          >
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-[16px] font-semibold">ประวัติ OSA ของร้านนี้</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                หนึ่งจุดคือหนึ่งสัปดาห์ · แถบเทาคือสัปดาห์ที่ไม่มีการตรวจ เส้นจึงขาดตอน
                ไม่ลากข้ามไปเอง
              </p>
            </div>
            <div className="px-3 py-4 sm:px-5">
              {trend.state === "LOADING" ? (
                <LoadingBlock label="กำลังโหลดประวัติ…" />
              ) : trend.state === "ERROR" ? (
                <ErrorBlock message={trend.error ?? ""} onRetry={trend.reload} />
              ) : measured < 2 ? (
                <p className="px-2 py-12 text-center text-[14px] leading-relaxed text-muted">
                  ยังมีข้อมูลไม่พอสำหรับกราฟ
                  <br />
                  ต้องมีผลการตรวจอย่างน้อย 2 สัปดาห์
                </p>
              ) : (
                <LineChart
                  data={points}
                  target={90}
                  targetLabel="เป้าหมาย 90%"
                  height={230}
                  decimals={0}
                />
              )}
            </div>
          </motion.section>
        </motion.div>

        {/* ---- evidence timeline ---- */}
        <motion.section
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.35 }}
          className="mt-5 rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
        >
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-[16px] font-semibold">ไทม์ไลน์หลักฐานภาพ</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              ทุกผลลัพธ์กดเข้าไปดูภาพต้นทางได้ และโต้แย้งได้ทุกรายการ
            </p>
          </div>

          {history.state === "LOADING" ? (
            <LoadingBlock label="กำลังโหลดไทม์ไลน์…" />
          ) : history.state === "ERROR" ? (
            <div className="p-5">
              <ErrorBlock message={history.error ?? ""} onRetry={history.reload} />
            </div>
          ) : visits.length === 0 ? (
            <p className="px-5 py-14 text-center text-[14px] leading-relaxed text-muted">
              ยังไม่มีการเข้าตรวจร้านนี้
              <br />
              ไทม์ไลน์จะเริ่มบันทึกตั้งแต่การเข้าร้านครั้งแรก
            </p>
          ) : (
            <ol className="divide-y divide-line">
              {visits.map((v, i) => {
                const when = new Date(v.checkedInAt);
                return (
                  <motion.li
                    key={v.visitId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(0.5, 0.1 + i * 0.05), duration: 0.35, ease: easeOut }}
                    className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-surface/60"
                  >
                    <div className="w-[112px] shrink-0">
                      <p className="text-[14px] font-semibold">
                        {when.toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
                      </p>
                      <p className="tnum text-[13px] text-muted">
                        {when.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.
                      </p>
                    </div>

                    <div className="min-w-[150px] flex-1">
                      <p className="text-[14px]">
                        {v.captures.length === 0
                          ? "ไม่มีภาพในการเข้าร้านครั้งนี้"
                          : `${v.captures.length} ภาพ`}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="tnum text-[13px] text-muted">{v.osaBefore ?? "—"}%</span>
                        <span className="text-faint" aria-hidden>→</span>
                        {/* An open visit has no after-score yet, and a dash
                            says so rather than repeating the before-score. */}
                        <span className="tnum text-[14px] font-semibold text-ok">
                          {v.osaAfter ?? "—"}%
                        </span>
                        {v.osaAfter !== null && (
                          <Bar value={v.osaAfter} tone="ok" className="w-16" height={5} />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Pill tone="danger" className="text-[12px]">
                        พบ <span className="tnum">{v.gapsFound}</span>
                      </Pill>
                      <Pill tone="ok" className="text-[12px]">
                        แก้ <span className="tnum">{v.gapsFixed}</span>
                      </Pill>
                      {!v.gpsMatch && (
                        <Pill tone="warn" className="text-[12px]">
                          พิกัดไม่ตรง
                        </Pill>
                      )}
                      {v.status === "OPEN" && (
                        <Pill tone="neutral" className="text-[12px]">
                          ยังไม่ปิด
                        </Pill>
                      )}
                    </div>

                    {/* One button per photograph. Picking a single capture
                        left the other shelves of a multi-shelf visit
                        unreachable, under a heading promising every result
                        could be opened. */}
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                      {v.captures.length === 0 ? (
                        <span className="text-[13px] text-faint">ไม่มีภาพ</span>
                      ) : (
                        v.captures.map((c) => (
                          <Button
                            key={c.captureId}
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setEvidence({
                                capture: c,
                                visitedAt: v.checkedInAt,
                                gapsFound: v.gapsFound,
                                gapsFixed: v.gapsFixed,
                              })
                            }
                          >
                            {c.shelfBayLabel || c.category}
                            {c.phase === "AFTER" ? " · หลัง" : ""}
                          </Button>
                        ))
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          )}
        </motion.section>

        <p className="mt-5 flex items-start gap-2 rounded-card border border-line bg-bg px-4 py-3.5 text-[13px] leading-relaxed text-muted">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-faint" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 16v-4.5M12 8.2h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>
            หน้านี้แสดงผลในระดับร้านเท่านั้น ไม่มีการเชื่อมโยงตัวเลขกับพนักงานคนใดคนหนึ่ง
            ข้อมูลผู้ถ่ายภาพในหลักฐานระบุเป็น “บทบาท” เพื่อยืนยันที่มาของภาพ ไม่ใช่เพื่อประเมินผลงาน
          </span>
        </p>
      </div>

      <EvidenceViewer
        capture={evidence?.capture ?? null}
        storeName={s.name}
        visitedAt={evidence?.visitedAt ?? null}
        gapsFound={evidence?.gapsFound ?? 0}
        gapsFixed={evidence?.gapsFixed ?? 0}
        onClose={() => setEvidence(null)}
      />
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={cn("text-[13px] font-medium")}>{value}</dd>
    </div>
  );
}
