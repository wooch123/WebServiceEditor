import type { ThemeTokens } from "./theme.js";

export const THEME_REVISION_STATUSES = [
  "DRAFT",
  "VALIDATING",
  "VALID",
  "INVALID",
  "PUBLISHED",
  "SUPERSEDED",
] as const;

export type ThemeRevisionStatus = (typeof THEME_REVISION_STATUSES)[number];

export interface ThemeRevision {
  readonly id: string;
  readonly projectId: string;
  readonly presetId: string;
  readonly tokenHash: string;
  readonly tokens: ThemeTokens;
  readonly status: ThemeRevisionStatus;
  readonly createdAt: string;
  readonly basedOnRevisionId?: string;
  readonly validationRunId?: string;
  readonly publishedAt?: string;
}

export interface ThemeRevisionValidation {
  readonly schemaValid: boolean;
  readonly contrastValid: boolean;
  readonly smokeValid: boolean;
  readonly errors: readonly string[];
  readonly validatedAt: string;
}

export interface RuntimeThemePolicy {
  readonly projectId: string;
  readonly defaultThemePresetId: string;
  readonly currentThemeRevisionId: string | null;
  readonly publishedThemeRevisionId: string | null;
  readonly autoApplyThemeToRuntime: boolean;
  readonly allowRuntimeThemeSelection: boolean;
  readonly allowedRuntimeThemeIds: readonly string[];
  readonly runtimeThemeVersion: number;
  readonly updatedAt: string;
}

export interface RuntimeThemeManifest {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly version: number;
  readonly defaultThemeId: string;
  readonly publishedThemeRevisionId: string | null;
  readonly publishedThemeId: string | null;
  readonly resolvedThemeId: string;
  readonly resolvedThemeRevisionId: string;
  readonly tokenHash: string;
  readonly tokens: ThemeTokens;
  readonly allowRuntimeThemeSelection: boolean;
  readonly allowedThemeIds: readonly string[];
  readonly fallbackThemeId: string;
  readonly updatedAt: string;
}

const transitions = {
  DRAFT: ["VALIDATING"],
  VALIDATING: ["VALID", "INVALID"],
  VALID: ["PUBLISHED", "SUPERSEDED"],
  INVALID: ["DRAFT", "SUPERSEDED"],
  PUBLISHED: ["SUPERSEDED"],
  SUPERSEDED: [],
} as const satisfies Readonly<
  Record<ThemeRevisionStatus, readonly ThemeRevisionStatus[]>
>;

export function canTransitionThemeRevision(
  from: ThemeRevisionStatus,
  to: ThemeRevisionStatus,
): boolean {
  return (transitions[from] as readonly string[]).includes(to);
}

export function createDraftThemeRevision(input: {
  readonly id: string;
  readonly projectId: string;
  readonly presetId: string;
  readonly tokenHash: string;
  readonly tokens: ThemeTokens;
  readonly createdAt: string;
  readonly basedOnRevisionId?: string;
}): ThemeRevision {
  return { ...input, status: "DRAFT" };
}
