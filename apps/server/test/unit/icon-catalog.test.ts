import { describe, expect, it } from "vitest";

import {
  LUCIDE_DYNAMIC_ICON_NAMES,
  LUCIDE_ICON_CATALOG,
} from "../../src/icons/lucide-icon-catalog.generated.js";

describe("Lucide icon catalog", () => {
  it("contains every unique 1.31.0 PascalCase export exactly once", () => {
    expect(LUCIDE_ICON_CATALOG).toHaveLength(1_767);
    expect(new Set(LUCIDE_ICON_CATALOG.map((item) => item.name)).size).toBe(
      LUCIDE_ICON_CATALOG.length,
    );
    expect(
      LUCIDE_ICON_CATALOG.every(
        (item) =>
          /^[A-Z][A-Za-z0-9]*$/.test(item.name) &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.dynamicName) &&
          item.categories.length >= 1 &&
          (item.keywords as readonly string[]).includes(item.dynamicName),
      ),
    ).toBe(true);
  });

  it("retains all 2,025 dynamic loader names across canonical names and aliases", () => {
    expect(LUCIDE_DYNAMIC_ICON_NAMES).toHaveLength(2_025);
    expect(new Set(LUCIDE_DYNAMIC_ICON_NAMES).size).toBe(2_025);
    const catalogKeywords = new Set<string>(
      LUCIDE_ICON_CATALOG.flatMap((item) => item.keywords),
    );
    expect(
      LUCIDE_DYNAMIC_ICON_NAMES.every((dynamicName) =>
        catalogKeywords.has(dynamicName),
      ),
    ).toBe(true);
    expect(
      LUCIDE_ICON_CATALOG.find((item) => item.name === "ArrowDown01")
        ?.dynamicName,
    ).toBe("arrow-down-01");
    expect(
      LUCIDE_ICON_CATALOG.find((item) => item.name === "Axis3d")?.dynamicName,
    ).toBe("axis-3-d");
    expect(
      LUCIDE_ICON_CATALOG.find((item) => item.name === "Building2")
        ?.dynamicName,
    ).toBe("building-2");
  });
});
