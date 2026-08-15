import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { PROJECT_LIFECYCLE_STATUSES } from "@webeditor/domain";
import Database from "better-sqlite3";

const METADATA_APPLICATION_ID = 0x57454245;
const LATEST_METADATA_SCHEMA_VERSION = 1;

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

const initialSchemaChecksum = createHash("sha256")
  .update(initialSchemaSql)
  .digest("hex");

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

      const applied = this.#database
        .prepare("SELECT checksum FROM metadata_migrations WHERE version = ?")
        .get(LATEST_METADATA_SCHEMA_VERSION) as
        { readonly checksum: string } | undefined;

      if (applied !== undefined) {
        if (applied.checksum !== initialSchemaChecksum) {
          throw new Error("Metadata migration checksum mismatch at version 1");
        }
        return;
      }

      this.#database.exec(initialSchemaSql);
      this.#database
        .prepare(
          `INSERT INTO metadata_migrations
            (version, name, checksum, applied_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          LATEST_METADATA_SCHEMA_VERSION,
          "initial-project-metadata",
          initialSchemaChecksum,
          new Date().toISOString(),
        );
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

  close(): void {
    if (this.#database.open) {
      this.#database.close();
    }
  }
}
