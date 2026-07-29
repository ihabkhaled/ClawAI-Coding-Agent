export interface ResponseLease {
  callerSignal?: AbortSignal;
  release(): void;
  response: Response;
  signal: AbortSignal;
}

export class ResponseBodyLimitError extends Error {
  constructor(readonly limitBytes: number) {
    super(`ClawAI response exceeded the ${String(limitBytes)} byte safety limit.`);
    this.name = 'ResponseBodyLimitError';
  }
}

const STREAM_IDLE_MESSAGE = 'ClawAI live stream timed out while waiting for data.';

export function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Request cancelled.'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error instanceof Error ? error : new Error('Request failed.'));
      },
    );
  });
}

function waitForRead<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Request cancelled.'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error instanceof Error ? error : new Error('Response read failed.'));
      },
    );
  });
}

function waitForIdleRead<T>(
  promise: Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  callerSignal?.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', aborted);
      action();
    };
    const timeout = setTimeout(() => {
      finish(() => {
        reject(new Error(STREAM_IDLE_MESSAGE));
      });
    }, timeoutMs);
    const aborted = (): void => {
      finish(() => {
        reject(
          callerSignal?.reason instanceof Error
            ? callerSignal.reason
            : new Error('Request cancelled.'),
        );
      });
    };
    callerSignal?.addEventListener('abort', aborted, { once: true });
    void promise.then(
      (value) => {
        finish(() => {
          resolve(value);
        });
      },
      (error: unknown) => {
        finish(() => {
          reject(error instanceof Error ? error : new Error('Response read failed.'));
        });
      },
    );
  });
}

function joinChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export async function readBoundedResponseText(
  lease: ResponseLease,
  limitBytes: number,
): Promise<string> {
  const reader = lease.response.body?.getReader();
  if (reader === undefined) {
    lease.release();
    return '';
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    let result = await waitForRead(reader.read(), lease.signal);
    while (!result.done) {
      totalBytes += result.value.byteLength;
      if (totalBytes > limitBytes) {
        await reader.cancel();
        throw new ResponseBodyLimitError(limitBytes);
      }
      chunks.push(result.value);
      result = await waitForRead(reader.read(), lease.signal);
    }
    return new TextDecoder().decode(joinChunks(chunks, totalBytes));
  } finally {
    if (lease.signal.aborted) {
      await Promise.allSettled([reader.cancel(lease.signal.reason)]);
    }
    lease.release();
  }
}

export async function discardResponseBody(lease: ResponseLease): Promise<void> {
  try {
    if (lease.response.body !== null) {
      await Promise.allSettled([lease.response.body.cancel()]);
    }
  } finally {
    lease.release();
  }
}

export function responseWithIdleTimeout(
  response: Response,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Response {
  if (response.body === null) {
    return response;
  }
  const reader = response.body.getReader();
  let readerReleased = false;
  const releaseReader = (): void => {
    if (!readerReleased) {
      readerReleased = true;
      reader.releaseLock();
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async cancel(reason: unknown) {
      try {
        await reader.cancel(reason);
      } finally {
        releaseReader();
      }
    },
    async pull(controller) {
      try {
        const result = await waitForIdleRead(reader.read(), timeoutMs, callerSignal);
        if (result.done) {
          controller.close();
          releaseReader();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error: unknown) {
        await Promise.allSettled([reader.cancel(error)]);
        releaseReader();
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}
