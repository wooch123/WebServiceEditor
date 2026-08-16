import { createHash, randomUUID } from "node:crypto";

import {
  THEME_TOKEN_NAMES,
  defaultTheme,
  findTheme,
  themes,
  type RuntimeThemeManifest,
  type RuntimeThemePolicy,
  type ThemeRevisionStatus,
  type ThemeRevisionValidation,
  type ThemeTokens,
  type WebEditorTheme,
} from "@webeditor/theme-core";
import type Database from "better-sqlite3";

import { assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import type { ProjectStorage } from "../projects/project-storage.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX_PATTERN = /^#[0-9A-F]{6}$/u;

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly lifecycle_status: string;
  readonly revision: number;
  readonly theme_id: string;
}

interface ThemeRevisionRow {
  readonly id: string;
  readonly project_id: string;
  readonly preset_id: string;
  readonly token_hash: string;
  readonly tokens_json: string;
  readonly status: ThemeRevisionStatus;
  readonly revision: number;
  readonly based_on_revision_id: string | null;
  readonly validation_run_id: string | null;
  readonly validation_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string | null;
}

interface ThemeSettingsRow {
  readonly project_id: string;
  readonly default_theme_preset_id: string;
  readonly current_theme_revision_id: string | null;
  readonly published_theme_revision_id: string | null;
  readonly auto_apply_theme_to_runtime: 0 | 1;
  readonly allow_runtime_theme_selection: 0 | 1;
  readonly allowed_runtime_theme_ids_json: string;
  readonly runtime_theme_version: number;
  readonly updated_at: string;
}

interface CommandRow {
  readonly request_hash: string;
  readonly response_status: number;
  readonly response_json: string;
}

export interface ThemeRevisionDto {
  readonly id: string;
  readonly projectId: string;
  readonly presetId: string;
  readonly tokenHash: string;
  readonly tokens: ThemeTokens;
  readonly status: ThemeRevisionStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly basedOnRevisionId: string | null;
  readonly validationRunId: string | null;
  readonly publishedAt: string | null;
  readonly validation: ThemeRevisionValidation | null;
}

export interface ThemeRevisionMutationDto {
  readonly revision: ThemeRevisionDto;
  readonly policy: RuntimeThemePolicy;
  readonly projectRevision: number;
  readonly commandId: string;
  readonly runtimeApplied: boolean;
}

export interface ThemePolicyMutationDto {
  readonly policy: RuntimeThemePolicy;
  readonly projectRevision: number;
  readonly commandId: string;
}

export interface CreateThemeRevisionRequest {
  readonly presetId: string;
  readonly tokens?: Readonly<Record<string, unknown>>;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface ThemeRevisionCommandRequest {
  readonly expectedRevision: number;
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

export interface UpdateRuntimeThemePolicyRequest {
  readonly defaultThemePresetId?: string;
  readonly autoApplyThemeToRuntime?: boolean;
  readonly allowRuntimeThemeSelection?: boolean;
  readonly allowedRuntimeThemeIds?: readonly string[];
  readonly expectedProjectRevision: number;
  readonly idempotencyKey: string;
}

const revisionColumns = `
  id, project_id, preset_id, token_hash, tokens_json, status, revision,
  based_on_revision_id, validation_run_id, validation_json, created_at,
  updated_at, published_at
`;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .filter((key) => source[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function uuid(value: unknown, code: string, label: string): string {
  assertApi(
    typeof value === "string" && UUID_PATTERN.test(value),
    400,
    code,
    `${label} is invalid`,
  );
  return value;
}

function idempotencyKey(value: unknown): string {
  assertApi(
    typeof value === "string" && value.length >= 1 && value.length <= 200,
    400,
    "INVALID_IDEMPOTENCY_KEY",
    "Idempotency key is invalid",
  );
  return value;
}

function nonNegativeRevision(value: unknown, label: string): number {
  assertApi(
    Number.isSafeInteger(value) && (value as number) >= 0,
    400,
    "INVALID_REVISION",
    `${label} is invalid`,
  );
  return value as number;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function validateTokens(
  tokens: Readonly<Record<string, unknown>>,
  validatedAt: string,
): {
  readonly tokens: ThemeTokens;
  readonly validation: ThemeRevisionValidation;
} {
  const keys = Object.keys(tokens).sort();
  const expected = [...THEME_TOKEN_NAMES].sort();
  const schemaValid =
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    THEME_TOKEN_NAMES.every(
      (name) =>
        typeof tokens[name] === "string" && HEX_PATTERN.test(tokens[name]),
    );
  if (!schemaValid) {
    return {
      tokens: Object.fromEntries(
        THEME_TOKEN_NAMES.map((name) => [
          name,
          typeof tokens[name] === "string" ? tokens[name] : "#000000",
        ]),
      ) as unknown as ThemeTokens,
      validation: {
        schemaValid: false,
        contrastValid: false,
        smokeValid: false,
        errors: ["THEME_TOKEN_SCHEMA_INVALID"],
        validatedAt,
      },
    };
  }
  const resolved = tokens as ThemeTokens;
  const textPairs: readonly [keyof ThemeTokens, keyof ThemeTokens][] = [
    ["foreground", "background"],
    ["cardForeground", "card"],
    ["popoverForeground", "popover"],
    ["primaryForeground", "primary"],
    ["accentForeground", "accent"],
    ["mutedForeground", "muted"],
    ["sidebarForeground", "sidebar"],
    ["nodeForeground", "node"],
    ["successForeground", "success"],
    ["warningForeground", "warning"],
    ["errorForeground", "error"],
    ["infoForeground", "info"],
  ];
  const boundaryPairs: readonly [keyof ThemeTokens, keyof ThemeTokens][] = [
    ["ring", "background"],
    ["input", "background"],
    ["selection", "background"],
  ];
  const contrastValid =
    textPairs.every(
      ([foreground, background]) =>
        contrast(resolved[foreground], resolved[background]) >= 4.5,
    ) &&
    boundaryPairs.every(
      ([foreground, background]) =>
        contrast(resolved[foreground], resolved[background]) >= 3,
    ) &&
    ([1, 2, 3, 4, 5, 6, 7, 8] as const).every(
      (index) => contrast(resolved[`chart${index}`], resolved.canvas) >= 3,
    );
  return {
    tokens: resolved,
    validation: {
      schemaValid: true,
      contrastValid,
      smokeValid: true,
      errors: contrastValid ? [] : ["THEME_CONTRAST_INVALID"],
      validatedAt,
    },
  };
}

export class ThemeRevisionService {
  constructor(
    readonly metadataDatabase: MetadataDatabase,
    readonly projectStorage: ProjectStorage,
    readonly clock: () => Date = () => new Date(),
  ) {}

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  listPresets(): { readonly themes: readonly WebEditorTheme[] } {
    return { themes };
  }

  preset(themeIdValue: unknown): { readonly theme: WebEditorTheme } {
    const theme = this.#theme(themeIdValue);
    return { theme };
  }

  policy(projectIdValue: unknown): RuntimeThemePolicy {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    this.#activeProject(projectId);
    return this.#policy(this.#settings(projectId));
  }

  create(
    projectIdValue: unknown,
    request: CreateThemeRevisionRequest,
  ): ThemeRevisionMutationDto {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    const theme = this.#theme(request.presetId);
    const key = idempotencyKey(request.idempotencyKey);
    const expectedProjectRevision = nonNegativeRevision(
      request.expectedProjectRevision,
      "Project revision",
    );
    const requestDigest = hash({ operation: "CREATE", projectId, request });
    const replay = this.#replay<ThemeRevisionMutationDto>(
      projectId,
      key,
      requestDigest,
    );
    if (replay) return replay;
    const tokensInput = request.tokens ?? theme.tokens;
    const { tokens } = validateTokens(tokensInput, this.clock().toISOString());
    const tokenHash = hash(tokens);
    const current = this.#activeProject(projectId);
    assertApi(
      current.revision === expectedProjectRevision,
      409,
      "PROJECT_REVISION_CONFLICT",
      "Project revision changed",
      { latestRevision: current.revision },
    );
    const now = this.clock().toISOString();
    const revisionId = randomUUID();
    const commandId = randomUUID();
    const settingsBefore = this.#settings(projectId);
    this.projectStorage.updateProjectManifest(projectId, {
      name: current.name,
      slug: current.slug,
      themeId: theme.id,
    });
    try {
      return this.metadataDatabase.transaction(() => {
        const project = this.#activeProject(projectId);
        assertApi(
          project.revision === expectedProjectRevision,
          409,
          "PROJECT_REVISION_CONFLICT",
          "Project revision changed",
          { latestRevision: project.revision },
        );
        this.connection
          .prepare(
            `INSERT INTO theme_revisions (
               id, project_id, preset_id, token_hash, tokens_json, status,
               revision, based_on_revision_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'DRAFT', 1, ?, ?, ?)`,
          )
          .run(
            revisionId,
            projectId,
            theme.id,
            tokenHash,
            JSON.stringify(tokens),
            settingsBefore.current_theme_revision_id,
            now,
            now,
          );
        this.connection
          .prepare(
            `UPDATE project_theme_settings
             SET default_theme_preset_id = ?, current_theme_revision_id = ?, updated_at = ?
             WHERE project_id = ?`,
          )
          .run(theme.id, revisionId, now, projectId);
        const projectRevision = this.#incrementProject(
          projectId,
          project.revision,
          theme.id,
          now,
        );
        const response: ThemeRevisionMutationDto = {
          revision: this.#revisionDto(this.#revision(revisionId)),
          policy: this.#policy(this.#settings(projectId)),
          projectRevision,
          commandId,
          runtimeApplied: false,
        };
        this.#record(
          projectId,
          revisionId,
          "CREATE",
          key,
          requestDigest,
          201,
          response,
          commandId,
          now,
        );
        this.#audit(
          projectId,
          revisionId,
          "THEME_REVISION_CREATED",
          null,
          response.revision,
          commandId,
          now,
        );
        return response;
      });
    } catch (error) {
      this.projectStorage.updateProjectManifest(projectId, {
        name: current.name,
        slug: current.slug,
        themeId: current.theme_id,
      });
      throw error;
    }
  }

  validate(
    projectIdValue: unknown,
    revisionIdValue: unknown,
    request: ThemeRevisionCommandRequest,
  ): ThemeRevisionMutationDto {
    return this.#revisionCommand(
      "VALIDATE",
      projectIdValue,
      revisionIdValue,
      request,
    );
  }

  publish(
    projectIdValue: unknown,
    revisionIdValue: unknown,
    request: ThemeRevisionCommandRequest,
  ): ThemeRevisionMutationDto {
    return this.#revisionCommand(
      "PUBLISH",
      projectIdValue,
      revisionIdValue,
      request,
    );
  }

  rollback(
    projectIdValue: unknown,
    revisionIdValue: unknown,
    request: ThemeRevisionCommandRequest,
  ): ThemeRevisionMutationDto {
    return this.#revisionCommand(
      "ROLLBACK",
      projectIdValue,
      revisionIdValue,
      request,
    );
  }

  updatePolicy(
    projectIdValue: unknown,
    request: UpdateRuntimeThemePolicyRequest,
  ): ThemePolicyMutationDto {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    const key = idempotencyKey(request.idempotencyKey);
    const expectedProjectRevision = nonNegativeRevision(
      request.expectedProjectRevision,
      "Project revision",
    );
    const requestDigest = hash({ operation: "POLICY", projectId, request });
    const replay = this.#replay<ThemePolicyMutationDto>(
      projectId,
      key,
      requestDigest,
    );
    if (replay) return replay;
    const projectBefore = this.#activeProject(projectId);
    const current = this.#settings(projectId);
    const defaultThemeId =
      request.defaultThemePresetId === undefined
        ? current.default_theme_preset_id
        : this.#theme(request.defaultThemePresetId).id;
    const autoApply =
      request.autoApplyThemeToRuntime ??
      current.auto_apply_theme_to_runtime === 1;
    const allowSelection =
      request.allowRuntimeThemeSelection ??
      current.allow_runtime_theme_selection === 1;
    assertApi(
      typeof autoApply === "boolean",
      400,
      "INVALID_THEME_POLICY",
      "Auto apply policy is invalid",
    );
    assertApi(
      typeof allowSelection === "boolean",
      400,
      "INVALID_THEME_POLICY",
      "Runtime selection policy is invalid",
    );
    const allowedThemeIds =
      request.allowedRuntimeThemeIds === undefined
        ? this.#allowedIds(current)
        : this.#allowedThemeIds(request.allowedRuntimeThemeIds);
    const now = this.clock().toISOString();
    const commandId = randomUUID();
    this.projectStorage.updateProjectManifest(projectId, {
      name: projectBefore.name,
      slug: projectBefore.slug,
      themeId: defaultThemeId,
    });
    try {
      return this.metadataDatabase.transaction(() => {
        const project = this.#activeProject(projectId);
        assertApi(
          project.revision === expectedProjectRevision,
          409,
          "PROJECT_REVISION_CONFLICT",
          "Project revision changed",
          { latestRevision: project.revision },
        );
        this.connection
          .prepare(
            `UPDATE project_theme_settings
           SET default_theme_preset_id = ?, auto_apply_theme_to_runtime = ?,
               allow_runtime_theme_selection = ?, allowed_runtime_theme_ids_json = ?,
               runtime_theme_version = runtime_theme_version + 1, updated_at = ?
           WHERE project_id = ?`,
          )
          .run(
            defaultThemeId,
            autoApply ? 1 : 0,
            allowSelection ? 1 : 0,
            JSON.stringify(allowedThemeIds),
            now,
            projectId,
          );
        const projectRevision = this.#incrementProject(
          projectId,
          project.revision,
          defaultThemeId,
          now,
        );
        const response: ThemePolicyMutationDto = {
          policy: this.#policy(this.#settings(projectId)),
          projectRevision,
          commandId,
        };
        this.#record(
          projectId,
          null,
          "POLICY",
          key,
          requestDigest,
          200,
          response,
          commandId,
          now,
        );
        this.#audit(
          projectId,
          projectId,
          "RUNTIME_THEME_POLICY_UPDATED",
          this.#policy(current),
          response.policy,
          commandId,
          now,
        );
        return response;
      });
    } catch (error) {
      this.projectStorage.updateProjectManifest(projectId, {
        name: projectBefore.name,
        slug: projectBefore.slug,
        themeId: projectBefore.theme_id,
      });
      throw error;
    }
  }

  manifest(projectIdValue: unknown): RuntimeThemeManifest {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    const project = this.#activeProject(projectId);
    const settings = this.#settings(projectId);
    const published =
      settings.published_theme_revision_id === null
        ? undefined
        : this.#optionalRevision(settings.published_theme_revision_id);
    const validPublished =
      published?.status === "PUBLISHED" ? published : undefined;
    const fallback = defaultTheme;
    const preset =
      findTheme(settings.default_theme_preset_id) ??
      findTheme(project.theme_id) ??
      fallback;
    const tokens = validPublished
      ? (JSON.parse(validPublished.tokens_json) as ThemeTokens)
      : preset.tokens;
    const resolvedThemeId = validPublished?.preset_id ?? preset.id;
    return {
      schemaVersion: 1,
      projectId,
      version: settings.runtime_theme_version,
      defaultThemeId: settings.default_theme_preset_id,
      publishedThemeRevisionId: validPublished?.id ?? null,
      publishedThemeId: validPublished?.preset_id ?? null,
      resolvedThemeId,
      resolvedThemeRevisionId:
        validPublished?.id ?? `preset:${resolvedThemeId}`,
      tokenHash: validPublished?.token_hash ?? hash(tokens),
      tokens,
      allowRuntimeThemeSelection: settings.allow_runtime_theme_selection === 1,
      allowedThemeIds: this.#allowedIds(settings),
      fallbackThemeId: fallback.id,
      updatedAt: settings.updated_at,
    };
  }

  #revisionCommand(
    operation: "VALIDATE" | "PUBLISH" | "ROLLBACK",
    projectIdValue: unknown,
    revisionIdValue: unknown,
    request: ThemeRevisionCommandRequest,
  ): ThemeRevisionMutationDto {
    const projectId = uuid(projectIdValue, "INVALID_PROJECT_ID", "Project ID");
    const revisionId = uuid(
      revisionIdValue,
      "INVALID_THEME_REVISION_ID",
      "Theme revision ID",
    );
    const key = idempotencyKey(request.idempotencyKey);
    const expectedRevision = nonNegativeRevision(
      request.expectedRevision,
      "Theme revision",
    );
    const expectedProjectRevision = nonNegativeRevision(
      request.expectedProjectRevision,
      "Project revision",
    );
    const requestDigest = hash({ operation, projectId, revisionId, request });
    const replay = this.#replay<ThemeRevisionMutationDto>(
      projectId,
      key,
      requestDigest,
    );
    if (replay) return replay;
    const now = this.clock().toISOString();
    const commandId = randomUUID();
    return this.metadataDatabase.transaction(() => {
      const project = this.#activeProject(projectId);
      const row = this.#revision(revisionId);
      assertApi(
        row.project_id === projectId,
        404,
        "THEME_REVISION_NOT_FOUND",
        "Theme revision was not found",
      );
      assertApi(
        row.revision === expectedRevision,
        409,
        "THEME_REVISION_CONFLICT",
        "Theme revision changed",
        { latestRevision: row.revision },
      );
      assertApi(
        project.revision === expectedProjectRevision,
        409,
        "PROJECT_REVISION_CONFLICT",
        "Project revision changed",
        { latestRevision: project.revision },
      );
      const before = this.#revisionDto(row);
      let runtimeApplied = false;
      if (operation === "VALIDATE") {
        assertApi(
          row.status === "DRAFT",
          409,
          "THEME_REVISION_STATE_CONFLICT",
          "Only Draft themes can be validated",
        );
        const tokens = JSON.parse(row.tokens_json) as Readonly<
          Record<string, unknown>
        >;
        const result = validateTokens(tokens, now).validation;
        const settings = this.#settings(projectId);
        const nextStatus: ThemeRevisionStatus =
          result.errors.length === 0
            ? settings.auto_apply_theme_to_runtime === 1
              ? "PUBLISHED"
              : "VALID"
            : "INVALID";
        const validationRunId = randomUUID();
        if (nextStatus === "PUBLISHED") {
          this.#supersedePublished(projectId, revisionId, now);
          this.#activate(projectId, revisionId, now);
          runtimeApplied = true;
        }
        this.connection
          .prepare(
            `UPDATE theme_revisions
           SET status = ?, revision = revision + 1, validation_run_id = ?,
               validation_json = ?, updated_at = ?, published_at = ?
           WHERE id = ?`,
          )
          .run(
            nextStatus,
            validationRunId,
            JSON.stringify(result),
            now,
            nextStatus === "PUBLISHED" ? now : null,
            revisionId,
          );
      } else if (operation === "PUBLISH") {
        assertApi(
          row.status === "VALID",
          409,
          "THEME_REVISION_STATE_CONFLICT",
          "Only Valid themes can be published",
        );
        this.#supersedePublished(projectId, revisionId, now);
        this.connection
          .prepare(
            `UPDATE theme_revisions
           SET status = 'PUBLISHED', revision = revision + 1, updated_at = ?, published_at = ?
           WHERE id = ?`,
          )
          .run(now, now, revisionId);
        this.#activate(projectId, revisionId, now);
        runtimeApplied = true;
      } else {
        assertApi(
          (row.status === "PUBLISHED" || row.status === "SUPERSEDED") &&
            row.validation_json !== null,
          409,
          "THEME_REVISION_STATE_CONFLICT",
          "Only a previously published theme can be restored",
        );
        this.#supersedePublished(projectId, revisionId, now);
        this.connection
          .prepare(
            `UPDATE theme_revisions
           SET status = 'PUBLISHED', revision = revision + 1, updated_at = ?, published_at = ?
           WHERE id = ?`,
          )
          .run(now, now, revisionId);
        this.#activate(projectId, revisionId, now);
        runtimeApplied = true;
      }
      const latest = this.#revision(revisionId);
      const projectRevision = this.#incrementProject(
        projectId,
        project.revision,
        latest.preset_id,
        now,
      );
      const response: ThemeRevisionMutationDto = {
        revision: this.#revisionDto(latest),
        policy: this.#policy(this.#settings(projectId)),
        projectRevision,
        commandId,
        runtimeApplied,
      };
      this.#record(
        projectId,
        revisionId,
        operation,
        key,
        requestDigest,
        200,
        response,
        commandId,
        now,
      );
      this.#audit(
        projectId,
        revisionId,
        `THEME_REVISION_${operation}`,
        before,
        response.revision,
        commandId,
        now,
      );
      return response;
    });
  }

  #theme(value: unknown): WebEditorTheme {
    assertApi(
      typeof value === "string",
      400,
      "INVALID_THEME_ID",
      "Theme ID is invalid",
    );
    const theme = findTheme(value);
    assertApi(
      theme !== undefined,
      404,
      "THEME_NOT_FOUND",
      "Theme was not found",
    );
    return theme;
  }

  #activeProject(projectId: string): ProjectRow {
    const row = this.connection
      .prepare(
        `SELECT id, name, slug, lifecycle_status, revision, theme_id
       FROM projects WHERE id = ?`,
      )
      .get(projectId) as ProjectRow | undefined;
    assertApi(
      row !== undefined && row.lifecycle_status === "ACTIVE",
      row === undefined ? 404 : 409,
      row === undefined ? "PROJECT_NOT_FOUND" : "PROJECT_NOT_ACTIVE",
      row === undefined ? "Project was not found" : "Project is not active",
    );
    return row;
  }

  #settings(projectId: string): ThemeSettingsRow {
    const row = this.connection
      .prepare(
        `SELECT project_id, default_theme_preset_id, current_theme_revision_id,
              published_theme_revision_id, auto_apply_theme_to_runtime,
              allow_runtime_theme_selection, allowed_runtime_theme_ids_json,
              runtime_theme_version, updated_at
       FROM project_theme_settings WHERE project_id = ?`,
      )
      .get(projectId) as ThemeSettingsRow | undefined;
    assertApi(
      row !== undefined,
      500,
      "THEME_SETTINGS_MISSING",
      "Theme settings are missing",
    );
    return row;
  }

  #revision(revisionId: string): ThemeRevisionRow {
    const row = this.#optionalRevision(revisionId);
    assertApi(
      row !== undefined,
      404,
      "THEME_REVISION_NOT_FOUND",
      "Theme revision was not found",
    );
    return row;
  }

  #optionalRevision(revisionId: string): ThemeRevisionRow | undefined {
    return this.connection
      .prepare(`SELECT ${revisionColumns} FROM theme_revisions WHERE id = ?`)
      .get(revisionId) as ThemeRevisionRow | undefined;
  }

  #revisionDto(row: ThemeRevisionRow): ThemeRevisionDto {
    return {
      id: row.id,
      projectId: row.project_id,
      presetId: row.preset_id,
      tokenHash: row.token_hash,
      tokens: JSON.parse(row.tokens_json) as ThemeTokens,
      status: row.status,
      revision: row.revision,
      basedOnRevisionId: row.based_on_revision_id,
      validationRunId: row.validation_run_id,
      validation:
        row.validation_json === null
          ? null
          : (JSON.parse(row.validation_json) as ThemeRevisionValidation),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
    };
  }

  #policy(row: ThemeSettingsRow): RuntimeThemePolicy {
    return {
      projectId: row.project_id,
      defaultThemePresetId: row.default_theme_preset_id,
      currentThemeRevisionId: row.current_theme_revision_id,
      publishedThemeRevisionId: row.published_theme_revision_id,
      autoApplyThemeToRuntime: row.auto_apply_theme_to_runtime === 1,
      allowRuntimeThemeSelection: row.allow_runtime_theme_selection === 1,
      allowedRuntimeThemeIds: this.#allowedIds(row),
      runtimeThemeVersion: row.runtime_theme_version,
      updatedAt: row.updated_at,
    };
  }

  #allowedIds(row: ThemeSettingsRow): string[] {
    const values = JSON.parse(row.allowed_runtime_theme_ids_json) as unknown;
    return Array.isArray(values)
      ? values.filter(
          (value): value is string =>
            typeof value === "string" && findTheme(value) !== undefined,
        )
      : [];
  }

  #allowedThemeIds(value: readonly string[]): string[] {
    assertApi(
      Array.isArray(value) && value.length <= themes.length,
      400,
      "INVALID_ALLOWED_THEME_IDS",
      "Allowed themes are invalid",
    );
    const result = value.map((themeId) => this.#theme(themeId).id);
    assertApi(
      new Set(result).size === result.length,
      400,
      "INVALID_ALLOWED_THEME_IDS",
      "Allowed themes contain duplicates",
    );
    return result;
  }

  #activate(projectId: string, revisionId: string, now: string): void {
    this.connection
      .prepare(
        `UPDATE project_theme_settings
       SET published_theme_revision_id = ?, runtime_theme_version = runtime_theme_version + 1,
           updated_at = ? WHERE project_id = ?`,
      )
      .run(revisionId, now, projectId);
  }

  #supersedePublished(
    projectId: string,
    exceptRevisionId: string,
    now: string,
  ): void {
    this.connection
      .prepare(
        `UPDATE theme_revisions SET status = 'SUPERSEDED', revision = revision + 1, updated_at = ?
       WHERE project_id = ? AND status = 'PUBLISHED' AND id <> ?`,
      )
      .run(now, projectId, exceptRevisionId);
  }

  #incrementProject(
    projectId: string,
    expectedRevision: number,
    themeId: string,
    now: string,
  ): number {
    const result = this.connection
      .prepare(
        `UPDATE projects SET revision = revision + 1, theme_id = ?, updated_at = ?
       WHERE id = ? AND revision = ?`,
      )
      .run(themeId, now, projectId, expectedRevision);
    assertApi(
      result.changes === 1,
      409,
      "PROJECT_REVISION_CONFLICT",
      "Project revision changed",
    );
    return expectedRevision + 1;
  }

  #replay<T>(
    projectId: string,
    key: string,
    requestDigest: string,
  ): T | undefined {
    const row = this.connection
      .prepare(
        `SELECT request_hash, response_status, response_json
       FROM theme_revision_commands WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, key) as CommandRow | undefined;
    if (!row) return undefined;
    assertApi(
      row.request_hash === requestDigest,
      409,
      "IDEMPOTENCY_PAYLOAD_CONFLICT",
      "Idempotency key was reused with a different payload",
    );
    return JSON.parse(row.response_json) as T;
  }

  #record(
    projectId: string,
    revisionId: string | null,
    commandType: "CREATE" | "VALIDATE" | "PUBLISH" | "ROLLBACK" | "POLICY",
    key: string,
    requestDigest: string,
    responseStatus: number,
    response: unknown,
    commandId: string,
    now: string,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO theme_revision_commands (
         id, project_id, revision_id, command_type, idempotency_key,
         request_hash, response_status, response_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        commandId,
        projectId,
        revisionId,
        commandType,
        key,
        requestDigest,
        responseStatus,
        JSON.stringify(response),
        now,
      );
  }

  #audit(
    projectId: string,
    objectId: string,
    action: string,
    before: unknown,
    after: unknown,
    correlationId: string,
    now: string,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO audit_logs (
         id, project_id, action, object_type, object_id, before_json,
         after_json, correlation_id, created_at
       ) VALUES (?, ?, ?, 'THEME_REVISION', ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        action,
        objectId,
        before === null ? null : JSON.stringify(before),
        JSON.stringify(after),
        correlationId,
        now,
      );
  }
}
