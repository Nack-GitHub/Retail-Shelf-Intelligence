"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Logo, Wordmark } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { useFlow } from "@/lib/flow/useFlow";
import { useOnline } from "@/lib/offline/useOnline";
import { fadeUp, listItem, stagger, easeOut } from "@/lib/motion";
import { login } from "@/lib/api/auth";
import { messageOf } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

export default function LoginScreen() {
  const flow = useFlow("LOGIN");
  const online = useOnline();

  // Prefilled with the seeded demo rep so a reviewer is one field from the
  // route screen — the password is still typed, and still checked by the API.
  // Outside a demo build the field starts empty: a real rep's account is not
  // the seeded one, and an address they have to clear first helps nobody.
  const [email, setEmail] = useState(DEMO_MODE ? "rep@shelfeye.demo" : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("กรุณากรอกอีเมล");
      return;
    }
    if (!password) {
      setError("กรุณากรอกรหัสผ่าน");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const user = await login(email, password);
      // A manager sent to the field-rep route screen would see an empty day,
      // so each role lands on the surface built for it. Either way this
      // replaces the sign-in screen rather than stacking on top of it — a back
      // press after signing in used to land on the form again, filled in and
      // apparently signed out.
      if (user.role === "REP") flow.go("ROUTE");
      else flow.exit("/w");
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
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
                {/* Left over from the mock build. login() is a plain network
                    call — there is no offline sign-in, and saying otherwise
                    leaves a rep tapping a button that cannot work. */}
                ไม่มีสัญญาณ — การเข้าสู่ระบบต้องใช้อินเทอร์เน็ต
                เมื่อเข้าสู่ระบบแล้วจึงจะทำงานแบบออฟไลน์ได้
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
          <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-muted">
            อีเมล
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="h-12 w-full rounded-btn border border-line-strong bg-bg px-3.5 text-[16px] outline-none transition-colors focus:border-primary"
          />
        </motion.div>

        <motion.div variants={listItem}>
          <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-muted">
            รหัสผ่าน
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

        {/* Four seeded accounts sharing one password, printed on the screen.
            Reviewers need it; a UAT server must never render it, which is why
            this whole block leaves the bundle when the flag is unset. */}
        {DEMO_MODE && (
        <motion.div variants={listItem} className="mt-2 space-y-2 border-t border-line pt-3">
          <p className="text-center text-[12px] font-medium text-muted">
            เลือกบัญชีสาธิตด่วน (รหัสผ่าน demo1234):
          </p>
          <div className="grid grid-cols-2 gap-1.5 text-[12px]">
            <button
              type="button"
              onClick={() => {
                setEmail("manager@shelfeye.demo");
                setPassword("demo1234");
              }}
              className={cn(
                "rounded-btn border p-2 text-left transition-colors",
                email === "manager@shelfeye.demo"
                  ? "border-primary bg-primary-soft text-primary-ink font-semibold"
                  : "border-line-strong bg-surface text-muted hover:border-primary",
              )}
            >
              <span className="block font-medium">💻 ผู้จัดการพื้นที่</span>
              <span className="block text-[11px] opacity-75">แดชบอร์ด (/w)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEmail("rep@shelfeye.demo");
                setPassword("demo1234");
              }}
              className={cn(
                "rounded-btn border p-2 text-left transition-colors",
                email === "rep@shelfeye.demo"
                  ? "border-primary bg-primary-soft text-primary-ink font-semibold"
                  : "border-line-strong bg-surface text-muted hover:border-primary",
              )}
            >
              <span className="block font-medium">📱 พนักงานตรวจ</span>
              <span className="block text-[11px] opacity-75">แอปมือถือ (/m)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEmail("admin@shelfeye.demo");
                setPassword("demo1234");
              }}
              className={cn(
                "rounded-btn border p-2 text-left transition-colors",
                email === "admin@shelfeye.demo"
                  ? "border-primary bg-primary-soft text-primary-ink font-semibold"
                  : "border-line-strong bg-surface text-muted hover:border-primary",
              )}
            >
              <span className="block font-medium">⚙️ ผู้ดูแลระบบ</span>
              <span className="block text-[11px] opacity-75">แดชบอร์ด (/w)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEmail("data@shelfeye.demo");
                setPassword("demo1234");
              }}
              className={cn(
                "rounded-btn border p-2 text-left transition-colors",
                email === "data@shelfeye.demo"
                  ? "border-primary bg-primary-soft text-primary-ink font-semibold"
                  : "border-line-strong bg-surface text-muted hover:border-primary",
              )}
            >
              <span className="block font-medium">📊 ทีมข้อมูล</span>
              <span className="block text-[11px] opacity-75">แดชบอร์ด (/w)</span>
            </button>
          </div>
        </motion.div>
        )}
      </motion.form>

      <div className="mt-auto flex items-center justify-end border-t border-line pt-4">
        <span className="text-[12px] text-faint">v0.9.0{DEMO_MODE ? " · demo" : ""}</span>
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
