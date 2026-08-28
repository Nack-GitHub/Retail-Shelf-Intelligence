"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { MobileHeader, Scroll, BottomBar } from "@/components/mobile/Chrome";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import { useDemo } from "@/lib/store";
import { formatBytes, type CapturedPhoto } from "@/lib/capture";
import { listItem, stagger, fadeUp } from "@/lib/motion";
/* Read here rather than imported from a shared module on purpose: Turbopack
   folds `process.env.NEXT_PUBLIC_DEMO_MODE` into a literal at the use site, but
   a `const` re-exported from another module stays a runtime lookup — the branch
   survives minification and drags the demo-only components into the bundle with
   it. Verified by grepping .next/static both ways. See next.config.ts. */
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/** Everything the intake step recorded this session. Stands in for the
 *  upload log until the API exists — and unlike a console, it is readable
 *  on the phone that took the photo. */
export default function CaptureLogScreen() {
  /* A detour, not a step: this screen can be opened from the camera, from the
     result, or from the route list, and "back" honestly means whichever of
     those the rep came from. That is the one case where the browser's history
     is the right answer rather than a coincidence. */
  const router = useRouter();
  const log = useDemo((s) => s.photoLog);
  const clear = useDemo((s) => s.clearPhotoLog);

  /* Capture ids, idempotency keys and the face-blur method are debugging
     output, not something a rep has any use for. The screen that answers
     their actual question — "has my work been sent?" — is the sync queue, so
     outside a demo build this route hands over to it rather than 404ing on a
     link somebody bookmarked. */
  useEffect(() => {
    if (!DEMO_MODE) router.replace("/m/sync");
  }, [router]);

  const totalBytes = log.reduce((n, p) => n + p.bytes, 0);

  if (!DEMO_MODE) return null;

  return (
    <>
      <MobileHeader
        onBack={() => router.back()}
        title="บันทึกภาพในเครื่อง"
        subtitle={
          log.length
            ? `${log.length} ภาพ · ${formatBytes(totalBytes)} · ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์`
            : "ยังไม่มีภาพในรอบนี้"
        }
      />

      <Scroll className="px-4 pt-4 pb-5">
        <div className="mb-4 flex items-start gap-2.5 rounded-card bg-primary-soft px-3.5 py-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-primary" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 16v-4.5M12 8.2h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <p className="text-[13px] leading-relaxed text-primary-ink">
            ทุกภาพที่ถ่ายหรืออัปโหลดจะผ่านฟังก์ชันรับภาพชุดเดียวกัน
            ย่อขนาดให้ไม่เกิน 1920 px แล้วบันทึกไว้ในหน้านี้
            <strong className="font-semibold"> การส่งขึ้นระบบเกิดที่หน้าประมวลผล</strong>{" "}
            หลังผู้ถ่ายกด “ใช้ภาพนี้” — หน้านี้เป็นบันทึกในเครื่อง ไม่ใช่คิวรอส่ง
            <span className="mt-1 block text-primary-ink/75">
              บันทึกนี้อยู่ในหน่วยความจำของแท็บ — รีเฟรชหน้าแล้วจะหาย
            </span>
          </p>
        </div>

        {log.length === 0 ? (
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            role="status"
            className="flex flex-col items-center rounded-card border border-line bg-bg px-6 py-14 text-center"
          >
            <div className="grid size-16 place-items-center rounded-full bg-surface-2 text-muted">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="3" y="6" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="2" />
                <path d="M8.5 6l1.2-2h4.6L15.5 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="mt-4 text-[17px] font-semibold">ยังไม่มีภาพในรอบนี้</h2>
            <p className="mt-1.5 max-w-[260px] text-[14px] leading-relaxed text-muted">
              ถ่ายภาพชั้นวางหรืออัปโหลดรูปจากเครื่อง แล้วรายละเอียดจะมาแสดงที่นี่
            </p>
          </motion.div>
        ) : (
          <motion.ul variants={stagger(0.05)} initial="hidden" animate="show" className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {log.map((p) => (
                <LogRow key={p.id} photo={p} />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </Scroll>

      <BottomBar>
        <Button variant="secondary" size="lg" full disabled={log.length === 0} onClick={clear}>
          ล้างบันทึกภาพ
        </Button>
      </BottomBar>
    </>
  );
}

function LogRow({ photo }: { photo: CapturedPhoto }) {
  const t = new Date(photo.capturedAt);
  return (
    <motion.li
      variants={listItem}
      layout
      exit={{ opacity: 0, scale: 0.97 }}
      className="overflow-hidden rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
    >
      <div className="flex gap-3 p-3">
        <span className="relative block size-[72px] shrink-0 overflow-hidden rounded-inset bg-surface-2">
          <Image src={photo.objectUrl} alt="" fill unoptimized sizes="72px" className="object-cover" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={photo.source === "CAMERA" ? "primary" : "neutral"} className="text-[12px]">
              {photo.source === "CAMERA" ? "ถ่ายจากกล้อง" : "อัปโหลดจากเครื่อง"}
            </Pill>
            <Pill tone="neutral" className="text-[12px]">
              {photo.phase === "BEFORE" ? "ก่อนเติมของ" : "หลังเติมของ"}
            </Pill>
            {!photo.faceBlur.applied && (
              <Pill tone="warn" className="text-[12px]">
                ยังไม่เบลอใบหน้า
              </Pill>
            )}
          </div>
          <p className="tnum mt-1.5 text-[14px] font-semibold">
            {photo.width}×{photo.height} · {formatBytes(photo.bytes)}
          </p>
          <p className="tnum text-[13px] text-muted">
            เดิม {photo.original.width}×{photo.original.height} ·{" "}
            {formatBytes(photo.original.bytes)}
          </p>
          <p className="tnum mt-0.5 text-[12px] text-faint">
            {t.toLocaleTimeString("th-TH")} · ประมวลผล {photo.processingMs} ms
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line bg-surface/50 px-3 py-2.5">
        <dt className="text-[12px] text-muted">capture id</dt>
        <dd className="truncate font-mono text-[12px]">{photo.id}</dd>
        <dt className="text-[12px] text-muted">idempotency</dt>
        <dd className="truncate font-mono text-[12px]">{photo.idempotencyKey}</dd>
        <dt className="text-[12px] text-muted">face blur</dt>
        <dd className="truncate font-mono text-[12px]">
          applied={String(photo.faceBlur.applied)} · {photo.faceBlur.method.toLowerCase()}
        </dd>
      </dl>
    </motion.li>
  );
}
