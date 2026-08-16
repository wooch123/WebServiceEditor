export interface PerformanceRouteSummaryDto {
  readonly route: string;
  readonly method: string;
  readonly sampleCount: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

export interface PerformanceSummaryDto {
  readonly generatedAt: string;
  readonly sampleCount: number;
  readonly routes: readonly PerformanceRouteSummaryDto[];
}
