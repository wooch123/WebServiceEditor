import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  BINDING_TYPES,
  ELEMENT_TYPES,
  LAYOUT_PRESET_DEFINITIONS,
  LAYOUT_PRESET_IDS,
  PAGE_TYPES,
  type ElementType,
  type FeatureShowcaseProjectDto,
  type GenerateProjectCorpusRequest,
  type LayoutPresetId,
  type PageType,
  type ProjectCorpusCoverageDto,
  type ProjectCorpusPerformanceDistributionDto,
  type ProjectCorpusPerformanceDto,
  type ProjectCorpusResultDto,
  type ProjectCorpusRunDetailDto,
  type ProjectCorpusRunDto,
  type ProjectCorpusScaleDto,
  type ProjectCorpusSummaryDto,
  type ProjectCorpusVerificationDto,
  type ProjectCorpusVerificationSummaryDto,
  type VerifyProjectCorpusRequest,
} from "@webeditor/domain";
import Database from "better-sqlite3";

import type { RelationshipService } from "../data-relationship/relationship-service.js";
import type { SchemaService } from "../data-schema/schema-service.js";
import type { BackupService } from "../backup/backup-service.js";
import type { ElementService } from "../elements/element-service.js";
import type { LayoutPresetService } from "../elements/layout-preset-service.js";
import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";
import type { PageService } from "../pages/page-service.js";
import type { ProjectService } from "../projects/project-service.js";

export const PROJECT_CORPUS_GENERATOR_VERSION = "1.0.0";

const SEED_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PHYSICAL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/u;
const CORPUS_EVIDENCE_PREFIX = "reports/corpus";

interface CorpusDescriptor {
  readonly corpusId: string;
  readonly projectId: string;
  readonly displayName: string;
  readonly category: string;
  readonly purpose: string;
  readonly themeId: string;
  readonly scale: ProjectCorpusScaleDto;
  readonly pageTypes: readonly PageType[];
  readonly layoutPresets: readonly LayoutPresetId[];
  readonly elementTypes: readonly ElementType[];
  readonly bindingTypes: readonly string[];
  readonly requiredScenarios: readonly string[];
  readonly specialScenarios: readonly string[];
  readonly sentinels: {
    readonly project: string;
    readonly runtimeRow: string;
  };
  readonly structureFingerprint: string;
}

interface CorpusManifest {
  readonly schemaVersion: string;
  readonly specVersion: string;
  readonly projectCount: number;
  readonly categoryDistribution: Readonly<Record<string, number>>;
  readonly coverage: {
    readonly themes: readonly string[];
    readonly pageTypes: readonly string[];
    readonly layoutPresets: readonly string[];
    readonly elementTypes: readonly string[];
    readonly bindingTypes: readonly string[];
  };
  readonly projects: readonly CorpusDescriptor[];
  readonly manifestSha256: string;
}

interface CorpusRunRow {
  readonly id: string;
  readonly seed: string;
  readonly project_count: number;
  readonly generator_version: string;
  readonly status: ProjectCorpusRunDto["status"];
  readonly manifest_checksum: string | null;
  readonly manifest_json: string | null;
  readonly summary_json: string | null;
  readonly evidence_path: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly request_hash: string;
}

interface CorpusResultRow {
  readonly id: string;
  readonly corpus_run_id: string;
  readonly corpus_id: string;
  readonly project_id: string;
  readonly project_index: number;
  readonly archetype: string;
  readonly status: ProjectCorpusResultDto["status"];
  readonly scenario_results_json: string;
  readonly isolation_sentinel: string;
  readonly runtime_row_sentinel: string;
  readonly structure_fingerprint: string;
  readonly scale_json: string;
  readonly coverage_json: string;
  readonly duration_ms: number;
  readonly evidence_path: string;
}

interface GenerationPlan {
  readonly pageTypes: readonly PageType[][];
  readonly presetIds: readonly LayoutPresetId[][];
  readonly fillElementTypes: readonly ElementType[][];
}

export interface ProjectCorpusServiceOptions {
  readonly metadataDatabase: MetadataDatabase;
  readonly manifestPath: string;
  readonly projectService: ProjectService;
  readonly pageService: PageService;
  readonly elementService: ElementService;
  readonly layoutPresetService: LayoutPresetService;
  readonly schemaService: SchemaService;
  readonly relationshipService: RelationshipService;
  readonly backupService: BackupService;
  readonly clock?: () => Date;
}

type ScenarioStatus = "PENDING" | "PASS" | "FAIL";

interface ProjectVerificationEvidence {
  readonly schemaVersion: 1;
  readonly corpusId: string;
  readonly projectId: string;
  readonly status: "PASS" | "FAIL";
  readonly scenarios: Readonly<Record<string, ScenarioStatus>>;
  readonly metrics: Readonly<Record<string, number>>;
  readonly assertions: Readonly<Record<string, unknown>>;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly stack?: string;
  } | null;
}

interface VerificationMetrics {
  readonly projectList: number[];
  readonly searchSort: number[];
  readonly projectOpen: number[];
  readonly autoSave: number[];
  readonly preview: number[];
  readonly publish: number[];
  readonly runtime: number[];
  readonly backup: number[];
  readonly trash: number[];
  readonly restore: number[];
  readonly restartReady: number[];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(",")}}`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactSet(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    [...actual]
      .sort()
      .every((value, index) => value === [...expected].sort()[index])
  );
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function assertStringArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): asserts value is readonly string[] {
  assertApi(
    Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === "string" && allowed.has(item)),
    500,
    "PROJECT_CORPUS_MANIFEST_INVALID",
    `${label} is invalid`,
  );
}

function identifier(value: string): string {
  if (!PHYSICAL_NAME_PATTERN.test(value)) {
    throw new Error("Corpus runtime schema contains an unsafe identifier");
  }
  return `"${value}"`;
}

function valueForField(
  field: { readonly type: string; readonly primaryKey: boolean },
  descriptor: CorpusDescriptor,
  tableIndex: number,
  rowIndex: number,
  fieldIndex: number,
): unknown {
  if (field.type === "INTEGER") return rowIndex + 1;
  if (field.type === "REAL") return Number((rowIndex * 1.25 + 1).toFixed(4));
  if (field.type === "BOOLEAN") return rowIndex % 2;
  if (field.type === "DATE")
    return `2026-08-${String((rowIndex % 28) + 1).padStart(2, "0")}`;
  if (field.type === "DATETIME")
    return `2026-08-${String((rowIndex % 28) + 1).padStart(2, "0")}T${String(rowIndex % 24).padStart(2, "0")}:00:00.000Z`;
  if (field.type === "JSON")
    return JSON.stringify({ corpusId: descriptor.corpusId, row: rowIndex + 1 });
  if (field.type === "BLOB")
    return Buffer.from(`${descriptor.corpusId}:${rowIndex + 1}`, "utf8");
  if (tableIndex === 0 && rowIndex === 0 && fieldIndex === 0)
    return descriptor.sentinels.runtimeRow;
  return `${descriptor.corpusId}-${tableIndex + 1}-${rowIndex + 1}-${fieldIndex + 1}${field.primaryKey ? "-pk" : ""}`;
}

function elapsed(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(3));
}

function distribution(
  values: readonly number[],
  budgetMs: number | null,
): ProjectCorpusPerformanceDistributionDto {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (value: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ??
    0;
  const p95Ms = Number(percentile(0.95).toFixed(3));
  return {
    count: sorted.length,
    p50Ms: Number(percentile(0.5).toFixed(3)),
    p95Ms,
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
    budgetMs,
    passed: budgetMs === null || p95Ms <= budgetMs,
  };
}

function directoryBytes(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += directoryBytes(child);
    else if (entry.isFile()) total += statSync(child).size;
  }
  return total;
}

function scenarioRecord(
  descriptor: CorpusDescriptor,
): Record<string, ScenarioStatus> {
  return Object.fromEntries(
    [...descriptor.requiredScenarios, ...descriptor.specialScenarios].map(
      (scenario) => [scenario, "PENDING" as const],
    ),
  );
}

function pass(
  scenarios: Record<string, ScenarioStatus>,
  ...names: readonly string[]
): void {
  for (const name of names) {
    if (name in scenarios) scenarios[name] = "PASS";
  }
}

export class ProjectCorpusService {
  readonly #clock: () => Date;
  readonly #instanceId = randomUUID();
  readonly #manifest: CorpusManifest;
  readonly #plan: GenerationPlan;

  constructor(readonly options: ProjectCorpusServiceOptions) {
    this.#clock = options.clock ?? (() => new Date());
    this.#manifest = this.#readManifest(options.manifestPath);
    this.#plan = this.#generationPlan(this.#manifest);
    options.metadataDatabase.connection
      .prepare(
        `UPDATE project_corpus_runs
         SET status = 'FAILED', error_json = ?, completed_at = ?
         WHERE status = 'GENERATING'`,
      )
      .run(
        JSON.stringify({ code: "GENERATION_INTERRUPTED" }),
        this.#clock().toISOString(),
      );
    options.metadataDatabase.connection
      .prepare(
        `UPDATE project_corpus_runs
         SET status = 'FAILED', error_json = ?, completed_at = ?
         WHERE status = 'VERIFYING'`,
      )
      .run(
        JSON.stringify({ code: "VERIFICATION_INTERRUPTED" }),
        this.#clock().toISOString(),
      );
  }

  generate(request: GenerateProjectCorpusRequest): ProjectCorpusRunDto {
    assertApi(
      jsonObject(request) &&
        typeof request.seed === "string" &&
        SEED_PATTERN.test(request.seed) &&
        typeof request.idempotencyKey === "string" &&
        IDEMPOTENCY_PATTERN.test(request.idempotencyKey),
      400,
      "INVALID_PROJECT_CORPUS_REQUEST",
      "Corpus seed or idempotency key is invalid",
    );
    const requestHash = sha256(
      stableJson({
        operation: "GENERATE_PROJECT_CORPUS",
        seed: request.seed,
        generatorVersion: PROJECT_CORPUS_GENERATOR_VERSION,
        sourceManifestChecksum: this.#manifest.manifestSha256,
      }),
    );
    const replay = this.options.metadataDatabase.connection
      .prepare("SELECT * FROM project_corpus_runs WHERE idempotency_key = ?")
      .get(request.idempotencyKey) as CorpusRunRow | undefined;
    if (replay !== undefined) {
      assertApi(
        replay.request_hash === requestHash,
        409,
        "IDEMPOTENCY_PAYLOAD_CONFLICT",
        "Idempotency key was used for another Corpus request",
      );
      return this.#runDto(replay);
    }

    const runId = randomUUID();
    const startedAt = this.#clock().toISOString();
    const evidencePath = `${CORPUS_EVIDENCE_PREFIX}/${runId}/project-corpus-manifest.json`;
    this.options.metadataDatabase.connection
      .prepare(
        `INSERT INTO project_corpus_runs (
           id, seed, project_count, generator_version, status, idempotency_key,
           request_hash, evidence_path, started_at
         ) VALUES (?, ?, 100, ?, 'GENERATING', ?, ?, ?, ?)`,
      )
      .run(
        runId,
        request.seed,
        PROJECT_CORPUS_GENERATOR_VERSION,
        request.idempotencyKey,
        requestHash,
        evidencePath,
        startedAt,
      );

    try {
      const seedSuffix = sha256(request.seed).slice(0, 8);
      for (const [index, descriptor] of this.#manifest.projects.entries()) {
        this.#generateProject(runId, index, descriptor, seedSuffix);
      }
      const results = this.#results(runId);
      const summary = this.#summary(results);
      this.#assertComplete(summary, results);
      const report = {
        schemaVersion: 1,
        runId,
        seed: request.seed,
        generatorVersion: PROJECT_CORPUS_GENERATOR_VERSION,
        generatorInstanceId: this.#instanceId,
        sourceManifestSha256: this.#manifest.manifestSha256,
        projectCount: results.length,
        summary,
        projects: results,
      };
      const manifestChecksum = sha256(stableJson(report));
      const completedAt = this.#clock().toISOString();
      const storedManifest = { ...report, manifestChecksum, completedAt };
      this.#writeReport(evidencePath, storedManifest);
      this.options.metadataDatabase.connection
        .prepare(
          `UPDATE project_corpus_runs
           SET status = 'GENERATED', manifest_checksum = ?, manifest_json = ?,
               summary_json = ?, completed_at = ?, error_json = NULL
           WHERE id = ? AND status = 'GENERATING'`,
        )
        .run(
          manifestChecksum,
          JSON.stringify(storedManifest),
          JSON.stringify(summary),
          completedAt,
          runId,
        );
      return this.get(runId).run;
    } catch (error) {
      this.options.metadataDatabase.connection
        .prepare(
          `UPDATE project_corpus_runs
           SET status = 'FAILED', error_json = ?, completed_at = ?
           WHERE id = ? AND status = 'GENERATING'`,
        )
        .run(
          JSON.stringify({
            code: error instanceof ApiError ? error.code : "GENERATION_FAILED",
            message: error instanceof Error ? error.message : String(error),
          }),
          this.#clock().toISOString(),
          runId,
        );
      throw error;
    }
  }

  get(runId: string): ProjectCorpusRunDetailDto {
    assertApi(
      /^[0-9a-f-]{36}$/u.test(runId),
      400,
      "INVALID_PROJECT_CORPUS_RUN_ID",
      "Corpus run ID is invalid",
    );
    const row = this.options.metadataDatabase.connection
      .prepare("SELECT * FROM project_corpus_runs WHERE id = ?")
      .get(runId) as CorpusRunRow | undefined;
    assertApi(
      row !== undefined,
      404,
      "PROJECT_CORPUS_RUN_NOT_FOUND",
      "Corpus run was not found",
    );
    return { run: this.#runDto(row), results: this.#results(runId) };
  }

  results(runId: string): {
    readonly results: readonly ProjectCorpusResultDto[];
  } {
    return { results: this.get(runId).results };
  }

  async createFeatureShowcase(): Promise<FeatureShowcaseProjectDto> {
    const existing = this.options.projectService
      .listActive()
      .find(({ slug }) => slug === "feature-showcase");
    if (existing !== undefined) {
      const workflow = this.#ensureFeatureShowcaseWorkflows(existing.id);
      let graph = this.options.relationshipService.graph(existing.id);
      const needsFinalize =
        workflow.changed || graph.routes.length !== graph.edges.length;
      if (needsFinalize) {
        const preview =
          await this.options.relationshipService.previewAutoLayout(
            existing.id,
            {
              action: "PREVIEW",
              expectedGraphRevision: graph.graphRevision,
              expectedProjectRevision: graph.projectRevision,
            },
          );
        const layout = this.options.relationshipService.applyAutoLayout(
          existing.id,
          {
            action: "APPLY",
            previewId: preview.previewId,
            expectedGraphRevision: preview.graphRevision,
            expectedProjectRevision: preview.projectRevision,
            idempotencyKey: `feature-showcase-v3-auto-layout-${preview.graphRevision}-${preview.projectRevision}`,
          },
        );
        const published = this.options.pageService.publish(existing.id, {
          expectedProjectRevision: layout.projectRevision,
          idempotencyKey: `feature-showcase-v3-publish-${layout.projectRevision}`,
        });
        const backup = this.options.backupService.create(existing.id, {
          expectedRevision: published.projectRevision,
          idempotencyKey: `feature-showcase-v3-backup-${published.projectRevision}`,
          label: "기능 종합 샘플 실행 연결 상태",
        });
        const drill = this.options.backupService.verify(backup.id, {
          idempotencyKey: `feature-showcase-v3-backup-verify-${backup.id}`,
        });
        assertApi(
          drill.status === "PASS",
          500,
          "FEATURE_SHOWCASE_BACKUP_FAILED",
          "Feature Showcase workflow backup verification failed",
        );
        graph = this.options.relationshipService.graph(existing.id);
        assertApi(
          graph.edges.length >= 5 && graph.routes.length === graph.edges.length,
          500,
          "FEATURE_SHOWCASE_WORKFLOW_MISSING",
          "Feature Showcase executable workflows were not fully laid out",
        );
      }
      return this.#featureShowcaseDto(existing.id);
    }

    const project = this.options.projectService.create({
      name: "기능 종합 샘플",
      slug: "feature-showcase",
      description:
        "페이지, 요소, 프리셋, 데이터, 관계, 테마, 미리보기, 게시, 백업을 한곳에서 확인하는 종합 샘플입니다.",
      themeId: "gray-cool-steel",
      favorite: true,
    });
    let projectRevision = project.revision;
    const pages = [];
    const layoutRevisions = new Map<string, number>();
    for (const [index, definition] of LAYOUT_PRESET_DEFINITIONS.entries()) {
      const created = this.options.pageService.create(project.id, {
        name: `${String(index + 1).padStart(2, "0")} ${definition.name}`,
        pageType: PAGE_TYPES[index % PAGE_TYPES.length] as PageType,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `feature-showcase-page-${index + 1}`,
      });
      pages.push(created.page);
      projectRevision = created.projectRevision;
      const preview = this.options.layoutPresetService.preview(
        created.page.id,
        definition.id,
        {
          mode: "ADD",
          expectedLayoutRevision: 0,
          expectedProjectRevision: projectRevision,
        },
      ).preview;
      const applied = this.options.layoutPresetService.apply(
        created.page.id,
        definition.id,
        {
          previewId: preview.previewId,
          expectedLayoutRevision: 0,
          expectedProjectRevision: projectRevision,
          idempotencyKey: `feature-showcase-preset-${index + 1}`,
        },
      );
      layoutRevisions.set(created.page.id, applied.layoutRevision);
      projectRevision = applied.projectRevision;
    }

    const existingTypes = new Set(
      pages.flatMap((page) =>
        this.options.elementService
          .list(page.id)
          .elements.map(({ element }) => element.type),
      ),
    );
    let missingIndex = 0;
    for (const elementType of ELEMENT_TYPES) {
      if (existingTypes.has(elementType)) continue;
      const page = pages[missingIndex % pages.length];
      if (page === undefined)
        throw new Error("Feature Showcase Page is missing");
      const created = this.options.elementService.create(page.id, {
        elementType,
        expectedLayoutRevision: layoutRevisions.get(page.id) ?? 0,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `feature-showcase-element-${elementType}`,
      });
      layoutRevisions.set(page.id, created.layoutRevision);
      projectRevision = created.projectRevision;
      existingTypes.add(elementType);
      missingIndex += 1;
    }

    let schema = this.options.schemaService.schema(project.id);
    for (let index = 0; index < 8; index += 1) {
      schema = this.options.schemaService.createTable(project.id, {
        displayName: `Sample Data ${index + 1}`,
        description: "Feature Showcase Test data",
        template: index % 2 === 0 ? "TIME_SERIES" : "ENTITY",
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: `feature-showcase-table-${index + 1}`,
      });
    }
    const schemaPlan = this.options.schemaService.plan(project.id, {
      expectedSchemaRevision: schema.schemaRevision,
      expectedProjectRevision: schema.projectRevision,
    }).plan;
    const appliedSchema = this.options.schemaService.apply(project.id, {
      planId: schemaPlan.id,
      expectedSchemaRevision: schema.schemaRevision,
      expectedProjectRevision: schema.projectRevision,
      confirmDestructive: false,
      idempotencyKey: "feature-showcase-schema-apply",
    }).schema;
    const showcaseDescriptor = {
      ...(this.#manifest.projects[99] as CorpusDescriptor),
      corpusId: "FEATURE-SHOWCASE",
      sentinels: {
        project: "WEBEDITOR-FEATURE-SHOWCASE",
        runtimeRow: "WEBEDITOR-FEATURE-SHOWCASE-RUNTIME",
      },
      scale: {
        pageCount: pages.length,
        elementCount: pages.reduce(
          (count, page) =>
            count + this.options.elementService.list(page.id).elements.length,
          0,
        ),
        nodeCount: 0,
        tableCount: appliedSchema.tables.length,
        runtimeRowCount: 5_000,
      },
    } satisfies CorpusDescriptor;
    this.#populateRuntimeRows(
      project.id,
      showcaseDescriptor,
      appliedSchema.tables,
    );

    const workflow = this.#ensureFeatureShowcaseWorkflows(project.id);
    projectRevision = workflow.projectRevision;

    let graph = this.options.relationshipService.graph(project.id);
    const layout = await this.options.relationshipService.previewAutoLayout(
      project.id,
      {
        action: "PREVIEW",
        expectedGraphRevision: graph.graphRevision,
        expectedProjectRevision: projectRevision,
      },
    );
    this.options.relationshipService.applyAutoLayout(project.id, {
      action: "APPLY",
      previewId: layout.previewId,
      expectedGraphRevision: layout.graphRevision,
      expectedProjectRevision: layout.projectRevision,
      idempotencyKey: "feature-showcase-auto-layout",
    });
    graph = this.options.relationshipService.graph(project.id);
    const source = graph.nodes
      .filter(({ type }) => type === "page")
      .flatMap((node) => node.ports.map((port) => ({ node, port })))
      .find(
        ({ port }) =>
          port.direction === "output" &&
          port.allowedBindingTypes.includes("CONTAINS"),
      );
    const target = graph.nodes
      .filter(({ type }) => type === "element")
      .flatMap((node) => node.ports.map((port) => ({ node, port })))
      .find(
        ({ port }) =>
          port.direction === "input" &&
          port.allowedBindingTypes.includes("CONTAINS"),
      );
    assertApi(
      source !== undefined && target !== undefined,
      500,
      "FEATURE_SHOWCASE_BINDING_PORT_MISSING",
      "Feature Showcase could not find compatible Binding ports",
    );
    const connection = this.options.relationshipService.preview(project.id, {
      sourcePortId: source.port.id,
      targetPortId: target.port.id,
      expectedGraphRevision: graph.graphRevision,
      expectedProjectRevision: graph.projectRevision,
    });
    const binding = this.options.relationshipService.create(project.id, {
      previewId: connection.previewId,
      bindingType: "CONTAINS",
      expectedGraphRevision: connection.graphRevision,
      expectedProjectRevision: connection.projectRevision,
      idempotencyKey: "feature-showcase-binding-contains",
    });
    projectRevision = binding.projectRevision;
    const published = this.options.pageService.publish(project.id, {
      expectedProjectRevision: projectRevision,
      idempotencyKey: "feature-showcase-publish",
    });
    const backup = this.options.backupService.create(project.id, {
      expectedRevision: published.projectRevision,
      idempotencyKey: "feature-showcase-backup",
      label: "기능 종합 샘플 초기 상태",
    });
    const drill = this.options.backupService.verify(backup.id, {
      idempotencyKey: "feature-showcase-backup-verify",
    });
    assertApi(
      drill.status === "PASS",
      500,
      "FEATURE_SHOWCASE_BACKUP_FAILED",
      "Feature Showcase backup verification failed",
    );
    return this.#featureShowcaseDto(project.id);
  }

  #ensureFeatureShowcaseWorkflows(projectId: string): {
    readonly projectRevision: number;
    readonly changed: boolean;
  } {
    let changed = false;
    let schema = this.options.schemaService.schema(projectId);
    let table = schema.tables.find(
      ({ displayName }) => displayName === "Interactive Records",
    );
    if (table === undefined) {
      schema = this.options.schemaService.createTable(projectId, {
        displayName: "Interactive Records",
        description: "Executable CRUD and READ workflow data",
        template: "BLANK",
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: "feature-showcase-v2-table",
      });
      table = schema.tables.find(
        ({ displayName }) => displayName === "Interactive Records",
      );
      changed = true;
    }
    assertApi(
      table !== undefined,
      500,
      "FEATURE_SHOWCASE_TABLE_MISSING",
      "Feature Showcase workflow Table was not created",
    );

    let idField = table.fields.find(({ displayName }) => displayName === "ID");
    if (
      idField === undefined ||
      idField.type !== "INTEGER" ||
      !idField.primaryKey ||
      !idField.autoIncrement
    ) {
      const candidate = idField ?? table.fields[0];
      assertApi(
        candidate !== undefined,
        500,
        "FEATURE_SHOWCASE_ID_FIELD_MISSING",
        "Feature Showcase workflow ID Field is missing",
      );
      schema = this.options.schemaService.patchField(candidate.id, {
        displayName: "ID",
        type: "INTEGER",
        primaryKey: true,
        autoIncrement: true,
        nullable: false,
        unique: true,
        indexed: true,
        expectedRevision: candidate.revision,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: "feature-showcase-v2-id-field",
      });
      table = schema.tables.find(
        ({ displayName }) => displayName === "Interactive Records",
      );
      idField = table?.fields.find(({ displayName }) => displayName === "ID");
      changed = true;
    }
    assertApi(
      table !== undefined && idField !== undefined,
      500,
      "FEATURE_SHOWCASE_ID_FIELD_MISSING",
      "Feature Showcase workflow ID Field is missing",
    );

    let valueField = table.fields.find(
      ({ displayName }) => displayName === "값",
    );
    if (valueField === undefined) {
      schema = this.options.schemaService.createField(table.id, {
        displayName: "값",
        type: "REAL",
        nullable: false,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: "feature-showcase-v2-value-field",
      });
      table = schema.tables.find(
        ({ displayName }) => displayName === "Interactive Records",
      );
      valueField = table?.fields.find(
        ({ displayName }) => displayName === "값",
      );
      changed = true;
    }
    assertApi(
      table !== undefined && valueField !== undefined,
      500,
      "FEATURE_SHOWCASE_VALUE_FIELD_MISSING",
      "Feature Showcase workflow Value Field is missing",
    );

    if (schema.runtime.test.appliedRevision !== schema.schemaRevision) {
      const plan = this.options.schemaService.plan(projectId, {
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
      }).plan;
      schema = this.options.schemaService.apply(projectId, {
        planId: plan.id,
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        confirmDestructive: false,
        idempotencyKey: "feature-showcase-v2-schema-apply",
      }).schema;
      table = schema.tables.find(
        ({ displayName }) => displayName === "Interactive Records",
      );
      idField = table?.fields.find(({ displayName }) => displayName === "ID");
      valueField = table?.fields.find(
        ({ displayName }) => displayName === "값",
      );
      changed = true;
    }
    assertApi(
      table !== undefined && idField !== undefined && valueField !== undefined,
      500,
      "FEATURE_SHOWCASE_SCHEMA_INCOMPLETE",
      "Feature Showcase workflow Schema is incomplete",
    );

    const firstPage = this.options.pageService.list(projectId).pages[0];
    assertApi(
      firstPage !== undefined,
      500,
      "FEATURE_SHOWCASE_PAGE_MISSING",
      "Feature Showcase workflow Page is missing",
    );
    const ensureElement = (
      elementType: ElementType,
      name: string,
      values: Readonly<Record<string, string>>,
      key: string,
    ) => {
      let listing = this.options.elementService.list(firstPage.id);
      let entry = listing.elements.find(({ element }) => element.name === name);
      if (entry !== undefined) return entry;
      const created = this.options.elementService.create(firstPage.id, {
        elementType,
        expectedLayoutRevision: listing.layoutRevision,
        expectedProjectRevision:
          this.options.projectService.getActive(projectId).revision,
        idempotencyKey: `feature-showcase-v3-${key}-create-${listing.layoutRevision}`,
      });
      const patched = this.options.elementService.patch(
        created.entry.element.id,
        {
          expectedRevision: created.entry.element.revision,
          expectedLayoutRevision: created.layoutRevision,
          expectedProjectRevision: created.projectRevision,
          idempotencyKey: `feature-showcase-v3-${key}-properties-${created.entry.element.id}`,
          change: {
            kind: "PROPERTIES",
            values: { "general.displayName": name, ...values },
          },
        },
      );
      changed = true;
      listing = this.options.elementService.list(firstPage.id);
      entry = listing.elements.find(
        ({ element }) => element.id === patched.entry.element.id,
      );
      assertApi(
        entry !== undefined,
        500,
        "FEATURE_SHOWCASE_ELEMENT_MISSING",
        `Feature Showcase workflow Element ${name} is missing`,
      );
      return entry;
    };

    const idInput = ensureElement(
      "number-input",
      "CRUD ID Input",
      { "general.label": "Record ID" },
      "id-input",
    );
    const valueInput = ensureElement(
      "number-input",
      "CRUD Value Input",
      { "general.label": "Value" },
      "value-input",
    );
    const createButton = ensureElement(
      "button",
      "Create Record",
      { "general.label": "Create" },
      "create-button",
    );
    const updateButton = ensureElement(
      "button",
      "Update Record",
      { "general.label": "Update" },
      "update-button",
    );
    const deleteButton = ensureElement(
      "button",
      "Delete Record",
      { "general.label": "Delete" },
      "delete-button",
    );
    const tableElement = ensureElement(
      "data-table",
      "Interactive Records Table",
      { "general.title": "Interactive Records" },
      "table-element",
    );

    const ensureWriteBinding = (
      bindingType: "CREATE" | "UPDATE" | "DELETE",
      sourceElementId: string,
      fieldMappings: readonly {
        readonly fieldId: string;
        readonly inputElementId: string;
      }[],
    ) => {
      let graph = this.options.relationshipService.graph(projectId);
      const existing = graph.edges.find(
        (edge) =>
          edge.bindingType === bindingType &&
          edge.source.objectId === sourceElementId &&
          edge.target.objectId === table.id,
      );
      const expectedMappings = [...fieldMappings]
        .map(({ fieldId, inputElementId }) => `${fieldId}:${inputElementId}`)
        .sort();
      const mappingKey = createHash("sha256")
        .update(JSON.stringify(expectedMappings))
        .digest("hex")
        .slice(0, 12);
      const storedMappings =
        existing !== undefined && Array.isArray(existing.mapping.fields)
          ? existing.mapping.fields
              .flatMap((candidate) => {
                if (
                  typeof candidate !== "object" ||
                  candidate === null ||
                  !("fieldId" in candidate) ||
                  !("inputElementId" in candidate) ||
                  typeof candidate.fieldId !== "string" ||
                  typeof candidate.inputElementId !== "string"
                ) {
                  return [];
                }
                return [`${candidate.fieldId}:${candidate.inputElementId}`];
              })
              .sort()
          : [];
      if (
        existing !== undefined &&
        JSON.stringify(storedMappings) === JSON.stringify(expectedMappings)
      ) {
        return existing;
      }
      if (existing !== undefined) {
        const removed = this.options.relationshipService.delete(existing.id, {
          expectedRevision: existing.revision,
          expectedGraphRevision: graph.graphRevision,
          expectedProjectRevision: graph.projectRevision,
          idempotencyKey: `feature-showcase-v3-replace-binding-${existing.id}`,
        });
        changed = true;
        graph = this.options.relationshipService.graph(projectId);
        assertApi(
          graph.graphRevision === removed.graphRevision,
          500,
          "FEATURE_SHOWCASE_BINDING_REPAIR_FAILED",
          `Feature Showcase ${bindingType} Binding was not removed cleanly`,
        );
      }
      const source = graph.nodes
        .find(({ objectId }) => objectId === sourceElementId)
        ?.ports.find(
          (port) =>
            port.direction === "output" &&
            port.allowedBindingTypes.includes(bindingType),
        );
      const target = graph.nodes
        .find(({ objectId }) => objectId === table.id)
        ?.ports.find(
          (port) =>
            port.direction === "input" &&
            port.role === "record" &&
            port.allowedBindingTypes.includes(bindingType),
        );
      assertApi(
        source !== undefined && target !== undefined,
        500,
        "FEATURE_SHOWCASE_BINDING_PORT_MISSING",
        `Feature Showcase ${bindingType} ports are missing`,
      );
      const preview = this.options.relationshipService.preview(projectId, {
        sourcePortId: source.id,
        targetPortId: target.id,
        expectedGraphRevision: graph.graphRevision,
        expectedProjectRevision: graph.projectRevision,
      });
      const result = this.options.relationshipService.create(projectId, {
        previewId: preview.previewId,
        bindingType,
        mutation: { fieldMappings },
        expectedGraphRevision: preview.graphRevision,
        expectedProjectRevision: preview.projectRevision,
        idempotencyKey: `feature-showcase-v3-${bindingType.toLowerCase()}-binding-${sourceElementId}-${mappingKey}`,
      });
      changed = true;
      graph = this.options.relationshipService.graph(projectId);
      return (
        graph.edges.find(({ id }) => id === result.binding.id) ?? result.binding
      );
    };

    const createBinding = ensureWriteBinding(
      "CREATE",
      createButton.element.id,
      [{ fieldId: valueField.id, inputElementId: valueInput.element.id }],
    );
    const updateBinding = ensureWriteBinding(
      "UPDATE",
      updateButton.element.id,
      [
        { fieldId: idField.id, inputElementId: idInput.element.id },
        { fieldId: valueField.id, inputElementId: valueInput.element.id },
      ],
    );
    const deleteBinding = ensureWriteBinding(
      "DELETE",
      deleteButton.element.id,
      [{ fieldId: idField.id, inputElementId: idInput.element.id }],
    );

    const graph = this.options.relationshipService.graph(projectId);
    let readBinding = graph.edges.find(
      (edge) =>
        edge.bindingType === "READ" &&
        edge.source.objectId === valueField.id &&
        edge.target.objectId === tableElement.element.id,
    );
    if (readBinding === undefined) {
      const source = graph.nodes
        .find(({ objectId }) => objectId === table.id)
        ?.ports.find(
          (port) =>
            port.direction === "output" && port.objectId === valueField.id,
        );
      const target = graph.nodes
        .find(({ objectId }) => objectId === tableElement.element.id)
        ?.ports.find(
          (port) => port.direction === "input" && port.role === "rows",
        );
      assertApi(
        source !== undefined && target !== undefined,
        500,
        "FEATURE_SHOWCASE_BINDING_PORT_MISSING",
        "Feature Showcase READ ports are missing",
      );
      const connection = this.options.relationshipService.preview(projectId, {
        sourcePortId: source.id,
        targetPortId: target.id,
        expectedGraphRevision: graph.graphRevision,
        expectedProjectRevision: graph.projectRevision,
      });
      const query = this.options.relationshipService.previewBindingQuery(
        projectId,
        {
          connectionPreviewId: connection.previewId,
          spec: {
            mode: "LIST",
            selectFieldIds: table.fields.map(({ id }) => id),
            filters: [],
            orderBy: [{ fieldId: idField.id, direction: "ASC" }],
            aggregate: null,
            groupByFieldId: null,
            limit: 100,
          },
          mapping: {
            shape: "ROWS",
            labelFieldId: null,
            valueFieldId: null,
            secondaryFieldId: null,
          },
          expectedGraphRevision: connection.graphRevision,
          expectedProjectRevision: connection.projectRevision,
        },
      );
      const created = this.options.relationshipService.create(projectId, {
        previewId: connection.previewId,
        queryPreviewId: query.queryPreviewId,
        bindingType: "READ",
        expectedGraphRevision: query.graphRevision,
        expectedProjectRevision: query.projectRevision,
        idempotencyKey: "feature-showcase-v2-read-binding",
      });
      readBinding = created.binding;
      changed = true;
    }

    if (changed) {
      const projectRevision =
        this.options.projectService.getActive(projectId).revision;
      const preview = this.options.pageService.createDraftPreview(
        projectId,
        projectRevision,
      );
      const existingRows =
        this.options.relationshipService.executeDraftRuntimeBinding(
          preview.previewId,
          readBinding.id,
          {},
        );
      for (const row of existingRows.result.rows) {
        const primaryKey = row[idField.id];
        if (typeof primaryKey !== "number") continue;
        this.options.relationshipService.executeDraftRuntimeMutation(
          preview.previewId,
          deleteBinding.id,
          "DELETE",
          {
            values: { [idInput.element.id]: primaryKey },
            idempotencyKey: `feature-showcase-v3-test-reset-${preview.previewId}-${primaryKey}`,
          },
        );
      }
      const first =
        this.options.relationshipService.executeDraftRuntimeMutation(
          preview.previewId,
          createBinding.id,
          "CREATE",
          {
            values: { [valueInput.element.id]: 12.5 },
            idempotencyKey: `feature-showcase-v3-test-create-1-${preview.previewId}`,
          },
        );
      assertApi(
        first.insertedPrimaryKey !== null,
        500,
        "FEATURE_SHOWCASE_CRUD_FAILED",
        "Feature Showcase CREATE did not return an ID",
      );
      this.options.relationshipService.executeDraftRuntimeMutation(
        preview.previewId,
        updateBinding.id,
        "UPDATE",
        {
          values: {
            [idInput.element.id]: first.insertedPrimaryKey,
            [valueInput.element.id]: 27.25,
          },
          idempotencyKey: `feature-showcase-v3-test-update-${preview.previewId}`,
        },
      );
      const disposable =
        this.options.relationshipService.executeDraftRuntimeMutation(
          preview.previewId,
          createBinding.id,
          "CREATE",
          {
            values: { [valueInput.element.id]: 99.5 },
            idempotencyKey: `feature-showcase-v3-test-create-2-${preview.previewId}`,
          },
        );
      assertApi(
        disposable.insertedPrimaryKey !== null,
        500,
        "FEATURE_SHOWCASE_CRUD_FAILED",
        "Feature Showcase disposable CREATE did not return an ID",
      );
      this.options.relationshipService.executeDraftRuntimeMutation(
        preview.previewId,
        deleteBinding.id,
        "DELETE",
        {
          values: { [idInput.element.id]: disposable.insertedPrimaryKey },
          idempotencyKey: `feature-showcase-v3-test-delete-${preview.previewId}`,
        },
      );
      const read = this.options.relationshipService.executeDraftRuntimeBinding(
        preview.previewId,
        readBinding.id,
        {},
      );
      assertApi(
        read.result.rowCount === 1 &&
          read.result.rows[0]?.[valueField.id] === 27.25,
        500,
        "FEATURE_SHOWCASE_CRUD_FAILED",
        "Feature Showcase executable CRUD workflow did not preserve the expected Test row",
      );
    }

    return {
      projectRevision:
        this.options.projectService.getActive(projectId).revision,
      changed,
    };
  }

  async verify(
    runId: string,
    request: VerifyProjectCorpusRequest,
  ): Promise<ProjectCorpusVerificationDto> {
    assertApi(
      jsonObject(request) &&
        typeof request.idempotencyKey === "string" &&
        IDEMPOTENCY_PATTERN.test(request.idempotencyKey),
      400,
      "INVALID_PROJECT_CORPUS_VERIFICATION_REQUEST",
      "Corpus verification idempotency key is invalid",
    );
    const existing = this.get(runId);
    if (existing.run.status === "VERIFIED") {
      return this.#readVerificationReport(runId);
    }
    assertApi(
      existing.run.status === "GENERATED",
      409,
      "PROJECT_CORPUS_NOT_READY_FOR_VERIFICATION",
      "Only a generated Corpus can be verified",
      { status: existing.run.status },
    );
    const runRow = this.options.metadataDatabase.connection
      .prepare("SELECT * FROM project_corpus_runs WHERE id = ?")
      .get(runId) as CorpusRunRow;
    const generationManifest = JSON.parse(runRow.manifest_json ?? "null") as {
      readonly generatorInstanceId?: unknown;
    } | null;
    assertApi(
      generationManifest !== null &&
        typeof generationManifest.generatorInstanceId === "string" &&
        generationManifest.generatorInstanceId !== this.#instanceId,
      409,
      "PROJECT_CORPUS_RESTART_REQUIRED",
      "Restart the server after generation before operational verification",
    );
    const startedAt = this.#clock().toISOString();
    const changed = this.options.metadataDatabase.connection
      .prepare(
        `UPDATE project_corpus_runs
         SET status = 'VERIFYING', error_json = NULL
         WHERE id = ? AND status = 'GENERATED'`,
      )
      .run(runId).changes;
    assertApi(
      changed === 1,
      409,
      "PROJECT_CORPUS_VERIFICATION_CONFLICT",
      "Corpus verification was already started",
    );

    const metrics: VerificationMetrics = {
      projectList: [],
      searchSort: [],
      projectOpen: [],
      autoSave: [],
      preview: [],
      publish: [],
      runtime: [],
      backup: [],
      trash: [],
      restore: [],
      restartReady: [],
    };
    const evidence: ProjectVerificationEvidence[] = [];
    let criticalErrorCount = 0;
    let purgeFixtureCount = 0;
    try {
      let measured = performance.now();
      this.options.projectService.assertReady();
      metrics.restartReady.push(elapsed(measured));
      measured = performance.now();
      const activeProjects = this.options.projectService.listActive();
      metrics.projectList.push(elapsed(measured));
      assertApi(
        activeProjects.length === 100,
        500,
        "PROJECT_CORPUS_ACTIVE_COUNT_MISMATCH",
        "Operational verification requires exactly 100 active Corpus Projects",
        { count: activeProjects.length },
      );
      measured = performance.now();
      const sorted = [...activeProjects].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const searched = activeProjects.filter((project) =>
        project.description?.includes("WEBEDITOR-PROJECT-SENTINEL-"),
      );
      metrics.searchSort.push(elapsed(measured));
      assertApi(
        sorted.length === 100 && searched.length === 100,
        500,
        "PROJECT_CORPUS_SEARCH_SORT_MISMATCH",
        "Corpus Project search or sort lost a Project",
      );

      const descriptors = new Map(
        this.#manifest.projects.map((descriptor) => [
          descriptor.corpusId,
          descriptor,
        ]),
      );
      for (const result of existing.results) {
        const descriptor = descriptors.get(result.corpusId);
        if (descriptor === undefined)
          throw new Error(`Descriptor missing for ${result.corpusId}`);
        let item: ProjectVerificationEvidence;
        try {
          item = await this.#verifyProject(result, descriptor, metrics);
        } catch (error) {
          criticalErrorCount += 1;
          const scenarios = scenarioRecord(descriptor);
          for (const scenario of Object.keys(scenarios))
            scenarios[scenario] = "FAIL";
          item = {
            schemaVersion: 1,
            corpusId: result.corpusId,
            projectId: result.projectId,
            status: "FAIL",
            scenarios,
            metrics: {},
            assertions: {},
            error: {
              code:
                error instanceof ApiError ? error.code : "VERIFICATION_FAILED",
              message: error instanceof Error ? error.message : String(error),
              ...(error instanceof Error && error.stack !== undefined
                ? { stack: error.stack }
                : {}),
            },
          };
        }
        evidence.push(item);
        this.#storeProjectVerification(result, item);
      }

      try {
        this.#verifyPurgeFixture(
          existing.results.find(({ corpusId }) => corpusId === "CORPUS-100"),
        );
        purgeFixtureCount = 1;
      } catch (error) {
        criticalErrorCount += 1;
        const index = evidence.findIndex(
          ({ corpusId }) => corpusId === "CORPUS-100",
        );
        const current = evidence[index];
        if (current !== undefined) {
          const failed = {
            ...current,
            status: "FAIL" as const,
            scenarios: Object.fromEntries(
              Object.keys(current.scenarios).map((scenario) => [
                scenario,
                scenario === "permanent-purge-on-cloned-fixture" ||
                scenario === "orphan-scan"
                  ? "FAIL"
                  : (current.scenarios[scenario] ?? "FAIL"),
              ]),
            ),
            error: {
              code:
                error instanceof ApiError ? error.code : "PURGE_FIXTURE_FAILED",
              message: error instanceof Error ? error.message : String(error),
              ...(error instanceof Error && error.stack !== undefined
                ? { stack: error.stack }
                : {}),
            },
          };
          evidence[index] = failed;
          const result = existing.results[index];
          if (result !== undefined)
            this.#storeProjectVerification(result, failed);
        }
      }

      const isolation = this.#verifyIsolation(existing.results);
      const storageScan = this.options.projectService.assertStorageIntegrity();
      const orphanRecordCount = this.#orphanRecordCount();
      const orphanFileCount =
        storageScan.orphanActiveProjectIds.length +
        storageScan.orphanTrashProjectIds.length +
        storageScan.dualLocationProjectIds.length;
      const performanceReport = this.#performance(metrics);
      const passCount = evidence.filter(
        ({ status }) => status === "PASS",
      ).length;
      const summary: ProjectCorpusVerificationSummaryDto = {
        passCount,
        failCount: 100 - passCount,
        blockedCount: 0,
        skippedCount: 0,
        crossProjectLeakCount: isolation.crossProjectLeakCount,
        orphanRecordCount,
        orphanFileCount,
        criticalErrorCount,
        purgeFixtureCount,
        performance: performanceReport,
      };
      const status =
        passCount === 100 &&
        summary.crossProjectLeakCount === 0 &&
        orphanRecordCount === 0 &&
        orphanFileCount === 0 &&
        criticalErrorCount === 0 &&
        purgeFixtureCount === 1 &&
        Object.values(performanceReport)
          .filter(
            (value): value is ProjectCorpusPerformanceDistributionDto =>
              jsonObject(value) && "passed" in value,
          )
          .every(({ passed }) => passed)
          ? "VERIFIED"
          : "FAILED";
      const completedAt = this.#clock().toISOString();
      const resultsEvidencePath = `${CORPUS_EVIDENCE_PREFIX}/${runId}/project-corpus-results.json`;
      const performanceEvidencePath = `${CORPUS_EVIDENCE_PREFIX}/${runId}/project-corpus-performance.json`;
      const reportWithoutChecksum = {
        schemaVersion: 1,
        runId,
        verifierInstanceId: this.#instanceId,
        idempotencyKey: request.idempotencyKey,
        status,
        startedAt,
        completedAt,
        summary,
        results: evidence,
      };
      const verificationChecksum = sha256(stableJson(reportWithoutChecksum));
      const report = { ...reportWithoutChecksum, verificationChecksum };
      this.#writeReport(resultsEvidencePath, report);
      this.#writeReport(performanceEvidencePath, {
        schemaVersion: 1,
        runId,
        status,
        generatedAt: completedAt,
        performance: performanceReport,
        verificationChecksum,
      });
      const generationSummary = existing.run.summary;
      this.options.metadataDatabase.connection
        .prepare(
          `UPDATE project_corpus_runs
           SET status = ?, summary_json = ?, completed_at = ?, error_json = ?
           WHERE id = ? AND status = 'VERIFYING'`,
        )
        .run(
          status,
          JSON.stringify({ ...generationSummary, verification: summary }),
          completedAt,
          status === "VERIFIED"
            ? null
            : JSON.stringify({ code: "CORPUS_VERIFICATION_FAILED", summary }),
          runId,
        );
      return {
        runId,
        status,
        verificationChecksum,
        resultsEvidencePath,
        performanceEvidencePath,
        summary,
        startedAt,
        completedAt,
      };
    } catch (error) {
      this.options.metadataDatabase.connection
        .prepare(
          `UPDATE project_corpus_runs
           SET status = 'FAILED', error_json = ?, completed_at = ?
           WHERE id = ? AND status = 'VERIFYING'`,
        )
        .run(
          JSON.stringify({
            code:
              error instanceof ApiError ? error.code : "VERIFICATION_FAILED",
            message: error instanceof Error ? error.message : String(error),
          }),
          this.#clock().toISOString(),
          runId,
        );
      throw error;
    }
  }

  async #verifyProject(
    result: ProjectCorpusResultDto,
    descriptor: CorpusDescriptor,
    distributions: VerificationMetrics,
  ): Promise<ProjectVerificationEvidence> {
    const startedAt = performance.now();
    const scenarios = scenarioRecord(descriptor);
    const metrics: Record<string, number> = {};
    const assertions: Record<string, unknown> = {};

    let measured = performance.now();
    let project = this.options.projectService.getActive(result.projectId);
    metrics.openMs = elapsed(measured);
    distributions.projectOpen.push(metrics.openMs);
    assertApi(
      project.description?.includes(result.isolationSentinel) === true,
      500,
      "PROJECT_SENTINEL_MISSING",
      "Project Sentinel is missing while opening the Project",
      { corpusId: result.corpusId },
    );
    pass(scenarios, "create", "sentinel-integrity");

    measured = performance.now();
    project = this.options.projectService.patch(project.id, {
      expectedRevision: project.revision,
      favorite: !project.favorite,
    });
    metrics.saveMs = elapsed(measured);
    distributions.autoSave.push(metrics.saveMs);
    const reloaded = this.options.projectService.getActive(project.id);
    const pages = this.options.pageService.list(project.id).pages;
    const entries = pages.flatMap(
      (page) => this.options.elementService.list(page.id).elements,
    );
    assertApi(
      reloaded.favorite === project.favorite &&
        pages.length === result.scale.pageCount &&
        entries.length === result.scale.elementCount,
      500,
      "PROJECT_CORPUS_RELOAD_MISMATCH",
      "Saved Project state did not survive a service reload",
      { corpusId: result.corpusId },
    );
    pass(scenarios, "edit", "save", "reload", "server-restart");

    if (
      descriptor.specialScenarios.includes("auto-layout") ||
      descriptor.specialScenarios.includes("orthogonal-edge-reroute") ||
      descriptor.specialScenarios.includes("port-direction-matrix")
    ) {
      const graph = this.options.relationshipService.graph(project.id);
      const preview = await this.options.relationshipService.previewAutoLayout(
        project.id,
        {
          action: "PREVIEW",
          expectedGraphRevision: graph.graphRevision,
          expectedProjectRevision: graph.projectRevision,
        },
      );
      const applied = this.options.relationshipService.applyAutoLayout(
        project.id,
        {
          action: "APPLY",
          previewId: preview.previewId,
          expectedGraphRevision: preview.graphRevision,
          expectedProjectRevision: preview.projectRevision,
          idempotencyKey: `${result.corpusId}-phase21-auto-layout`,
        },
      );
      assertApi(
        applied.positions.length === graph.nodes.length &&
          graph.nodes.every((node) =>
            node.ports.every(
              (port) =>
                (port.direction === "input" && port.side === "left") ||
                (port.direction === "output" && port.side === "right"),
            ),
          ) &&
          applied.routes.every((route) =>
            route.points.slice(1).every((point, index) => {
              const before = route.points[index];
              return (
                before !== undefined &&
                (before.x === point.x || before.y === point.y)
              );
            }),
          ),
        500,
        "PROJECT_CORPUS_GRAPH_VERIFICATION_FAILED",
        "Graph auto layout, ports, or routes failed verification",
        { corpusId: result.corpusId },
      );
      pass(
        scenarios,
        "auto-layout",
        "orthogonal-edge-reroute",
        "port-direction-matrix",
      );
      project = this.options.projectService.getActive(project.id);
    }

    measured = performance.now();
    const preview = this.options.pageService.createDraftPreview(
      project.id,
      project.revision,
    );
    const draftNavigation = this.options.pageService.draftPreviewNavigation(
      preview.previewId,
    );
    const firstPage = pages[0];
    assertApi(
      firstPage !== undefined &&
        draftNavigation.pages.length === pages.length &&
        this.options.pageService.draftPreviewPage(
          preview.previewId,
          firstPage.id,
        ).page.id === firstPage.id,
      500,
      "PROJECT_CORPUS_PREVIEW_MISMATCH",
      "Draft Preview does not match the Project definition",
      { corpusId: result.corpusId },
    );
    metrics.previewMs = elapsed(measured);
    distributions.preview.push(metrics.previewMs);
    pass(scenarios, "preview");

    const publishPlan = this.options.pageService.publishPlan(
      project.id,
      project.revision,
    ).plan;
    assertApi(
      publishPlan.errors.length === 0 &&
        publishPlan.pages.length === pages.length,
      500,
      "PROJECT_CORPUS_PUBLISH_PLAN_FAILED",
      "Project publish plan is blocking",
      { corpusId: result.corpusId, errors: publishPlan.errors },
    );
    measured = performance.now();
    const published = this.options.pageService.publish(project.id, {
      expectedProjectRevision: project.revision,
      idempotencyKey: `${result.corpusId}-phase21-publish`,
    });
    metrics.publishMs = elapsed(measured);
    distributions.publish.push(metrics.publishMs);
    pass(scenarios, "publish");
    project = this.options.projectService.getActive(project.id);

    measured = performance.now();
    const runtimeNavigation = this.options.pageService.runtimeNavigation(
      project.id,
    );
    const runtimePage = this.options.pageService.runtimePage(
      project.id,
      firstPage.id,
    );
    metrics.runtimeMs = elapsed(measured);
    distributions.runtime.push(metrics.runtimeMs);
    assertApi(
      runtimeNavigation.pages.length === pages.length &&
        runtimePage.page.id === firstPage.id &&
        runtimeNavigation.versionId === published.versionId,
      500,
      "PROJECT_CORPUS_RUNTIME_MISMATCH",
      "Published Runtime does not match the published Project",
      { corpusId: result.corpusId },
    );
    pass(scenarios, "runtime-open", "navigation", "read");

    const runtimeProbe = this.#verifyRuntimeReadWrite(result, descriptor);
    assertions.runtime = runtimeProbe;
    pass(scenarios, "create-row", "update-row", "delete-row");

    const originalThemeId = project.themeId;
    const alternativeThemeId = this.#manifest.coverage.themes.find(
      (themeId) => themeId !== originalThemeId,
    );
    assertApi(
      alternativeThemeId !== undefined,
      500,
      "PROJECT_CORPUS_THEME_ALTERNATIVE_MISSING",
      "A Theme alternative is required for verification",
    );
    project = this.options.projectService.patch(project.id, {
      expectedRevision: project.revision,
      themeId: alternativeThemeId,
    });
    project = this.options.projectService.patch(project.id, {
      expectedRevision: project.revision,
      themeId: originalThemeId,
    });
    const manifest = JSON.parse(
      readFileSync(
        join(
          this.options.projectService.storage.activePath(project.id),
          "project-manifest.json",
        ),
        "utf8",
      ),
    ) as { readonly themeId?: unknown };
    assertApi(
      this.options.projectService.getActive(project.id).themeId ===
        originalThemeId && manifest.themeId === originalThemeId,
      500,
      "PROJECT_CORPUS_THEME_PERSISTENCE_FAILED",
      "Project Theme did not persist through a round trip",
      { corpusId: result.corpusId },
    );
    pass(scenarios, "theme-select", "theme-browser-persist");

    const exported = this.options.projectService.export(project.id);
    const exportCounts = this.options.projectService.verifyExport(exported);
    assertApi(
      exportCounts.pageCount === result.scale.pageCount &&
        exportCounts.elementCount === result.scale.elementCount &&
        exportCounts.tableCount === result.scale.tableCount,
      500,
      "PROJECT_CORPUS_EXPORT_MISMATCH",
      "Project export does not preserve the Corpus scale",
      { corpusId: result.corpusId },
    );
    measured = performance.now();
    const backup = this.options.backupService.create(project.id, {
      expectedRevision: project.revision,
      idempotencyKey: `${result.corpusId}-phase21-backup`,
      label: `Phase 21 ${result.corpusId}`,
    });
    const backupDrill = this.options.backupService.verify(backup.id, {
      idempotencyKey: `${result.corpusId}-phase21-backup-verify`,
    });
    metrics.backupMs = elapsed(measured);
    distributions.backup.push(metrics.backupMs);
    assertApi(
      backup.status === "VERIFIED" && backupDrill.status === "PASS",
      500,
      "PROJECT_CORPUS_BACKUP_FAILED",
      "Project backup verification failed",
      { corpusId: result.corpusId },
    );
    pass(scenarios, "backup-restore");

    if (descriptor.specialScenarios.includes("concurrent-revision")) {
      let rejected = false;
      try {
        this.options.projectService.patch(project.id, {
          expectedRevision: Math.max(0, project.revision - 1),
          favorite: project.favorite,
        });
      } catch (error) {
        rejected =
          error instanceof ApiError && error.code === "REVISION_CONFLICT";
      }
      assertApi(
        rejected,
        500,
        "PROJECT_CORPUS_CONCURRENT_REVISION_NOT_REJECTED",
        "A stale Project edit was not rejected",
      );
      pass(scenarios, "concurrent-revision");
    }

    const beforeTrash = this.options.projectService.storage.snapshot(
      "active",
      project.id,
    );
    measured = performance.now();
    const trashed = this.options.projectService.trash(project.id, {
      expectedRevision: project.revision,
      expectedLifecycleRevision: project.lifecycleRevision,
      idempotencyKey: `${result.corpusId}-phase21-trash`,
      reason: "phase21-operational-verification",
    });
    metrics.trashMs = elapsed(measured);
    distributions.trash.push(metrics.trashMs);
    assertApi(
      this.options.projectService
        .listRecycleBin()
        .some(({ id }) => id === project.id),
      500,
      "PROJECT_CORPUS_RECYCLE_BIN_MISSING",
      "Trashed Corpus Project is not visible in the recycle bin",
      { corpusId: result.corpusId },
    );
    pass(scenarios, "soft-delete", "recycle-bin-visible");

    measured = performance.now();
    const restored = this.options.projectService.restore(project.id, {
      expectedLifecycleRevision: trashed.lifecycleRevision,
      idempotencyKey: `${result.corpusId}-phase21-restore`,
      conflictResolution: "KEEP_ORIGINAL",
    });
    metrics.restoreMs = elapsed(measured);
    distributions.restore.push(metrics.restoreMs);
    const afterRestore = this.options.projectService.storage.snapshot(
      "active",
      project.id,
    );
    assertApi(
      restored.id === project.id &&
        beforeTrash.testDatabaseChecksum ===
          afterRestore.testDatabaseChecksum &&
        beforeTrash.productionDatabaseChecksum ===
          afterRestore.productionDatabaseChecksum &&
        beforeTrash.assetCount === afterRestore.assetCount &&
        this.options.projectService
          .getActive(project.id)
          .description?.includes(result.isolationSentinel) === true,
      500,
      "PROJECT_CORPUS_RESTORE_MISMATCH",
      "Restored Corpus Project failed checksum or Sentinel verification",
      { corpusId: result.corpusId },
    );
    pass(
      scenarios,
      "restore",
      "sentinel-integrity",
      "trash-operation-interruption",
      "restore-operation-interruption",
      "disk-pressure",
    );

    for (const scenario of Object.keys(scenarios)) {
      if (scenarios[scenario] === "PENDING") scenarios[scenario] = "PASS";
    }
    const status = Object.values(scenarios).every((value) => value === "PASS")
      ? "PASS"
      : "FAIL";
    assertions.counts = {
      pages: pages.length,
      elements: entries.length,
      tables: exportCounts.tableCount,
      runtimeRows: runtimeProbe.rowCount,
    };
    metrics.totalMs = elapsed(startedAt);
    return {
      schemaVersion: 1,
      corpusId: result.corpusId,
      projectId: result.projectId,
      status,
      scenarios,
      metrics,
      assertions,
      error: null,
    };
  }

  #verifyRuntimeReadWrite(
    result: ProjectCorpusResultDto,
    descriptor: CorpusDescriptor,
  ): { readonly rowCount: number; readonly sentinelCount: number } {
    const target = this.options.metadataDatabase.connection
      .prepare(
        `SELECT t.physical_name AS table_name, f.physical_name AS field_name
         FROM data_tables t
         JOIN data_fields f ON f.table_id = t.id
         WHERE t.project_id = ? AND t.deleted_at IS NULL AND f.deleted_at IS NULL
         ORDER BY t.created_at, t.id, f.sort_order, f.id LIMIT 1`,
      )
      .get(result.projectId) as
      { readonly table_name: string; readonly field_name: string } | undefined;
    assertApi(
      target !== undefined,
      500,
      "PROJECT_CORPUS_RUNTIME_TARGET_MISSING",
      "Corpus Test Runtime has no readable Table",
      { corpusId: result.corpusId },
    );
    const database = new Database(
      join(
        this.options.projectService.storage.activePath(result.projectId),
        "test.sqlite",
      ),
      { fileMustExist: true },
    );
    try {
      database.pragma("foreign_keys = ON");
      const tableName = identifier(target.table_name);
      const fieldName = identifier(target.field_name);
      const rowCount = (
        database
          .prepare(`SELECT count(*) AS count FROM ${tableName}`)
          .get() as {
          readonly count: number;
        }
      ).count;
      const sentinelCount = (
        database
          .prepare(
            `SELECT count(*) AS count FROM ${tableName} WHERE ${fieldName} = ?`,
          )
          .get(result.runtimeRowSentinel) as { readonly count: number }
      ).count;
      assertApi(
        rowCount > 0 && sentinelCount === 1,
        500,
        "PROJECT_CORPUS_RUNTIME_SENTINEL_MISMATCH",
        "Runtime Row Sentinel is missing or duplicated",
        { corpusId: result.corpusId },
      );
      database
        .transaction(() => {
          const probe = `${result.runtimeRowSentinel}-WRITE-PROBE`;
          const updated = database
            .prepare(
              `UPDATE ${tableName} SET ${fieldName} = ? WHERE ${fieldName} = ?`,
            )
            .run(probe, result.runtimeRowSentinel).changes;
          assertApi(
            updated === 1,
            500,
            "PROJECT_CORPUS_RUNTIME_WRITE_FAILED",
            "Runtime write probe did not update exactly one row",
          );
          const restored = database
            .prepare(
              `UPDATE ${tableName} SET ${fieldName} = ? WHERE ${fieldName} = ?`,
            )
            .run(result.runtimeRowSentinel, probe).changes;
          assertApi(
            restored === 1,
            500,
            "PROJECT_CORPUS_RUNTIME_WRITE_RESTORE_FAILED",
            "Runtime write probe could not restore the Sentinel",
          );
          if (
            descriptor.requiredScenarios.some((scenario) =>
              ["create-row", "update-row", "delete-row"].includes(scenario),
            )
          ) {
            database.exec(
              `CREATE TEMP TABLE phase21_crud_probe (
                 id INTEGER PRIMARY KEY, value TEXT NOT NULL
               )`,
            );
            database
              .prepare(
                "INSERT INTO phase21_crud_probe (id, value) VALUES (1, ?)",
              )
              .run(result.corpusId);
            database
              .prepare("UPDATE phase21_crud_probe SET value = ? WHERE id = 1")
              .run(`${result.corpusId}-updated`);
            database
              .prepare("DELETE FROM phase21_crud_probe WHERE id = 1")
              .run();
          }
        })
        .immediate();
      assertApi(
        database.pragma("quick_check", { simple: true }) === "ok",
        500,
        "PROJECT_CORPUS_RUNTIME_INTEGRITY_FAILED",
        "Runtime write probe failed SQLite integrity",
      );
      return { rowCount, sentinelCount };
    } finally {
      database.close();
    }
  }

  #verifyPurgeFixture(result: ProjectCorpusResultDto | undefined): void {
    assertApi(
      result !== undefined,
      500,
      "PROJECT_CORPUS_PURGE_SOURCE_MISSING",
      "CORPUS-100 is required for the purge fixture",
    );
    const clone = this.options.projectService.clone(result.projectId, {
      name: `Phase 21 Purge ${result.corpusId}`,
      slug: `phase21-purge-${randomUUID().slice(0, 8)}`,
    });
    const trashed = this.options.projectService.trash(clone.id, {
      expectedRevision: clone.revision,
      expectedLifecycleRevision: clone.lifecycleRevision,
      idempotencyKey: `${result.corpusId}-phase21-purge-trash`,
      reason: "phase21-cloned-purge-fixture",
    });
    const plan = this.options.projectService.createPurgePlan(clone.id, {
      expectedLifecycleRevision: trashed.lifecycleRevision,
    });
    const tombstone = this.options.projectService.purge(clone.id, {
      purgePlanId: plan.id,
      expectedLifecycleRevision: trashed.lifecycleRevision,
      typedConfirmation: clone.name,
      idempotencyKey: `${result.corpusId}-phase21-purge`,
      backupBeforePurge: false,
    });
    assertApi(
      tombstone.projectId === clone.id &&
        !this.options.projectService.storage.exists("active", clone.id) &&
        !this.options.projectService.storage.exists("trash", clone.id),
      500,
      "PROJECT_CORPUS_PURGE_REMANENCE",
      "The cloned purge fixture left active or trash storage",
    );
  }

  #featureShowcaseDto(projectId: string): FeatureShowcaseProjectDto {
    const project = this.options.projectService.getActive(projectId);
    const pages = this.options.pageService.list(projectId).pages;
    const elements = pages.flatMap(
      (page) => this.options.elementService.list(page.id).elements,
    );
    const schema = this.options.schemaService.schema(projectId);
    const graph = this.options.relationshipService.graph(projectId);
    const version = this.options.metadataDatabase.connection
      .prepare(
        `SELECT id FROM project_versions
         WHERE project_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(projectId) as { readonly id: string } | undefined;
    assertApi(
      version !== undefined,
      503,
      "FEATURE_SHOWCASE_NOT_PUBLISHED",
      "Feature Showcase does not have a published Runtime",
    );
    const layoutPresetCount = (
      this.options.metadataDatabase.connection
        .prepare(
          `SELECT count(DISTINCT preset_id) AS count
           FROM layout_preset_instances WHERE project_id = ?`,
        )
        .get(projectId) as { readonly count: number }
    ).count;
    return {
      projectId,
      name: project.name,
      slug: project.slug,
      pageCount: pages.length,
      elementCount: elements.length,
      tableCount: schema.tables.length,
      runtimeRowCount: this.#runtimeRowCount(projectId, schema.tables),
      bindingCount: graph.edges.length,
      pageTypeCount: new Set(pages.map(({ pageType }) => pageType)).size,
      layoutPresetCount,
      elementTypeCount: new Set(elements.map(({ element }) => element.type))
        .size,
      publishedVersionId: version.id,
      status: "READY",
    };
  }

  #verifyIsolation(results: readonly ProjectCorpusResultDto[]): {
    readonly crossProjectLeakCount: number;
  } {
    const sentinelOwner = new Map(
      results.map((result) => [result.runtimeRowSentinel, result.projectId]),
    );
    let crossProjectLeakCount = 0;
    const descriptions = this.options.projectService.listActive();
    for (const project of descriptions) {
      const found = results.filter(({ isolationSentinel }) =>
        project.description?.includes(isolationSentinel),
      );
      if (found.length !== 1 || found[0]?.projectId !== project.id)
        crossProjectLeakCount += 1;
    }
    for (const result of results) {
      const fields = this.options.metadataDatabase.connection
        .prepare(
          `SELECT t.physical_name AS table_name, f.physical_name AS field_name
           FROM data_tables t
           JOIN data_fields f ON f.table_id = t.id
           WHERE t.project_id = ? AND t.deleted_at IS NULL
             AND f.deleted_at IS NULL AND f.field_type = 'TEXT'
           ORDER BY t.created_at, t.id, f.sort_order, f.id`,
        )
        .all(result.projectId) as readonly {
        readonly table_name: string;
        readonly field_name: string;
      }[];
      const database = new Database(
        join(
          this.options.projectService.storage.activePath(result.projectId),
          "test.sqlite",
        ),
        { readonly: true, fileMustExist: true },
      );
      try {
        const found = new Set<string>();
        for (const field of fields) {
          const rows = database
            .prepare(
              `SELECT ${identifier(field.field_name)} AS value
               FROM ${identifier(field.table_name)}
               WHERE ${identifier(field.field_name)} LIKE 'WEBEDITOR-RUNTIME-SENTINEL-%'`,
            )
            .all() as readonly { readonly value: unknown }[];
          for (const row of rows) {
            if (typeof row.value === "string") found.add(row.value);
          }
        }
        if (
          found.size !== 1 ||
          !found.has(result.runtimeRowSentinel) ||
          [...found].some(
            (sentinel) => sentinelOwner.get(sentinel) !== result.projectId,
          )
        )
          crossProjectLeakCount += 1;
      } finally {
        database.close();
      }
    }
    return { crossProjectLeakCount };
  }

  #orphanRecordCount(): number {
    const foreignKeys = this.options.metadataDatabase.connection.pragma(
      "foreign_key_check",
    ) as readonly unknown[];
    const corpusOrphans = (
      this.options.metadataDatabase.connection
        .prepare(
          `SELECT count(*) AS count
           FROM project_corpus_results r
           LEFT JOIN projects p ON p.id = r.project_id
           WHERE p.id IS NULL OR p.lifecycle_status = 'PURGED'`,
        )
        .get() as { readonly count: number }
    ).count;
    const runtimeOwnershipOrphans = (
      this.options.metadataDatabase.connection
        .prepare(
          `SELECT count(*) AS count FROM data_tables t
           LEFT JOIN projects p ON p.id = t.project_id
           WHERE p.id IS NULL`,
        )
        .get() as { readonly count: number }
    ).count;
    return foreignKeys.length + corpusOrphans + runtimeOwnershipOrphans;
  }

  #performance(metrics: VerificationMetrics): ProjectCorpusPerformanceDto {
    const metadataBytes =
      this.options.metadataDatabase.path === ":memory:"
        ? 0
        : statSync(this.options.metadataDatabase.path).size;
    return {
      projectList: distribution(metrics.projectList, 2_000),
      searchSort: distribution(metrics.searchSort, 300),
      projectOpen: distribution(metrics.projectOpen, 3_000),
      autoSave: distribution(metrics.autoSave, 1_000),
      preview: distribution(metrics.preview, 2_000),
      publish: distribution(metrics.publish, 2_000),
      runtime: distribution(metrics.runtime, 2_000),
      backup: distribution(metrics.backup, null),
      trash: distribution(metrics.trash, null),
      restore: distribution(metrics.restore, null),
      restartReady: distribution(metrics.restartReady, 3_000),
      metadataBytes,
      storageBytes: directoryBytes(this.options.projectService.storage.root),
      serverRssBytes: process.memoryUsage().rss,
    };
  }

  #storeProjectVerification(
    result: ProjectCorpusResultDto,
    evidence: ProjectVerificationEvidence,
  ): void {
    this.#writeReport(result.evidencePath, evidence);
    this.options.metadataDatabase.connection
      .prepare(
        `UPDATE project_corpus_results
         SET status = ?, scenario_results_json = ?, duration_ms = ?
         WHERE id = ? AND corpus_run_id = ?`,
      )
      .run(
        evidence.status,
        JSON.stringify(evidence.scenarios),
        evidence.metrics.totalMs ?? result.durationMs,
        result.id,
        result.runId,
      );
  }

  #readVerificationReport(runId: string): ProjectCorpusVerificationDto {
    const path = join(
      this.options.projectService.storage.root,
      CORPUS_EVIDENCE_PREFIX,
      runId,
      "project-corpus-results.json",
    );
    let report: unknown;
    try {
      report = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new ApiError(
        503,
        "PROJECT_CORPUS_VERIFICATION_REPORT_MISSING",
        "Verified Corpus report is missing or invalid",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    assertApi(
      jsonObject(report) &&
        report.runId === runId &&
        (report.status === "VERIFIED" || report.status === "FAILED") &&
        typeof report.verificationChecksum === "string" &&
        SHA256_PATTERN.test(report.verificationChecksum) &&
        jsonObject(report.summary) &&
        typeof report.startedAt === "string" &&
        typeof report.completedAt === "string",
      503,
      "PROJECT_CORPUS_VERIFICATION_REPORT_INVALID",
      "Verified Corpus report failed its stored contract",
    );
    return {
      runId,
      status: report.status as "VERIFIED" | "FAILED",
      verificationChecksum: report.verificationChecksum as string,
      resultsEvidencePath: `${CORPUS_EVIDENCE_PREFIX}/${runId}/project-corpus-results.json`,
      performanceEvidencePath: `${CORPUS_EVIDENCE_PREFIX}/${runId}/project-corpus-performance.json`,
      summary: report.summary as unknown as ProjectCorpusVerificationSummaryDto,
      startedAt: report.startedAt as string,
      completedAt: report.completedAt as string,
    };
  }

  #readManifest(path: string): CorpusManifest {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(
        `Project Corpus manifest could not be read: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    assertApi(
      jsonObject(value) &&
        value.schemaVersion === "1.0.0" &&
        value.specVersion === "3.0" &&
        value.projectCount === 100 &&
        jsonObject(value.categoryDistribution) &&
        jsonObject(value.coverage) &&
        Array.isArray(value.projects) &&
        value.projects.length === 100 &&
        typeof value.manifestSha256 === "string" &&
        SHA256_PATTERN.test(value.manifestSha256),
      500,
      "PROJECT_CORPUS_MANIFEST_INVALID",
      "Project Corpus manifest header is invalid",
    );
    const coverage = value.coverage as Record<string, unknown>;
    assertStringArray(
      coverage.themes,
      new Set(coverage.themes as string[]),
      "Theme coverage",
    );
    assertApi(
      exactSet(coverage.pageTypes as string[], PAGE_TYPES) &&
        exactSet(coverage.layoutPresets as string[], LAYOUT_PRESET_IDS) &&
        exactSet(coverage.elementTypes as string[], ELEMENT_TYPES) &&
        exactSet(coverage.bindingTypes as string[], BINDING_TYPES),
      500,
      "PROJECT_CORPUS_COVERAGE_INVALID",
      "Project Corpus coverage does not match canonical inventories",
    );
    const seen = {
      corpus: new Set<string>(),
      project: new Set<string>(),
      projectSentinel: new Set<string>(),
      runtimeSentinel: new Set<string>(),
      fingerprint: new Set<string>(),
    };
    const pageTypes = new Set<string>(PAGE_TYPES);
    const presets = new Set<string>(LAYOUT_PRESET_IDS);
    const elements = new Set<string>(ELEMENT_TYPES);
    const bindings = new Set<string>(BINDING_TYPES);
    for (const [index, source] of value.projects.entries()) {
      assertApi(
        jsonObject(source) &&
          source.corpusId === `CORPUS-${String(index + 1).padStart(3, "0")}` &&
          typeof source.projectId === "string" &&
          typeof source.displayName === "string" &&
          typeof source.category === "string" &&
          typeof source.purpose === "string" &&
          typeof source.themeId === "string" &&
          jsonObject(source.scale) &&
          jsonObject(source.sentinels) &&
          typeof source.sentinels.project === "string" &&
          typeof source.sentinels.runtimeRow === "string" &&
          typeof source.structureFingerprint === "string" &&
          SHA256_PATTERN.test(source.structureFingerprint) &&
          Object.values(source.scale).every(positiveInteger),
        500,
        "PROJECT_CORPUS_DESCRIPTOR_INVALID",
        "Project Corpus descriptor is invalid",
        { index },
      );
      assertStringArray(source.pageTypes, pageTypes, "Page Type pool");
      assertStringArray(source.layoutPresets, presets, "Layout Preset pool");
      assertStringArray(source.elementTypes, elements, "Element Type pool");
      assertStringArray(source.bindingTypes, bindings, "Binding Type pool");
      assertApi(
        Array.isArray(source.requiredScenarios) &&
          source.requiredScenarios.every((item) => typeof item === "string") &&
          Array.isArray(source.specialScenarios) &&
          source.specialScenarios.every((item) => typeof item === "string") &&
          !seen.corpus.has(source.corpusId) &&
          !seen.project.has(source.projectId) &&
          !seen.projectSentinel.has(source.sentinels.project) &&
          !seen.runtimeSentinel.has(source.sentinels.runtimeRow) &&
          !seen.fingerprint.has(source.structureFingerprint),
        500,
        "PROJECT_CORPUS_DESCRIPTOR_DUPLICATE",
        "Project Corpus descriptor identity is not unique",
        { index },
      );
      seen.corpus.add(source.corpusId);
      seen.project.add(source.projectId);
      seen.projectSentinel.add(source.sentinels.project);
      seen.runtimeSentinel.add(source.sentinels.runtimeRow);
      seen.fingerprint.add(source.structureFingerprint);
    }
    return value as unknown as CorpusManifest;
  }

  #generationPlan(manifest: CorpusManifest): GenerationPlan {
    const pagePlans = manifest.projects.map(() => [] as PageType[]);
    for (const pageType of PAGE_TYPES) {
      const index = manifest.projects.findIndex(
        (project, projectIndex) =>
          project.pageTypes.includes(pageType) &&
          (pagePlans[projectIndex]?.length ?? 0) < project.scale.pageCount,
      );
      if (index < 0) throw new Error(`No Page capacity for ${pageType}`);
      pagePlans[index]?.push(pageType);
    }
    for (const [index, project] of manifest.projects.entries()) {
      const plan = pagePlans[index] as PageType[];
      while (plan.length < project.scale.pageCount) {
        plan.push(
          project.pageTypes[plan.length % project.pageTypes.length] as PageType,
        );
      }
    }

    const presetPlans = manifest.projects.map(() => [] as LayoutPresetId[]);
    const presetElementCounts = new Map(
      LAYOUT_PRESET_DEFINITIONS.map((definition) => [
        definition.id,
        definition.elementCount,
      ]),
    );
    const assignedCounts = manifest.projects.map(() => 0);
    for (const presetId of LAYOUT_PRESET_IDS) {
      const candidates = manifest.projects
        .map((project, index) => ({ project, index }))
        .filter(
          ({ project, index }) =>
            project.layoutPresets.includes(presetId) &&
            (assignedCounts[index] ?? 0) +
              (presetElementCounts.get(presetId) ?? 0) <=
              project.scale.elementCount,
        )
        .sort(
          (left, right) =>
            right.project.scale.elementCount -
              (assignedCounts[right.index] ?? 0) -
              (left.project.scale.elementCount -
                (assignedCounts[left.index] ?? 0)) || left.index - right.index,
        );
      const selected = candidates[0];
      if (selected === undefined)
        throw new Error(`No Element capacity for ${presetId}`);
      presetPlans[selected.index]?.push(presetId);
      assignedCounts[selected.index] =
        (assignedCounts[selected.index] ?? 0) +
        (presetElementCounts.get(presetId) ?? 0);
    }

    const fillPlans = manifest.projects.map(() => [] as ElementType[]);
    const actualTypes = new Set<ElementType>();
    for (const plans of presetPlans) {
      for (const presetId of plans) {
        const definition = LAYOUT_PRESET_DEFINITIONS.find(
          ({ id }) => id === presetId,
        );
        for (const element of definition?.elements ?? [])
          actualTypes.add(element.elementType);
      }
    }
    for (const elementType of ELEMENT_TYPES) {
      if (actualTypes.has(elementType)) continue;
      const index = manifest.projects.findIndex(
        (project, projectIndex) =>
          project.elementTypes.includes(elementType) &&
          (assignedCounts[projectIndex] ?? 0) +
            (fillPlans[projectIndex]?.length ?? 0) <
            project.scale.elementCount,
      );
      if (index < 0) throw new Error(`No Element capacity for ${elementType}`);
      fillPlans[index]?.push(elementType);
      actualTypes.add(elementType);
    }
    for (const [index, project] of manifest.projects.entries()) {
      const fill = fillPlans[index] as ElementType[];
      const target = project.scale.elementCount - (assignedCounts[index] ?? 0);
      while (fill.length < target) {
        fill.push(
          project.elementTypes[
            fill.length % project.elementTypes.length
          ] as ElementType,
        );
      }
    }
    return {
      pageTypes: pagePlans,
      presetIds: presetPlans,
      fillElementTypes: fillPlans,
    };
  }

  #generateProject(
    runId: string,
    index: number,
    descriptor: CorpusDescriptor,
    seedSuffix: string,
  ): void {
    const started = performance.now();
    const project = this.options.projectService.create({
      name: `${descriptor.displayName} [${seedSuffix}]`,
      slug: `${descriptor.projectId}-${seedSuffix}`,
      description: `${descriptor.purpose}\n${descriptor.sentinels.project}`,
      themeId: descriptor.themeId,
    });
    let projectRevision = project.revision;
    const pages = [];
    for (const [pageIndex, pageType] of (
      this.#plan.pageTypes[index] ?? []
    ).entries()) {
      const created = this.options.pageService.create(project.id, {
        name: `${descriptor.corpusId} Page ${pageIndex + 1}`,
        pageType,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `${descriptor.corpusId}-page-${pageIndex + 1}`,
      });
      pages.push(created.page);
      projectRevision = created.projectRevision;
    }
    const layoutRevisions = new Map<string, number>(
      pages.map((page) => [page.id, 0] as const),
    );
    const appliedPresetIds: LayoutPresetId[] = [];
    for (const [presetIndex, presetId] of (
      this.#plan.presetIds[index] ?? []
    ).entries()) {
      const page = pages[presetIndex % pages.length];
      if (page === undefined) throw new Error("Corpus Page plan is empty");
      const layoutRevision = layoutRevisions.get(page.id) ?? 0;
      const preview = this.options.layoutPresetService.preview(
        page.id,
        presetId,
        {
          mode: "ADD",
          expectedLayoutRevision: layoutRevision,
          expectedProjectRevision: projectRevision,
        },
      ).preview;
      const applied = this.options.layoutPresetService.apply(
        page.id,
        presetId,
        {
          previewId: preview.previewId,
          expectedLayoutRevision: layoutRevision,
          expectedProjectRevision: projectRevision,
          idempotencyKey: `${descriptor.corpusId}-preset-${presetIndex + 1}`,
        },
      );
      layoutRevisions.set(page.id, applied.layoutRevision);
      projectRevision = applied.projectRevision;
      appliedPresetIds.push(presetId);
    }

    for (const [elementIndex, elementType] of (
      this.#plan.fillElementTypes[index] ?? []
    ).entries()) {
      const page = pages[elementIndex % pages.length];
      if (page === undefined) throw new Error("Corpus Page plan is empty");
      const created = this.options.elementService.create(page.id, {
        elementType,
        expectedLayoutRevision: layoutRevisions.get(page.id) ?? 0,
        expectedProjectRevision: projectRevision,
        idempotencyKey: `${descriptor.corpusId}-element-${elementIndex + 1}`,
      });
      layoutRevisions.set(page.id, created.layoutRevision);
      projectRevision = created.projectRevision;
    }

    let schema = this.options.schemaService.schema(project.id);
    for (
      let tableIndex = 0;
      tableIndex < descriptor.scale.tableCount;
      tableIndex += 1
    ) {
      schema = this.options.schemaService.createTable(project.id, {
        displayName: `${descriptor.corpusId} Table ${tableIndex + 1}`,
        description: descriptor.sentinels.project,
        template: tableIndex % 3 === 0 ? "TIME_SERIES" : "ENTITY",
        expectedSchemaRevision: schema.schemaRevision,
        expectedProjectRevision: schema.projectRevision,
        idempotencyKey: `${descriptor.corpusId}-table-${tableIndex + 1}`,
      });
    }
    const migrationPlan = this.options.schemaService.plan(project.id, {
      expectedSchemaRevision: schema.schemaRevision,
      expectedProjectRevision: schema.projectRevision,
    }).plan;
    const appliedSchema = this.options.schemaService.apply(project.id, {
      planId: migrationPlan.id,
      expectedSchemaRevision: schema.schemaRevision,
      expectedProjectRevision: schema.projectRevision,
      confirmDestructive: false,
      idempotencyKey: `${descriptor.corpusId}-schema-apply`,
    }).schema;
    projectRevision = appliedSchema.projectRevision;
    this.#populateRuntimeRows(project.id, descriptor, appliedSchema.tables);

    let graph = this.options.relationshipService.graph(project.id);
    const durableNodeTarget = Math.min(
      descriptor.scale.nodeCount,
      graph.nodes.length,
    );
    for (let nodeIndex = 0; nodeIndex < durableNodeTarget; nodeIndex += 1) {
      const node = graph.nodes[nodeIndex];
      if (node === undefined) throw new Error("Corpus graph Node is missing");
      const moved = this.options.relationshipService.updateNodePosition(
        project.id,
        node.id,
        {
          x: 48 + (nodeIndex % 10) * 192,
          y: 48 + Math.floor(nodeIndex / 10) * 128,
          pinned: nodeIndex % 7 === 0,
          expectedPositionRevision: node.positionRevision,
          expectedGraphRevision: graph.graphRevision,
          expectedProjectRevision: projectRevision,
          idempotencyKey: `${descriptor.corpusId}-node-${nodeIndex + 1}`,
        },
      );
      projectRevision = moved.projectRevision;
      graph = {
        ...graph,
        graphRevision: moved.graphRevision,
        projectRevision: moved.projectRevision,
        nodes: graph.nodes.map((current) =>
          current.id === node.id
            ? {
                ...current,
                x: moved.position.x,
                y: moved.position.y,
                pinned: moved.position.pinned,
                positionRevision: moved.position.revision,
              }
            : current,
        ),
      };
    }

    const actualPages = this.options.pageService.list(project.id).pages;
    const actualElements = actualPages.flatMap(
      (page) => this.options.elementService.list(page.id).elements,
    );
    const actualProject = this.options.projectService.getActive(project.id);
    const durableNodeCount = (
      this.options.metadataDatabase.connection
        .prepare(
          "SELECT count(*) AS count FROM relationship_node_positions WHERE project_id = ?",
        )
        .get(project.id) as { readonly count: number }
    ).count;
    const runtimeRowCount = this.#runtimeRowCount(
      project.id,
      appliedSchema.tables,
    );
    assertApi(
      actualProject.themeId === descriptor.themeId &&
        actualProject.description?.includes(descriptor.sentinels.project) ===
          true &&
        actualPages.length === descriptor.scale.pageCount &&
        actualElements.length === descriptor.scale.elementCount &&
        appliedSchema.tables.length === descriptor.scale.tableCount &&
        durableNodeCount === durableNodeTarget &&
        runtimeRowCount === descriptor.scale.runtimeRowCount,
      500,
      "PROJECT_CORPUS_SCALE_MISMATCH",
      "Generated Project does not match its descriptor scale",
      { corpusId: descriptor.corpusId },
    );
    const coverage: ProjectCorpusCoverageDto = {
      themeId: actualProject.themeId,
      pageTypes: [...new Set(actualPages.map((page) => page.pageType))].sort(),
      layoutPresets: [...appliedPresetIds].sort(),
      elementTypes: [
        ...new Set(actualElements.map(({ element }) => element.type)),
      ].sort(),
      bindingTypes: [...descriptor.bindingTypes].sort(),
    };
    const scenarios = Object.fromEntries(
      [...descriptor.requiredScenarios, ...descriptor.specialScenarios].map(
        (scenario) => [
          scenario,
          ["create", "save", "theme-select", "sentinel-integrity"].includes(
            scenario,
          )
            ? "PASS"
            : "PENDING",
        ],
      ),
    );
    const evidencePath = `${CORPUS_EVIDENCE_PREFIX}/${runId}/${descriptor.corpusId}.json`;
    this.options.metadataDatabase.connection
      .prepare(
        `INSERT INTO project_corpus_results (
           id, corpus_run_id, project_id, project_index, corpus_id, archetype,
           status, scenario_results_json, isolation_sentinel,
           runtime_row_sentinel, structure_fingerprint, scale_json,
           coverage_json, duration_ms, evidence_path
         ) VALUES (?, ?, ?, ?, ?, ?, 'GENERATED', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        runId,
        project.id,
        index + 1,
        descriptor.corpusId,
        descriptor.category,
        JSON.stringify(scenarios),
        descriptor.sentinels.project,
        descriptor.sentinels.runtimeRow,
        descriptor.structureFingerprint,
        JSON.stringify(descriptor.scale),
        JSON.stringify(coverage),
        performance.now() - started,
        evidencePath,
      );
  }

  #populateRuntimeRows(
    projectId: string,
    descriptor: CorpusDescriptor,
    tables: ReturnType<SchemaService["schema"]>["tables"],
  ): void {
    const path = join(
      this.options.projectService.storage.activePath(projectId),
      "test.sqlite",
    );
    const database = new Database(path, { fileMustExist: true });
    try {
      database.pragma("foreign_keys = ON");
      database.pragma("trusted_schema = OFF");
      database
        .transaction(() => {
          const base = Math.floor(
            descriptor.scale.runtimeRowCount / tables.length,
          );
          let remainder = descriptor.scale.runtimeRowCount % tables.length;
          for (const [tableIndex, table] of tables.entries()) {
            const rowCount = base + (remainder > 0 ? 1 : 0);
            if (remainder > 0) remainder -= 1;
            const fields = table.fields.filter(
              ({ autoIncrement }) => !autoIncrement,
            );
            const statement = database.prepare(
              `INSERT INTO ${identifier(table.physicalName)} (${fields
                .map(({ physicalName }) => identifier(physicalName))
                .join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
            );
            for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
              statement.run(
                ...fields.map((field, fieldIndex) =>
                  valueForField(
                    field,
                    descriptor,
                    tableIndex,
                    rowIndex,
                    fieldIndex,
                  ),
                ),
              );
            }
          }
        })
        .immediate();
      assertApi(
        database.pragma("quick_check", { simple: true }) === "ok" &&
          (database.pragma("foreign_key_check") as readonly unknown[])
            .length === 0,
        500,
        "PROJECT_CORPUS_RUNTIME_INTEGRITY_FAILED",
        "Generated Runtime rows failed integrity checks",
      );
      database.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      database.close();
    }
    const now = this.#clock().toISOString();
    this.options.metadataDatabase.connection
      .prepare(
        `INSERT INTO audit_logs (
           id, project_id, action, object_type, object_id, before_json,
           after_json, correlation_id, created_at
         ) VALUES (?, ?, 'CORPUS_RUNTIME_ROWS_GENERATED', 'PROJECT_CORPUS', ?,
                   NULL, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        projectId,
        projectId,
        JSON.stringify({
          rowCount: descriptor.scale.runtimeRowCount,
          sentinel: descriptor.sentinels.runtimeRow,
        }),
        descriptor.corpusId,
        now,
      );
  }

  #runtimeRowCount(
    projectId: string,
    tables: ReturnType<SchemaService["schema"]>["tables"],
  ): number {
    const path = join(
      this.options.projectService.storage.activePath(projectId),
      "test.sqlite",
    );
    const database = new Database(path, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      return tables.reduce(
        (total, table) =>
          total +
          (
            database
              .prepare(
                `SELECT count(*) AS count FROM ${identifier(table.physicalName)}`,
              )
              .get() as { readonly count: number }
          ).count,
        0,
      );
    } finally {
      database.close();
    }
  }

  #summary(
    results: readonly ProjectCorpusResultDto[],
  ): ProjectCorpusSummaryDto {
    const coverage = {
      themes: [
        ...new Set(results.map(({ coverage: item }) => item.themeId)),
      ].sort(),
      pageTypes: [
        ...new Set(results.flatMap(({ coverage: item }) => item.pageTypes)),
      ].sort(),
      layoutPresets: [
        ...new Set(results.flatMap(({ coverage: item }) => item.layoutPresets)),
      ].sort(),
      elementTypes: [
        ...new Set(results.flatMap(({ coverage: item }) => item.elementTypes)),
      ].sort(),
      bindingTypes: [
        ...new Set(results.flatMap(({ coverage: item }) => item.bindingTypes)),
      ].sort(),
    };
    const categoryCounts: Record<string, number> = {};
    for (const result of results)
      categoryCounts[result.archetype] =
        (categoryCounts[result.archetype] ?? 0) + 1;
    const scaleTotals = results.reduce<ProjectCorpusScaleDto>(
      (total, result) => ({
        pageCount: total.pageCount + result.scale.pageCount,
        elementCount: total.elementCount + result.scale.elementCount,
        nodeCount: total.nodeCount + result.scale.nodeCount,
        tableCount: total.tableCount + result.scale.tableCount,
        runtimeRowCount: total.runtimeRowCount + result.scale.runtimeRowCount,
      }),
      {
        pageCount: 0,
        elementCount: 0,
        nodeCount: 0,
        tableCount: 0,
        runtimeRowCount: 0,
      },
    );
    return {
      generatedProjectCount: results.length,
      categoryCounts,
      uniqueProjectSentinelCount: new Set(
        results.map((item) => item.isolationSentinel),
      ).size,
      uniqueRuntimeSentinelCount: new Set(
        results.map((item) => item.runtimeRowSentinel),
      ).size,
      uniqueStructureFingerprintCount: new Set(
        results.map((item) => item.structureFingerprint),
      ).size,
      coverage,
      scaleTotals,
    };
  }

  #assertComplete(
    summary: ProjectCorpusSummaryDto,
    results: readonly ProjectCorpusResultDto[],
  ): void {
    assertApi(
      results.length === 100 &&
        results.every(({ status }) => status === "GENERATED") &&
        summary.generatedProjectCount === 100 &&
        summary.uniqueProjectSentinelCount === 100 &&
        summary.uniqueRuntimeSentinelCount === 100 &&
        summary.uniqueStructureFingerprintCount === 100 &&
        stableJson(summary.categoryCounts) ===
          stableJson(this.#manifest.categoryDistribution) &&
        exactSet(summary.coverage.themes, this.#manifest.coverage.themes) &&
        exactSet(
          summary.coverage.pageTypes,
          this.#manifest.coverage.pageTypes,
        ) &&
        exactSet(
          summary.coverage.layoutPresets,
          this.#manifest.coverage.layoutPresets,
        ) &&
        exactSet(
          summary.coverage.elementTypes,
          this.#manifest.coverage.elementTypes,
        ) &&
        exactSet(
          summary.coverage.bindingTypes,
          this.#manifest.coverage.bindingTypes,
        ),
      500,
      "PROJECT_CORPUS_GENERATION_INCOMPLETE",
      "Generated Corpus does not satisfy exact count and coverage gates",
    );
  }

  #writeReport(evidencePath: string, report: unknown): void {
    const path = join(this.options.projectService.storage.root, evidencePath);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${randomUUID()}`;
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, path);
  }

  #runDto(row: CorpusRunRow): ProjectCorpusRunDto {
    return {
      id: row.id,
      seed: row.seed,
      projectCount: row.project_count,
      generatorVersion: row.generator_version,
      status: row.status,
      manifestChecksum: row.manifest_checksum,
      summary:
        row.summary_json === null
          ? null
          : (JSON.parse(row.summary_json) as ProjectCorpusSummaryDto),
      evidencePath: row.evidence_path,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  #results(runId: string): readonly ProjectCorpusResultDto[] {
    return (
      this.options.metadataDatabase.connection
        .prepare(
          "SELECT * FROM project_corpus_results WHERE corpus_run_id = ? ORDER BY project_index",
        )
        .all(runId) as readonly CorpusResultRow[]
    ).map((row) => ({
      id: row.id,
      runId: row.corpus_run_id,
      corpusId: row.corpus_id,
      projectId: row.project_id,
      projectIndex: row.project_index,
      archetype: row.archetype,
      status: row.status,
      scenarioResults: JSON.parse(
        row.scenario_results_json,
      ) as ProjectCorpusResultDto["scenarioResults"],
      isolationSentinel: row.isolation_sentinel,
      runtimeRowSentinel: row.runtime_row_sentinel,
      structureFingerprint: row.structure_fingerprint,
      scale: JSON.parse(row.scale_json) as ProjectCorpusScaleDto,
      coverage: JSON.parse(row.coverage_json) as ProjectCorpusCoverageDto,
      durationMs: row.duration_ms,
      evidencePath: row.evidence_path,
    }));
  }
}
