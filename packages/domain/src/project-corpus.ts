export const PROJECT_CORPUS_RUN_STATUSES = [
  "GENERATING",
  "GENERATED",
  "VERIFYING",
  "VERIFIED",
  "FAILED",
] as const;

export const PROJECT_CORPUS_RESULT_STATUSES = [
  "GENERATED",
  "PASS",
  "FAIL",
] as const;

export type ProjectCorpusRunStatus =
  (typeof PROJECT_CORPUS_RUN_STATUSES)[number];
export type ProjectCorpusResultStatus =
  (typeof PROJECT_CORPUS_RESULT_STATUSES)[number];

export interface GenerateProjectCorpusRequest {
  readonly seed: string;
  readonly idempotencyKey: string;
}

export interface VerifyProjectCorpusRequest {
  readonly idempotencyKey: string;
}

export interface ProjectCorpusPerformanceDistributionDto {
  readonly count: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly budgetMs: number | null;
  readonly passed: boolean;
}

export interface ProjectCorpusPerformanceDto {
  readonly projectList: ProjectCorpusPerformanceDistributionDto;
  readonly searchSort: ProjectCorpusPerformanceDistributionDto;
  readonly projectOpen: ProjectCorpusPerformanceDistributionDto;
  readonly autoSave: ProjectCorpusPerformanceDistributionDto;
  readonly preview: ProjectCorpusPerformanceDistributionDto;
  readonly publish: ProjectCorpusPerformanceDistributionDto;
  readonly runtime: ProjectCorpusPerformanceDistributionDto;
  readonly backup: ProjectCorpusPerformanceDistributionDto;
  readonly trash: ProjectCorpusPerformanceDistributionDto;
  readonly restore: ProjectCorpusPerformanceDistributionDto;
  readonly restartReady: ProjectCorpusPerformanceDistributionDto;
  readonly metadataBytes: number;
  readonly storageBytes: number;
  readonly serverRssBytes: number;
}

export interface ProjectCorpusVerificationSummaryDto {
  readonly passCount: number;
  readonly failCount: number;
  readonly blockedCount: 0;
  readonly skippedCount: 0;
  readonly crossProjectLeakCount: number;
  readonly orphanRecordCount: number;
  readonly orphanFileCount: number;
  readonly criticalErrorCount: number;
  readonly purgeFixtureCount: number;
  readonly performance: ProjectCorpusPerformanceDto;
}

export interface ProjectCorpusVerificationDto {
  readonly runId: string;
  readonly status: "VERIFIED" | "FAILED";
  readonly verificationChecksum: string;
  readonly resultsEvidencePath: string;
  readonly performanceEvidencePath: string;
  readonly summary: ProjectCorpusVerificationSummaryDto;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface FeatureShowcaseProjectDto {
  readonly projectId: string;
  readonly name: string;
  readonly slug: string;
  readonly pageCount: number;
  readonly elementCount: number;
  readonly tableCount: number;
  readonly runtimeRowCount: number;
  readonly bindingCount: number;
  readonly pageTypeCount: number;
  readonly layoutPresetCount: number;
  readonly elementTypeCount: number;
  readonly publishedVersionId: string;
  readonly status: "READY";
}

export const REFERENCE_APPLICATION_KINDS = [
  "SEMICONDUCTOR_YIELD",
  "COMMERCE_OPERATIONS",
  "PERSONAL_BLOG",
  "WORK_MANAGEMENT",
] as const;

export type ReferenceApplicationKind =
  (typeof REFERENCE_APPLICATION_KINDS)[number];

export interface ReferenceApplicationProjectDto {
  readonly kind: ReferenceApplicationKind;
  readonly projectId: string;
  readonly name: string;
  readonly slug: string;
  readonly pageCount: number;
  readonly elementCount: number;
  readonly tableCount: number;
  readonly testRowCount: number;
  readonly productionRowCount: number;
  readonly bindingCount: number;
  readonly publishedVersionId: string;
  readonly status: "READY";
}

export interface ReferenceApplicationSuiteDto {
  readonly projects: readonly ReferenceApplicationProjectDto[];
  readonly totalProjectCount: 4;
  readonly totalTestRowCount: number;
  readonly totalProductionRowCount: number;
  readonly status: "READY";
}

export interface ProjectCorpusScaleDto {
  readonly pageCount: number;
  readonly elementCount: number;
  /** Exact graph workload target; see ADR 0020 for derived-Node materialization. */
  readonly nodeCount: number;
  readonly tableCount: number;
  readonly runtimeRowCount: number;
}

export interface ProjectCorpusCoverageDto {
  readonly themeId: string;
  readonly pageTypes: readonly string[];
  readonly layoutPresets: readonly string[];
  readonly elementTypes: readonly string[];
  readonly bindingTypes: readonly string[];
}

export interface ProjectCorpusResultDto {
  readonly id: string;
  readonly runId: string;
  readonly corpusId: string;
  readonly projectId: string;
  readonly projectIndex: number;
  readonly archetype: string;
  readonly status: ProjectCorpusResultStatus;
  readonly scenarioResults: Readonly<
    Record<string, "PENDING" | "PASS" | "FAIL">
  >;
  readonly isolationSentinel: string;
  readonly runtimeRowSentinel: string;
  readonly structureFingerprint: string;
  readonly scale: ProjectCorpusScaleDto;
  readonly coverage: ProjectCorpusCoverageDto;
  readonly durationMs: number;
  readonly evidencePath: string;
}

export interface ProjectCorpusSummaryDto {
  readonly generatedProjectCount: number;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly uniqueProjectSentinelCount: number;
  readonly uniqueRuntimeSentinelCount: number;
  readonly uniqueStructureFingerprintCount: number;
  readonly coverage: {
    readonly themes: readonly string[];
    readonly pageTypes: readonly string[];
    readonly layoutPresets: readonly string[];
    readonly elementTypes: readonly string[];
    readonly bindingTypes: readonly string[];
  };
  readonly scaleTotals: ProjectCorpusScaleDto;
  readonly verification?: ProjectCorpusVerificationSummaryDto;
}

export interface ProjectCorpusRunDto {
  readonly id: string;
  readonly seed: string;
  readonly projectCount: number;
  readonly generatorVersion: string;
  readonly status: ProjectCorpusRunStatus;
  readonly manifestChecksum: string | null;
  readonly summary: ProjectCorpusSummaryDto | null;
  readonly evidencePath: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface ProjectCorpusRunDetailDto {
  readonly run: ProjectCorpusRunDto;
  readonly results: readonly ProjectCorpusResultDto[];
}
