/* Every failure the user can see passes through here.
 *
 * A component should never have to know what a 503 is. It asks for data, and
 * either gets it or gets an ApiError carrying a Thai sentence that says what
 * happened AND what to do next — "ลองใหม่อีกครั้ง" is a instruction, "Internal
 * Server Error" is not. */

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "SERVER"
  | "OFFLINE"
  | "TIMEOUT";

/** Fallbacks, used only when the backend sends no `userMessage` of its own.
 *  The backend's Thai copy always wins: it knows which resource failed. */
const FALLBACK: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง",
  FORBIDDEN: "บัญชีของคุณไม่มีสิทธิ์เข้าถึงส่วนนี้",
  NOT_FOUND: "ไม่พบข้อมูลที่ต้องการ",
  VALIDATION: "ข้อมูลที่ส่งไปไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่",
  CONFLICT: "ข้อมูลนี้ถูกบันทึกไปแล้ว",
  SERVER: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  OFFLINE: "ไม่มีสัญญาณอินเทอร์เน็ต งานถูกเก็บไว้ในเครื่องและจะส่งเมื่อกลับมาออนไลน์",
  TIMEOUT: "เซิร์ฟเวอร์ตอบกลับช้าเกินไป กรุณาลองใหม่อีกครั้ง",
};

function codeFor(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 422) return "VALIDATION";
  return "SERVER";
}

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    /** Thai, shown directly to the user. Never a stack trace, never English. */
    readonly userMessage: string,
    readonly status = 0,
    /** the backend's own error code, e.g. UNREADABLE_IMAGE — for branching */
    readonly serverCode?: string,
  ) {
    super(`${code}: ${userMessage}`);
    this.name = "ApiError";
  }

  /** Reads the backend's error envelope — see `domain_error_handler` in
   *  backend/app/main.py, which emits {errorCode, detail, userMessage}.
   *  FastAPI's own HTTPException sends {detail} alone, so both are handled. */
  static async fromResponse(res: Response): Promise<ApiError> {
    const code = codeFor(res.status);
    let userMessage = FALLBACK[code];
    let serverCode: string | undefined;

    try {
      const body = await res.json();
      serverCode = typeof body?.errorCode === "string" ? body.errorCode : undefined;
      const detail = typeof body?.detail === "string" ? body.detail : undefined;
      userMessage = body?.userMessage || detail || userMessage;
    } catch {
      // A response with no JSON body — a gateway error page, most likely.
      // The fallback message is already correct for that case.
    }

    return new ApiError(code, userMessage, res.status, serverCode);
  }

  static offline() {
    return new ApiError("OFFLINE", FALLBACK.OFFLINE);
  }

  static timeout() {
    return new ApiError("TIMEOUT", FALLBACK.TIMEOUT);
  }
}

/** Anything thrown out of the api layer, rendered for the user.
 *  Non-ApiError throws are a bug, but a screen must still say something
 *  useful rather than going blank. */
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.userMessage;
  return FALLBACK.SERVER;
}
