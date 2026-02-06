/** Base class for all PT-APIs errors. */
export class PtApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = "INTERNAL_ERROR",
  ) {
    super(message);
    this.name = "PtApiError";
  }
}

export class NotFoundError extends PtApiError {
  constructor(resource: string, id: string) {
    super(`${resource} '${id}' not found`, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends PtApiError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class AdapterError extends PtApiError {
  constructor(adapterId: string, message: string) {
    super(`[${adapterId}] ${message}`, 502, "ADAPTER_ERROR");
    this.name = "AdapterError";
  }
}
