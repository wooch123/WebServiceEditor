import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXPECTED_UI_MODULES,
  SHADCN_DRY_RUN_ITEMS,
  extractModuleSpecifiers,
  findEmojiCharacters,
  inspectHeaderControlStructure,
  isForbiddenIconPackage,
  validatePhase1,
} from "../../scripts/verify-phase1.mjs";

describe("Phase 1 design-system validation infrastructure", () => {
  it("validates the complete local Phase 1 source inventory", async () => {
    const report = await validatePhase1();

    assert.equal(
      report.result,
      "PASS",
      JSON.stringify(report.failures, null, 2),
    );
    assert.equal(report.details.registryItemCount, 62);
    assert.equal(report.details.registryGeneratedFileCount, 62);
    assert.equal(report.details.installedUiModuleCount, 61);
    assert.equal(report.details.inspectedUiFiles.length, 61);
    assert.equal(report.details.themeCount, 60);
    assert.deepEqual(report.details.themeGroupCounts, {
      dark: 20,
      gray: 20,
      light: 20,
    });
    assert.equal(report.details.designSystem.referencedUiModuleCount, 61);
    assert.equal(report.details.designSystem.componentFamilyMarkerCount, 61);
    assert.equal(report.details.designSystem.renderedComponentFamilyCount, 61);
  });

  it("pins the dry-run registry inventory without conflating form with a module", () => {
    assert.equal(SHADCN_DRY_RUN_ITEMS.length, 62);
    assert.equal(EXPECTED_UI_MODULES.length, 61);
    assert.ok(SHADCN_DRY_RUN_ITEMS.includes("form"));
    assert.ok(!EXPECTED_UI_MODULES.includes("form"));
    assert.deepEqual([...EXPECTED_UI_MODULES].sort(), EXPECTED_UI_MODULES);
  });

  it("extracts static imports and rejects known non-Lucide icon sources", () => {
    const source = `
      import { Plus } from "lucide-react";
      import type { IconType } from "react-icons";
      export { Button } from "@/components/ui/button";
    `;

    assert.deepEqual(extractModuleSpecifiers(source), [
      "lucide-react",
      "react-icons",
      "@/components/ui/button",
    ]);
    assert.equal(isForbiddenIconPackage("lucide-react"), false);
    assert.equal(isForbiddenIconPackage("@/components/ui/button"), false);
    assert.equal(isForbiddenIconPackage("input-otp"), false);
    assert.equal(isForbiddenIconPackage("react-icons"), true);
    assert.equal(isForbiddenIconPackage("@heroicons/react"), true);
    assert.equal(isForbiddenIconPackage("phosphor-react"), true);
  });

  it("detects emoji glyphs deterministically", () => {
    assert.deepEqual(findEmojiCharacters("plain Korean 한글"), []);
    assert.deepEqual(findEmojiCharacters("📊 ready 📊 ✅"), ["✅", "📊"]);
  });

  it("recognizes the required header control order and right alignment", () => {
    const appSource = `
      function HeaderControls() {
        return <div className="header-controls">
          <div className="font-size-control"><Minus /><output /><Plus /></div>
          <label className="theme-control" />
        </div>;
      }
      function Home() {
        return <header className="app-header"><Brand /><HeaderControls {...controls} /></header>;
      }
    `;
    const result = inspectHeaderControlStructure(
      appSource,
      ".header-controls { display: flex; margin-left: auto; }",
    );

    assert.deepEqual(result, {
      hasDefinition: true,
      hasControlsContainer: true,
      fontBeforeTheme: true,
      decrementOutputIncrement: true,
      headerCount: 1,
      allHeadersPlaceControlsLast: true,
      controlsAlignedRight: true,
    });
  });
});
