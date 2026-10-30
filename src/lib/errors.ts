/** Typed application errors mapped to safe HTTP responses. */
export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "PROVIDER_ERROR"
  | "NOT_CONFIGURED";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  PROVIDER_ERROR: 502,
  NOT_CONFIGURED: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;
  constructor(code: ErrorCode, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const errors = {
  badRequest: (m = "Bad request") => new AppError("BAD_REQUEST", m),
  validation: (m: string, details?: Record<string, string[]>) => new AppError("VALIDATION", m, details),
  unauthenticated: (m = "Please sign in to continue") => new AppError("UNAUTHENTICATED", m),
  forbidden: (m = "You do not have access to this resource") => new AppError("FORBIDDEN", m),
  /** Use notFound for resources the actor isn't allowed to see, to avoid leaking existence. */
  notFound: (m = "Not found") => new AppError("NOT_FOUND", m),
  conflict: (m: string) => new AppError("CONFLICT", m),
  rateLimited: (m = "Too many requests. Please wait and try again.") => new AppError("RATE_LIMITED", m),
  tooLarge: (m = "File is too large") => new AppError("PAYLOAD_TOO_LARGE", m),
  unsupported: (m = "Unsupported file type") => new AppError("UNSUPPORTED_MEDIA", m),
  provider: (m = "Payment provider error") => new AppError("PROVIDER_ERROR", m),
  notConfigured: (m: string) => new AppError("NOT_CONFIGURED", m),
};

export function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === 11000;
}
