import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  inspectPhase12BrowserEvidence,
  inspectPhase12Contract,
  validatePhase12,
} from "../../scripts/verify-phase12.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Phase 12 validation contract", () => {
  it("passes the repository production and behavior contract", async () => {
    const report = await validatePhase12({
      repositoryRoot: root,
      includeBrowserEvidence: false,
      includePhase11Regression: false,
      includeGovernance: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
  });

  it("rejects a Runtime tree that imports Editor components", () => {
    const complete = Object.keys(
      inspectPhase12Contract({
        adr: "",
        domain: "",
        pageRepository: "",
        pageService: "",
        projectService: "",
        runtimeService: "",
        relationshipService: "",
        compiler: "",
        pageRoutes: "",
        relationshipRoutes: "",
        backendTest: "",
        app: "",
        runtime: "",
        runtimeRenderer: "",
        runtimeTest: "",
        pageManager: "",
        pageManagerTest: "",
        runtimeApi: "",
        styles: "",
        status: "",
      }),
    );
    assert.ok(complete.includes("runtimeSeparated"));
    const result = inspectPhase12Contract({
      adr: "",
      domain: "",
      pageRepository: "",
      pageService: "",
      projectService: "",
      runtimeService: "",
      relationshipService: "",
      compiler: "",
      pageRoutes: "",
      relationshipRoutes: "",
      backendTest: "",
      app: "",
      runtime: 'import { ElementCanvas } from "../elements/ElementCanvas";',
      runtimeRenderer: "",
      runtimeTest: "",
      pageManager: "",
      pageManagerTest: "",
      runtimeApi: "",
      styles: "",
      status: "",
    });
    assert.equal(result.runtimeSeparated, false);
  });

  it("accepts the concise Preview label only with the accessible action contract", () => {
    const source = {
      adr: "",
      domain: "",
      pageRepository: "",
      pageService: "",
      projectService: "",
      runtimeService: "",
      relationshipService: "",
      compiler: "",
      pageRoutes: "",
      relationshipRoutes: "",
      backendTest: "",
      app: "",
      runtime: "",
      runtimeRenderer: "",
      runtimeTest: "",
      pageManager:
        'createDraftPreview aria-label="미리보기" onClick={() => void openDraftPreview()}>보기</Button>',
      pageManagerTest: "",
      runtimeApi: "",
      styles: "",
      status: "",
    };
    assert.equal(inspectPhase12Contract(source).previewControl, true);
    source.pageManager = source.pageManager.replace(
      'aria-label="미리보기"',
      "",
    );
    assert.equal(inspectPhase12Contract(source).previewControl, false);
  });

  it("rejects mismatched browser geometry and Draft/Published leakage", () => {
    const result = inspectPhase12BrowserEvidence({
      schemaVersion: 1,
      result: "PASS",
      target: "isolated local browser session",
      url: "http://127.0.0.1:5174/",
      desktop: {
        viewport: { width: 1280, height: 720 },
        pageActionRects: [
          { width: 80, height: 40 },
          { width: 81, height: 40 },
          { width: 80, height: 40 },
        ],
      },
      snapshotSeparation: {
        publishedNameBeforeDraft: "게시",
        publishedNameAfterDraft: "초안",
        draftName: "초안",
        publishedSnapshotId: "v1",
        publishedSnapshotIdAfterDraft: "v1",
      },
    });
    assert.equal(result.equalPageActions, false);
    assert.equal(result.snapshotSeparation, false);
  });

  it("keeps the Phase 12 verifier referenced by the workspace command", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    assert.equal(
      packageJson.scripts["verify:phase12"],
      "pnpm test && node scripts/verify-phase12.mjs",
    );
  });
});
