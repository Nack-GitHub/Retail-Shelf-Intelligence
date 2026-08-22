"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Logo, Wordmark } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Controls";
import { useDemo } from "@/lib/store";
import { fadeUp, listItem, stagger, easeOut } from "@/lib/motion";
import { CURRENT_USER } from "@/lib/mock/data";

export default function LoginScreen() {
  const router = useRouter();
  const online = useDemo((s) => s.online);
  const setOnline = useDemo((s) => s.setOnline);

  const [code, setCode] = useState(CURRENT_USER.employeeCode);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) {
      setError("กรุณากรอกรหัสพนักงาน");
      return;
    }
    if (pin.length > 0 && pin.length < 4) {
      setError("รหัสผ่านต้องมีอย่างน้อย 4 ตัว");
      return;
    }
    setError(null);
    setBusy(true);
    window.setTimeout(() => router.push("/m"), 620);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg px-6 pt-8 pb-[max(20px,env(safe-area-inset-bottom))]">
      <AnimatePresence>
        {!online && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="mb-5 overflow-hidden"
          >
            <div className="flex items-start gap-2.5 rounded-card bg-warn-soft px-3.5 py-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-warn" aria-hidden>
                <path d="M2 8.8a16 16 0 0120 0M5.5 12.4a11 11 0 0113 0M9 16a6 6 0 016 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 20h.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p className="text-[13px] leading-relaxed text-[#b45f04]">
                ไม่มีสัญญาณ — จะเข้าสู่ระบบด้วยข้อมูลที่บันทึกไว้ในเครื่อง
                และซิงก์เมื่อกลับมาออนไลน์
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={fadeUp} initial="hidden" animate="show" className="pt-4">
        <Logo size={56} />
        <h1 className="mt-5 text-[26px] font-bold leading-tight tracking-tight">
          เข้าสู่ระบบ <Wordmark className="text-[26px]" />
        </h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
          ตรวจชั้นวางด้วยกล้องมือถือ รู้ผลก่อนเดินออกจากร้าน
        </p>
      </motion.div>

      <motion.form
        variants={stagger(0.06, 0.14)}
        initial="hidden"
        animate="show"
        onSubmit={submit}
        className="mt-7 flex flex-col gap-3.5"
      >
        <motion.div variants={listItem}>
          <label htmlFor="code" className="mb-1.5 block text-[13px] font-medium text-muted">
            รหัสพนักงาน
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="username"
            className="h-12 w-full rounded-btn border border-line-strong bg-bg px-3.5 text-[16px] outline-none transition-colors focus:border-primary"
          />
        </motion.div>

        <motion.div variants={listItem}>
          <label htmlFor="pin" className="mb-1.5 block text-[13px] font-medium text-muted">
            รหัสผ่าน
          </label>
          <input
            id="pin"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••••"
            autoComplete="current-password"
            aria-describedby={error ? "login-error" : undefined}
            aria-invalid={!!error}
            className="h-12 w-full rounded-btn border border-line-strong bg-bg px-3.5 text-[16px] outline-none transition-colors placeholder:text-faint focus:border-primary"
          />
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.p
              id="login-error"
              role="alert"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: [0, -7, 6, -4, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.36, ease: easeOut }}
              className="flex items-center gap-1.5 text-[13px] font-medium text-danger"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 7.5v5.5M12 16.2h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <motion.div variants={listItem} className="pt-1">
          <Button type="submit" size="lg" full disabled={busy}>
            {busy ? (
              <>
                <Spinner /> กำลังเข้าสู่ระบบ
              </>
            ) : (
              "เข้าสู่ระบบ"
            )}
          </Button>
        </motion.div>

        <motion.p variants={listItem} className="text-center text-[13px] text-faint">
          โหมดสาธิต — กดปุ่มเข้าสู่ระบบได้ทันที
        </motion.p>
      </motion.form>

      <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
        <Toggle checked={online} onChange={setOnline} label="จำลองสถานะออนไลน์" />
        <span className="text-[12px] text-faint">v0.9.0 · demo</span>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <motion.span
      className="size-4 rounded-full border-2 border-white/35 border-t-white"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
    />
  );
}
