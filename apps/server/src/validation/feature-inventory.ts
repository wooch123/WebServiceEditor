import {
  BINDING_TYPES,
  DATA_FIELD_TYPES,
  ELEMENT_COMMAND_TYPES,
  ELEMENT_DEFINITIONS,
  LAYOUT_PRESET_DEFINITIONS,
  PAGE_TYPES,
  PROJECT_LIFECYCLE_STATUSES,
  REQUIREMENT_IDS,
  VALIDATION_RULE_IDS,
  type ValidationInventoryCategory,
  type ValidationInventoryItemDto,
} from "@webeditor/domain";
import { themes } from "@webeditor/theme-core";

interface InventorySource {
  readonly category: ValidationInventoryCategory;
  readonly itemId: string;
  readonly displayName: string;
  readonly requiredStates: readonly string[];
  readonly requiredTests: readonly string[];
}

const tests = {
  element: ["apps/server/test/integration/element-layout.test.ts"],
  preset: [
    "apps/server/test/integration/statistical-elements-layout-presets.test.ts",
  ],
  theme: ["apps/server/test/integration/theme-revision-runtime.test.ts"],
  action: ["apps/server/test/integration/element-properties-history.test.ts"],
  bindingRead: [
    "apps/server/test/integration/safe-read-binding-engine.test.ts",
  ],
  bindingMutation: [
    "apps/server/test/integration/crud-binding-runtime.test.ts",
  ],
  bindingNavigation: [
    "apps/server/test/integration/project-variable-navigation.test.ts",
  ],
  field: ["apps/server/test/integration/database-designer.test.ts"],
  page: ["apps/server/test/integration/page-management.test.ts"],
  icon: ["apps/server/test/unit/icon-catalog.test.ts"],
  api: ["apps/server/test/integration/system-routes.test.ts"],
  lifecycle: ["apps/server/test/integration/project-lifecycle.test.ts"],
  requirement: ["tests/validation/phase0-validation.test.mjs"],
  validationRule: ["apps/server/test/integration/validation-report.test.ts"],
} as const;

function bindingTests(bindingType: (typeof BINDING_TYPES)[number]) {
  if (["create", "update", "delete"].includes(bindingType)) {
    return tests.bindingMutation;
  }
  if (["parameter", "navigation"].includes(bindingType)) {
    return tests.bindingNavigation;
  }
  return tests.bindingRead;
}

function sources(apiRoutes: readonly string[]): readonly InventorySource[] {
  return [
    ...REQUIREMENT_IDS.map((requirementId) => ({
      category: "REQUIREMENT" as const,
      itemId: requirementId,
      displayName: requirementId,
      requiredStates: ["TRACED"],
      requiredTests: tests.requirement,
    })),
    ...VALIDATION_RULE_IDS.map((ruleId) => ({
      category: "VALIDATION_RULE" as const,
      itemId: ruleId,
      displayName: ruleId,
      requiredStates: ["EXECUTABLE", "EVIDENCED"],
      requiredTests: tests.validationRule,
    })),
    ...ELEMENT_DEFINITIONS.map((definition) => ({
      category: "ELEMENT" as const,
      itemId: definition.type,
      displayName: definition.label,
      requiredStates: definition.supportedRenderStates,
      requiredTests: tests.element,
    })),
    ...LAYOUT_PRESET_DEFINITIONS.map((definition) => ({
      category: "LAYOUT_PRESET" as const,
      itemId: definition.id,
      displayName: definition.name,
      requiredStates: ["PREVIEW", "APPLY", "UNDO", "REDO"],
      requiredTests: tests.preset,
    })),
    ...themes.map((theme) => ({
      category: "THEME" as const,
      itemId: theme.id,
      displayName: theme.name,
      requiredStates: ["EDITOR", "PREVIEW", "RUNTIME"],
      requiredTests: tests.theme,
    })),
    ...ELEMENT_COMMAND_TYPES.map((action) => ({
      category: "ACTION" as const,
      itemId: action,
      displayName: action,
      requiredStates: ["APPLIED", "REPLAY"],
      requiredTests: tests.action,
    })),
    ...BINDING_TYPES.map((binding) => ({
      category: "BINDING" as const,
      itemId: binding,
      displayName: binding,
      requiredStates: ["READY", "DISABLED"],
      requiredTests: bindingTests(binding),
    })),
    ...DATA_FIELD_TYPES.map((fieldType) => ({
      category: "FIELD_TYPE" as const,
      itemId: fieldType,
      displayName: fieldType,
      requiredStates: ["DRAFT", "TEST"],
      requiredTests: tests.field,
    })),
    ...PAGE_TYPES.map((pageType) => ({
      category: "PAGE_TYPE" as const,
      itemId: pageType,
      displayName: pageType,
      requiredStates: ["EDITOR", "RUNTIME"],
      requiredTests: tests.page,
    })),
    {
      category: "ICON" as const,
      itemId: "lucide-1.31.0",
      displayName: "Lucide 1.31.0",
      requiredStates: ["CATALOG", "EDITOR", "RUNTIME"],
      requiredTests: tests.icon,
    },
    ...apiRoutes.map((route) => ({
      category: "API_ROUTE" as const,
      itemId: route,
      displayName: route,
      requiredStates: ["REGISTERED"],
      requiredTests: tests.api,
    })),
    ...PROJECT_LIFECYCLE_STATUSES.map((status) => ({
      category: "PROJECT_LIFECYCLE" as const,
      itemId: status,
      displayName: status,
      requiredStates: ["PERSISTED", "RECOVERABLE"],
      requiredTests: tests.lifecycle,
    })),
  ];
}

export function featureInventory(
  apiRoutes: readonly string[],
  verifiedAt: string,
  runId: string,
): readonly ValidationInventoryItemDto[] {
  return [...sources(apiRoutes)]
    .sort((left, right) =>
      `${left.category}:${left.itemId}`.localeCompare(
        `${right.category}:${right.itemId}`,
      ),
    )
    .map((source) => {
      const inventoryId = `${source.category}:${source.itemId}`;
      return {
        inventoryId,
        category: source.category,
        itemId: source.itemId,
        displayName: source.displayName,
        requiredStates: source.requiredStates,
        requiredTests: source.requiredTests,
        evidence: [`validation-run:${runId}#${inventoryId}`],
        status: "VERIFIED",
        lastVerifiedAt: verifiedAt,
      };
    });
}
