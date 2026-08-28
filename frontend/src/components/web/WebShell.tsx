"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { useSession } from "@/components/auth/AuthGate";
import { fetchAreas, type Area } from "@/lib/api/analytics";
import { logout } from "@/lib/api/auth";
import { useResource } from "@/lib/api/useResource";
import { springSoft } from "@/lib/motion";
import { cn } from "@/lib/cn";

/* The area picker lives in the shell, and every screen under it reports on
   whichever area is selected. Passing it through context rather than a query
   param keeps the pages from each inventing their own default. */

interface AreaSelection {
  /** undefined means "all areas" — the API treats a missing areaId that way */
  areaId: string | undefined;
  areaName: string;
  areas: Area[];
  setAreaId: (id: string | undefined) => void;
  /** false until the default area is chosen.
   *
   *  Screens gate their queries on this. Without it every area-scoped
   *  request fires twice on load — once unscoped before /v1/areas resolves,
   *  then again for the manager's own area — and the dashboard briefly shows
   *  numbers for the whole country. */
  ready: boolean;
}

const AreaContext = createContext<AreaSelection>({
  areaId: undefined,
  areaName: "ทุกพื้นที่",
  areas: [],
  setAreaId: () => {},
  ready: false,
});

export function useArea(): AreaSelection {
  return useContext(AreaContext);
}

const NAV = [
  { href: "/w", label: "ภาพรวมพื้นที่", code: "W1", icon: GridIcon },
  { href: "/w/routes", label: "วางแผนเส้นทาง", code: "W4", icon: RouteIcon },
  { href: "/w/model-health", label: "สุขภาพของโมเดล", code: "W5", icon: PulseIcon },
  { href: "/w/relabel", label: "คิวตรวจภาพ", code: "W6", icon: LayersIcon },
] as const;

export function WebShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useSession();
  const areasResource = useResource(() => fetchAreas(), []);
  const areas = useMemo(() => areasResource.data ?? [], [areasResource.data]);
  const [areaId, setAreaId] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);

  // Default to the manager's own area once it is known, rather than to
  // whichever area happens to sort first.
  useEffect(() => {
    if (ready) return;
    // An empty area list is still an answer: there is nothing to scope to,
    // so screens should stop waiting and query unscoped.
    if (areasResource.state === "ERROR" || (areasResource.state === "READY" && areas.length === 0)) {
      setReady(true);
      return;
    }
    if (areas.length === 0) return;
    const own = user?.areaId && areas.some((a) => a.id === user.areaId) ? user.areaId : areas[0].id;
    setAreaId(own);
    setReady(true);
  }, [areas, ready, user?.areaId, areasResource.state]);

  const selection: AreaSelection = {
    areaId,
    areaName: areas.find((a) => a.id === areaId)?.name ?? "ทุกพื้นที่",
    areas,
    setAreaId,
    ready,
  };

  if (user?.role === "REP") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0a0e14] p-6 text-center text-[#f2f5f9]">
        <div className="max-w-[440px] rounded-card border border-white/10 bg-[#131922] p-7 shadow-2xl">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-[#f79009]/20 text-[#f79009]">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-[18px] font-bold text-white">เฉพาะผู้จัดการและทีมข้อมูล</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#93a0b3]">
            คุณกำลังเข้าสู่ระบบด้วยบัญชี <strong className="text-white">พนักงานภาคสนาม ({user.email})</strong> ซึ่งออกแบบมาสำหรับแอปมือถือ (/m)
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[#93a0b3]">
            หากต้องการดูแดชบอร์ด Web Admin กรุณาสลับไปใช้บัญชี <strong className="text-white">manager@shelfeye.demo</strong> หรือ <strong className="text-white">admin@shelfeye.demo</strong>
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => {
                logout();
                // Replace: a signed-out session is not somewhere to go back
                // into, and pushing left the dashboard one press away.
                router.replace("/m/login");
              }}
              className="h-11 w-full rounded-btn bg-primary text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              สลับเป็นบัญชีผู้จัดการ / แอดมิน
            </button>
            <Link
              href="/m"
              className="flex h-11 w-full items-center justify-center rounded-btn border border-white/15 bg-transparent text-[14px] font-medium text-white transition-colors hover:bg-white/5"
            >
              ไปยังแอปมือถือ (/m)
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AreaContext.Provider value={selection}>
    <div className="min-h-dvh bg-surface lg:grid lg:grid-cols-[248px_1fr]">
      {/* ---------- sidebar ---------- */}
      <aside className="sticky top-0 z-40 border-b border-line bg-bg lg:h-dvh lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <Logo size={32} />
          <span className="text-[16px] font-bold tracking-tight">
            Shelf<span className="text-primary">Eye</span>
          </span>
          <span className="ml-auto rounded-pill bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted lg:ml-0">
            demo
          </span>
        </div>

        <nav className="scroll-x flex gap-1 px-3 pb-3 lg:flex-col lg:pb-0">
          {NAV.map((item) => {
            const active =
              item.href === "/w" ? pathname === "/w" || pathname.startsWith("/w/stores") : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 shrink-0 items-center gap-2.5 rounded-btn px-3 text-[14px] font-medium transition-colors",
                  active ? "text-primary-ink" : "text-muted hover:bg-surface hover:text-text",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-btn bg-primary-soft"
                    transition={springSoft}
                  />
                )}
                <span className="relative"><Icon /></span>
                <span className="relative whitespace-nowrap">{item.label}</span>
                <span className="relative ml-auto hidden text-[11px] font-semibold text-faint lg:block">
                  {item.code}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden lg:mt-auto lg:block lg:px-3 lg:pb-4">
          <div className="mt-6 rounded-card border border-line bg-surface p-3.5">
            <p className="text-[12px] font-medium text-muted">พื้นที่รับผิดชอบ</p>
            <label className="sr-only" htmlFor="area">เลือกพื้นที่</label>
            <select
              id="area"
              value={areaId ?? ""}
              onChange={(e) => setAreaId(e.target.value || undefined)}
              className="mt-1.5 h-9 w-full rounded-inset border border-line-strong bg-bg px-2 text-[13px] outline-none focus:border-primary"
            >
              <option value="">ทุกพื้นที่</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.storeCount})
                </option>
              ))}
            </select>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-ink">
                  {user?.fullName.slice(0, 1) ?? "?"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{user?.fullName ?? "—"}</p>
                  <p className="truncate text-[12px] text-muted">{ROLE_LABELS[user?.role ?? ""] ?? ""}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  logout();
                  router.replace("/m/login");
                }}
                title="ออกจากระบบ / สลับบัญชี"
                className="flex items-center gap-1 rounded-btn px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-danger"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                ออก
              </button>
            </div>
          </div>
          <Link
            href="/"
            className="mt-3 block px-1 text-[12px] text-faint underline-offset-4 hover:text-muted hover:underline"
          >
            กลับหน้าเลือกแพลตฟอร์ม
          </Link>
        </div>
      </aside>

      <div className="min-w-0">{children}</div>
      </div>
    </AreaContext.Provider>
  );
}

const ROLE_LABELS: Record<string, string> = {
  REP: "พนักงานภาคสนาม",
  MANAGER: "ผู้จัดการพื้นที่",
  ADMIN: "ผู้ดูแลระบบ",
  DATA: "ทีมข้อมูล",
};

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="border-b border-line bg-bg px-6 py-5 lg:px-8">
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-text"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function RouteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M6 8v4a4 4 0 004 4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 12h3.5l2.5-6 4 12 2.5-6H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M3 13l9 5 9-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
