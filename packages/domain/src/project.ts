import type { ProjectLifecycleStatus } from "./project-lifecycle.js";

export interface Project {
  readonly id: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly lifecycleStatus: ProjectLifecycleStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
  readonly deletedBy?: string;
  readonly originalStoragePath?: string;
  readonly trashStoragePath?: string;
  readonly currentStoragePath?: string;
}
