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
