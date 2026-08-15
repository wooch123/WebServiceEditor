export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function assertApi(
  condition: unknown,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): asserts condition {
  if (!condition) {
    throw new ApiError(statusCode, code, message, details);
  }
}
