import { describe, expect, it } from "vitest";

import {
  PROJECT_CORPUS_RESULT_STATUSES,
  PROJECT_CORPUS_RUN_STATUSES,
  type ProjectCorpusVerificationSummaryDto,
} from "../src/index.js";

describe("Project Corpus contract", () => {
  it("pins generation and verification lifecycle states", () => {
    expect(PROJECT_CORPUS_RUN_STATUSES).toEqual([
      "GENERATING",
      "GENERATED",
      "VERIFYING",
      "VERIFIED",
      "FAILED",
    ]);
    expect(PROJECT_CORPUS_RESULT_STATUSES).toEqual([
      "GENERATED",
      "PASS",
      "FAIL",
    ]);
  });

  it("requires the release-blocking 100/100 verification counters", () => {
    const summary = {
      passCount: 100,
      failCount: 0,
      blockedCount: 0,
      skippedCount: 0,
      crossProjectLeakCount: 0,
      orphanRecordCount: 0,
      orphanFileCount: 0,
      criticalErrorCount: 0,
      purgeFixtureCount: 1,
    } satisfies Omit<ProjectCorpusVerificationSummaryDto, "performance">;
    expect(summary).toMatchObject({ passCount: 100, failCount: 0 });
  });
});
