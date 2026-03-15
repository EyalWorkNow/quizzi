import os from 'os';

type TaskGateOptions = {
  name: string;
  concurrency: number;
  maxQueue: number;
};

type QueueEntry = {
  label: string;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export type TaskGate = {
  run<T>(label: string, task: () => Promise<T>): Promise<T>;
  snapshot(): {
    name: string;
    active: number;
    queued: number;
    concurrency: number;
    maxQueue: number;
  };
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function defaultTaskConcurrency(fallback = 2) {
  try {
    const parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    return Math.max(1, Math.min(8, parallelism - 1 || fallback));
  } catch {
    return fallback;
  }
}

export function envTaskConcurrency(name: string, fallback: number) {
  return parsePositiveInt(process.env[name], fallback);
}

export function createBoundedTaskGate(options: TaskGateOptions): TaskGate {
  const queue: QueueEntry[] = [];
  let active = 0;

  const runNext = () => {
    while (active < options.concurrency && queue.length > 0) {
      const next = queue.shift() as QueueEntry;
      active += 1;

      next
        .task()
        .then(next.resolve, next.reject)
        .finally(() => {
          active = Math.max(0, active - 1);
          runNext();
        });
    }
  };

  return {
    run<T>(label: string, task: () => Promise<T>) {
      if (active >= options.concurrency && queue.length >= options.maxQueue) {
        return Promise.reject(
          new Error(
            `${options.name} is saturated. Active=${active}, queued=${queue.length}, label=${label}`,
          ),
        );
      }

      return new Promise<T>((resolve, reject) => {
        queue.push({
          label,
          task: () => task(),
          resolve: (value) => resolve(value as T),
          reject,
        });
        runNext();
      });
    },
    snapshot() {
      return {
        name: options.name,
        active,
        queued: queue.length,
        concurrency: options.concurrency,
        maxQueue: options.maxQueue,
      };
    },
  };
}
