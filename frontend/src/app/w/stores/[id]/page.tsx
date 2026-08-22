"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import { PageHeader } from "@/components/web/WebShell";
import { EvidenceViewer } from "@/components/web/EvidenceViewer";
import { Sparkline, LineChart } from "@/components/charts/LineChart";
import { Heatmap } from "@/components/charts/Heatmap";
import { CountUp, Bar } from "@/components/ui/Progress";
import { RiskBadge, Pill, OsaStatusPill, osaStatusOf } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { getStore } from "@/lib/mock/data";
import {
  DOW,
  EVIDENCE_TIMELINE,
  OOS_HEATMAP,
  RISK_RANKING,
  STORE_OSA_HISTORY,
  type EvidenceItem,
} from "@/lib/mock/analytics";
import { fadeUp, listItem, stagger, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

export default function StoreDetail() {
  const { id } = useParams<{ id: string }>();
  const store = getStore(id);
  const row = RISK_RANKING.find((r) => r.storeId === id);
  const [evidence, setEvidence] = useState<EvidenceItem | null>(null);

  const osa = row?.osa ?? store.lastOsa;

  return (
    <>
      <PageHeader
        title={row?.name ?? store.name}
        subtitle={`${row?.chain ?? store.chain} · ${store.externalCode} · ${store.address}`}
        back={{ href: "/w", label: "ภาพรวมพื้นที่" }}
        actions={
          <>
            <RiskBadge band={row?.risk ?? store.riskBand} />
            <Button variant="secondary" size="sm">
              เพิ่มเข้าเส้นทางสัปดาห์หน้า
            </Button>
          </>
        }
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
                <p className="mt-1 flex items-baseline gap-1">
                  <CountUp to={osa} className="text-[40px] font-bold leading-none tracking-tight" />
                  <span className="text-[20px] font-bold text-muted">%</span>
                </p>
              </div>
              <OsaStatusPill status={osaStatusOf(osa)} />
            </div>

            <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-4">
              <div>
                <p className="text-[12px] text-muted">12 สัปดาห์ย้อนหลัง</p>
                <Sparkline values={STORE_OSA_HISTORY} width={150} height={40} color="#1b6fe8" />
              </div>
              <div className="text-right">
                <p className="text-[12px] text-muted">ค่าเฉลี่ยพื้นที่</p>
                <p className="tnum text-[18px] font-semibold">83.4%</p>
              </div>
            </div>

            <dl className="mt-4 space-y-2.5 border-t border-line pt-4">
              <Fact label="SKU ที่ขาดซ้ำ" value={`${row?.repeatGapSkus ?? store.repeatGapSkus} รายการ`} />
              <Fact label="เข้าตรวจครั้งล่าสุด" value={`${row?.lastVisit ?? "16 ส.ค."} (${row?.daysSince ?? store.daysSinceLastVisit} วันก่อน)`} />
              <Fact label="รูปแบบร้าน" value={store.chain} />
              <Fact
                label="นโยบายการถ่ายภาพ"
                value={store.photoPolicy === "ALLOWED" ? "อนุญาต" : store.photoPolicy === "RESTRICTED" ? "มีเงื่อนไข" : "ไม่อนุญาต"}
              />
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
                ทุกจุดบนกราฟกดเข้าไปดูภาพต้นฉบับได้จากไทม์ไลน์ด้านล่าง
              </p>
            </div>
            <div className="px-3 py-4 sm:px-5">
              <LineChart
                data={STORE_OSA_HISTORY.map((v, i) => ({ label: `W${31 + i}`, value: v }))}
                target={90}
                targetLabel="เป้าหมาย 90%"
                height={230}
                decimals={0}
              />
            </div>
          </motion.section>
        </motion.div>

        {/* ---- heatmap ---- */}
        <motion.section
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.25 }}
          className="mt-5 rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold">SKU ที่ขาดบ่อย แยกตามวันในสัปดาห์</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                จำนวนครั้งที่ตรวจพบว่าขาดใน 12 สัปดาห์ล่าสุด · ตัวเลขในช่องคือจำนวนครั้ง
              </p>
            </div>
            <Pill tone="danger">ขาดหนักช่วงศุกร์–เสาร์</Pill>
          </div>
          <div className="px-5 py-4">
            <Heatmap rows={OOS_HEATMAP} columns={DOW} />
            <p className="mt-4 rounded-card bg-surface px-3.5 py-3 text-[13px] leading-relaxed text-muted">
              <strong className="font-semibold text-text">สิ่งที่อ่านได้จากตารางนี้:</strong>{" "}
              สินค้ากลุ่มกาแฟพร้อมดื่มขาดหนักสุดในวันศุกร์และเสาร์
              การเลื่อนรอบเติมของมาก่อนวันศุกร์น่าจะได้ผลมากกว่าการเพิ่มรอบเข้าร้าน
            </p>
          </div>
        </motion.section>

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

          <ol className="divide-y divide-line">
            {EVIDENCE_TIMELINE.map((e, i) => (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.06, duration: 0.35, ease: easeOut }}
                className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-surface/60"
              >
                <div className="w-[112px] shrink-0">
                  <p className="text-[14px] font-semibold">{e.date}</p>
                  <p className="tnum text-[13px] text-muted">{e.time} น.</p>
                </div>

                <div className="min-w-[150px] flex-1">
                  <p className="text-[14px]">
                    {e.category} · ชั้น {e.bay}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="tnum text-[13px] text-muted">{e.osaBefore}%</span>
                    <span className="text-faint" aria-hidden>→</span>
                    <span className="tnum text-[14px] font-semibold text-ok">{e.osaAfter}%</span>
                    <Bar value={e.osaAfter ?? e.osaBefore} tone="ok" className="w-16" height={5} delay={0.5 + i * 0.06} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Pill tone="danger" className="text-[12px]">
                    พบ <span className="tnum">{e.gaps}</span>
                  </Pill>
                  <Pill tone="ok" className="text-[12px]">
                    แก้ <span className="tnum">{e.fixed}</span>
                  </Pill>
                  {e.disputed && (
                    <Pill tone="warn" className="text-[12px]">
                      กำลังโต้แย้ง
                    </Pill>
                  )}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEvidence(e)}>
                    ดูภาพหลักฐาน
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEvidence(e)}>
                    โต้แย้งผลนี้
                  </Button>
                </div>
              </motion.li>
            ))}
          </ol>
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

      <EvidenceViewer item={evidence} storeName={row?.name ?? store.name} onClose={() => setEvidence(null)} />
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
