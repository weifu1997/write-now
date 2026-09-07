import os from "node:os";
import { NovelSideEffectJobService, novelSideEffectJobService } from "./NovelSideEffectJobService";
import {
  NovelSideEffectJobHandlers,
  UnsupportedNovelSideEffectPayloadError,
} from "./NovelSideEffectJobHandlers";

function resolveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface NovelSideEffectWorkerOptions {
  workerId?: string;
  leaseMs?: number;
  pollMs?: number;
}

export class NovelSideEffectWorker {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly pollMs: number;

  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;

  constructor(
    private readonly jobService: NovelSideEffectJobService = novelSideEffectJobService,
    private readonly handlers: NovelSideEffectJobHandlers = new NovelSideEffectJobHandlers(),
    options: NovelSideEffectWorkerOptions = {},
  ) {
    this.workerId = options.workerId
      ?? process.env.NOVEL_SIDE_EFFECT_WORKER_ID?.trim()
      ?? `novel-side-effect-${os.hostname()}-${process.pid}`;
    this.leaseMs = resolveNumberEnv("NOVEL_SIDE_EFFECT_WORKER_LEASE_MS", options.leaseMs ?? 120_000);
    this.pollMs = resolveNumberEnv("NOVEL_SIDE_EFFECT_WORKER_POLL_MS", options.pollMs ?? 5_000);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.jobService.recoverExpiredRunningJobs().catch((error) => {
      console.warn("[novel-side-effect-worker] failed to recover expired jobs", error);
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs);
    void this.tick();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.isTicking) {
      return;
    }
    this.isTicking = true;
    try {
      const job = await this.jobService.leaseNext({
        workerId: this.workerId,
        leaseMs: this.leaseMs,
      });
      if (!job) {
        return;
      }
      try {
        await this.handlers.execute(job);
        await this.jobService.markSucceeded(job);
      } catch (error) {
        try {
          const forceDead = error instanceof UnsupportedNovelSideEffectPayloadError;
          await this.jobService.markFailedOrDead(job, error, { forceDead });
        } catch (markError) {
          // 租约过期被 recoverExpiredRunningJobs 回收后，markSucceeded /
          // markFailedOrDead 的 CAS 更新都会匹配 0 行并抛错。tick 由
          // setInterval 里的 void 调用，这里的拒绝若不就地消化会变成
          // unhandledRejection 并使整个服务进程退出。
          console.error(
            `[novel-side-effect-worker] job ${job.id} failed and its failure could not be recorded`,
            error,
            markError,
          );
        }
      }
    } catch (error) {
      // leaseNext（或其它前置步骤）失败时仅记录，等待下一轮轮询重试；
      // 同样避免 void 调用链上的未处理拒绝。
      console.error("[novel-side-effect-worker] tick failed before leasing a job", error);
    } finally {
      this.isTicking = false;
    }
  }
}

export const novelSideEffectWorker = new NovelSideEffectWorker();

