"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useTransform } from "motion/react";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { SkuThumb } from "@/components/shelf/SkuThumb";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import { StateSwitcher } from "@/components/mobile/StateSwitcher";
/* Read here rather than imported from a shared module on purpose: Turbopack
   folds `process.env.NEXT_PUBLIC_DEMO_MODE` into a literal at the use site, but
   a `const` re-exported from another module stays a runtime lookup — the branch
   survives minification and drags the demo-only components into the bundle with
   it. Verified by grepping .next/static both ways. See next.config.ts. */
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
import { BLOCKED_REASONS } from "@/lib/constants";
import { fetchStore } from "@/lib/api/routes";
import { useResource } from "@/lib/api/useResource";
import { messageOf } from "@/lib/api/errors";
import { useFlow } from "@/lib/flow/useFlow";
import { FlowGuardBlock } from "@/components/mobile/FlowGuardBlock";
import { useDemo, useVisitStats } from "@/lib/store";
import type { BlockedReason, Task } from "@/types";
import { listItem, stagger, springSoft, easeOut, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const PRIORITY_LABEL = { 1: "สำคัญสูง", 2: "สำคัญปานกลาง", 3: "สำคัญต่ำ" } as const;
const PRIORITY_TONE = { 1: "danger", 2: "warn", 3: "neutral" } as const;

export default function TaskListScreen() {
  const { id } = useParams<{ id: string }>();
  const flow = useFlow("TASKS");
  const store = useResource(() => fetchStore(id), [id]).data;

  const tasks = useDemo((s) => s.tasks);
  const loadTasks = useDemo((s) => s.loadTasks);
  const setTask = useDemo((s) => s.setTask);
  const visitId = useDemo((s) => s.visitId);
  const requests = useDemo((s) => s.replenishmentRequests);
  const stats = useVisitStats();

  const [view, setView] = useState<"HAS_TASKS" | "PERFECT">("HAS_TASKS");
  const [sheetFor, setSheetFor] = useState<Task | null>(null);
  const [blockFor, setBlockFor] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reloading this screen loses the in-memory list but not the visit, so the
  // tasks are read back from the server rather than reconstructed.
  useEffect(() => {
    if (visitId && !tasks.length) void loadTasks().catch(() => {});
  }, [visitId, tasks.length, loadTasks]);

  async function change(
    taskId: string,
    status: "FIXED" | "BLOCKED",
    reason?: BlockedReason,
  ) {
    setError(null);
    try {
      await setTask(taskId, status, reason);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  const openCount = tasks.filter((t) => t.status === "OPEN").length;
  const allDone = tasks.length > 0 && openCount === 0;
  const showEmpty = (DEMO_MODE && view === "PERFECT") || tasks.length === 0;

  if (flow.blocked) return <FlowGuardBlock flow={flow} />;

  return (
    <>
      <MobileHeader
        title="ต้องทำที่ร้านนี้"
        subtitle={store?.name}
        onBack={flow.back}
        progress={0.8}
        right={
          !showEmpty ? (
            <Pill tone={openCount ? "warn" : "ok"}>
              <span className="tnum">
                {tasks.length - openCount}/{tasks.length}
              </span>
            </Pill>
          ) : undefined
        }
      />

      <Scroll className="px-4 pt-4 pb-5">
        {/* `change` has always recorded this and nothing ever rendered it, so a
            tap that failed to reach the server looked exactly like one that
            worked — the rep walks out believing the shelf is logged. */}
        {error && (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-card border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] leading-relaxed text-[#a52218]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 7.5v5M12 16.2h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span>บันทึกผลไม่สำเร็จ — {error} ลองอีกครั้ง</span>
          </div>
        )}
        {showEmpty ? (
          <PerfectState />
        ) : (
          <>
            <p className="mb-3 px-1 text-[13px] leading-relaxed text-muted">
              เรียงตามความสำคัญของสินค้า · ปัดไปทางขวาเพื่อบันทึกว่าเติมของแล้ว
              หรือแตะเพื่อเลือกผลอื่น
            </p>

            <motion.ul variants={stagger(0.05)} initial="hidden" animate="show" className="flex flex-col gap-2.5">
              <AnimatePresence initial={false}>
                {tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onOpen={() => setSheetFor(t)}
                    onFix={() => void change(t.id, "FIXED")}
                  />
                ))}
              </AnimatePresence>
            </motion.ul>

            <AnimatePresence>
              {requests.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 rounded-card border border-primary/25 bg-primary-soft px-4 py-3.5"
                >
                  <p className="flex items-center gap-2 text-[14px] font-semibold text-primary-ink">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M3 7h13v10H3zM16 10h3.5l1.5 3v4h-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <circle cx="7" cy="18.5" r="1.8" stroke="currentColor" strokeWidth="2" />
                      <circle cx="17.5" cy="18.5" r="1.8" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    ส่งคำขอเติมสินค้าแล้ว <span className="tnum">{requests.length}</span> รายการ
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-primary-ink/80">
                    คำขอถูกส่งไปยังทีมซัพพลายเชนเพื่อพิจารณา ระบบจะไม่ติดต่อร้านค้าโดยอัตโนมัติ
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {DEMO_MODE && (
        <div className="mt-4">
          <StateSwitcher
            value={view}
            onChange={setView}
            options={[
              { value: "HAS_TASKS", label: "มีงาน" },
              { value: "PERFECT", label: "ไม่มีงาน (OSA 100%)" },
            ]}
          />
        </div>
        )}
      </Scroll>

      <BottomBar>
        {showEmpty ? (
          <Button size="lg" full onClick={() => flow.go("CHECKOUT")}>
            เช็คเอาต์จากร้านนี้
          </Button>
        ) : (
          <>
            <Button
              size="lg"
              full
              disabled={!allDone && stats.fixed.length === 0}
              onClick={() => flow.go("COMPARE")}
            >
              {allDone ? "ถ่ายภาพหลังเติมของ" : `เหลืออีก ${openCount} รายการ`}
            </Button>
            {!allDone && stats.fixed.length > 0 && (
              <p className="mt-2 text-center text-[13px] text-muted">
                ถ่ายภาพ After ได้เลย แล้วค่อยกลับมาปิดงานที่เหลือ
              </p>
            )}
          </>
        )}
      </BottomBar>

      {/* outcome picker */}
      <Sheet
        open={!!sheetFor}
        onClose={() => setSheetFor(null)}
        title={sheetFor ? `${sheetFor.skuBrand} ${sheetFor.skuName}` : ""}
        description={sheetFor?.positionLabel}
      >
        <div className="flex flex-col gap-2.5 pb-2">
          <button
            type="button"
            onClick={() => {
              if (sheetFor) void change(sheetFor.id, "FIXED");
              setSheetFor(null);
            }}
            className="flex items-center gap-3 rounded-card border-2 border-line-strong bg-bg px-4 py-4 text-left transition-colors hover:border-ok hover:bg-ok-soft"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>
              <span className="block text-[16px] font-semibold">เติมของแล้ว</span>
              <span className="block text-[13px] text-muted">จะขอให้ถ่ายภาพ After ตอนจบงาน</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setBlockFor(sheetFor);
              setSheetFor(null);
            }}
            className="flex items-center gap-3 rounded-card border-2 border-line-strong bg-bg px-4 py-4 text-left transition-colors hover:border-text hover:bg-surface"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M6 18L18 6" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
            <span>
              <span className="block text-[16px] font-semibold">เติมไม่ได้</span>
              <span className="block text-[13px] text-muted">เลือกเหตุผลเพื่อส่งต่อให้ทีมที่เกี่ยวข้อง</span>
            </span>
          </button>
        </div>
      </Sheet>

      {/* blocked reasons */}
      <Sheet
        open={!!blockFor}
        onClose={() => setBlockFor(null)}
        title="ทำไมถึงเติมของไม่ได้"
        description="ระบบจะบันทึกเหตุผลไว้ในหลักฐาน และส่งต่อให้ทีมที่รับผิดชอบ"
      >
        <ul className="flex flex-col gap-2 pb-2">
          {BLOCKED_REASONS.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  if (blockFor) void change(blockFor.id, "BLOCKED", r.id as BlockedReason);
                  setBlockFor(null);
                }}
                className="w-full rounded-card border border-line-strong bg-bg px-4 py-3.5 text-left transition-colors hover:border-text hover:bg-surface"
              >
                <p className="text-[15px] font-medium">{r.label}</p>
                <p className="mt-0.5 text-[13px] text-muted">{r.hint}</p>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

function TaskRow({
  task,
  onOpen,
  onFix,
}: {
  task: Task;
  onOpen: () => void;
  onFix: () => void;
}) {
  const x = useMotionValue(0);
  const revealOpacity = useTransform(x, [0, 60, 110], [0, 0.6, 1]);
  const settled = task.status !== "OPEN";

  return (
    <motion.li variants={listItem} layout className="relative">
      {/* swipe reveal */}
      {!settled && (
        <motion.div
          style={{ opacity: revealOpacity }}
          className="pointer-events-none absolute inset-0 flex items-center rounded-card bg-ok pl-5"
        >
          <span className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            เติมของแล้ว
          </span>
        </motion.div>
      )}

      <motion.div
        drag={settled ? false : "x"}
        style={{ x }}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.55 }}
        onDragEnd={(_, info) => {
          if (info.offset.x > 110) onFix();
        }}
        transition={springSoft}
        className={cn(
          "relative rounded-card border bg-bg shadow-[var(--shadow-card)]",
          settled ? "border-line" : "border-line-strong",
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          disabled={settled}
          className="flex w-full items-center gap-3 p-3.5 text-left disabled:cursor-default"
        >
          <SkuThumb code={task.skuCode} className={cn(settled && "opacity-45")} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p
                className={cn(
                  "truncate text-[15px] font-semibold leading-snug",
                  task.status === "FIXED" && "text-muted line-through",
                )}
              >
                {task.skuBrand} {task.skuName}
              </p>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              {task.positionLabel} · <span className="tnum">{task.facings}</span> หน้าร้าน
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Pill tone={PRIORITY_TONE[task.priority]} className="text-[12px]">
                {PRIORITY_LABEL[task.priority]}
              </Pill>
              {task.status === "FIXED" && (
                <Pill tone="ok" className="text-[12px]">
                  เติมแล้ว
                </Pill>
              )}
              {task.status === "BLOCKED" && (
                <Pill tone="neutral" className="text-[12px]">
                  {BLOCKED_REASONS.find((r) => r.id === task.blockedReason)?.label}
                </Pill>
              )}
            </div>
          </div>
          {!settled && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-faint" aria-hidden>
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </motion.div>
    </motion.li>
  );
}

function PerfectState() {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      role="status"
      className="flex flex-col items-center rounded-card border border-line bg-bg px-6 py-14 text-center"
    >
      <motion.div
        className="grid size-20 place-items-center rounded-full bg-ok-soft"
        initial={{ scale: 0.7 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.5, ease: easeOut }}
      >
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" className="text-ok" aria-hidden>
          <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.div>
      <h2 className="mt-4 text-[19px] font-semibold">ชั้นวางเต็มสมบูรณ์</h2>
      <p className="mt-1.5 max-w-[260px] text-[14px] leading-relaxed text-muted">
        ไม่พบช่องว่างที่ต้องแก้ไข OSA อยู่ที่ 100% — เช็คเอาต์แล้วไปร้านถัดไปได้เลย
      </p>
    </motion.div>
  );
}
