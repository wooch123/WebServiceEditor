import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { PROJECT_LIFECYCLE_STATUSES } from "@webeditor/domain";
import Database from "better-sqlite3";

const METADATA_APPLICATION_ID = 0x57454245;
export const LATEST_METADATA_SCHEMA_VERSION = 4;

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

const pageManagementSchemaSql = `
  CREATE TABLE pages (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 99),
    route TEXT NOT NULL CHECK (
      length(route) BETWEEN 1 AND 200 AND substr(route, 1, 1) = '/'
    ),
    page_type TEXT NOT NULL CHECK (page_type = 'blank'),
    icon_name TEXT NOT NULL CHECK (length(icon_name) BETWEEN 1 AND 120),
    icon_catalog_version TEXT NOT NULL CHECK (icon_catalog_version = '1.31.0'),
    navigation_visible INTEGER NOT NULL DEFAULT 1 CHECK (navigation_visible IN (0, 1)),
    navigation_group TEXT CHECK (
      navigation_group IS NULL OR length(trim(navigation_group)) BETWEEN 1 AND 100
    ),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX pages_active_route_unique_idx
    ON pages(project_id, route COLLATE NOCASE) WHERE deleted_at IS NULL;
  CREATE UNIQUE INDEX pages_active_sort_order_unique_idx
    ON pages(project_id, sort_order) WHERE deleted_at IS NULL;
  CREATE INDEX pages_project_deleted_sort_idx
    ON pages(project_id, deleted_at, sort_order);

  CREATE TABLE page_commands (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    command_type TEXT NOT NULL CHECK (command_type = 'DELETE'),
    snapshot_json TEXT NOT NULL,
    impact_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT
  );
  CREATE INDEX page_commands_project_created_idx
    ON page_commands(project_id, created_at);

  CREATE TABLE project_definition_operations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    operation_type TEXT NOT NULL CHECK (
      operation_type IN ('PAGE_CREATE', 'PAGE_REORDER', 'PAGE_DELETE', 'PAGE_UNDO', 'PUBLISH')
    ),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL CHECK (response_status BETWEEN 200 AND 299),
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, idempotency_key)
  );

  CREATE TABLE project_versions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    source_project_revision INTEGER NOT NULL CHECK (source_project_revision >= 1),
    snapshot_json TEXT NOT NULL,
    published_at TEXT NOT NULL,
    UNIQUE(project_id, sequence)
  );
  CREATE INDEX project_versions_project_published_idx
    ON project_versions(project_id, sequence DESC);
  CREATE TRIGGER project_versions_immutable_update
    BEFORE UPDATE ON project_versions
    BEGIN
      SELECT RAISE(ABORT, 'project_versions are immutable');
    END;
`;

const pageManagementSchemaChecksum = createHash("sha256")
  .update(pageManagementSchemaSql)
  .digest("hex");

const canvasElementLayoutSchemaSql = `
  CREATE UNIQUE INDEX pages_id_project_unique_idx ON pages(id, project_id);

  CREATE TABLE page_layout_revisions (
    page_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    desktop_revision INTEGER NOT NULL DEFAULT 0
      CHECK (desktop_revision >= 0)
      CHECK (typeof(desktop_revision) = 'integer'),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id) ON DELETE CASCADE
  );
  CREATE INDEX page_layout_revisions_project_idx
    ON page_layout_revisions(project_id, page_id);
  INSERT INTO page_layout_revisions (page_id, project_id, desktop_revision, updated_at)
    SELECT id, project_id, 0, updated_at FROM pages;
  CREATE TRIGGER pages_initialize_layout_revision
    AFTER INSERT ON pages
    BEGIN
      INSERT INTO page_layout_revisions (
        page_id, project_id, desktop_revision, updated_at
      ) VALUES (NEW.id, NEW.project_id, 0, NEW.updated_at);
    END;

  CREATE TABLE elements (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'button', 'container', 'kpi-card')),
    type_version INTEGER NOT NULL DEFAULT 1 CHECK (type_version = 1),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    props_json TEXT NOT NULL CHECK (json_valid(props_json) AND json_type(props_json) = 'object'),
    style_json TEXT NOT NULL CHECK (json_valid(style_json) AND json_type(style_json) = 'object'),
    events_json TEXT NOT NULL CHECK (json_valid(events_json) AND json_type(events_json) = 'array'),
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1
      CHECK (revision >= 1)
      CHECK (typeof(revision) = 'integer'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(id, page_id, project_id),
    FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id) ON DELETE CASCADE
  );
  CREATE INDEX elements_page_active_idx
    ON elements(page_id, deleted_at, created_at, id);
  CREATE INDEX elements_project_active_idx
    ON elements(project_id, deleted_at, page_id, id);

  CREATE TABLE element_layouts (
    element_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    breakpoint TEXT NOT NULL CHECK (breakpoint IN ('desktop', 'tablet', 'mobile')),
    x INTEGER NOT NULL CHECK (x >= 0) CHECK (typeof(x) = 'integer'),
    y INTEGER NOT NULL CHECK (y >= 0) CHECK (typeof(y) = 'integer'),
    w INTEGER NOT NULL CHECK (w >= 1) CHECK (typeof(w) = 'integer'),
    h INTEGER NOT NULL CHECK (h >= 1) CHECK (typeof(h) = 'integer'),
    min_w INTEGER NOT NULL CHECK (min_w >= 1) CHECK (typeof(min_w) = 'integer'),
    min_h INTEGER NOT NULL CHECK (min_h >= 1) CHECK (typeof(min_h) = 'integer'),
    max_w INTEGER NOT NULL CHECK (max_w >= min_w) CHECK (typeof(max_w) = 'integer'),
    max_h INTEGER NOT NULL CHECK (max_h >= min_h) CHECK (typeof(max_h) = 'integer'),
    PRIMARY KEY (element_id, breakpoint),
    CHECK (w BETWEEN min_w AND max_w),
    CHECK (h BETWEEN min_h AND max_h),
    CHECK (breakpoint != 'desktop' OR (max_w <= 24 AND x + w <= 24)),
    FOREIGN KEY (element_id, page_id, project_id)
      REFERENCES elements(id, page_id, project_id) ON DELETE CASCADE
  );
  CREATE INDEX element_layouts_page_breakpoint_idx
    ON element_layouts(page_id, breakpoint, y, x, element_id);

  CREATE TABLE element_commands (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    element_id TEXT,
    command_type TEXT NOT NULL CHECK (
      command_type IN ('ADD', 'MOVE', 'RESIZE', 'LOCK', 'BATCH_LAYOUT', 'DELETE')
    ),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
    response_status INTEGER NOT NULL
      CHECK (response_status BETWEEN 200 AND 499)
      CHECK (typeof(response_status) = 'integer'),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    before_layout_revision INTEGER NOT NULL
      CHECK (before_layout_revision >= 0)
      CHECK (typeof(before_layout_revision) = 'integer'),
    after_layout_revision INTEGER NOT NULL
      CHECK (after_layout_revision >= before_layout_revision)
      CHECK (typeof(after_layout_revision) = 'integer'),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, idempotency_key),
    FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id) ON DELETE CASCADE
  );
  CREATE INDEX element_commands_page_created_idx
    ON element_commands(page_id, created_at, id);
`;

export const CANVAS_ELEMENT_LAYOUT_SCHEMA_CHECKSUM = createHash("sha256")
  .update(canvasElementLayoutSchemaSql)
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
  {
    checksum: pageManagementSchemaChecksum,
    name: "page-management-and-published-navigation",
    sql: pageManagementSchemaSql,
    version: 3,
  },
  {
    checksum: CANVAS_ELEMENT_LAYOUT_SCHEMA_CHECKSUM,
    name: "canvas-element-layout-kernel",
    sql: canvasElementLayoutSchemaSql,
    version: 4,
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
    const userVersion = this.#numberPragma("user_version");
    if (applicationId !== 0 && applicationId !== METADATA_APPLICATION_ID) {
      throw new Error("Refusing to initialize a non-WebEditor SQLite database");
    }
    if (userVersion > LATEST_METADATA_SCHEMA_VERSION) {
      throw new Error(
        `Refusing unknown future metadata schema version ${userVersion}`,
      );
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
      const recordedVersions = rows.map((row) => row.version);
      const highestRecordedVersion = recordedVersions.at(-1) ?? 0;
      if (
        recordedVersions.some(
          (version, index) =>
            version !== index + 1 || version > LATEST_METADATA_SCHEMA_VERSION,
        )
      ) {
        throw new Error("Metadata migration history is not a known prefix");
      }
      if (userVersion !== highestRecordedVersion) {
        throw new Error("Metadata user_version and migration history disagree");
      }

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
