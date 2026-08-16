export const VALIDATION_LEVELS = [
  "STATIC",
  "REFERENCE",
  "DATABASE",
  "BINDING",
  "RENDER",
  "INTERACTION",
  "INVENTORY",
] as const;

export const VALIDATION_RESULTS = [
  "PASS",
  "WARNING",
  "FAIL",
  "BLOCKED",
] as const;

export const VALIDATION_INVENTORY_CATEGORIES = [
  "REQUIREMENT",
  "VALIDATION_RULE",
  "ELEMENT",
  "LAYOUT_PRESET",
  "THEME",
  "ACTION",
  "BINDING",
  "FIELD_TYPE",
  "PAGE_TYPE",
  "ICON",
  "API_ROUTE",
  "PROJECT_LIFECYCLE",
] as const;

export const REQUIREMENT_IDS = Array.from(
  { length: 37 },
  (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`,
) as readonly string[];

export const VALIDATION_RULE_IDS = [
  "INVENTORY_TEST_EVIDENCE",
  "INVENTORY_EMPTY",
  "INVENTORY_EVIDENCE_MISSING",
  "API_INVENTORY_EMPTY",
  "PAGE_ROUTE_INVALID",
  "PAGE_ICON_MISSING",
  "ELEMENT_PAGE_REFERENCE",
  "ELEMENT_REGISTRY_TYPE",
  "ELEMENT_LAYOUT_INVALID",
  "BINDING_DIRECTION_INVALID",
  "BINDING_REFERENCE_BROKEN",
  "TEST_DATABASE_MISSING",
  "TEST_DATABASE_INTEGRITY",
  "TEST_SCHEMA_NOT_APPLIED",
  "PHYSICAL_TABLE_MISSING",
  "PHYSICAL_FIELD_MISSING",
  "TEST_DATABASE_UNREADABLE",
  "THEME_POLICY_MISSING",
  "THEME_REFERENCE_INVALID",
] as const;

export const VALIDATION_TARGET_KINDS = [
  "PROJECT_HOME",
  "RECYCLE_BIN",
  "PAGE",
  "ELEMENT",
  "PROPERTY_TAB",
  "TABLE",
  "FIELD",
  "BINDING",
  "THEME",
  "RUNTIME_ROUTE",
] as const;

export type ValidationLevel = (typeof VALIDATION_LEVELS)[number];
export type ValidationResult = (typeof VALIDATION_RESULTS)[number];
export type ValidationInventoryCategory =
  (typeof VALIDATION_INVENTORY_CATEGORIES)[number];
export type ValidationTargetKind = (typeof VALIDATION_TARGET_KINDS)[number];
export type ValidationRuleId = (typeof VALIDATION_RULE_IDS)[number];

export interface ValidationTargetDto {
  readonly kind: ValidationTargetKind;
  readonly projectId: string;
  readonly pageId?: string;
  readonly elementId?: string;
  readonly propertyTabId?: string;
  readonly tableId?: string;
  readonly fieldId?: string;
  readonly bindingId?: string;
  readonly themeId?: string;
  readonly route?: string;
}

export interface ValidationInventoryItemDto {
  readonly inventoryId: string;
  readonly category: ValidationInventoryCategory;
  readonly itemId: string;
  readonly displayName: string;
  readonly requiredStates: readonly string[];
  readonly requiredTests: readonly string[];
  readonly evidence: readonly string[];
  readonly status: "VERIFIED";
  readonly lastVerifiedAt: string;
}

export interface ValidationIssueDto {
  readonly id: string;
  readonly ruleId: string;
  readonly level: ValidationLevel;
  readonly result: Exclude<ValidationResult, "PASS">;
  readonly title: string;
  readonly detail: string;
  readonly target: ValidationTargetDto;
}

export interface ValidationSummaryDto {
  readonly pass: number;
  readonly warning: number;
  readonly fail: number;
  readonly blocked: number;
}

export interface ValidationRunDto {
  readonly id: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly levels: readonly ValidationLevel[];
  readonly status: ValidationResult;
  readonly inventoryRequired: number;
  readonly inventoryVerified: number;
  readonly summary: ValidationSummaryDto;
  readonly issues: readonly ValidationIssueDto[];
  readonly inventory: readonly ValidationInventoryItemDto[];
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface RunValidationRequest {
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface ValidationRunListDto {
  readonly projectId: string;
  readonly runs: readonly ValidationRunDto[];
}
