import type { ChatOpenAI } from "@langchain/openai";
import type { LLMProvider } from "@write-now/shared/types/llm";

const LLM_REQUEST_LIMITER_PATCHED = Symbol("LLM_REQUEST_LIMITER_PATCHED");

export interface ProviderModelLimitOptions {
  provider: LLMProvider;
  model: string;
  concurrencyLimit?: number | null;
  requestIntervalMs?: number | null;
}

type PatchableChatOpenAI = ChatOpenAI & {
  [LLM_REQUEST_LIMITER_PATCHED]?: boolean;
};

function normalizeNonNegativeInteger(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * 包装上游流：消费完成、消费出错或提前终止（break 触发生成器 return）时释放限流槽位。
 */
function wrapAsyncIterableWithRelease<TStream extends AsyncIterable<unknown>>(
  stream: TStream,
  release: () => void,
): TStream {
  let released = false;
  const releaseOnce = () => {
    if (released) {
      return;
    }
    released = true;
    release();
  };
  async function* consume(): AsyncGenerator<unknown> {
    try {
      for await (const chunk of stream) {
        yield chunk;
      }
    } finally {
      releaseOnce();
    }
  }
  return consume() as unknown as TStream;
}

class ProviderModelRequestLimiter {
  private readonly concurrencyLimit: number;
  private readonly requestIntervalMs: number;
  private readonly queue: Array<() => void> = [];
  private activeCount = 0;
  private nextStartAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: ProviderModelLimitOptions) {
    this.concurrencyLimit = normalizeNonNegativeInteger(options.concurrencyLimit);
    this.requestIntervalMs = normalizeNonNegativeInteger(options.requestIntervalMs);
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.concurrencyLimit === 0 && this.requestIntervalMs === 0) {
      return operation();
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.activeCount += 1;
        if (this.requestIntervalMs > 0) {
          this.nextStartAt = Date.now() + this.requestIntervalMs;
        }
        operation()
          .then(resolve, reject)
          .finally(() => {
            this.activeCount = Math.max(0, this.activeCount - 1);
            this.processQueue();
          });
      });
      this.processQueue();
    });
  }

  /**
   * 流式专用：并发槽位必须持有到"整个流被消费完毕"，而不是流对象创建成功时。
   * 否则长输出的结构化调用会在建立连接的瞬间释放槽位，并发与间隔限制对
   * 流式请求完全失效。
   * 注意：若调用方拿到流后既不迭代也不 return()，槽位会等到进程结束；
   * 现有调用方（structuredInvoke / repair）都会完整消费或提前 break
   * （break 会触发生成器 finally），该权衡优于当前"创建即释放"的行为。
   */
  runStream<TStream extends AsyncIterable<unknown>>(open: () => Promise<TStream>): Promise<TStream> {
    if (this.concurrencyLimit === 0 && this.requestIntervalMs === 0) {
      return open();
    }

    return new Promise<TStream>((resolve, reject) => {
      this.queue.push(() => {
        this.activeCount += 1;
        if (this.requestIntervalMs > 0) {
          this.nextStartAt = Date.now() + this.requestIntervalMs;
        }
        let released = false;
        const release = () => {
          if (released) {
            return;
          }
          released = true;
          this.activeCount = Math.max(0, this.activeCount - 1);
          this.processQueue();
        };
        open()
          .then((stream) => {
            resolve(wrapAsyncIterableWithRelease(stream, release));
          }, (error) => {
            release();
            reject(error);
          });
      });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.queue.length === 0) {
      return;
    }
    if (this.concurrencyLimit > 0 && this.activeCount >= this.concurrencyLimit) {
      return;
    }

    const waitMs = this.requestIntervalMs > 0 ? this.nextStartAt - Date.now() : 0;
    if (waitMs > 0) {
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.processQueue();
        }, waitMs);
      }
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }
    next();
    this.processQueue();
  }
}

const sharedLimiters = new Map<string, ProviderModelRequestLimiter>();

function getLimiterKey(options: ProviderModelLimitOptions): string {
  return [
    options.provider,
    options.model,
    normalizeNonNegativeInteger(options.concurrencyLimit),
    normalizeNonNegativeInteger(options.requestIntervalMs),
  ].join(":");
}

export function createProviderModelLimiter(options: ProviderModelLimitOptions): ProviderModelRequestLimiter {
  return new ProviderModelRequestLimiter(options);
}

/**
 * 当 provider 配置变更时调用，淘汰该 provider 下所有旧限速器实例。
 * 持有旧实例引用的 LLM 客户端仍可完成在途请求，新请求将使用新配置创建的实例。
 */
export function evictSharedLimiters(provider: string): void {
  const prefix = `${provider}:`;
  for (const key of sharedLimiters.keys()) {
    if (key.startsWith(prefix)) {
      sharedLimiters.delete(key);
    }
  }
}

function getSharedProviderModelLimiter(options: ProviderModelLimitOptions): ProviderModelRequestLimiter {
  const key = getLimiterKey(options);
  const existing = sharedLimiters.get(key);
  if (existing) {
    return existing;
  }
  const created = createProviderModelLimiter(options);
  sharedLimiters.set(key, created);
  return created;
}

export function attachLLMRequestLimiter(llm: ChatOpenAI, options: ProviderModelLimitOptions): ChatOpenAI {
  const concurrencyLimit = normalizeNonNegativeInteger(options.concurrencyLimit);
  const requestIntervalMs = normalizeNonNegativeInteger(options.requestIntervalMs);
  if (concurrencyLimit === 0 && requestIntervalMs === 0) {
    return llm;
  }

  const patchable = llm as PatchableChatOpenAI;
  if (patchable[LLM_REQUEST_LIMITER_PATCHED]) {
    return llm;
  }

  const limiter = getSharedProviderModelLimiter({
    ...options,
    concurrencyLimit,
    requestIntervalMs,
  });
  const originalInvoke = llm.invoke.bind(llm);
  const originalStream = llm.stream.bind(llm);
  const originalBatch = llm.batch.bind(llm);

  patchable.invoke = (async (...args: Parameters<ChatOpenAI["invoke"]>) =>
    limiter.run(() => originalInvoke(...args))) as ChatOpenAI["invoke"];

  patchable.stream = (async (...args: Parameters<ChatOpenAI["stream"]>) =>
    limiter.runStream(() => originalStream(...args))) as ChatOpenAI["stream"];

  patchable.batch = (async (...args: Parameters<ChatOpenAI["batch"]>) =>
    limiter.run(() => originalBatch(...args))) as ChatOpenAI["batch"];

  Object.defineProperty(patchable, LLM_REQUEST_LIMITER_PATCHED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return llm;
}
