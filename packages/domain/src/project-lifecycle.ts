export const PROJECT_LIFECYCLE_STATUSES = [
  "ACTIVE",
  "TRASHING",
  "TRASHED",
  "RESTORING",
  "PURGING",
  "PURGE_FAILED",
  "PURGED",
] as const;

export type ProjectLifecycleStatus =
  (typeof PROJECT_LIFECYCLE_STATUSES)[number];

const projectLifecycleStatusSet = new Set<string>(PROJECT_LIFECYCLE_STATUSES);

const PROJECT_LIFECYCLE_TRANSITIONS = {
  ACTIVE: ["TRASHING"],
  TRASHING: ["TRASHED", "ACTIVE"],
  TRASHED: ["RESTORING", "PURGING"],
  RESTORING: ["ACTIVE", "TRASHED"],
  PURGING: ["PURGED", "PURGE_FAILED"],
  PURGE_FAILED: ["PURGING"],
  PURGED: [],
} as const satisfies Readonly<
  Record<ProjectLifecycleStatus, readonly ProjectLifecycleStatus[]>
>;

export function isProjectLifecycleStatus(
  value: unknown,
): value is ProjectLifecycleStatus {
  return typeof value === "string" && projectLifecycleStatusSet.has(value);
}

export function canTransitionProjectLifecycle(
  from: ProjectLifecycleStatus,
  to: ProjectLifecycleStatus,
): boolean {
  return (PROJECT_LIFECYCLE_TRANSITIONS[from] as readonly string[]).includes(
    to,
  );
}
