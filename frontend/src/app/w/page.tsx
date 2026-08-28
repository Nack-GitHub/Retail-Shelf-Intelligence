"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { PageHeader } from "@/components/web/WebShell";
import { LineChart } from "@/components/charts/LineChart";
import { CountUp, Bar } from "@/components/ui/Progress";
import { RiskBadge, Pill } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Controls";
import { Button } from "@/components/ui/Button";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import { useResource } from "@/lib/api/useResource";
import { fetchKpis, fetchOsaTrend, fetchRiskRanking } from "@/lib/api/analytics";
import { useArea } from "@/components/web/WebShell";
import { listItem, stagger, fadeUp, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { osaTone } from "@/lib/osa";
import { OsaSource } from "@/components/ui/OsaSource";

type Range = "4W" | "12W" | "26W";

const RANGE_DAYS: Record<Range, number> = { "4W": 28, "12W": 84, "26W": 182 };

export default function AreaDashboard() {
  const router = useRouter();
  const [range, setRange] = useState<Range>("12W");
  const { areaId, areaName, ready } = useArea();
  const days = RANGE_DAYS[range];

  const kpis = useResource(async () => (ready ? fetchKpis(areaId, days) : null), [areaId, days, ready]);
  const osa = useResource(async () => (ready ? fetchOsaTrend({ areaId, days }) : null), [areaId, days, ready]);
  const risk = useResource(async () => (ready ? fetchRiskRanking(areaId) : null), [areaId, ready]);

  const trend = useMemo(
    () =>
      (osa.data ?? []).map((p) => ({
        // "2026-08-17" → "17 ส.ค." — the axis has no room for a full date
        label: new Date(p.bucket).toLocaleDateString("th-TH", {
          day: "numeric",
          month: "short",
        }),
        value: p.osa,
      })),
    [osa.data],
  );

  const rows = risk.data ?? [];

  return (
    <>
      <PageHeader
        title="ภาพรวมพื้นที่"
        subtitle={`${areaName} · ข้อมูลสด ณ เวลาที่เปิดหน้านี้`}
        actions={
          <>
            <Segmented
              ariaLabel="ช่วงเวลา"
              value={range}
              onChange={setRange}
              options={[
                { value: "4W", label: "4 สัปดาห์" },
                { value: "12W", label: "12 สัปดาห์" },
                { value: "26W", label: "26 สัปดาห์" },
              ]}
            />
            {/* No endpoint behind this yet. A button that swallows the click
                teaches people the app is broken; one that says why does not. */}
            <Button variant="secondary" size="sm" disabled title="ยังไม่เปิดใช้งานในรุ่นนี้">
              <DownloadIcon /> ส่งออกรายงาน (เร็ว ๆ นี้)
            </Button>
          </>
        }
      />

      <div className="px-6 py-6 lg:px-8">
        {/* ---------- KPI row ---------- */}
        {kpis.state === "LOADING" || !ready ? (
          <LoadingBlock label="กำลังโหลดตัวชี้วัด…" />
        ) : kpis.state === "ERROR" ? (
          <ErrorBlock message={kpis.error ?? ""} onRetry={kpis.reload} />
        ) : (
          <motion.ul
            variants={stagger(0.06)}
            initial="hidden"
            animate="show"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            {(kpis.data ?? []).map((k) => {
              // delta is null when there is no earlier window to compare
              // against — no chip at all beats a "0" that reads as "steady".
              // A delta of exactly 0 is "held steady" — rendering it as a red
              // downward arrow reports a regression that did not happen.
              const positive =
                k.delta === null || k.delta === 0
                  ? null
                  : k.good === "up"
                    ? k.delta > 0
                    : k.delta < 0;
              const progress =
                k.target === null
                  ? null
                  : k.good === "up"
                    ? (k.value / k.target) * 100
                    : (k.target / k.value) * 100;
              return (
                <motion.li
                  key={k.id}
                  variants={listItem}
                  className="rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]"
                >
                  <p className="min-h-[38px] text-[13px] leading-snug text-muted">{k.label}</p>
                  <p className="mt-2 flex items-baseline gap-1.5">
                    <CountUp
                      to={k.value}
                      decimals={k.value % 1 === 0 ? 0 : 1}
                      className="text-[32px] font-bold leading-none tracking-tight"
                    />
                    <span className="text-[15px] font-medium text-muted">{k.unit}</span>
                  </p>
                  {k.delta !== null && (
                    <div className="mt-3 flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[12px] font-semibold",
                          positive === null
                            ? "bg-surface-2 text-muted"
                            : positive
                              ? "bg-ok-soft text-[#07794a]"
                              : "bg-danger-soft text-[#a52218]",
                        )}
                      >
                        {k.delta !== 0 && (
                          <svg
                            width="12" height="12" viewBox="0 0 24 24" fill="none"
                            className={k.delta > 0 ? "" : "rotate-180"}
                            aria-hidden
                          >
                            <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                        <span className="tnum">
                          {Math.abs(k.delta)}
                          {k.unit === "%" ? " จุด" : ""}
                        </span>
                      </span>
                      <span className="text-[12px] text-faint">{k.deltaLabel}</span>
                    </div>
                  )}
                  {progress !== null && k.target !== null && (
                    <div className="mt-3.5 border-t border-line pt-3">
                      <div className="flex items-center justify-between text-[12px] text-muted">
                        <span>เทียบเป้าหมาย</span>
                        <span className="tnum">
                          {k.target}
                          {k.unit === "%" ? "%" : ` ${k.unit}`}
                        </span>
                      </div>
                      <Bar
                        value={Math.min(100, progress)}
                        tone={progress >= 100 ? "ok" : progress >= 85 ? "warn" : "danger"}
                        className="mt-1.5 w-full"
                        height={5}
                      />
                    </div>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        )}

        {/* ---------- trend ---------- */}
        <motion.section
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.25 }}
          className="mt-5 rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold">แนวโน้ม OSA ของพื้นที่</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                ค่าเฉลี่ยถ่วงน้ำหนักตามจำนวนร้านที่ตรวจในแต่ละสัปดาห์
              </p>
            </div>
            <div className="flex items-center gap-4 text-[13px]">
              <Legend color="#1b6fe8" label="OSA จริง" />
              <Legend color="#d92d20" label="เป้าหมาย 90%" dashed />
            </div>
          </div>
          <div className="px-3 py-4 sm:px-5">
            {osa.state === "LOADING" || !ready ? (
              <LoadingBlock label="กำลังโหลดแนวโน้ม…" />
            ) : osa.state === "ERROR" ? (
              <ErrorBlock message={osa.error ?? ""} onRetry={osa.reload} />
            ) : trend.length < 2 ? (
              /* One point is not a trend. Drawing a line through it would
                 imply a direction the data cannot support. */
              <p className="px-2 py-14 text-center text-[14px] leading-relaxed text-muted">
                ยังมีข้อมูลไม่พอสำหรับแนวโน้ม
                <br />
                ต้องมีผลการตรวจอย่างน้อย 2 สัปดาห์จึงจะแสดงกราฟได้
              </p>
            ) : (
              <LineChart data={trend} target={90} targetLabel="เป้าหมาย 90%" height={260} />
            )}
          </div>
        </motion.section>

        {/* ---------- risk table ---------- */}
        <motion.section
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.35 }}
          className="mt-5 overflow-hidden rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold">ร้านที่ต้องเข้าดูแลก่อน</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                จัดอันดับจากระดับร้าน ไม่ใช่จากตัวพนักงาน · คลิกแถวเพื่อดูหลักฐาน
              </p>
            </div>
            <Pill tone="neutral">
              <span className="tnum">{rows.length}</span> ร้าน
            </Pill>
          </div>

          {risk.state === "LOADING" || !ready ? (
            <LoadingBlock label="กำลังจัดอันดับร้าน…" />
          ) : risk.state === "ERROR" ? (
            <div className="p-5">
              <ErrorBlock message={risk.error ?? ""} onRetry={risk.reload} />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-[14px] text-muted">
              ยังไม่มีร้านในพื้นที่นี้
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-surface/60">
                    {["ร้าน", "OSA ล่าสุด", "SKU ที่ขาดซ้ำ", "ตรวจครั้งล่าสุด", "ระดับความเสี่ยง", ""].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <motion.tr
                      key={r.storeId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 + i * 0.03, duration: 0.3, ease: easeOut }}
                      onClick={() => router.push(`/w/stores/${r.storeId}`)}
                      className="cursor-pointer border-b border-line last:border-0 transition-colors hover:bg-surface"
                    >
                      <td className="px-4 py-3">
                        <p className="text-[14px] font-medium">{r.storeName}</p>
                        <p className="text-[12px] text-muted">{r.chain}</p>
                      </td>
                      <td className="px-4 py-3">
                        {/* Never measured is not zero — an empty bar here would
                            read as a shelf stripped bare. */}
                        {r.lastOsa === null ? (
                          <span className="text-[13px] text-muted">ยังไม่เคยตรวจ</span>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="tnum text-[15px] font-semibold">{r.lastOsa}%</span>
                              <Bar
                                value={r.lastOsa}
                                tone={osaTone(r.lastOsa)}
                                className="w-16"
                                height={5}
                                delay={0.45 + i * 0.03}
                              />
                            </div>
                            <OsaSource store={r} className="mt-0.5" />
                          </>
                        )}
                      </td>
                      <td className="tnum px-4 py-3 text-[14px]">{r.repeatGapSkus}</td>
                      <td className="px-4 py-3">
                        {r.daysSinceLastVisit === null ? (
                          <p className="text-[13px] text-muted">ยังไม่เคยเข้า</p>
                        ) : (
                          <p className="tnum text-[14px]">{r.daysSinceLastVisit} วันก่อน</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RiskBadge band={r.riskBand} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* A real link, not a decorated span. The row's onClick
                            serves a mouse; without this a keyboard or screen
                            reader user has no way into a store at all — and
                            this is the only route to the evidence. */}
                        <Link
                          href={`/w/stores/${r.storeId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-btn text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          ดูหลักฐาน<span className="sr-only"> ของ {r.storeName}</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Link>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.section>

        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.5 }}
          className="mt-5 flex items-start gap-2 rounded-card border border-line bg-bg px-4 py-3.5 text-[13px] leading-relaxed text-muted"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-faint" aria-hidden>
            <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
            <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span>
            ระบบนี้รวบรวมข้อมูลในระดับ <strong className="font-semibold text-text">ร้าน</strong> และ{" "}
            <strong className="font-semibold text-text">พื้นที่</strong> เท่านั้น
            ไม่มีการจัดอันดับหรือให้คะแนนพนักงานรายบุคคลในทุกหน้าจอ
            เพราะจะทำให้ข้อมูลถูกบิดเบือนและไม่สามารถนำไปใช้ปรับปรุงงานได้
            <Link href="/w/model-health" className="ml-1 font-medium text-primary underline-offset-2 hover:underline">
              ดูหลักการวัดผล
            </Link>
          </span>
        </motion.p>
      </div>
    </>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <svg width="18" height="8" aria-hidden>
        <line
          x1="0" y1="4" x2="18" y2="4"
          stroke={color} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={dashed ? "5 4" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
