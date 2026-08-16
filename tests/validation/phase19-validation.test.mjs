import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  EXPECTED_ACTIONS,
  EXPECTED_ELEMENT_CATEGORY_COUNTS,
  EXPECTED_LIFECYCLES,
  EXPECTED_NEW_ELEMENT_TYPES,
  inspectPhase19BrowserEvidence,
  inspectPhase19Inventory,
  validatePhase19,
} from "../../scripts/verify-phase19.mjs";

const root = resolve(import.meta.dirname, "../..");

function browserEvidence() {
  const elements = [
    "accordion",
    "badge",
    "bar-chart",
    "board",
    "box-plot",
    "breadcrumb",
    "button",
    "button-navigation",
    "chat",
    "checkbox",
    "comment",
    "container",
    "control-chart",
    "correlation-matrix",
    "data-table",
    "date-picker",
    "date-range",
    "detail-view",
    "distribution-plot",
    "divider",
    "file-list",
    "file-upload",
    "filter",
    "gauge",
    "heading",
    "heatmap",
    "histogram",
    "icon",
    "image",
    "kpi-card",
    "line-chart",
    "link",
    "list",
    "log-viewer",
    "menu",
    "multi-select",
    "notification",
    "number-input",
    "page-link",
    "pagination",
    "pareto-chart",
    "radio",
    "scatter-plot",
    "search",
    "select",
    "slider",
    "spacer",
    "summary-statistics",
    "switch",
    "tabs",
    "tabs-navigation",
    "text",
    "text-area",
    "text-input",
    "tree",
  ];
  return {
    schemaVersion: 1,
    result: "PASS",
    target: "actual HTTPS domain",
    url: "https://webeditor.dove9999.com/",
    viewport: { width: 1280, height: 720 },
    inventory: {
      pageTypeCount: 12,
      elementTypeCount: 55,
      layoutPresetCount: 22,
      bindingTypeCount: 11,
      themeCount: 120,
      lifecycleCount: 7,
    },
    palette: {
      visibleElementCount: 55,
      visibleElementTypes: elements,
      categoryCounts: EXPECTED_ELEMENT_CATEGORY_COUNTS,
      newElementTypes: EXPECTED_NEW_ELEMENT_TYPES,
      sameLevelGeometryPreserved: true,
    },
    responsive419: {
      viewportWidth: 419,
      documentScrollWidth: 419,
      paletteReachable: true,
      inspectorReachable: true,
    },
    manualUxReview: {
      noOccludingResizeSquares: true,
      elementBodyDragWorks: true,
      elementPointerStable: true,
      unboundedVerticalCanvas: true,
      relationshipEdgePanelConditional: true,
      relationshipCanvasMaximized: true,
      relationshipDropLatencyMs: 18,
      backupMenuLeftAligned: true,
    },
    consoleErrorCount: 0,
    failedRequestCount: 0,
  };
}

describe("Phase 19 validation contract", () => {
  it("passes the repository before browser and governance finalization", async () => {
    const report = await validatePhase19({
      repositoryRoot: root,
      includeBrowserEvidence: false,
      includeGovernance: false,
    });
    assert.equal(report.result, "PASS", JSON.stringify(report.failures));
    assert.equal(report.details.inspection.counts.elementTypes, 55);
    assert.equal(report.details.inspection.counts.pageTypes, 12);
    assert.equal(report.details.inspection.counts.layoutPresets, 22);
    assert.equal(report.details.inspection.counts.bindingTypes, 11);
    assert.equal(report.details.inspection.counts.themes, 120);
  });

  it("pins the exhaustive action, lifecycle, category, and new-type inventories", () => {
    assert.equal(EXPECTED_ACTIONS.length, 8);
    assert.equal(EXPECTED_LIFECYCLES.length, 7);
    assert.deepEqual(EXPECTED_ELEMENT_CATEGORY_COUNTS, {
      basic: 12,
      input: 12,
      data: 7,
      statistics: 13,
      collaboration: 6,
      navigation: 5,
    });
    assert.equal(EXPECTED_NEW_ELEMENT_TYPES.length, 11);
  });

  it("rejects missing inventory entries, weak contracts, and incomplete validation evidence", () => {
    const corpus = {
      coverage: {
        pageTypes: ["blank"],
        elementTypes: ["text"],
        layoutPresets: ["blank-grid"],
        bindingTypes: ["read"],
        themes: ["dark-one"],
      },
    };
    const snapshot = {
      pageTypes: ["blank"],
      elementDefinitions: [
        {
          type: "text",
          category: "basic",
          rendererKey: "missing",
          editorRendererKey: "text",
          runtimeRendererKey: "text",
          validatorKey: "text",
          propertySchema: { fields: [] },
          supportedRenderStates: ["DATA"],
          layout: {
            minW: 1,
            defaultW: 2,
            maxW: 3,
            minH: 1,
            defaultH: 2,
            maxH: 3,
          },
        },
      ],
      layoutPresets: ["blank-grid"],
      bindingTypes: ["read"],
      themes: [{ id: "dark-one", group: "dark" }],
      actions: EXPECTED_ACTIONS.slice(1),
      lifecycles: EXPECTED_LIFECYCLES.slice(1),
      requirements: ["REQ-001"],
      validationRun: {
        status: "PASS",
        inventoryRequired: 1,
        inventoryVerified: 0,
        inventory: [],
      },
    };
    const result = inspectPhase19Inventory(snapshot, corpus);
    assert.equal(result.elementContractsComplete, false);
    assert.equal(result.themeInventoryExact, false);
    assert.equal(result.actionsExact, false);
    assert.equal(result.lifecyclesExact, false);
    assert.equal(result.validationRunPass, false);
    assert.equal(result.validationInventoryExact, false);
  });

  it("rejects incomplete actual-domain inventory and manual UX evidence", () => {
    const baseline = browserEvidence();
    const elements = baseline.palette.visibleElementTypes;
    assert.deepEqual(inspectPhase19BrowserEvidence(baseline, elements), {
      metadata: true,
      inventory: true,
      palette: true,
      responsive: true,
      manualUx: true,
      clean: true,
    });
    const mutated = {
      ...baseline,
      palette: {
        ...baseline.palette,
        visibleElementCount: 54,
        visibleElementTypes: elements.slice(1),
      },
      manualUxReview: {
        ...baseline.manualUxReview,
        noOccludingResizeSquares: false,
        relationshipDropLatencyMs: 180,
      },
    };
    const rejected = inspectPhase19BrowserEvidence(mutated, elements);
    assert.equal(rejected.palette, false);
    assert.equal(rejected.manualUx, false);
  });
});
