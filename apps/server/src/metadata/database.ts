import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { PROJECT_LIFECYCLE_STATUSES } from "@webeditor/domain";
import Database from "better-sqlite3";

const METADATA_APPLICATION_ID = 0x57454245;
export const LATEST_METADATA_SCHEMA_VERSION = 8;

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

const elementRegistryPropertiesHistorySchemaSql = `
  CREATE TABLE elements_v5 (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 120),
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
  INSERT INTO elements_v5 (
    id, project_id, page_id, type, type_version, name, props_json, style_json,
    events_json, locked, hidden, revision, created_at, updated_at, deleted_at
  ) SELECT
    id, project_id, page_id, type, type_version, name, props_json, style_json,
    events_json, locked, hidden, revision, created_at, updated_at, deleted_at
  FROM elements;

  CREATE TABLE element_layouts_v5 (
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
      REFERENCES elements_v5(id, page_id, project_id) ON DELETE CASCADE
  );
  INSERT INTO element_layouts_v5 (
    element_id, project_id, page_id, breakpoint, x, y, w, h,
    min_w, min_h, max_w, max_h
  ) SELECT
    element_id, project_id, page_id, breakpoint, x, y, w, h,
    min_w, min_h, max_w, max_h
  FROM element_layouts;

  DROP TABLE element_layouts;
  DROP TABLE elements;
  ALTER TABLE elements_v5 RENAME TO elements;
  ALTER TABLE element_layouts_v5 RENAME TO element_layouts;
  CREATE INDEX elements_page_active_idx
    ON elements(page_id, deleted_at, created_at, id);
  CREATE INDEX elements_project_active_idx
    ON elements(project_id, deleted_at, page_id, id);
  CREATE INDEX element_layouts_page_breakpoint_idx
    ON element_layouts(page_id, breakpoint, y, x, element_id);

  CREATE TABLE element_commands_v5 (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    element_id TEXT,
    command_type TEXT NOT NULL CHECK (
      command_type IN ('ADD', 'MOVE', 'RESIZE', 'LOCK', 'BATCH_LAYOUT', 'DELETE', 'PROPERTIES')
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
    history_state TEXT CHECK (
      history_state IS NULL OR history_state IN ('APPLIED', 'UNDONE', 'DISCARDED')
    ),
    history_sequence INTEGER CHECK (
      history_sequence IS NULL OR
      (history_sequence >= 1 AND typeof(history_sequence) = 'integer')
    ),
    history_updated_at TEXT,
    created_at TEXT NOT NULL,
    CHECK (
      (history_state IS NULL AND history_sequence IS NULL AND history_updated_at IS NULL) OR
      (history_state IS NOT NULL AND history_sequence IS NOT NULL AND history_updated_at IS NOT NULL)
    ),
    UNIQUE(id, project_id),
    UNIQUE(project_id, idempotency_key),
    UNIQUE(project_id, history_sequence),
    FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id) ON DELETE CASCADE
  );
  INSERT INTO element_commands_v5 (
    id, project_id, page_id, element_id, command_type, idempotency_key,
    request_hash, before_json, after_json, response_status, response_json,
    before_layout_revision, after_layout_revision, history_state,
    history_sequence, history_updated_at, created_at
  )
  SELECT
    id, project_id, page_id, element_id, command_type, idempotency_key,
    request_hash, before_json, after_json, response_status, response_json,
    before_layout_revision, after_layout_revision,
    CASE WHEN response_status BETWEEN 200 AND 299 THEN 'APPLIED' ELSE NULL END,
    CASE WHEN response_status BETWEEN 200 AND 299 THEN
      ROW_NUMBER() OVER (
        PARTITION BY project_id, (response_status BETWEEN 200 AND 299)
        ORDER BY created_at, element_commands.rowid
      )
    ELSE NULL END,
    CASE WHEN response_status BETWEEN 200 AND 299 THEN created_at ELSE NULL END,
    created_at
  FROM element_commands;
  DROP TABLE element_commands;
  ALTER TABLE element_commands_v5 RENAME TO element_commands;
  CREATE INDEX element_commands_page_created_idx
    ON element_commands(page_id, created_at, id);
  CREATE INDEX element_commands_project_history_idx
    ON element_commands(project_id, history_state, history_sequence);

  CREATE TABLE element_history_operations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    command_id TEXT,
    requested_command_id TEXT NOT NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN ('UNDO', 'REDO')),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL
      CHECK (response_status BETWEEN 200 AND 499)
      CHECK (typeof(response_status) = 'integer'),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, idempotency_key),
    FOREIGN KEY (command_id, project_id)
      REFERENCES element_commands(id, project_id) ON DELETE CASCADE
  );
  CREATE INDEX element_history_operations_project_created_idx
    ON element_history_operations(project_id, created_at, id);
`;

export const ELEMENT_REGISTRY_PROPERTIES_HISTORY_SCHEMA_CHECKSUM = createHash(
  "sha256",
)
  .update(elementRegistryPropertiesHistorySchemaSql)
  .digest("hex");

const statisticalElementsLayoutPresetsSchemaSql = `
  CREATE TABLE element_commands_v6 (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    element_id TEXT,
    command_type TEXT NOT NULL CHECK (
      command_type IN (
        'ADD', 'MOVE', 'RESIZE', 'LOCK', 'BATCH_LAYOUT', 'DELETE',
        'PROPERTIES', 'PRESET_APPLY'
      )
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
    history_state TEXT CHECK (
      history_state IS NULL OR history_state IN ('APPLIED', 'UNDONE', 'DISCARDED')
    ),
    history_sequence INTEGER CHECK (
      history_sequence IS NULL OR
      (history_sequence >= 1 AND typeof(history_sequence) = 'integer')
    ),
    history_updated_at TEXT,
    created_at TEXT NOT NULL,
    CHECK (
      (history_state IS NULL AND history_sequence IS NULL AND history_updated_at IS NULL) OR
      (history_state IS NOT NULL AND history_sequence IS NOT NULL AND history_updated_at IS NOT NULL)
    ),
    UNIQUE(id, project_id),
    UNIQUE(project_id, idempotency_key),
    UNIQUE(project_id, history_sequence),
    FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id) ON DELETE CASCADE
  );
  INSERT INTO element_commands_v6 (
    id, project_id, page_id, element_id, command_type, idempotency_key,
    request_hash, before_json, after_json, response_status, response_json,
    before_layout_revision, after_layout_revision, history_state,
    history_sequence, history_updated_at, created_at
  ) SELECT
    id, project_id, page_id, element_id, command_type, idempotency_key,
    request_hash, before_json, after_json, response_status, response_json,
    before_layout_revision, after_layout_revision, history_state,
    history_sequence, history_updated_at, created_at
  FROM element_commands;

  CREATE TABLE element_history_operations_v6 (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    command_id TEXT,
    requested_command_id TEXT NOT NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN ('UNDO', 'REDO')),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL
      CHECK (response_status BETWEEN 200 AND 499)
      CHECK (typeof(response_status) = 'integer'),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, idempotency_key),
    FOREIGN KEY (command_id, project_id)
      REFERENCES element_commands_v6(id, project_id) ON DELETE CASCADE
  );
  INSERT INTO element_history_operations_v6 (
    id, project_id, command_id, requested_command_id, operation_type,
    idempotency_key, request_hash, response_status, response_json, created_at
  ) SELECT
    id, project_id, command_id, requested_command_id, operation_type,
    idempotency_key, request_hash, response_status, response_json, created_at
  FROM element_history_operations;

  DROP TABLE element_history_operations;
  DROP TABLE element_commands;
  ALTER TABLE element_commands_v6 RENAME TO element_commands;
  ALTER TABLE element_history_operations_v6 RENAME TO element_history_operations;
  CREATE INDEX element_commands_page_created_idx
    ON element_commands(page_id, created_at, id);
  CREATE INDEX element_commands_project_history_idx
    ON element_commands(project_id, history_state, history_sequence);
  CREATE INDEX element_history_operations_project_created_idx
    ON element_history_operations(project_id, created_at, id);

  CREATE TABLE layout_preset_instances (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    preset_id TEXT NOT NULL CHECK (length(preset_id) BETWEEN 1 AND 120),
    preset_version INTEGER NOT NULL CHECK (preset_version = 1),
    preset_snapshot_json TEXT NOT NULL CHECK (
      json_valid(preset_snapshot_json) AND
      json_type(preset_snapshot_json) = 'object'
    ),
    registry_checksum TEXT NOT NULL CHECK (
      length(registry_checksum) = 64 AND
      registry_checksum = lower(registry_checksum) AND
      registry_checksum NOT GLOB '*[^0-9a-f]*'
    ),
    coordinate_checksum TEXT NOT NULL CHECK (
      length(coordinate_checksum) = 64 AND
      coordinate_checksum = lower(coordinate_checksum) AND
      coordinate_checksum NOT GLOB '*[^0-9a-f]*'
    ),
    apply_mode TEXT NOT NULL CHECK (apply_mode IN ('ADD', 'REPLACE')),
    instance_state TEXT NOT NULL CHECK (
      instance_state IN ('APPLIED', 'UNDONE', 'DISCARDED')
    ),
    origin TEXT NOT NULL CHECK (origin IN ('APPLY', 'IMPORT')),
    command_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(id, project_id, page_id),
    UNIQUE(command_id, project_id),
    FOREIGN KEY (page_id, project_id) REFERENCES pages(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (command_id, project_id)
      REFERENCES element_commands(id, project_id) ON DELETE CASCADE
  );
  CREATE INDEX layout_preset_instances_page_state_idx
    ON layout_preset_instances(page_id, instance_state, created_at, id);
  CREATE INDEX layout_preset_instances_project_idx
    ON layout_preset_instances(project_id, created_at, id);

  CREATE TABLE layout_preset_instance_elements (
    instance_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    template_id TEXT NOT NULL CHECK (length(template_id) BETWEEN 1 AND 120),
    element_id TEXT NOT NULL,
    element_type TEXT NOT NULL CHECK (length(element_type) BETWEEN 1 AND 120),
    element_type_version INTEGER NOT NULL CHECK (element_type_version = 1),
    initial_x INTEGER NOT NULL CHECK (initial_x >= 0 AND typeof(initial_x) = 'integer'),
    initial_y INTEGER NOT NULL CHECK (initial_y >= 0 AND typeof(initial_y) = 'integer'),
    initial_w INTEGER NOT NULL CHECK (initial_w >= 1 AND typeof(initial_w) = 'integer'),
    initial_h INTEGER NOT NULL CHECK (initial_h >= 1 AND typeof(initial_h) = 'integer'),
    entry_snapshot_json TEXT NOT NULL CHECK (
      json_valid(entry_snapshot_json) AND json_type(entry_snapshot_json) = 'object'
    ),
    PRIMARY KEY (instance_id, template_id),
    UNIQUE(element_id),
    UNIQUE(
      instance_id, template_id, element_id, element_type_version,
      project_id, page_id
    ),
    FOREIGN KEY (instance_id, project_id, page_id)
      REFERENCES layout_preset_instances(id, project_id, page_id) ON DELETE CASCADE,
    FOREIGN KEY (element_id, page_id, project_id)
      REFERENCES elements(id, page_id, project_id) ON DELETE CASCADE
  );
  CREATE INDEX layout_preset_instance_elements_project_idx
    ON layout_preset_instance_elements(project_id, page_id, element_id);

  CREATE TABLE element_binding_placeholders (
    element_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    element_type_version INTEGER NOT NULL CHECK (element_type_version = 1),
    port_id TEXT NOT NULL CHECK (length(port_id) BETWEEN 1 AND 120),
    instance_id TEXT,
    template_id TEXT,
    status TEXT NOT NULL CHECK (status = 'UNCONNECTED'),
    created_at TEXT NOT NULL,
    PRIMARY KEY (element_id, port_id),
    CHECK (
      (instance_id IS NULL AND template_id IS NULL) OR
      (instance_id IS NOT NULL AND template_id IS NOT NULL)
    ),
    FOREIGN KEY (element_id, page_id, project_id)
      REFERENCES elements(id, page_id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (
      instance_id, template_id, element_id, element_type_version,
      project_id, page_id
    ) REFERENCES layout_preset_instance_elements (
      instance_id, template_id, element_id, element_type_version,
      project_id, page_id
    ) ON DELETE CASCADE
  );
  CREATE INDEX element_binding_placeholders_project_page_idx
    ON element_binding_placeholders(project_id, page_id, element_id, port_id);
  CREATE INDEX element_binding_placeholders_instance_idx
    ON element_binding_placeholders(instance_id, template_id);

  INSERT INTO element_binding_placeholders (
    element_id, project_id, page_id, element_type_version, port_id,
    instance_id, template_id, status, created_at
  )
  SELECT id, project_id, page_id, type_version, 'value', NULL, NULL,
    'UNCONNECTED', created_at
  FROM elements WHERE type = 'kpi-card';
  INSERT INTO element_binding_placeholders (
    element_id, project_id, page_id, element_type_version, port_id,
    instance_id, template_id, status, created_at
  )
  SELECT id, project_id, page_id, type_version, 'rows', NULL, NULL,
    'UNCONNECTED', created_at
  FROM elements WHERE type = 'data-table';
`;

export const STATISTICAL_ELEMENTS_LAYOUT_PRESETS_SCHEMA_CHECKSUM = createHash(
  "sha256",
)
  .update(statisticalElementsLayoutPresetsSchemaSql)
  .digest("hex");

const databaseDesignerSchemaSql = `
  CREATE TABLE project_schema_states (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    draft_revision INTEGER NOT NULL DEFAULT 0
      CHECK (draft_revision >= 0 AND typeof(draft_revision) = 'integer'),
    test_applied_revision INTEGER NOT NULL DEFAULT 0
      CHECK (test_applied_revision >= 0 AND typeof(test_applied_revision) = 'integer'),
    test_schema_checksum TEXT CHECK (
      test_schema_checksum IS NULL OR (
        length(test_schema_checksum) = 64 AND
        test_schema_checksum = lower(test_schema_checksum) AND
        test_schema_checksum NOT GLOB '*[^0-9a-f]*'
      )
    ),
    production_applied_revision INTEGER NOT NULL DEFAULT 0
      CHECK (production_applied_revision >= 0 AND typeof(production_applied_revision) = 'integer'),
    production_schema_checksum TEXT CHECK (
      production_schema_checksum IS NULL OR (
        length(production_schema_checksum) = 64 AND
        production_schema_checksum = lower(production_schema_checksum) AND
        production_schema_checksum NOT GLOB '*[^0-9a-f]*'
      )
    ),
    updated_at TEXT NOT NULL
  );
  INSERT INTO project_schema_states (project_id, updated_at)
    SELECT id, updated_at FROM projects;
  CREATE TRIGGER projects_initialize_schema_state
    AFTER INSERT ON projects
    BEGIN
      INSERT INTO project_schema_states (project_id, updated_at)
      VALUES (NEW.id, NEW.updated_at);
    END;

  CREATE TABLE data_tables (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
    physical_name TEXT NOT NULL CHECK (
      physical_name GLOB 't_[0-9a-f]*' AND length(physical_name) = 34
    ),
    description TEXT CHECK (
      description IS NULL OR length(description) <= 1000
    ),
    revision INTEGER NOT NULL DEFAULT 1
      CHECK (revision >= 1 AND typeof(revision) = 'integer'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(id, project_id),
    UNIQUE(project_id, physical_name)
  );
  CREATE UNIQUE INDEX data_tables_active_display_name_idx
    ON data_tables(project_id, display_name COLLATE NOCASE)
    WHERE deleted_at IS NULL;
  CREATE INDEX data_tables_project_active_idx
    ON data_tables(project_id, deleted_at, created_at, id);

  CREATE TABLE data_fields (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    table_id TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
    physical_name TEXT NOT NULL CHECK (
      physical_name GLOB 'c_[0-9a-f]*' AND length(physical_name) = 34
    ),
    field_type TEXT NOT NULL CHECK (
      field_type IN ('INTEGER', 'REAL', 'TEXT', 'BOOLEAN', 'DATE', 'DATETIME', 'JSON', 'BLOB')
    ),
    primary_key INTEGER NOT NULL DEFAULT 0 CHECK (primary_key IN (0, 1)),
    auto_increment INTEGER NOT NULL DEFAULT 0 CHECK (auto_increment IN (0, 1)),
    nullable INTEGER NOT NULL DEFAULT 1 CHECK (nullable IN (0, 1)),
    is_unique INTEGER NOT NULL DEFAULT 0 CHECK (is_unique IN (0, 1)),
    default_value TEXT CHECK (default_value IS NULL OR length(default_value) <= 1000),
    indexed INTEGER NOT NULL DEFAULT 0 CHECK (indexed IN (0, 1)),
    unit TEXT CHECK (unit IS NULL OR length(unit) <= 100),
    description TEXT CHECK (description IS NULL OR length(description) <= 1000),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0 AND typeof(sort_order) = 'integer'),
    revision INTEGER NOT NULL DEFAULT 1
      CHECK (revision >= 1 AND typeof(revision) = 'integer'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(id, table_id, project_id),
    UNIQUE(table_id, physical_name),
    CHECK (auto_increment = 0 OR (primary_key = 1 AND field_type = 'INTEGER')),
    CHECK (primary_key = 0 OR nullable = 0),
    FOREIGN KEY (table_id, project_id)
      REFERENCES data_tables(id, project_id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX data_fields_active_display_name_idx
    ON data_fields(table_id, display_name COLLATE NOCASE)
    WHERE deleted_at IS NULL;
  CREATE UNIQUE INDEX data_fields_active_sort_order_idx
    ON data_fields(table_id, sort_order) WHERE deleted_at IS NULL;
  CREATE INDEX data_fields_project_table_active_idx
    ON data_fields(project_id, table_id, deleted_at, sort_order, id);

  CREATE TABLE data_relations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
    relation_type TEXT NOT NULL CHECK (
      relation_type IN ('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE')
    ),
    source_table_id TEXT NOT NULL,
    source_field_id TEXT NOT NULL,
    target_table_id TEXT NOT NULL,
    target_field_id TEXT NOT NULL,
    on_delete TEXT NOT NULL CHECK (on_delete IN ('RESTRICT', 'CASCADE', 'SET_NULL')),
    revision INTEGER NOT NULL DEFAULT 1
      CHECK (revision >= 1 AND typeof(revision) = 'integer'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(id, project_id),
    FOREIGN KEY (source_table_id, project_id)
      REFERENCES data_tables(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (target_table_id, project_id)
      REFERENCES data_tables(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (source_field_id, source_table_id, project_id)
      REFERENCES data_fields(id, table_id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (target_field_id, target_table_id, project_id)
      REFERENCES data_fields(id, table_id, project_id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX data_relations_active_endpoints_idx
    ON data_relations(project_id, source_field_id, target_field_id)
    WHERE deleted_at IS NULL;
  CREATE INDEX data_relations_project_active_idx
    ON data_relations(project_id, deleted_at, created_at, id);

  CREATE TABLE schema_migration_plans (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_environment TEXT NOT NULL CHECK (target_environment = 'test'),
    schema_revision INTEGER NOT NULL CHECK (
      schema_revision >= 0 AND typeof(schema_revision) = 'integer'
    ),
    project_revision INTEGER NOT NULL CHECK (
      project_revision >= 1 AND typeof(project_revision) = 'integer'
    ),
    schema_checksum TEXT NOT NULL CHECK (
      length(schema_checksum) = 64 AND schema_checksum = lower(schema_checksum) AND
      schema_checksum NOT GLOB '*[^0-9a-f]*'
    ),
    snapshot_json TEXT NOT NULL CHECK (
      json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'
    ),
    plan_json TEXT NOT NULL CHECK (
      json_valid(plan_json) AND json_type(plan_json) = 'object'
    ),
    status TEXT NOT NULL CHECK (
      status IN ('READY', 'APPLYING', 'APPLIED', 'FAILED', 'EXPIRED')
    ),
    backup_id TEXT,
    backup_checksum TEXT,
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX schema_migration_plans_project_status_idx
    ON schema_migration_plans(project_id, status, expires_at);

  CREATE TABLE schema_backups (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES schema_migration_plans(id) ON DELETE CASCADE,
    environment TEXT NOT NULL CHECK (environment = 'test'),
    relative_path TEXT NOT NULL,
    checksum TEXT NOT NULL CHECK (
      length(checksum) = 64 AND checksum = lower(checksum) AND
      checksum NOT GLOB '*[^0-9a-f]*'
    ),
    size_bytes INTEGER NOT NULL CHECK (
      size_bytes >= 0 AND typeof(size_bytes) = 'integer'
    ),
    verified INTEGER NOT NULL CHECK (verified = 1),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, plan_id)
  );

  CREATE TABLE schema_commands (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id TEXT,
    command_type TEXT NOT NULL CHECK (
      command_type IN (
        'TABLE_CREATE', 'TABLE_UPDATE', 'TABLE_DELETE',
        'FIELD_CREATE', 'FIELD_UPDATE', 'FIELD_DELETE',
        'RELATION_CREATE', 'RELATION_UPDATE', 'RELATION_DELETE',
        'SCHEMA_APPLY'
      )
    ),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL CHECK (
      length(request_hash) = 64 AND request_hash = lower(request_hash) AND
      request_hash NOT GLOB '*[^0-9a-f]*'
    ),
    response_status INTEGER NOT NULL CHECK (
      response_status BETWEEN 200 AND 499 AND typeof(response_status) = 'integer'
    ),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, idempotency_key)
  );
  CREATE INDEX schema_commands_project_created_idx
    ON schema_commands(project_id, created_at, id);
`;

export const DATABASE_DESIGNER_SCHEMA_CHECKSUM = createHash("sha256")
  .update(databaseDesignerSchemaSql)
  .digest("hex");

const dataRelationshipCanvasSchemaSql = `
  CREATE TABLE project_binding_states (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    graph_revision INTEGER NOT NULL DEFAULT 0
      CHECK (graph_revision >= 0 AND typeof(graph_revision) = 'integer'),
    updated_at TEXT NOT NULL
  );
  INSERT INTO project_binding_states (project_id, updated_at)
    SELECT id, updated_at FROM projects;
  CREATE TRIGGER projects_initialize_binding_state
    AFTER INSERT ON projects
    BEGIN
      INSERT INTO project_binding_states (project_id, updated_at)
      VALUES (NEW.id, NEW.updated_at);
    END;

  CREATE TABLE bindings (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    binding_type TEXT NOT NULL CHECK (
      binding_type IN (
        'CONTAINS', 'READ', 'CREATE', 'UPDATE', 'DELETE',
        'FILTER', 'NAVIGATE', 'RELATION'
      )
    ),
    source_node_type TEXT NOT NULL CHECK (
      source_node_type IN ('page', 'element', 'table')
    ),
    source_object_id TEXT NOT NULL,
    source_node_id TEXT NOT NULL,
    source_port_id TEXT NOT NULL,
    source_port_role TEXT NOT NULL,
    source_side TEXT NOT NULL CHECK (source_side = 'right'),
    source_direction TEXT NOT NULL CHECK (source_direction = 'output'),
    source_value_type TEXT NOT NULL,
    target_node_type TEXT NOT NULL CHECK (
      target_node_type IN ('page', 'element', 'table')
    ),
    target_object_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    target_port_id TEXT NOT NULL,
    target_port_role TEXT NOT NULL,
    target_side TEXT NOT NULL CHECK (target_side = 'left'),
    target_direction TEXT NOT NULL CHECK (target_direction = 'input'),
    target_value_type TEXT NOT NULL,
    query_json TEXT NOT NULL CHECK (
      json_valid(query_json) AND json_type(query_json) = 'object'
    ),
    mapping_json TEXT NOT NULL CHECK (
      json_valid(mapping_json) AND json_type(mapping_json) = 'object'
    ),
    status TEXT NOT NULL CHECK (status IN ('READY', 'DISABLED')),
    revision INTEGER NOT NULL DEFAULT 1
      CHECK (revision >= 1 AND typeof(revision) = 'integer'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(id, project_id)
  );
  CREATE UNIQUE INDEX bindings_active_endpoints_idx
    ON bindings(project_id, source_port_id, target_port_id)
    WHERE deleted_at IS NULL;
  CREATE INDEX bindings_project_active_idx
    ON bindings(project_id, deleted_at, created_at, id);
  CREATE INDEX bindings_source_active_idx
    ON bindings(project_id, source_port_id, deleted_at);
  CREATE INDEX bindings_target_active_idx
    ON bindings(project_id, target_port_id, deleted_at);

  CREATE TABLE binding_commands (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    binding_id TEXT NOT NULL,
    command_type TEXT NOT NULL CHECK (
      command_type IN ('CREATE_BINDING', 'UPDATE_BINDING', 'DELETE_BINDING')
    ),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL CHECK (
      length(request_hash) = 64 AND request_hash = lower(request_hash) AND
      request_hash NOT GLOB '*[^0-9a-f]*'
    ),
    before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
    response_status INTEGER NOT NULL CHECK (
      response_status BETWEEN 200 AND 499 AND typeof(response_status) = 'integer'
    ),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    before_graph_revision INTEGER NOT NULL CHECK (
      before_graph_revision >= 0 AND typeof(before_graph_revision) = 'integer'
    ),
    after_graph_revision INTEGER NOT NULL CHECK (
      after_graph_revision >= 0 AND typeof(after_graph_revision) = 'integer'
    ),
    history_state TEXT CHECK (
      history_state IS NULL OR history_state IN ('APPLIED', 'UNDONE', 'DISCARDED')
    ),
    history_sequence INTEGER CHECK (
      history_sequence IS NULL OR (
        history_sequence >= 1 AND typeof(history_sequence) = 'integer'
      )
    ),
    history_updated_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, idempotency_key),
    FOREIGN KEY (binding_id, project_id)
      REFERENCES bindings(id, project_id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX binding_commands_history_sequence_idx
    ON binding_commands(project_id, history_sequence)
    WHERE history_sequence IS NOT NULL;
  CREATE INDEX binding_commands_history_idx
    ON binding_commands(project_id, history_state, history_sequence, id);

  CREATE TABLE binding_history_operations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    command_id TEXT,
    requested_command_id TEXT NOT NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN ('UNDO', 'REDO')),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL CHECK (
      length(request_hash) = 64 AND request_hash = lower(request_hash) AND
      request_hash NOT GLOB '*[^0-9a-f]*'
    ),
    response_status INTEGER NOT NULL CHECK (
      response_status BETWEEN 200 AND 499 AND typeof(response_status) = 'integer'
    ),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, idempotency_key),
    FOREIGN KEY (command_id) REFERENCES binding_commands(id) ON DELETE SET NULL
  );
  CREATE INDEX binding_history_operations_project_idx
    ON binding_history_operations(project_id, created_at, id);
`;

export const DATA_RELATIONSHIP_CANVAS_SCHEMA_CHECKSUM = createHash("sha256")
  .update(dataRelationshipCanvasSchemaSql)
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
  {
    checksum: ELEMENT_REGISTRY_PROPERTIES_HISTORY_SCHEMA_CHECKSUM,
    name: "element-registry-properties-history",
    sql: elementRegistryPropertiesHistorySchemaSql,
    version: 5,
  },
  {
    checksum: STATISTICAL_ELEMENTS_LAYOUT_PRESETS_SCHEMA_CHECKSUM,
    name: "statistical-elements-layout-presets",
    sql: statisticalElementsLayoutPresetsSchemaSql,
    version: 6,
  },
  {
    checksum: DATABASE_DESIGNER_SCHEMA_CHECKSUM,
    name: "database-designer-runtime-schema",
    sql: databaseDesignerSchemaSql,
    version: 7,
  },
  {
    checksum: DATA_RELATIONSHIP_CANVAS_SCHEMA_CHECKSUM,
    name: "data-relationship-canvas",
    sql: dataRelationshipCanvasSchemaSql,
    version: 8,
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
