"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { CaptureFrame } from "@/components/shelf/CaptureFrame";
import { DetectionOverlay, type OverlayFilter } from "@/components/shelf/DetectionOverlay";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { Button } from "@/components/ui/Button";
import { OsaStatusPill, Pill } from "@/components/ui/Badge";
import { CountUp } from "@/components/ui/Progress";
import { StateSwitcher } from "@/components/mobile/StateSwitcher";
import { fetchStore } from "@/lib/api/routes";
import { fetchCategories } from "@/lib/api/catalog";
import { useResource } from "@/lib/api/useResource";
import { useDemo } from "@/lib/store";
import { fadeUp, listItem, stagger, springSoft } from "@/lib/motion";
import { cn } from "@/lib/cn";

type View = "NORMAL" | "LOW_CONF" | "NO_SHELF";

export default function ResultScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const analysis = useDemo((s) => s.analysis);
  const photo = useDemo((s) => s.photo);
  const findings = useDemo((s) => s.findings);
  const categoryId = useDemo((s) => s.categoryId);
  const bay = useDemo((s) => s.bay);

  const store = useResource(() => fetchStore(id), [id]).data;
  const catalog = useResource(() => fetchCategories(id), [id]).data;
  const cat = catalog?.find((c) => c.id === categoryId) ?? null;

  const [view, setView] = useState<View>("NORMAL");
  const [filter, setFilter] = useState<OverlayFilter>("ALL");
  const [expanded, setExpanded] = useState(false);

  const gapCount = findings.length;
  // The server's own verdict, not a threshold guessed on this side.
  const lowConf = findings.filter((f) => f.isLowConfidence).length;

  const chips = useMemo(
    () =>
      [
        { id: "ALL" as const, label: "ทั้งหมด", count: null, dot: null },
        { id: "GAP" as const, label: "ช่องว่าง", count: gapCount, dot: "bg-danger" },
        { id: "PRODUCT" as const, label: "มีสินค้า", count: null, dot: "bg-ok" },
        { id: "LOW_CONF" as const, label: "ต้องตรวจสอบ", count: lowConf, dot: "bg-uncertain" },
        { id: "TAG" as const, label: "ป้ายราคา", count: null, dot: "bg-[#7fb0ff]" },
      ] satisfies { id: OverlayFilter; label: string; count: number | null; dot: string | null }[],
    [gapCount, lowConf],
  );

  if (view === "NO_SHELF") {
    return <NoShelfState onRetake={() => router.push(`/m/store/${id}/capture`)} onSwitch={setView} view={view} />;
  }

  // No analysis in memory — a reload, or someone deep-linking here. Say so and
  // offer the way back, rather than rendering an empty shell.
  if (!analysis) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
        <h1 className="text-[18px] font-semibold">ยังไม่มีผลการตรวจ</h1>
        <p className="max-w-[280px] text-[14px] leading-relaxed text-muted">
          ผลการตรวจจะแสดงที่นี่หลังถ่ายภาพชั้นวาง
        </p>
        <Button size="lg" onClick={() => router.replace(`/m/store/${id}/capture`)}>
          เปิดกล้อง
        </Button>
      </div>
    );
  }

  return (
    <>
      <MobileHeader
        title="ผลการตรวจชั้นวาง"
        subtitle={[store?.name, cat && `${cat.name} ชั้น ${bay ?? ""}`.trim()]
          .filter(Boolean)
          .join(" · ")}
        progress={0.62}
        right={
          <Pill tone="neutral" className="text-[12px]">
            <span className="tnum">{(analysis.inferenceMs / 1000).toFixed(1)} วิ</span>
          </Pill>
        }
      />

      {/* ---------- photo + detections ---------- */}
      <motion.div
        layout
        transition={springSoft}
        className={cn(
          "relative flex shrink-0 items-center overflow-hidden bg-ink",
          expanded ? "min-h-0 flex-1" : "w-full",
        )}
      >
        <div
          className="relative w-full"
          style={{ aspectRatio: `${analysis.imageWidth} / ${analysis.imageHeight}` }}
        >
          <CaptureFrame photo={photo} imageUrl={analysis.imageUrl} fit="contain" />
          <DetectionOverlay
            detections={analysis.detections}
            findings={findings}
            filter={filter}
            fit="contain"
            imageWidth={analysis.imageWidth}
            imageHeight={analysis.imageHeight}
            lowConfidenceThreshold={analysis.lowConfidenceThreshold}
          />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="absolute right-3 top-3 grid size-10 place-items-center rounded-btn bg-ink/70 text-ink-text backdrop-blur-sm transition-colors hover:bg-ink/90"
          aria-label={expanded ? "ย่อภาพ" : "ขยายภาพ"}
        >
          {expanded ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 3v6H3M15 21v-6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M3 9V3h6M21 15v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1.5 rounded-pill bg-ink/70 px-2.5 py-1.5 backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-ok" aria-hidden />
            <span className="text-[12px] font-medium text-ink-text">{analysis.modelVersion}</span>
          </span>
        </div>
      </motion.div>

      {/* ---------- filter chips ---------- */}
      <div className="shrink-0 border-b border-line bg-bg">
        <motion.div
          variants={stagger(0.035, 0.15)}
          initial="hidden"
          animate="show"
          className="scroll-x flex gap-2 px-4 py-3"
        >
          {chips.map((c) => {
            const active = filter === c.id;
            return (
              <motion.button
                key={c.id}
                variants={listItem}
                type="button"
                onClick={() => setFilter(c.id)}
                aria-pressed={active}
                className={cn(
                  "relative flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-medium transition-colors",
                  active ? "text-white" : "bg-surface-2 text-muted hover:text-text",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="chip-active"
                    className="absolute inset-0 rounded-pill bg-text"
                    transition={springSoft}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  {c.dot && <span className={cn("size-1.5 rounded-full", c.dot)} aria-hidden />}
                  {c.label}
                  {c.count !== null && <span className="tnum opacity-70">{c.count}</span>}
                </span>
              </motion.button>
            );
          })}
        </motion.div>
      </div>

      {/* ---------- summary ---------- */}
      <Scroll className="px-4 pt-4 pb-5">
        <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="flex flex-col gap-3">
          <motion.div
            variants={listItem}
            className="rounded-card border border-line bg-bg p-4 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-muted">OSA ของชั้นวางนี้</p>
                <p className="mt-0.5 flex items-baseline gap-1">
                  <CountUp to={analysis.osaScore} className="text-[44px] font-bold leading-none tracking-tight" />
                  <span className="text-[22px] font-bold leading-none text-muted">%</span>
                </p>
              </div>
              <OsaStatusPill status={analysis.status} className="mb-1.5" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <CountTile tone="danger" value={gapCount} label="ช่องว่าง" />
              <CountTile tone="warn" value={lowConf} label="ต้องตรวจสอบ" />
            </div>

            <p className="mt-3.5 border-t border-line pt-3 text-[13px] leading-relaxed text-muted">
              ตัวเลขทุกตัวอ้างอิงจากภาพด้านบนโดยตรง กดที่ชิปเพื่อดูว่าจุดไหนถูกนับเป็นอะไร
            </p>
          </motion.div>

          <AnimatePresence>
            {(view === "LOW_CONF" || lowConf > 0) && (
              <motion.div
                variants={listItem}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-2.5 rounded-card border border-line-strong bg-uncertain-soft px-3.5 py-3"
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-muted" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
                  <path d="M12 16v-4.5M12 8.2h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                <div>
                  <p className="text-[14px] font-medium">
                    มี <span className="tnum">{lowConf}</span> จุดที่ระบบไม่มั่นใจ
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                    จุดที่เป็นเส้นประต้องให้คุณตัดสินใจ ระบบจะไม่นับเป็นช่องว่างจนกว่าคุณจะยืนยัน
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div variants={listItem}>
            <StateSwitcher
              value={view}
              onChange={setView}
              options={[
                { value: "NORMAL", label: "ปกติ" },
                { value: "LOW_CONF", label: "ความมั่นใจต่ำ" },
                { value: "NO_SHELF", label: "ไม่พบชั้นวาง" },
              ]}
            />
          </motion.div>
        </motion.div>
      </Scroll>

      <BottomBar>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={() => router.push(`/m/store/${id}/capture`)}
          >
            ถ่ายใหม่
          </Button>
          <Button size="lg" className="flex-[1.6]" onClick={() => router.push(`/m/store/${id}/verify`)}>
            ตรวจสอบทีละจุด
          </Button>
        </div>
      </BottomBar>
    </>
  );
}

function CountTile({
  tone,
  value,
  label,
}: {
  tone: "danger" | "warn";
  value: number;
  label: string;
}) {
  const styles = {
    danger: "bg-danger-soft text-[#a52218]",
    warn: "bg-warn-soft text-[#b45f04]",
  } as const;
  const dots = { danger: "bg-danger", warn: "bg-warn" } as const;
  return (
    <div className={cn("rounded-chip px-3.5 py-3", styles[tone])}>
      <span className="flex items-center gap-1.5 text-[13px] font-medium">
        <span className={cn("size-2 rounded-full", dots[tone])} aria-hidden />
        {label}
      </span>
      <p className="mt-1 text-[24px] font-bold leading-none">
        <CountUp to={value} /> <span className="text-[15px] font-semibold">จุด</span>
      </p>
    </div>
  );
}

function NoShelfState({
  onRetake,
  onSwitch,
  view,
}: {
  onRetake: () => void;
  onSwitch: (v: View) => void;
  view: View;
}) {
  return (
    <>
      <MobileHeader title="ผลการตรวจชั้นวาง" progress={0.62} />
      <Scroll className="flex flex-col px-4 pt-4 pb-5">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          role="status"
          className="flex flex-col items-center rounded-card border border-line bg-bg px-6 py-12 text-center"
        >
          <div className="grid size-16 place-items-center rounded-full bg-warn-soft">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-warn" aria-hidden>
              <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="mt-4 text-[18px] font-semibold">ไม่พบชั้นวางในภาพนี้</h2>
          <p className="mt-1.5 max-w-[270px] text-[14px] leading-relaxed text-muted">
            ระบบมองไม่เห็นแนวชั้นวางที่ชัดพอ ลองถอยออกให้เห็นทั้งชั้น
            และให้แนวชั้นวางขนานกับขอบจอ
          </p>
          <ul className="mt-5 w-full space-y-2 text-left">
            {["ถอยห่างประมาณ 1.5–2 เมตร", "ให้เห็นขอบชั้นวางทั้งบนและล่าง", "หลีกเลี่ยงการถ่ายย้อนแสง"].map((t) => (
              <li key={t} className="flex items-start gap-2 text-[14px] text-muted">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </motion.div>

        <div className="mt-4">
          <StateSwitcher
            value={view}
            onChange={onSwitch}
            options={[
              { value: "NORMAL", label: "ปกติ" },
              { value: "LOW_CONF", label: "ความมั่นใจต่ำ" },
              { value: "NO_SHELF", label: "ไม่พบชั้นวาง" },
            ]}
          />
        </div>
      </Scroll>
      <BottomBar>
        <Button size="lg" full onClick={onRetake}>
          ถ่ายใหม่อีกครั้ง
        </Button>
      </BottomBar>
    </>
  );
}
