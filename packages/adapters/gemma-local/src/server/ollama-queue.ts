// ---------------------------------------------------------------------------
// Ollama Request Queue — Global concurrency manager for Ollama inference
//
// Problem: Ollama serves requests sequentially on GPU. When many agents fire
// simultaneously, requests pile up → timeouts → cascading failures.
//
// Solution: A shared in-process semaphore that:
// 1. Limits concurrent Ollama requests (default: 2)
// 2. Queues excess requests with a wait timeout
// 3. Routes overflow directly to MiniMax (skip the Ollama wait entirely)
// 4. Tracks queue depth and stats for observability
// ---------------------------------------------------------------------------

export interface QueueConfig {
  /** Max concurrent Ollama requests. Default: 2 */
  maxConcurrentOllama: number;
  /** Max requests waiting in queue before overflow to fallback. Default: 3 */
  maxQueueDepth: number;
  /** Max time (ms) a request will wait in queue before giving up. Default: 60000 */
  queueTimeoutMs: number;
}

export interface QueueStats {
  activeOllamaRequests: number;
  queuedRequests: number;
  totalServed: number;
  totalOverflowed: number;
  totalTimedOut: number;
}

type QueueResolver = () => void;

class OllamaQueue {
  private active = 0;
  private queue: Array<{ resolve: QueueResolver; timer: ReturnType<typeof setTimeout> }> = [];
  private config: QueueConfig;

  // Stats
  private totalServed = 0;
  private totalOverflowed = 0;
  private totalTimedOut = 0;

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      maxConcurrentOllama: config?.maxConcurrentOllama ?? 2,
      maxQueueDepth: config?.maxQueueDepth ?? 3,
      queueTimeoutMs: config?.queueTimeoutMs ?? 60_000,
    };
  }

  /**
   * Update config at runtime (e.g., from adapter_config).
   */
  updateConfig(config: Partial<QueueConfig>): void {
    if (config.maxConcurrentOllama != null) this.config.maxConcurrentOllama = config.maxConcurrentOllama;
    if (config.maxQueueDepth != null) this.config.maxQueueDepth = config.maxQueueDepth;
    if (config.queueTimeoutMs != null) this.config.queueTimeoutMs = config.queueTimeoutMs;
  }

  /**
   * Try to acquire an Ollama slot. Returns:
   * - "acquired" → proceed with Ollama call, MUST call release() when done
   * - "overflow"  → queue is full, caller should go directly to MiniMax
   * - "timeout"   → waited in queue but timed out, caller should go to MiniMax
   */
  async acquire(): Promise<"acquired" | "overflow" | "timeout"> {
    // Fast path: slot available
    if (this.active < this.config.maxConcurrentOllama) {
      this.active++;
      return "acquired";
    }

    // Queue is full → overflow to fallback immediately
    if (this.queue.length >= this.config.maxQueueDepth) {
      this.totalOverflowed++;
      return "overflow";
    }

    // Wait in queue
    return new Promise<"acquired" | "timeout">((resolve) => {
      const timer = setTimeout(() => {
        // Remove from queue
        const idx = this.queue.findIndex((e) => e.resolve === onRelease);
        if (idx !== -1) this.queue.splice(idx, 1);
        this.totalTimedOut++;
        resolve("timeout");
      }, this.config.queueTimeoutMs);

      const onRelease = () => {
        clearTimeout(timer);
        this.active++;
        resolve("acquired");
      };

      this.queue.push({ resolve: onRelease, timer });
    });
  }

  /**
   * Release an Ollama slot. MUST be called after every successful acquire("acquired").
   */
  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.totalServed++;

    // Wake next in queue
    if (this.queue.length > 0 && this.active < this.config.maxConcurrentOllama) {
      const next = this.queue.shift()!;
      next.resolve();
    }
  }

  /**
   * Get current queue statistics.
   */
  getStats(): QueueStats {
    return {
      activeOllamaRequests: this.active,
      queuedRequests: this.queue.length,
      totalServed: this.totalServed,
      totalOverflowed: this.totalOverflowed,
      totalTimedOut: this.totalTimedOut,
    };
  }

  /**
   * Get a short status string for logging.
   */
  statusLine(): string {
    return `ollama_active=${this.active}/${this.config.maxConcurrentOllama} queued=${this.queue.length}/${this.config.maxQueueDepth}`;
  }
}

// ---------------------------------------------------------------------------
// Singleton — shared across all adapter invocations in this process
// ---------------------------------------------------------------------------

let _instance: OllamaQueue | null = null;

export function getOllamaQueue(config?: Partial<QueueConfig>): OllamaQueue {
  if (!_instance) {
    _instance = new OllamaQueue(config);
  } else if (config) {
    _instance.updateConfig(config);
  }
  return _instance;
}
