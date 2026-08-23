"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { me, type CurrentUser } from "@/lib/api/auth";
import { SESSION_EXPIRED_EVENT, hasValidToken } from "@/lib/api/client";
import { messageOf } from "@/lib/api/errors";

/* One place decides whether a screen may render.
 *
 * Every authenticated screen sits under a layout that wraps it in this gate,
 * so no page has to remember to check for a token — the failure mode of
 * per-page checks is that the one page nobody thought about renders a row of
 * failing requests instead of a login prompt. */

const LOGIN_PATH = "/m/login";

interface Session {
  user: CurrentUser | null;
  /** re-reads /v1/me — used after login, and after a role change in the demo */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session>({ user: null, refresh: async () => {} });

/** The signed-in user, or null while loading. Screens that need a name or a
 *  role read it from here rather than holding their own copy. */
export function useSession(): Session {
  return useContext(SessionContext);
}

type State = "CHECKING" | "READY" | "ERROR";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<State>("CHECKING");
  const [error, setError] = useState<string | null>(null);

  const isLoginScreen = pathname === LOGIN_PATH;

  const refresh = useCallback(async () => {
    try {
      setUser(await me());
      setState("READY");
      setError(null);
    } catch (err) {
      setError(messageOf(err));
      setState("ERROR");
    }
  }, []);

  useEffect(() => {
    if (isLoginScreen) {
      setState("READY");
      return;
    }
    if (!hasValidToken()) {
      router.replace(LOGIN_PATH);
      return;
    }
    // The layout survives navigation between screens, so the identity is
    // fetched once and the token re-checked on every move. Re-fetching /v1/me
    // on each screen change would be a request per tap for an answer that
    // cannot have changed.
    if (user) return;
    void refresh();
  }, [isLoginScreen, pathname, refresh, router, user]);

  // A 401 on any request anywhere means the session is gone. The api layer
  // fires this rather than navigating itself, so routing stays in one place.
  useEffect(() => {
    const onExpired = () => router.replace(LOGIN_PATH);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router]);

  if (isLoginScreen) {
    return <SessionContext.Provider value={{ user, refresh }}>{children}</SessionContext.Provider>;
  }

  if (state === "CHECKING") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-0 flex-1 items-center justify-center bg-bg px-6"
      >
        <div className="flex flex-col items-center gap-3">
          <span className="size-7 animate-spin rounded-full border-[3px] border-line-strong border-t-primary" />
          <p className="text-[14px] text-muted">กำลังตรวจสอบสิทธิ์…</p>
        </div>
      </div>
    );
  }

  if (state === "ERROR") {
    return (
      <div
        role="alert"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-bg px-6 text-center"
      >
        <p className="text-[15px] font-semibold">เข้าสู่ระบบไม่สำเร็จ</p>
        <p className="max-w-[300px] text-[14px] leading-relaxed text-muted">{error}</p>
        <button
          type="button"
          onClick={() => {
            setState("CHECKING");
            void refresh();
          }}
          className="mt-1 h-11 rounded-btn bg-primary px-5 text-[15px] font-semibold text-white"
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  return <SessionContext.Provider value={{ user, refresh }}>{children}</SessionContext.Provider>;
}
