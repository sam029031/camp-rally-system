/**
 * Route Handler 用的錯誤型別（純模組，可在單元測試 import）。
 * 丟出 ApiHttpError → apiRoute() 轉成 { ok:false, code, message } 與對應 HTTP status（見 src/lib/api/contract.ts）。
 */
import { errorMessage, type ErrorCode } from "@/lib/errors";
import type { CheckRecordRow } from "@/lib/types";

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  /** 401 時一併清掉 session cookie */
  readonly clearSession: boolean;
  readonly record: CheckRecordRow | null | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message?: string,
    opts: { clearSession?: boolean; record?: CheckRecordRow | null } = {},
  ) {
    super(message ?? errorMessage(code));
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
    this.clearSession = opts.clearSession ?? false;
    this.record = opts.record;
  }
}

export function badRequest(message?: string): ApiHttpError {
  return new ApiHttpError(400, "INVALID_REQUEST", message);
}

export function reasonRequired(): ApiHttpError {
  return new ApiHttpError(400, "REASON_REQUIRED");
}

export function forbidden(message?: string): ApiHttpError {
  return new ApiHttpError(403, "FORBIDDEN", message);
}

export function unauthorized(): ApiHttpError {
  return new ApiHttpError(401, "UNAUTHORIZED", undefined, { clearSession: false });
}

export function sessionExpired(): ApiHttpError {
  return new ApiHttpError(401, "SESSION_EXPIRED", undefined, { clearSession: true });
}

export function notFound(message?: string): ApiHttpError {
  return new ApiHttpError(404, "NOT_FOUND", message);
}
