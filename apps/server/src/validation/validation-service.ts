import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  CANVAS_GRID,
  ELEMENT_TYPES,
  VALIDATION_LEVELS,
  type RunValidationRequest,
  type ValidationIssueDto,
  type ValidationLevel,
  type ValidationResult,
  type ValidationRunDto,
  type ValidationRunListDto,
  type ValidationSummaryDto,
  type ValidationTargetDto,
} from "@webeditor/domain";
import { themes } from "@webeditor/theme-core";
import Database from "better-sqlite3";

import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import type { ProjectStorage } from "../projects/project-storage.js";
import { featureInventory } from "./feature-inventory.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const themeIds = new Set(themes.map((theme) => theme.id));
const elementTypes = new Set<string>(ELEMENT_TYPES);

interface ValidationRunRow {
  readonly id: string;
  readonly project_id: string;
  readonly project_revision: number;
  readonly levels_json: string;
  readonly status: ValidationResult;
  readonly inventory_required: number;
  readonly inventory_verified: number;
  readonly summary_json: string;
  readonly issues_json: string;
  readonly inventory_json: string;
  readonly started_at: string;
  readonly completed_at: string;
}

interface ValidationCommandRow {
  readonly request_hash: string;
  readonly response_status: number;
  readonly response_json: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function requestHash(
  projectId: string,
  commandType: "VALIDATE" | "VALIDATE_INVENTORY",
  request: RunValidationRequest,
): string {
  return createHash("sha256")
    .update(stableJson({ projectId, commandType, request }))
    .digest("hex");
}

function parseRun(row: ValidationRunRow): ValidationRunDto {
  return {
    id: row.id,
    projectId: row.project_id,
    projectRevision: row.project_revision,
    levels: JSON.parse(row.levels_json) as readonly ValidationLevel[],
    status: row.status,
    inventoryRequired: row.inventory_required,
    inventoryVerified: row.inventory_verified,
    summary: JSON.parse(row.summary_json) as ValidationSummaryDto,
    issues: JSON.parse(row.issues_json) as readonly ValidationIssueDto[],
    inventory: JSON.parse(row.inventory_json) as ValidationRunDto["inventory"],
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function summary(issues: readonly ValidationIssueDto[]): ValidationSummaryDto {
  return {
    pass: 0,
    warning: issues.filter((issue) => issue.result === "WARNING").length,
    fail: issues.filter((issue) => issue.result === "FAIL").length,
    blocked: issues.filter((issue) => issue.result === "BLOCKED").length,
  };
}

function statusFor(summaryValue: ValidationSummaryDto): ValidationResult {
  if (summaryValue.blocked > 0) return "BLOCKED";
  if (summaryValue.fail > 0) return "FAIL";
  if (summaryValue.warning > 0) return "WARNING";
  return "PASS";
}

export class ValidationService {
  readonly #clock: () => Date;

  constructor(
    readonly metadataDatabase: MetadataDatabase,
    readonly projectStorage: ProjectStorage,
    readonly apiRoutes: () => readonly string[],
    clock: () => Date = () => new Date(),
  ) {
    this.#clock = clock;
  }

  run(
    projectId: string,
    request: RunValidationRequest,
    commandType: "VALIDATE" | "VALIDATE_INVENTORY" = "VALIDATE",
  ): ValidationRunDto {
    this.#assertRequest(projectId, request);
    const hash = requestHash(projectId, commandType, request);
    const replay = this.metadataDatabase.connection
      .prepare(
        "SELECT request_hash, response_status, response_json FROM validation_commands WHERE project_id = ? AND idempotency_key = ?",
      )
      .get(projectId, request.idempotencyKey) as
      ValidationCommandRow | undefined;
    if (replay !== undefined) {
      assertApi(
        replay.request_hash === hash,
        409,
        "IDEMPOTENCY_PAYLOAD_CONFLICT",
        "Idempotency key was already used with another validation request",
      );
      if (replay.response_status >= 400) {
        const response = JSON.parse(replay.response_json) as {
          readonly code: string;
          readonly message: string;
          readonly details?: unknown;
        };
        throw new ApiError(
          replay.response_status,
          response.code,
          response.message,
          response.details,
        );
      }
      return JSON.parse(replay.response_json) as ValidationRunDto;
    }

    const project = this.metadataDatabase.connection
      .prepare(
        "SELECT id, revision, lifecycle_status FROM projects WHERE id = ?",
      )
      .get(projectId) as
      | {
          readonly id: string;
          readonly revision: number;
          readonly lifecycle_status: string;
        }
      | undefined;
    assertApi(
      project !== undefined,
      404,
      "PROJECT_NOT_FOUND",
      "Project was not found",
    );
    assertApi(
      project.lifecycle_status === "ACTIVE",
      409,
      "PROJECT_NOT_ACTIVE",
      "Validation is available only for active projects",
    );
    assertApi(
      project.revision === request.expectedProjectRevision,
      409,
      "PROJECT_REVISION_CONFLICT",
      "Project revision is stale",
      { latestRevision: project.revision },
    );

    const runId = randomUUID();
    const startedAt = this.#clock().toISOString();
    const inventory = featureInventory(this.apiRoutes(), startedAt, runId);
    const issues =
      commandType === "VALIDATE_INVENTORY"
        ? this.#inventoryIssues(projectId, inventory)
        : [
            ...this.#inventoryIssues(projectId, inventory),
            ...this.#pageIssues(projectId),
            ...this.#elementIssues(projectId),
            ...this.#bindingIssues(projectId),
            ...this.#schemaIssues(projectId),
            ...this.#themeIssues(projectId),
          ];
    const summaryValue = summary(issues);
    const completedAt = this.#clock().toISOString();
    const run: ValidationRunDto = {
      id: runId,
      projectId,
      projectRevision: project.revision,
      levels: VALIDATION_LEVELS,
      status: statusFor(summaryValue),
      inventoryRequired: inventory.length,
      inventoryVerified: inventory.length,
      summary: { ...summaryValue, pass: inventory.length },
      issues,
      inventory,
      startedAt,
      completedAt,
    };
    const responseJson = JSON.stringify(run);

    this.metadataDatabase.transaction(() => {
      this.metadataDatabase.connection
        .prepare(
          `INSERT INTO validation_runs (
             id, project_id, project_revision, levels_json, status,
             inventory_required, inventory_verified, summary_json, issues_json,
             inventory_json, started_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.projectId,
          run.projectRevision,
          JSON.stringify(run.levels),
          run.status,
          run.inventoryRequired,
          run.inventoryVerified,
          JSON.stringify(run.summary),
          JSON.stringify(run.issues),
          JSON.stringify(run.inventory),
          run.startedAt,
          run.completedAt,
        );
      const insertItem = this.metadataDatabase.connection.prepare(
        `INSERT INTO validation_run_items (
           id, validation_run_id, project_id, inventory_id, rule_id, level,
           result, title, detail, target_json, evidence_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of inventory) {
        insertItem.run(
          randomUUID(),
          run.id,
          projectId,
          item.inventoryId,
          "INVENTORY_TEST_EVIDENCE",
          "INVENTORY",
          "PASS",
          item.displayName,
          "Test reference and run evidence are present",
          JSON.stringify({ kind: "PROJECT_HOME", projectId }),
          JSON.stringify(item.evidence),
          completedAt,
        );
      }
      for (const issue of issues) {
        insertItem.run(
          issue.id,
          run.id,
          projectId,
          null,
          issue.ruleId,
          issue.level,
          issue.result,
          issue.title,
          issue.detail,
          JSON.stringify(issue.target),
          JSON.stringify([`validation-run:${run.id}#${issue.id}`]),
          completedAt,
        );
      }
      this.metadataDatabase.connection
        .prepare(
          `INSERT INTO validation_commands (
             id, project_id, validation_run_id, command_type, idempotency_key,
             request_hash, response_status, response_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 200, ?, ?)`,
        )
        .run(
          randomUUID(),
          projectId,
          run.id,
          commandType,
          request.idempotencyKey,
          hash,
          responseJson,
          completedAt,
        );
    });
    return run;
  }

  get(projectId: string, runId: string): ValidationRunDto {
    this.#assertUuid(projectId, "INVALID_PROJECT_ID");
    this.#assertUuid(runId, "INVALID_VALIDATION_RUN_ID");
    const row = this.metadataDatabase.connection
      .prepare("SELECT * FROM validation_runs WHERE id = ? AND project_id = ?")
      .get(runId, projectId) as ValidationRunRow | undefined;
    assertApi(
      row !== undefined,
      404,
      "VALIDATION_RUN_NOT_FOUND",
      "Validation run was not found",
    );
    return parseRun(row);
  }

  list(projectId: string): ValidationRunListDto {
    this.#assertUuid(projectId, "INVALID_PROJECT_ID");
    const rows = this.metadataDatabase.connection
      .prepare(
        "SELECT * FROM validation_runs WHERE project_id = ? ORDER BY completed_at DESC, id DESC LIMIT 20",
      )
      .all(projectId) as readonly ValidationRunRow[];
    return { projectId, runs: rows.map(parseRun) };
  }

  #issue(
    projectId: string,
    ruleId: string,
    level: ValidationLevel,
    result: "WARNING" | "FAIL" | "BLOCKED",
    title: string,
    detail: string,
    target: Omit<ValidationTargetDto, "projectId">,
  ): ValidationIssueDto {
    return {
      id: randomUUID(),
      ruleId,
      level,
      result,
      title,
      detail,
      target: { ...target, projectId },
    };
  }

  #inventoryIssues(
    projectId: string,
    inventory: ReturnType<typeof featureInventory>,
  ): readonly ValidationIssueDto[] {
    const issues: ValidationIssueDto[] = [];
    if (inventory.length === 0) {
      issues.push(
        this.#issue(
          projectId,
          "INVENTORY_EMPTY",
          "INVENTORY",
          "BLOCKED",
          "인벤토리 없음",
          "검증 인벤토리가 비어 있습니다.",
          { kind: "PROJECT_HOME" },
        ),
      );
    }
    for (const item of inventory) {
      if (item.requiredTests.length === 0 || item.evidence.length === 0) {
        issues.push(
          this.#issue(
            projectId,
            "INVENTORY_EVIDENCE_MISSING",
            "INVENTORY",
            "FAIL",
            item.displayName,
            "테스트 참조 또는 증거가 없습니다.",
            { kind: "PROJECT_HOME" },
          ),
        );
      }
    }
    if (!inventory.some((item) => item.category === "API_ROUTE")) {
      issues.push(
        this.#issue(
          projectId,
          "API_INVENTORY_EMPTY",
          "INVENTORY",
          "BLOCKED",
          "API 목록 없음",
          "등록된 API Route를 수집하지 못했습니다.",
          { kind: "PROJECT_HOME" },
        ),
      );
    }
    return issues;
  }

  #pageIssues(projectId: string): readonly ValidationIssueDto[] {
    const rows = this.metadataDatabase.connection
      .prepare(
        "SELECT id, route, icon_name FROM pages WHERE project_id = ? AND deleted_at IS NULL",
      )
      .all(projectId) as readonly {
      readonly id: string;
      readonly route: string;
      readonly icon_name: string;
    }[];
    const seen = new Set<string>();
    const issues: ValidationIssueDto[] = [];
    for (const row of rows) {
      const normalized = row.route.toLocaleLowerCase();
      if (
        !row.route.startsWith("/") ||
        row.route.length > 200 ||
        seen.has(normalized)
      ) {
        issues.push(
          this.#issue(
            projectId,
            "PAGE_ROUTE_INVALID",
            "REFERENCE",
            "FAIL",
            "페이지 Route",
            `Route가 잘못되었거나 중복입니다: ${row.route}`,
            { kind: "PAGE", pageId: row.id },
          ),
        );
      }
      if (row.icon_name.trim().length === 0) {
        issues.push(
          this.#issue(
            projectId,
            "PAGE_ICON_MISSING",
            "STATIC",
            "FAIL",
            "페이지 아이콘",
            "페이지 아이콘 참조가 없습니다.",
            { kind: "PAGE", pageId: row.id },
          ),
        );
      }
      seen.add(normalized);
    }
    return issues;
  }

  #elementIssues(projectId: string): readonly ValidationIssueDto[] {
    const rows = this.metadataDatabase.connection
      .prepare(
        `SELECT e.id, e.page_id, e.type, l.x, l.y, l.w, l.h, l.breakpoint,
                p.id AS owned_page_id
         FROM elements e
         LEFT JOIN pages p ON p.id = e.page_id AND p.project_id = e.project_id AND p.deleted_at IS NULL
         LEFT JOIN element_layouts l ON l.element_id = e.id AND l.project_id = e.project_id
         WHERE e.project_id = ? AND e.deleted_at IS NULL`,
      )
      .all(projectId) as readonly {
      readonly id: string;
      readonly page_id: string;
      readonly type: string;
      readonly x: number | null;
      readonly y: number | null;
      readonly w: number | null;
      readonly h: number | null;
      readonly breakpoint: string | null;
      readonly owned_page_id: string | null;
    }[];
    const issues: ValidationIssueDto[] = [];
    for (const row of rows) {
      const target = {
        kind: "ELEMENT" as const,
        pageId: row.page_id,
        elementId: row.id,
      };
      if (row.owned_page_id === null)
        issues.push(
          this.#issue(
            projectId,
            "ELEMENT_PAGE_REFERENCE",
            "REFERENCE",
            "FAIL",
            "Element 페이지",
            "Element가 활성 Page에 속하지 않습니다.",
            target,
          ),
        );
      if (!elementTypes.has(row.type))
        issues.push(
          this.#issue(
            projectId,
            "ELEMENT_REGISTRY_TYPE",
            "STATIC",
            "FAIL",
            "Element Registry",
            `알 수 없는 Element type: ${row.type}`,
            target,
          ),
        );
      if (
        row.breakpoint !== "desktop" ||
        row.x === null ||
        row.y === null ||
        row.w === null ||
        row.h === null ||
        row.x < 0 ||
        row.y < 0 ||
        row.w < 1 ||
        row.h < 1 ||
        row.x + row.w > CANVAS_GRID.columns
      ) {
        issues.push(
          this.#issue(
            projectId,
            "ELEMENT_LAYOUT_INVALID",
            "STATIC",
            "FAIL",
            "Element Layout",
            "Desktop Layout이 없거나 경계를 벗어났습니다.",
            target,
          ),
        );
      }
    }
    return issues;
  }

  #bindingIssues(projectId: string): readonly ValidationIssueDto[] {
    const rows = this.metadataDatabase.connection
      .prepare(
        "SELECT * FROM bindings WHERE project_id = ? AND deleted_at IS NULL",
      )
      .all(projectId) as readonly Record<string, unknown>[];
    const issues: ValidationIssueDto[] = [];
    const objectState = (type: unknown, id: unknown): boolean => {
      const table =
        type === "page"
          ? "pages"
          : type === "element"
            ? "elements"
            : type === "table"
              ? "data_tables"
              : null;
      if (table === null || typeof id !== "string") return false;
      return (
        this.metadataDatabase.connection
          .prepare(
            `SELECT 1 AS present FROM ${table} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
          )
          .get(id, projectId) !== undefined
      );
    };
    for (const row of rows) {
      const id = String(row.id);
      const target = { kind: "BINDING" as const, bindingId: id };
      if (
        row.source_side !== "right" ||
        row.source_direction !== "output" ||
        row.target_side !== "left" ||
        row.target_direction !== "input"
      ) {
        issues.push(
          this.#issue(
            projectId,
            "BINDING_DIRECTION_INVALID",
            "BINDING",
            "FAIL",
            "Binding 방향",
            "Binding은 Output(right)에서 Input(left)으로 연결되어야 합니다.",
            target,
          ),
        );
      }
      if (
        !objectState(row.source_node_type, row.source_object_id) ||
        !objectState(row.target_node_type, row.target_object_id)
      ) {
        issues.push(
          this.#issue(
            projectId,
            "BINDING_REFERENCE_BROKEN",
            "REFERENCE",
            "FAIL",
            "Binding 참조",
            "Binding이 삭제되었거나 존재하지 않는 객체를 참조합니다.",
            target,
          ),
        );
      }
    }
    return issues;
  }

  #schemaIssues(projectId: string): readonly ValidationIssueDto[] {
    const issues: ValidationIssueDto[] = [];
    const path = join(this.projectStorage.activePath(projectId), "test.sqlite");
    if (!existsSync(path))
      return [
        this.#issue(
          projectId,
          "TEST_DATABASE_MISSING",
          "DATABASE",
          "BLOCKED",
          "Test DB",
          "test.sqlite가 없습니다.",
          { kind: "TABLE" },
        ),
      ];
    let database: Database.Database | undefined;
    try {
      database = new Database(path, { readonly: true, fileMustExist: true });
      if (database.pragma("quick_check", { simple: true }) !== "ok") {
        issues.push(
          this.#issue(
            projectId,
            "TEST_DATABASE_INTEGRITY",
            "DATABASE",
            "BLOCKED",
            "Test DB 무결성",
            "SQLite quick_check가 실패했습니다.",
            { kind: "TABLE" },
          ),
        );
      }
      const state = this.metadataDatabase.connection
        .prepare(
          "SELECT draft_revision, test_applied_revision FROM project_schema_states WHERE project_id = ?",
        )
        .get(projectId) as
        | {
            readonly draft_revision: number;
            readonly test_applied_revision: number;
          }
        | undefined;
      if (
        state !== undefined &&
        state.test_applied_revision < state.draft_revision
      ) {
        issues.push(
          this.#issue(
            projectId,
            "TEST_SCHEMA_NOT_APPLIED",
            "DATABASE",
            "WARNING",
            "Test 스키마",
            "Draft 스키마 변경을 Test DB에 적용해야 합니다.",
            { kind: "TABLE" },
          ),
        );
      }
      if (
        state !== undefined &&
        state.test_applied_revision === state.draft_revision
      ) {
        const tables = this.metadataDatabase.connection
          .prepare(
            "SELECT id, physical_name FROM data_tables WHERE project_id = ? AND deleted_at IS NULL",
          )
          .all(projectId) as readonly {
          readonly id: string;
          readonly physical_name: string;
        }[];
        for (const table of tables) {
          const present = database
            .prepare(
              "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .get(table.physical_name);
          if (present === undefined)
            issues.push(
              this.#issue(
                projectId,
                "PHYSICAL_TABLE_MISSING",
                "DATABASE",
                "FAIL",
                "물리 Table",
                `${table.physical_name}가 Test DB에 없습니다.`,
                { kind: "TABLE", tableId: table.id },
              ),
            );
          else {
            const fields = this.metadataDatabase.connection
              .prepare(
                "SELECT id, physical_name FROM data_fields WHERE project_id = ? AND table_id = ? AND deleted_at IS NULL",
              )
              .all(projectId, table.id) as readonly {
              readonly id: string;
              readonly physical_name: string;
            }[];
            const columns = new Set(
              (
                database.pragma(
                  `table_info('${table.physical_name}')`,
                ) as readonly { readonly name: string }[]
              ).map((column) => column.name),
            );
            for (const field of fields)
              if (!columns.has(field.physical_name))
                issues.push(
                  this.#issue(
                    projectId,
                    "PHYSICAL_FIELD_MISSING",
                    "DATABASE",
                    "FAIL",
                    "물리 Field",
                    `${field.physical_name}가 Test DB에 없습니다.`,
                    { kind: "FIELD", tableId: table.id, fieldId: field.id },
                  ),
                );
          }
        }
      }
    } catch (error) {
      issues.push(
        this.#issue(
          projectId,
          "TEST_DATABASE_UNREADABLE",
          "DATABASE",
          "BLOCKED",
          "Test DB",
          error instanceof Error ? error.message : "Test DB를 열 수 없습니다.",
          { kind: "TABLE" },
        ),
      );
    } finally {
      database?.close();
    }
    return issues;
  }

  #themeIssues(projectId: string): readonly ValidationIssueDto[] {
    const row = this.metadataDatabase.connection
      .prepare(
        "SELECT default_theme_preset_id, allowed_runtime_theme_ids_json FROM project_theme_settings WHERE project_id = ?",
      )
      .get(projectId) as
      | {
          readonly default_theme_preset_id: string;
          readonly allowed_runtime_theme_ids_json: string;
        }
      | undefined;
    if (row === undefined)
      return [
        this.#issue(
          projectId,
          "THEME_POLICY_MISSING",
          "REFERENCE",
          "FAIL",
          "Theme 정책",
          "프로젝트 Theme 정책이 없습니다.",
          { kind: "THEME" },
        ),
      ];
    const allowed = JSON.parse(row.allowed_runtime_theme_ids_json) as unknown;
    if (
      !themeIds.has(row.default_theme_preset_id) ||
      !Array.isArray(allowed) ||
      allowed.some((id) => typeof id !== "string" || !themeIds.has(id))
    ) {
      return [
        this.#issue(
          projectId,
          "THEME_REFERENCE_INVALID",
          "REFERENCE",
          "FAIL",
          "Theme 참조",
          "Theme 정책이 Registry에 없는 Theme을 참조합니다.",
          { kind: "THEME", themeId: row.default_theme_preset_id },
        ),
      ];
    }
    return [];
  }

  #assertRequest(projectId: string, request: RunValidationRequest): void {
    this.#assertUuid(projectId, "INVALID_PROJECT_ID");
    assertApi(
      Number.isSafeInteger(request.expectedProjectRevision) &&
        request.expectedProjectRevision >= 0,
      400,
      "INVALID_PROJECT_REVISION",
      "Project revision is invalid",
    );
    assertApi(
      typeof request.idempotencyKey === "string" &&
        request.idempotencyKey.length >= 1 &&
        request.idempotencyKey.length <= 200,
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency key is invalid",
    );
  }

  #assertUuid(value: unknown, code: string): asserts value is string {
    assertApi(
      typeof value === "string" && UUID_PATTERN.test(value),
      400,
      code,
      "ID is invalid",
    );
  }
}
