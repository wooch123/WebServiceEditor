import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { PROJECT_LIFECYCLE_STATUSES } from "@webeditor/domain";
import Database from "better-sqlite3";

const METADATA_APPLICATION_ID = 0x57454245;
export const LATEST_METADATA_SCHEMA_VERSION = 2;

const lifecycleSqlValues = PROJECT_LIFECYCLE_STATUSES.map(
  (status) => `'${status}'`,
).join(", ");

const initialSchemaSql = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
    description TEXT,
    lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN (${lifecycleSqlValues})),
    status TEXT NOT NULL DEFAULT 'DRAFT',
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    deleted_by TEXT,
    deleted_reason TEXT,
    original_storage_path TEXT,
    current_storage_path TEXT,
    purge_eligible_at TEXT,
    tombstone_checksum TEXT
  );

  CREATE INDEX projects_lifecycle_status_idx ON projects(lifecycle_status);
  CREATE INDEX projects_slug_idx ON projects(slug);
  CREATE INDEX projects_deleted_at_idx ON projects(deleted_at);
`;

export const INITIAL_METADATA_SCHEMA_CHECKSUM = createHash("sha256")
  .update(initialSchemaSql)
  .digest("hex");

const lifecycleFoundationSchemaSql = `
  ALTER TABLE projects ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0 CHECK (lifecycle_revision >= 0);
  ALTER TABLE projects ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1));
  ALTER TABLE projects ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'light-clean-paper';
  CREATE UNIQUE INDEX projects_active_slug_unique_idx
    ON projects(slug COLLATE NOCASE)
    WHERE lifecycle_status IN ('ACTIVE', 'TRASHING', 'RESTORING');

  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    action TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    correlation_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX audit_logs_project_created_idx ON audit_logs(project_id, created_at);

  CREATE TABLE project_lifecycle_operations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    operation_type TEXT NOT NULL CHECK (operation_type IN ('TRASH', 'RESTORE', 'PURGE')),
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    storage_from TEXT,
    storage_to TEXT,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    response_status INTEGER,
    response_json TEXT,
    error_json TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(project_id, idempotency_key)
  );
  CREATE INDEX lifecycle_operations_project_status_idx
    ON project_lifecycle_operations(project_id, status);

  CREATE TABLE lifecycle_outbox (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    operation_id TEXT NOT NULL REFERENCES project_lifecycle_operations(id),
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX lifecycle_outbox_status_idx ON lifecycle_outbox(status, next_attempt_at);

  CREATE TABLE trash_manifests (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
    operation_id TEXT NOT NULL REFERENCES project_lifecycle_operations(id),
    original_slug TEXT NOT NULL,
    original_storage_path TEXT NOT NULL,
    trash_storage_path TEXT NOT NULL,
    project_checksum TEXT NOT NULL,
    test_db_checksum TEXT NOT NULL,
    production_db_checksum TEXT NOT NULL,
    asset_count INTEGER NOT NULL CHECK (asset_count >= 0),
    deleted_at TEXT NOT NULL,
    manifest_json TEXT NOT NULL
  );

  CREATE TABLE purge_plans (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    project_name TEXT NOT NULL,
    lifecycle_revision INTEGER NOT NULL CHECK (lifecycle_revision >= 0),
    project_checksum TEXT NOT NULL,
    impact_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
  );
  CREATE INDEX purge_plans_project_expires_idx ON purge_plans(project_id, expires_at);

  CREATE TABLE project_tombstones (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
    project_name TEXT NOT NULL,
    project_checksum TEXT NOT NULL,
    operation_id TEXT NOT NULL REFERENCES project_lifecycle_operations(id),
    backup_retained INTEGER NOT NULL CHECK (backup_retained IN (0, 1)),
    detail_json TEXT NOT NULL,
    purged_at TEXT NOT NULL
  );
`;

const lifecycleFoundationSchemaChecksum = createHash("sha256")
  .update(lifecycleFoundationSchemaSql)
  .digest("hex");

const metadataMigrations = [
  {
    checksum: INITIAL_METADATA_SCHEMA_CHECKSUM,
    name: "initial-project-metadata",
    sql: initialSchemaSql,
    version: 1,
  },
  {
    checksum: lifecycleFoundationSchemaChecksum,
    name: "project-lifecycle-foundation",
    sql: lifecycleFoundationSchemaSql,
    version: 2,
  },
] as const;

export interface MetadataReadiness {
  readonly applicationId: number;
  readonly foreignKeysEnabled: true;
  readonly integrity: "ok";
  readonly schemaVersion: number;
}

export class MetadataDatabase {
  readonly #database: Database.Database;

  constructor(readonly path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.#database = new Database(path);
    this.#database.pragma("foreign_keys = ON");

    try {
      this.#initialize();
      this.#database.pragma("journal_mode = WAL");
      this.#database.pragma("synchronous = FULL");
      this.assertReady();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  #initialize(): void {
    const applicationId = this.#numberPragma("application_id");
    if (applicationId !== 0 && applicationId !== METADATA_APPLICATION_ID) {
      throw new Error("Refusing to initialize a non-WebEditor SQLite database");
    }

    const migrate = this.#database.transaction(() => {
      if (applicationId === 0) {
        this.#database.pragma(`application_id = ${METADATA_APPLICATION_ID}`);
      }

      this.#database.exec(`
        CREATE TABLE IF NOT EXISTS metadata_migrations (
          version INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL UNIQUE,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);

      const rows = this.#database
        .prepare(
          "SELECT version, checksum FROM metadata_migrations ORDER BY version",
        )
        .all() as readonly {
        readonly version: number;
        readonly checksum: string;
      }[];
      const appliedByVersion = new Map(
        rows.map((row) => [row.version, row.checksum]),
      );

      for (const migration of metadataMigrations) {
        const appliedChecksum = appliedByVersion.get(migration.version);
        if (appliedChecksum !== undefined) {
          if (appliedChecksum !== migration.checksum) {
            throw new Error(
              `Metadata migration checksum mismatch at version ${migration.version}`,
            );
          }
          continue;
        }

        this.#database.exec(migration.sql);
        this.#database
          .prepare(
            `INSERT INTO metadata_migrations
              (version, name, checksum, applied_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            migration.version,
            migration.name,
            migration.checksum,
            new Date().toISOString(),
          );
      }
      this.#database.pragma(`user_version = ${LATEST_METADATA_SCHEMA_VERSION}`);
    });

    migrate.immediate();
  }

  #numberPragma(
    name: "application_id" | "foreign_keys" | "user_version",
  ): number {
    const value: unknown = this.#database.pragma(name, { simple: true });
    if (typeof value !== "number") {
      throw new Error(`Unexpected SQLite pragma value for ${name}`);
    }
    return value;
  }

  assertReady(): MetadataReadiness {
    const applicationId = this.#numberPragma("application_id");
    const foreignKeys = this.#numberPragma("foreign_keys");
    const schemaVersion = this.#numberPragma("user_version");
    const integrity: unknown = this.#database.pragma("quick_check", {
      simple: true,
    });
    const foreignKeyViolations = this.#database.pragma("foreign_key_check") as
      readonly unknown[] | undefined;

    if (applicationId !== METADATA_APPLICATION_ID) {
      throw new Error("Metadata database application ID is invalid");
    }
    if (foreignKeys !== 1) {
      throw new Error("SQLite foreign key enforcement is disabled");
    }
    if (schemaVersion !== LATEST_METADATA_SCHEMA_VERSION) {
      throw new Error("Metadata database schema is not current");
    }
    if (integrity !== "ok") {
      throw new Error("Metadata database integrity check failed");
    }
    if (foreignKeyViolations === undefined || foreignKeyViolations.length > 0) {
      throw new Error("Metadata database has foreign key violations");
    }

    return {
      applicationId,
      foreignKeysEnabled: true,
      integrity,
      schemaVersion,
    };
  }

  get connection(): Database.Database {
    return this.#database;
  }

  transaction<T>(operation: () => T): T {
    return this.#database.transaction(operation).immediate();
  }

  close(): void {
    if (this.#database.open) {
      this.#database.close();
    }
  }
}
