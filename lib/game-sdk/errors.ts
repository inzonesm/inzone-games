export class HostSdkError extends Error {
  code: string;
  outcomeUnknown: boolean;
  requestId?: string;
  status?: number;

  constructor(
    code: string,
    options: {
      message?: string;
      outcomeUnknown?: boolean;
      requestId?: string;
      status?: number;
    } = {},
  ) {
    super(options.message ?? code);
    this.name = 'HostSdkError';
    this.code = code;
    this.outcomeUnknown = options.outcomeUnknown === true;
    if (options.requestId) this.requestId = options.requestId;
    if (options.status !== undefined) this.status = options.status;
  }
}

export function toSdkError(error: unknown): HostSdkError {
  if (error instanceof HostSdkError) return error;
  if (error && typeof error === 'object') {
    const rec = error as {
      code?: unknown;
      message?: unknown;
      outcomeUnknown?: unknown;
      requestId?: unknown;
      status?: unknown;
    };
    if (typeof rec.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(rec.code)) {
      return new HostSdkError(rec.code, {
        message: typeof rec.message === 'string' ? rec.message : rec.code,
        outcomeUnknown: rec.outcomeUnknown === true,
        requestId: typeof rec.requestId === 'string' ? rec.requestId : undefined,
        status: typeof rec.status === 'number' ? rec.status : undefined,
      });
    }
  }
  return new HostSdkError('HOST_INTERNAL_ERROR', {
    message: error instanceof Error ? error.message : 'HOST_INTERNAL_ERROR',
  });
}
