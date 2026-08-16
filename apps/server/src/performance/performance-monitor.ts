import type {
  PerformanceRouteSummaryDto,
  PerformanceSummaryDto,
} from "@webeditor/domain";
import type { FastifyRequest } from "fastify";

interface Sample {
  readonly route: string;
  readonly method: string;
  readonly durationMs: number;
}

function percentile(values: readonly number[], value: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(
    0,
    Math.min(values.length - 1, Math.ceil(values.length * value) - 1),
  );
  return Number((values[index] ?? 0).toFixed(2));
}

export class PerformanceMonitor {
  readonly #starts = new WeakMap<FastifyRequest, bigint>();
  readonly #samples: Sample[] = [];

  constructor(
    readonly capacity = 4096,
    readonly clock: () => Date = () => new Date(),
  ) {}

  start(request: FastifyRequest): void {
    this.#starts.set(request, process.hrtime.bigint());
  }

  finish(request: FastifyRequest): void {
    const start = this.#starts.get(request);
    if (start === undefined) return;
    this.#starts.delete(request);
    const route =
      request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "/";
    this.#samples.push({
      route,
      method: request.method,
      durationMs: Number(process.hrtime.bigint() - start) / 1_000_000,
    });
    if (this.#samples.length > this.capacity) {
      this.#samples.splice(0, this.#samples.length - this.capacity);
    }
  }

  summary(): PerformanceSummaryDto {
    const groups = new Map<string, Sample[]>();
    for (const sample of this.#samples) {
      const key = `${sample.method} ${sample.route}`;
      const group = groups.get(key) ?? [];
      group.push(sample);
      groups.set(key, group);
    }
    const routes: PerformanceRouteSummaryDto[] = [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, samples]) => {
        const [method = "GET", ...routeParts] = key.split(" ");
        const durations = samples
          .map((sample) => sample.durationMs)
          .sort((left, right) => left - right);
        return {
          route: routeParts.join(" "),
          method,
          sampleCount: samples.length,
          p50Ms: percentile(durations, 0.5),
          p95Ms: percentile(durations, 0.95),
          p99Ms: percentile(durations, 0.99),
          maxMs: Number((durations.at(-1) ?? 0).toFixed(2)),
        };
      });
    return {
      generatedAt: this.clock().toISOString(),
      sampleCount: this.#samples.length,
      routes,
    };
  }
}
