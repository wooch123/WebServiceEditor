import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";

export const CANONICAL_PHASE3_ROUTES = Object.freeze([
  { method: "GET", path: "/api/v1/projects" },
  { method: "POST", path: "/api/v1/projects" },
  { method: "GET", path: "/api/v1/projects/:projectId" },
  { method: "PATCH", path: "/api/v1/projects/:projectId" },
  { method: "POST", path: "/api/v1/projects/:projectId/clone" },
  { method: "POST", path: "/api/v1/projects/:projectId/export" },
  { method: "POST", path: "/api/v1/projects/import" },
  { method: "POST", path: "/api/v1/projects/:projectId/trash" },
  { method: "GET", path: "/api/v1/recycle-bin/projects" },
  { method: "GET", path: "/api/v1/recycle-bin/projects/:projectId" },
  { method: "POST", path: "/api/v1/recycle-bin/projects/:projectId/restore" },
  {
    method: "POST",
    path: "/api/v1/recycle-bin/projects/:projectId/purge-plan",
  },
  { method: "DELETE", path: "/api/v1/recycle-bin/projects/:projectId" },
  { method: "POST", path: "/api/v1/recycle-bin/projects/batch-restore" },
  { method: "POST", path: "/api/v1/recycle-bin/projects/batch-purge" },
]);

export const CANONICAL_LIFECYCLE_STATUSES = Object.freeze([
  "ACTIVE",
  "TRASHING",
  "TRASHED",
  "RESTORING",
  "PURGING",
  "PURGE_FAILED",
  "PURGED",
]);

export const REQUIRED_LIFECYCLE_TRANSITIONS = Object.freeze([
  ["ACTIVE", "TRASHING"],
  ["TRASHING", "TRASHED"],
  ["TRASHING", "ACTIVE"],
  ["TRASHED", "RESTORING"],
  ["RESTORING", "ACTIVE"],
  ["RESTORING", "TRASHED"],
  ["TRASHED", "PURGING"],
  ["PURGING", "PURGED"],
  ["PURGING", "PURGE_FAILED"],
  ["PURGE_FAILED", "PURGING"],
]);

export const REQUIRED_METADATA_TABLES = Object.freeze({
  projects: [
    "id",
    "name",
    "slug",
    "description",
    "lifecycle_status",
    "lifecycle_revision",
    "schema_version",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
    "deleted_by",
    "deleted_reason",
    "original_storage_path",
    "current_storage_path",
    "purge_eligible_at",
    "tombstone_checksum",
  ],
  audit_logs: [
    "id",
    "user_id",
    "project_id",
    "action",
    "object_type",
    "object_id",
    "before_json",
    "after_json",
    "correlation_id",
    "created_at",
  ],
  project_lifecycle_operations: [
    "id",
    "project_id",
    "operation_type",
    "from_status",
    "to_status",
    "idempotency_key",
    "request_hash",
    "storage_from",
    "storage_to",
    "status",
    "response_status",
    "response_json",
    "error_json",
    "started_at",
    "completed_at",
  ],
  lifecycle_outbox: [
    "id",
    "project_id",
    "operation_id",
    "event_type",
    "payload_json",
    "status",
    "attempt_count",
    "next_attempt_at",
    "created_at",
    "completed_at",
  ],
  trash_manifests: [
    "project_id",
    "operation_id",
    "original_slug",
    "original_storage_path",
    "trash_storage_path",
    "project_checksum",
    "test_db_checksum",
    "production_db_checksum",
    "asset_count",
    "deleted_at",
    "manifest_json",
  ],
});

export const PHASE3_EVIDENCE_PATH =
  "artifacts/phase3/project-lifecycle-validation.json";

export const REQUIRED_PHASE3_TEST_CAPABILITIES = Object.freeze([
  "lifecycle-state-machine",
  "canonical-api-contract",
  "idempotency-replay-and-conflict",
  "restart-trash-restore-checksum",
  "purge-failure-compensation",
  "active-trash-mutual-exclusion",
  "real-api-component-persistence",
  "trash-versus-purge-safety-ui",
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".sql",
  ".ts",
  ".tsx",
]);

function repositoryPath(repositoryRoot, absolutePath) {
  return relative(repositoryRoot, absolutePath).split(sep).join("/");
}

async function collectFiles(repositoryRoot, roots, predicate = () => true) {
  const files = [];

  async function visit(absolutePath) {
    let entries;
    try {
      entries = await readdir(absolutePath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (
        entry.name === "dist" ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      ) {
        continue;
      }
      const child = resolve(absolutePath, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile()) {
        const path = repositoryPath(repositoryRoot, child);
        if (predicate(path)) {
          files.push({ path, source: await readFile(child, "utf8") });
        }
      }
    }
  }

  for (const root of roots) {
    await visit(resolve(repositoryRoot, root));
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function combinedSource(files) {
  return files
    .map(({ path, source }) => `\n/* ${path} */\n${source}`)
    .join("\n");
}

function uniqueBy(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

export function routeKey(route) {
  return `${route.method.toUpperCase()} ${route.path}`;
}

function normalizedRoutePath(path) {
  const withoutQuery = path.split("?")[0] ?? path;
  const normalizedParameters = withoutQuery.replace(
    /\$\{[^}]*projectId[^}]*\}/giu,
    ":projectId",
  );
  return normalizedParameters.length > 1
    ? normalizedParameters.replace(/\/+$/u, "")
    : normalizedParameters;
}

export function extractRouteInventory(source) {
  const routes = [];
  const directRoute =
    /\.\s*(get|post|patch|delete)\s*(?:<[^;]{0,2500}>\s*)?\(\s*(["'`])([^"'`]+)\2/giu;
  for (const match of source.matchAll(directRoute)) {
    routes.push({
      method: (match[1] ?? "").toUpperCase(),
      path: normalizedRoutePath(match[3] ?? ""),
    });
  }

  const routeObject = /\.route\s*\(\s*\{(?<body>[\s\S]{0,5000}?)\}\s*\)/giu;
  for (const match of source.matchAll(routeObject)) {
    const body = match.groups?.body ?? "";
    const method = /\bmethod\s*:\s*(["'])(GET|POST|PATCH|DELETE)\1/iu.exec(
      body,
    )?.[2];
    const path = /\b(?:url|path)\s*:\s*(["'`])([^"'`]+)\1/iu.exec(body)?.[2];
    if (method && path) {
      routes.push({
        method: method.toUpperCase(),
        path: normalizedRoutePath(path),
      });
    }
  }

  // Route inventories are often declared as data and registered in a loop.
  const routeDescriptor =
    /\bmethod\s*:\s*(["'])(GET|POST|PATCH|DELETE)\1[^{}]{0,500}?\b(?:url|path)\s*:\s*(["'`])([^"'`]+)\3/giu;
  for (const match of source.matchAll(routeDescriptor)) {
    routes.push({
      method: (match[2] ?? "").toUpperCase(),
      path: normalizedRoutePath(match[4] ?? ""),
    });
  }

  const reversedRouteDescriptor =
    /\b(?:url|path)\s*:\s*(["'`])([^"'`]+)\1[^{}]{0,500}?\bmethod\s*:\s*(["'])(GET|POST|PATCH|DELETE)\3/giu;
  for (const match of source.matchAll(reversedRouteDescriptor)) {
    routes.push({
      method: (match[4] ?? "").toUpperCase(),
      path: normalizedRoutePath(match[2] ?? ""),
    });
  }

  return uniqueBy(routes, routeKey).sort((left, right) =>
    routeKey(left).localeCompare(routeKey(right)),
  );
}

export function inspectCanonicalRouteContract(files) {
  const source = combinedSource(files);
  const extractedRoutes = uniqueBy(
    files.flatMap(({ source }) => extractRouteInventory(source)),
    routeKey,
  );
  const prefixes = [
    ...source.matchAll(/\bprefix\s*:\s*(["'`])(\/api\/v1\/?)["'`]\s*[,}]/giu),
  ].map((match) => (match[2] ?? "").replace(/\/$/u, ""));
  const prefixedRoutes = extractedRoutes.flatMap((route) => {
    if (
      route.path.startsWith("/api/") ||
      !/^\/(?:projects|recycle-bin\/projects)(?:\/|$)/u.test(route.path)
    ) {
      return [];
    }
    return prefixes.map((prefix) => ({
      method: route.method,
      path: `${prefix}${route.path}`,
    }));
  });
  const actualRoutes = uniqueBy(
    [...extractedRoutes, ...prefixedRoutes],
    routeKey,
  ).sort((left, right) => routeKey(left).localeCompare(routeKey(right)));
  const actualKeys = new Set(actualRoutes.map(routeKey));
  const missingRoutes = CANONICAL_PHASE3_ROUTES.filter(
    (route) => !actualKeys.has(routeKey(route)),
  );
  const lifecycleRoutes = actualRoutes.filter((route) =>
    /(?:projects|recycle-bin)/u.test(route.path),
  );
  const unversionedLifecycleRoutes = lifecycleRoutes.filter(
    (route) =>
      !route.path.startsWith("/api/v1/") &&
      !prefixes.some((prefix) =>
        actualKeys.has(routeKey({ ...route, path: `${prefix}${route.path}` })),
      ),
  );
  const forbiddenActiveDeleteRoutes = actualRoutes.filter(
    (route) =>
      route.method === "DELETE" &&
      /^\/api\/v1\/projects(?:\/|$)/u.test(route.path),
  );

  return {
    actualRoutes,
    missingRoutes,
    unversionedLifecycleRoutes,
    forbiddenActiveDeleteRoutes,
  };
}

function extractCreateTableBlock(source, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+["'\\x60\\[]?${escaped}["'\\x60\\]]?\\s*\\((?<body>[\\s\\S]*?)\\)\\s*;`,
    "iu",
  );
  return pattern.exec(source)?.groups?.body ?? "";
}

function extractAlterTableStatements(source, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `alter\\s+table\\s+["'\\x60\\[]?${escaped}["'\\x60\\]]?\\s+add\\s+(?:column\\s+)?[^;]+;`,
    "giu",
  );
  return [...source.matchAll(pattern)].map((match) => match[0] ?? "");
}

export function inspectMetadataSchema(source) {
  const lowerSource = source.toLowerCase();
  const tables = Object.fromEntries(
    Object.entries(REQUIRED_METADATA_TABLES).map(([tableName, columns]) => {
      const block = extractCreateTableBlock(source, tableName);
      const alters = extractAlterTableStatements(source, tableName);
      const effectiveDefinition = `${block}\n${alters.join("\n")}`;
      const normalizedDefinition = effectiveDefinition.toLowerCase();
      return [
        tableName,
        {
          present: block.length > 0,
          missingColumns: columns.filter(
            (column) =>
              !new RegExp(`\\b${column}\\b`, "u").test(normalizedDefinition),
          ),
          block: effectiveDefinition,
        },
      ];
    }),
  );
  const projectBlock = tables.projects?.block ?? "";
  const operationBlock = tables.project_lifecycle_operations?.block ?? "";
  const projectConstraintSource = `${projectBlock.toLowerCase()}\n${lowerSource.match(/create\s+(?:unique\s+)?index[^;]+projects[^;]*;/giu)?.join("\n") ?? ""}`;
  const operationConstraintSource = `${operationBlock.toLowerCase()}\n${lowerSource.match(/create\s+(?:unique\s+)?index[^;]+project_lifecycle_operations[^;]*;/giu)?.join("\n") ?? ""}`;

  return {
    tables,
    enablesForeignKeys:
      /pragma\s+foreign_keys\s*=\s*on/iu.test(source) ||
      /\.pragma\s*\(\s*["'`]foreign_keys\s*=\s*on["'`]/iu.test(source),
    runsMetadataIntegrityCheck:
      /pragma\s+(?:quick_check|integrity_check)/iu.test(source) ||
      /\.pragma\s*\(\s*["'`](?:quick_check|integrity_check)["'`]/iu.test(
        source,
      ),
    projectsPrimaryKey:
      /\bid\b[^,\n]*\bprimary\s+key\b/iu.test(projectBlock) ||
      /\bprimary\s+key\s*\(\s*id\s*\)/iu.test(projectBlock),
    lifecycleStatusConstraint:
      CANONICAL_LIFECYCLE_STATUSES.every((status) =>
        projectConstraintSource.includes(status.toLowerCase()),
      ) ||
      (/check\s*\(\s*lifecycle_status\s+in\s*\(\s*\$\{\s*lifecycleSqlValues\s*\}\s*\)\s*\)/iu.test(
        projectBlock,
      ) &&
        /PROJECT_LIFECYCLE_STATUSES\.map\s*\(/u.test(source)),
    lifecycleStatusIndex:
      /create\s+(?:unique\s+)?index[^;]*\blifecycle_status\b/iu.test(
        lowerSource,
      ),
    slugIndex: /create\s+(?:unique\s+)?index[^;]*\bslug\b/iu.test(lowerSource),
    deletedAtIndex: /create\s+(?:unique\s+)?index[^;]*\bdeleted_at\b/iu.test(
      lowerSource,
    ),
    operationTypeConstraint: ["TRASH", "RESTORE", "PURGE"].every((value) =>
      operationConstraintSource.includes(value.toLowerCase()),
    ),
    idempotencyUniqueConstraint:
      /unique[\s\S]{0,250}\bidempotency_key\b|idempotency_key[\s\S]{0,250}\bunique\b/iu.test(
        operationConstraintSource,
      ),
    forbidsProjectRowDeletion: !/delete\s+from\s+["'`[]?projects\b/iu.test(
      source,
    ),
  };
}

export function inspectLifecycleProtocol(files) {
  const source = combinedSource(files);
  const statuses = CANONICAL_LIFECYCLE_STATUSES.filter((status) =>
    new RegExp(`["'\\x60]${status}["'\\x60]`, "u").test(source),
  );
  const transitions = REQUIRED_LIFECYCLE_TRANSITIONS.filter(([from, to]) => {
    const explicitPair = new RegExp(
      `["'\\x60]${from}["'\\x60][\\s\\S]{0,180}["'\\x60]${to}["'\\x60]`,
      "u",
    );
    return explicitPair.test(source);
  });
  const idempotencyOccurrences =
    source.match(/idempotency_?key/giu)?.length ?? 0;

  return {
    statuses,
    transitions,
    hasExpectedRevision: /expected_?revision/iu.test(source),
    hasExpectedLifecycleRevision: /expected_?lifecycle_?revision/iu.test(
      source,
    ),
    rejectsRevisionConflict:
      /(?:409|conflict)[\s\S]{0,300}(?:revision|lifecycle)|(?:revision|lifecycle)[\s\S]{0,300}(?:409|conflict)/iu.test(
        source,
      ),
    hasIdempotencyContract: idempotencyOccurrences >= 4,
    hasRequestHash: /request_?hash/iu.test(source),
    persistsReplayResponse:
      /response_?(?:json|status)|stored_?response|replay_?response/iu.test(
        source,
      ),
    readsIdempotencyRecord:
      /select[\s\S]{0,500}project_lifecycle_operations[\s\S]{0,500}idempotency_key|project_lifecycle_operations[\s\S]{0,500}(?:find|select|get)[\s\S]{0,500}idempotency/iu.test(
        source,
      ),
    rejectsKeyPayloadMismatch:
      /(?:request_?hash|payload)[\s\S]{0,300}(?:mismatch|different|conflict|409)|(?:mismatch|different|conflict|409)[\s\S]{0,300}(?:request_?hash|payload)/iu.test(
        source,
      ),
    writesOperationJournal:
      /insert\s+into\s+["'`[]?project_lifecycle_operations\b/iu.test(source),
    readsIncompleteJournal:
      /select[\s\S]{0,600}project_lifecycle_operations[\s\S]{0,500}(?:pending|started|in_progress|trashing|restoring|purging|purge_failed)/iu.test(
        source,
      ),
    writesOutbox: /insert\s+into\s+["'`[]?lifecycle_outbox\b/iu.test(source),
    writesAudit: /insert\s+into\s+["'`[]?audit_logs\b/iu.test(source),
    listsOnlyActiveProjects:
      /from\s+projects[\s\S]{0,500}where\s+lifecycle_status\s*=\s*["']ACTIVE["']/iu.test(
        source,
      ),
    listsOnlyRecycleBinProjects:
      /from\s+projects[\s\S]{0,500}where\s+lifecycle_status\s+in\s*\([^)]*["']TRASHED["'][^)]*["']PURGE_FAILED["'][^)]*\)/iu.test(
        source,
      ),
    hasPurgePlanBinding:
      /purge_?plan/iu.test(source) &&
      /(?:project_?checksum|checksum)/iu.test(source) &&
      /(?:expires|expiration|ttl)/iu.test(source) &&
      /(?:typed_?confirmation|project_?name|confirmation_?phrase)/iu.test(
        source,
      ),
    idempotencyOccurrences,
  };
}

export function inspectStorageAndRecovery(files) {
  const source = combinedSource(files);
  const constructorRunsRecovery = files.some(({ source: fileSource }) =>
    /constructor\s*\([^)]*\)\s*\{[\s\S]{0,1800}(?:this\.)?recover\w*(?:Lifecycle|Operation)\w*\s*\(/iu.test(
      fileSource,
    ),
  );
  const applicationInstantiatesRecoveryService = files.some(
    ({ path, source: fileSource }) =>
      /(?:^|\/)(?:app|main|server|bootstrap)\.[^.]+$/u.test(path) &&
      /new\s+ProjectService\s*\(/u.test(fileSource),
  );
  return {
    declaresSeparateRoots:
      /active_?root|active_?storage|data[\\/]active/iu.test(source) &&
      /trash_?root|trash_?storage|data[\\/]trash/iu.test(source),
    usesAtomicRename:
      /(?:from\s+["']node:fs(?:\/promises)?["'][\s\S]{0,500}\brename(?:Sync)?\b|\b(?:fs\.)?rename(?:Sync)?\s*\()/iu.test(
        source,
      ),
    computesSha256: /createHash\s*\(\s*["']sha256["']\s*\)|\bsha256\b/iu.test(
      source,
    ),
    buildsDeterministicManifest:
      /manifest/iu.test(source) &&
      /checksum/iu.test(source) &&
      /\.sort\s*\(/u.test(source),
    rejectsSymbolicLinks:
      /isSymbolicLink\s*\(|symlink[\s_-]*(?:reject|forbid|error)|reject[\s\S]{0,100}symlink/iu.test(
        source,
      ),
    checksPathTraversal:
      /(?:path_?traversal|\.\.[\\/]|relative\s*\(|startsWith\s*\()[\s\S]{0,250}(?:throw|reject|forbid|invalid)/iu.test(
        source,
      ) ||
      /function\s+assert(?:SafeRelativePath|Within)[\s\S]{0,1400}(?:relative\s*\(|segment\s*!==?\s*["']\.\.["'])[^}]{0,900}assertApi\s*\(/iu.test(
        source,
      ),
    checksRuntimeDatabases:
      /(?:integrity_check|quick_check)/iu.test(source) &&
      /(?:test_?db|test\.sqlite|production_?db|production\.sqlite)/iu.test(
        source,
      ),
    verifiesRestoreChecksum:
      /restore[\s\S]{0,1200}checksum|checksum[\s\S]{0,1200}restore/iu.test(
        source,
      ),
    assertsActiveTrashExclusion:
      /(?:active[\s\S]{0,500}trash|trash[\s\S]{0,500}active)[\s\S]{0,300}(?:both|simultaneous|invariant|conflict|exclusive|already exists)/iu.test(
        source,
      ),
    hasStartupRecovery:
      /(?:startup|start|boot|ready|buildApp|createApp)[\s\S]{0,1000}recover[\w\s]*(?:lifecycle|operation)|recover[\w\s]*(?:lifecycle|operation)[\s\S]{0,1000}(?:startup|start|boot|ready|buildApp|createApp)/iu.test(
        source,
      ) ||
      (constructorRunsRecovery && applicationInstantiatesRecoveryService),
    hasResumeOrCompensation:
      /resume|compensat(?:e|ion)|rollback[\s_-]*(?:move|lifecycle)|recover[\s_-]*(?:move|operation)/iu.test(
        source,
      ),
    hasFailureInjection:
      /fault_?inject|failure_?inject|fail_?point|inject(?:ed|ion)?[\s_-]*(?:failure|fault)|simulate[\s_-]*(?:failure|crash)/iu.test(
        source,
      ),
  };
}

export function inspectDestructiveSafety(files) {
  const routeInspection = inspectCanonicalRouteContract(files);
  const source = combinedSource(files);
  const hasGlobalPurgeGuard =
    /purge[\s\S]{0,2200}(?:lifecycle_?status|status)[\s\S]{0,500}(?:TRASHED|PURGE_FAILED)|(?:TRASHED|PURGE_FAILED)[\s\S]{0,500}(?:lifecycle_?status|status)[\s\S]{0,2200}purge/iu.test(
      source,
    );
  const forbiddenProjectDeletes = [];
  const unsafeFilesystemDeletes = [];

  for (const file of files) {
    if (/delete\s+from\s+["'`[]?projects\b/iu.test(file.source)) {
      forbiddenProjectDeletes.push(file.path);
    }
    const hasFilesystemDelete =
      /\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/u.test(
        file.source,
      );
    if (!hasFilesystemDelete) {
      continue;
    }
    const isPurgeScoped =
      /purge/iu.test(`${file.path}\n${file.source}`) &&
      (hasGlobalPurgeGuard || /TRASHED|PURGE_FAILED/u.test(file.source)) &&
      !routeInspection.forbiddenActiveDeleteRoutes.some((route) =>
        file.source.includes(route.path),
      );
    const filesystemDeleteTargets = [
      ...file.source.matchAll(
        /\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(\s*([^,\n)]+)/gu,
      ),
    ].map((match) => match[1].trim());
    const isScopedTransientCleanup =
      filesystemDeleteTargets.length > 0 &&
      filesystemDeleteTargets.every((target) =>
        /^(?:stagingPath|backupPath|verificationMarkerPath|journalPath|temporaryPath)$/u.test(
          target,
        ),
      ) &&
      /assertWithin|#runtimePath|same-directory staging/u.test(file.source);
    if (!isPurgeScoped && !isScopedTransientCleanup) {
      unsafeFilesystemDeletes.push(file.path);
    }
  }

  return {
    forbiddenActiveDeleteRoutes: routeInspection.forbiddenActiveDeleteRoutes,
    forbiddenProjectDeletes: [...new Set(forbiddenProjectDeletes)].sort(),
    unsafeFilesystemDeletes: [...new Set(unsafeFilesystemDeletes)].sort(),
    hasGlobalPurgeGuard,
  };
}

export function inspectFrontendPersistence(files) {
  const source = combinedSource(files);
  const apiSource = source.replace(/\s+/gu, " ");
  const hardcodedInitialProjects = [
    ...source.matchAll(
      /\b(?:const|let|var)\s+(?<name>initialProjects|mockProjects|sampleProjects|projectFixtures)\b/giu,
    ),
  ].map((match) => match.groups?.name ?? match[0]);
  const hasNetworkClient =
    /\bfetch\s*\(|\baxios\b|\bky\s*\(|\bapiClient\b|\brequestJson\b/iu.test(
      source,
    );
  const hasLocalProjectMutation =
    /setProjects\s*\(|projects\s*=\s*projects\.(?:filter|map)|localStorage\.setItem\s*\([^)]*project/iu.test(
      source,
    );

  return {
    hasNetworkClient,
    readsActiveProjects:
      apiSource.includes("/api/v1/projects") && hasNetworkClient,
    readsRecycleBin:
      apiSource.includes("/api/v1/recycle-bin/projects") && hasNetworkClient,
    callsTrashEndpoint:
      /\/api\/v1\/projects\/[^\s"'`]*\$?\{?[^\s"'`]*\}?\/trash|\/api\/v1\/projects\/:projectId\/trash/iu.test(
        source,
      ) ||
      (apiSource.includes("/api/v1/projects") &&
        /trashProject|projectTrash|softDeleteProject/iu.test(source)),
    callsRestoreEndpoint:
      /\/api\/v1\/recycle-bin\/projects[\s\S]{0,300}restore|restoreProject[\s\S]{0,300}\/api\/v1\/recycle-bin\/projects/iu.test(
        source,
      ),
    callsPurgePlan:
      /\/api\/v1\/recycle-bin\/projects[\s\S]{0,300}purge-plan|createPurgePlan|requestPurgePlan/iu.test(
        source,
      ),
    purgesThroughRecycleBinDelete:
      /method\s*:\s*["']DELETE["'][\s\S]{0,500}\/api\/v1\/recycle-bin\/projects|\/api\/v1\/recycle-bin\/projects[\s\S]{0,500}method\s*:\s*["']DELETE["']/iu.test(
        source,
      ),
    neverDeletesActiveEndpoint:
      !/(?:fetch|requestJson|request)\s*(?:<[^>]+>)?\(\s*(["'`])\/api\/v1\/projects\/(?![^"'`]*\/(?:trash|schema(?:\/|$)|relations(?:\/|$)))[^"'`]*\1\s*,\s*\{[^}]{0,240}method\s*:\s*["']DELETE["']/iu.test(
        source,
      ),
    hasImpactConfirmation:
      /(?:impact|영향)[\s\S]{0,700}(?:trash|휴지통)|(?:trash|휴지통)[\s\S]{0,700}(?:impact|영향)/iu.test(
        source,
      ),
    hasTypedPurgeConfirmation:
      /typedConfirmation|confirmationPhrase|confirmProjectName|프로젝트\s*이름[\s\S]{0,300}(?:입력|확인)/iu.test(
        source,
      ),
    distinguishesTrashAndPurge:
      /(?:trash|휴지통)/iu.test(source) &&
      /(?:purge|영구\s*삭제)/iu.test(source) &&
      /(?:recycle|휴지통)/iu.test(source),
    hardcodedInitialProjects,
    mockOnlyPersistence:
      hardcodedInitialProjects.length > 0 ||
      (hasLocalProjectMutation && !hasNetworkClient),
  };
}

export function inspectTestInventory(files) {
  const source = combinedSource(files);
  const paths = files.map(({ path }) => path);
  const domainTestFiles = files.filter(({ path }) =>
    /packages\/domain\//u.test(path),
  );
  const serverIntegrationFiles = files.filter(({ path }) =>
    /apps\/server\/test\/integration\//u.test(path),
  );
  const webComponentFiles = files.filter(
    ({ path }) =>
      /apps\/web\//u.test(path) && /\.(?:test|spec)\.[^.]+$/u.test(path),
  );
  const someFileMatches = (candidateFiles, patterns) =>
    candidateFiles.some(({ source: fileSource }) =>
      patterns.every((pattern) => pattern.test(fileSource)),
    );
  const skippedTests = [
    ...source.matchAll(
      /\b(?:describe|it|test)\.skip\s*\(|\b(?:xit|xdescribe)\s*\(|\.todo\s*\(/gu,
    ),
  ].map((match) => match[0]);
  const capabilities = {
    "lifecycle-state-machine": someFileMatches(domainTestFiles, [
      /ACTIVE[\s\S]{0,1000}TRASHING[\s\S]{0,1000}TRASHED/iu,
      /PURGE_FAILED/iu,
    ]),
    "canonical-api-contract": someFileMatches(serverIntegrationFiles, [
      /\/api\/v1\/projects/iu,
      /\/api\/v1\/recycle-bin\/projects/iu,
      /trash/iu,
      /restore/iu,
      /purge/iu,
    ]),
    "idempotency-replay-and-conflict": someFileMatches(serverIntegrationFiles, [
      /idempotency/iu,
      /(?:replay|same\s+(?:key|response)|payload\s+(?:mismatch|conflict)|409)/iu,
    ]),
    "restart-trash-restore-checksum": someFileMatches(serverIntegrationFiles, [
      /(?:restart|reopen|close[\s\S]{0,240}(?:open|buildServer)|server\s+restart)/iu,
      /trash/iu,
      /restore/iu,
      /checksum|sha-?256|file\s+bytes/iu,
    ]),
    "purge-failure-compensation": someFileMatches(serverIntegrationFiles, [
      /purge/iu,
      /(?:failure|fault|throw|inject)/iu,
      /(?:compensat|recover|retry|PURGE_FAILED)/iu,
    ]),
    "active-trash-mutual-exclusion": someFileMatches(serverIntegrationFiles, [
      /active/iu,
      /trash/iu,
      /(?:both|simultaneous|mutual|exclusive|never|dual(?:[-_\s]*(?:location|residence))?|not[\s\S]{0,80}same)/iu,
    ]),
    "real-api-component-persistence": someFileMatches(webComponentFiles, [
      /(?:render|userEvent|screen\.)/iu,
      /\/api\/v1\/projects|fetch|request/iu,
      /(?:reload|rerender|refresh|server)/iu,
    ]),
    "trash-versus-purge-safety-ui": someFileMatches(webComponentFiles, [
      /(?:alertdialog|dialog|confirmation)/iu,
      /trash|휴지통/iu,
      /purge|영구\s*삭제/iu,
    ]),
  };

  return {
    paths,
    capabilities,
    skippedTests,
    hasDomainLifecycleTest: domainTestFiles.some(
      ({ path, source: fileSource }) =>
        /packages\/domain\/(?:test|src\/.*\.(?:test|spec))\//u.test(path) &&
        /lifecycle|TRASHING|PURGE_FAILED/iu.test(fileSource),
    ),
    hasServerLifecycleIntegrationTest: someFileMatches(serverIntegrationFiles, [
      /trash/iu,
      /restore/iu,
      /purge/iu,
    ]),
    hasWebLifecycleComponentTest: webComponentFiles.some(
      ({ path, source: fileSource }) =>
        /\.(?:test|spec)\.[^.]+$/u.test(path) &&
        /trash|recycle|purge|휴지통|영구\s*삭제/iu.test(fileSource),
    ),
  };
}

async function inspectGovernance(repositoryRoot, validation) {
  let traceability = { requirements: [] };
  try {
    traceability = JSON.parse(
      await readFile(
        resolve(repositoryRoot, "docs/requirement-traceability.json"),
        "utf8",
      ),
    );
  } catch (error) {
    validation.check(false, "Phase 3 traceability JSON can be read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const requirements = Object.fromEntries(
    (traceability.requirements ?? []).map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );
  for (const id of ["REQ-033", "REQ-034", "REQ-035", "REQ-036"]) {
    const requirement = requirements[id];
    validation.check(Boolean(requirement), `${id} is present in traceability`);
    if (!requirement) {
      continue;
    }
    validation.check(
      Array.isArray(requirement.implementation) &&
        requirement.implementation.length > 0,
      `${id} references Phase 3 implementation`,
    );
    validation.check(
      Array.isArray(requirement.tests) &&
        requirement.tests.includes("scripts/verify-phase3.mjs"),
      `${id} references scripts/verify-phase3.mjs`,
    );
    validation.check(
      Array.isArray(requirement.evidence) &&
        requirement.evidence.includes(PHASE3_EVIDENCE_PATH),
      `${id} references ${PHASE3_EVIDENCE_PATH}`,
    );
  }

  return { requirements: Object.values(requirements) };
}

export async function validatePhase3({
  repositoryRoot = REPOSITORY_ROOT,
  includeGovernance = true,
} = {}) {
  const validation = new Validation(
    "Phase 3 persistent project lifecycle foundation",
  );
  const sourcePredicate = (path) =>
    SOURCE_EXTENSIONS.has(extname(path)) &&
    !/\.(?:test|spec)\.[^.]+$/u.test(path) &&
    !/(?:^|\/)test(?:s)?\//u.test(path);
  const serverFiles = await collectFiles(
    repositoryRoot,
    ["apps/server/src"],
    sourcePredicate,
  );
  const domainFiles = await collectFiles(
    repositoryRoot,
    ["packages/domain/src"],
    sourcePredicate,
  );
  const webFiles = await collectFiles(
    repositoryRoot,
    ["apps/web/src"],
    sourcePredicate,
  );
  const testFiles = await collectFiles(
    repositoryRoot,
    ["apps/server/test", "packages/domain/test", "apps/web/src"],
    (path) =>
      SOURCE_EXTENSIONS.has(extname(path)) &&
      (/\.(?:test|spec)\.[^.]+$/u.test(path) ||
        /(?:^|\/)test(?:s)?\//u.test(path)),
  );

  validation.check(serverFiles.length > 0, "server source can be inspected");
  validation.check(domainFiles.length > 0, "domain source can be inspected");
  validation.check(webFiles.length > 0, "web source can be inspected");

  const routeInspection = inspectCanonicalRouteContract(serverFiles);
  validation.check(
    routeInspection.missingRoutes.length === 0,
    "all canonical Phase 3 /api/v1 routes are registered",
    { missing: routeInspection.missingRoutes.map(routeKey) },
  );
  validation.check(
    routeInspection.unversionedLifecycleRoutes.length === 0,
    "no unversioned Project lifecycle routes are registered",
    { routes: routeInspection.unversionedLifecycleRoutes.map(routeKey) },
  );
  validation.check(
    routeInspection.forbiddenActiveDeleteRoutes.length === 0,
    "active Project routes never expose physical DELETE",
    { routes: routeInspection.forbiddenActiveDeleteRoutes.map(routeKey) },
  );

  const lifecycleInspection = inspectLifecycleProtocol([
    ...domainFiles,
    ...serverFiles,
  ]);
  validation.check(
    lifecycleInspection.statuses.length === CANONICAL_LIFECYCLE_STATUSES.length,
    "all seven canonical lifecycle statuses are explicit",
    {
      expected: CANONICAL_LIFECYCLE_STATUSES,
      actual: lifecycleInspection.statuses,
    },
  );
  validation.check(
    lifecycleInspection.transitions.length ===
      REQUIRED_LIFECYCLE_TRANSITIONS.length,
    "normal, compensation, and retry lifecycle transitions are explicit",
    {
      missing: REQUIRED_LIFECYCLE_TRANSITIONS.filter(
        ([from, to]) =>
          !lifecycleInspection.transitions.some(
            ([actualFrom, actualTo]) => actualFrom === from && actualTo === to,
          ),
      ).map(([from, to]) => `${from}->${to}`),
    },
  );
  for (const [property, message] of [
    ["hasExpectedRevision", "definition revision is checked"],
    ["hasExpectedLifecycleRevision", "lifecycle revision is checked"],
    ["rejectsRevisionConflict", "revision conflicts return 409"],
    ["hasIdempotencyContract", "lifecycle commands require idempotency keys"],
    ["hasRequestHash", "idempotency records bind a request hash"],
    ["persistsReplayResponse", "idempotency records persist replay responses"],
    ["readsIdempotencyRecord", "idempotency records are read before execution"],
    [
      "rejectsKeyPayloadMismatch",
      "idempotency key payload mismatches conflict",
    ],
    ["writesOperationJournal", "lifecycle operation journal is written"],
    ["readsIncompleteJournal", "incomplete operation journals are recoverable"],
    ["writesOutbox", "lifecycle outbox events are persisted"],
    ["writesAudit", "lifecycle audit events are persisted"],
    [
      "listsOnlyActiveProjects",
      "active Project queries exclude non-active states",
    ],
    [
      "listsOnlyRecycleBinProjects",
      "Recycle Bin queries include only recoverable trashed states",
    ],
    [
      "hasPurgePlanBinding",
      "purge plans bind expiry, checksum, and confirmation",
    ],
  ]) {
    validation.check(lifecycleInspection[property], message);
  }

  const metadataInspection = inspectMetadataSchema(combinedSource(serverFiles));
  for (const [tableName, table] of Object.entries(metadataInspection.tables)) {
    validation.check(table.present, `metadata table ${tableName} exists`);
    validation.check(
      table.missingColumns.length === 0,
      `metadata table ${tableName} has every required column`,
      { missing: table.missingColumns },
    );
  }
  for (const [property, message] of [
    ["enablesForeignKeys", "SQLite foreign keys are enabled"],
    ["runsMetadataIntegrityCheck", "metadata SQLite integrity is checked"],
    ["projectsPrimaryKey", "Project IDs are primary keys and cannot be reused"],
    [
      "lifecycleStatusConstraint",
      "Project lifecycle status is CHECK constrained",
    ],
    ["lifecycleStatusIndex", "Project lifecycle status is indexed"],
    ["slugIndex", "Project slug is indexed"],
    ["deletedAtIndex", "Project deleted timestamp is indexed"],
    ["operationTypeConstraint", "journal operation type is CHECK constrained"],
    ["idempotencyUniqueConstraint", "journal idempotency key is unique"],
    ["forbidsProjectRowDeletion", "purge preserves the Project tombstone row"],
  ]) {
    validation.check(metadataInspection[property], message);
  }

  const storageInspection = inspectStorageAndRecovery(serverFiles);
  for (const [property, message] of [
    ["declaresSeparateRoots", "active and trash storage roots are separate"],
    ["usesAtomicRename", "storage lifecycle uses an atomic filesystem rename"],
    ["computesSha256", "storage manifests use SHA-256 checksums"],
    [
      "buildsDeterministicManifest",
      "storage manifests are sorted and deterministic",
    ],
    ["rejectsSymbolicLinks", "storage manifests reject symbolic links"],
    ["checksPathTraversal", "storage paths reject traversal"],
    [
      "checksRuntimeDatabases",
      "test and production runtime DB integrity is checked",
    ],
    ["verifiesRestoreChecksum", "restore verifies checksums"],
    [
      "assertsActiveTrashExclusion",
      "active and trash storage are mutually exclusive",
    ],
    [
      "hasStartupRecovery",
      "startup invokes lifecycle journal recovery before ready",
    ],
    [
      "hasResumeOrCompensation",
      "incomplete file operations resume or compensate",
    ],
    [
      "hasFailureInjection",
      "storage failure injection is implemented for tests",
    ],
  ]) {
    validation.check(storageInspection[property], message);
  }

  const destructiveInspection = inspectDestructiveSafety(serverFiles);
  validation.check(
    destructiveInspection.forbiddenActiveDeleteRoutes.length === 0,
    "physical purge is not reachable from active Project routes",
    destructiveInspection,
  );
  validation.check(
    destructiveInspection.forbiddenProjectDeletes.length === 0,
    "purge never deletes the Project tombstone row",
    destructiveInspection,
  );
  validation.check(
    destructiveInspection.unsafeFilesystemDeletes.length === 0,
    "filesystem deletion is scoped to a guarded recycle-bin purge",
    destructiveInspection,
  );

  const frontendInspection = inspectFrontendPersistence(webFiles);
  for (const [property, message] of [
    ["hasNetworkClient", "Project UI uses a real network API client"],
    ["readsActiveProjects", "Project UI reads active Projects from /api/v1"],
    ["readsRecycleBin", "Recycle Bin reads server-persisted Projects"],
    ["callsTrashEndpoint", "active Delete invokes the soft-trash endpoint"],
    ["callsRestoreEndpoint", "Recycle Bin invokes the restore endpoint"],
    ["callsPurgePlan", "Permanent Delete requests a purge plan first"],
    [
      "purgesThroughRecycleBinDelete",
      "Permanent Delete uses recycle-bin DELETE only",
    ],
    [
      "neverDeletesActiveEndpoint",
      "frontend never issues active Project DELETE",
    ],
    ["hasImpactConfirmation", "soft trash presents an impact confirmation"],
    ["hasTypedPurgeConfirmation", "purge requires typed Project confirmation"],
    ["distinguishesTrashAndPurge", "UI distinguishes soft trash from purge"],
  ]) {
    validation.check(frontendInspection[property], message);
  }
  validation.check(
    frontendInspection.hardcodedInitialProjects.length === 0,
    "frontend contains no hardcoded initial Project inventory",
    { declarations: frontendInspection.hardcodedInitialProjects },
  );
  validation.check(
    !frontendInspection.mockOnlyPersistence,
    "frontend persistence is not mock-only or in-memory-only",
  );

  const testInspection = inspectTestInventory(testFiles);
  validation.check(
    testInspection.skippedTests.length === 0,
    "Phase 3 test inventory has no skipped or TODO tests",
    { skipped: testInspection.skippedTests },
  );
  validation.check(
    testInspection.hasDomainLifecycleTest,
    "domain lifecycle state-machine tests exist",
  );
  validation.check(
    testInspection.hasServerLifecycleIntegrationTest,
    "server lifecycle integration tests exist",
  );
  validation.check(
    testInspection.hasWebLifecycleComponentTest,
    "web lifecycle component tests exist",
  );
  for (const capability of REQUIRED_PHASE3_TEST_CAPABILITIES) {
    validation.check(
      testInspection.capabilities[capability],
      `test inventory covers ${capability}`,
    );
  }

  const governance = includeGovernance
    ? await inspectGovernance(repositoryRoot, validation)
    : { requirements: [] };

  return validation.result({
    canonicalRouteCount: CANONICAL_PHASE3_ROUTES.length,
    registeredCanonicalRoutes:
      CANONICAL_PHASE3_ROUTES.length - routeInspection.missingRoutes.length,
    lifecycleStatusCount: lifecycleInspection.statuses.length,
    lifecycleTransitionCount: lifecycleInspection.transitions.length,
    metadataTableCount: Object.values(metadataInspection.tables).filter(
      (table) => table.present,
    ).length,
    serverSourceFiles: serverFiles.map(({ path }) => path),
    domainSourceFiles: domainFiles.map(({ path }) => path),
    webSourceFiles: webFiles.map(({ path }) => path),
    testFiles: testInspection.paths,
    routeInspection,
    lifecycleInspection,
    metadataInspection: {
      ...metadataInspection,
      tables: Object.fromEntries(
        Object.entries(metadataInspection.tables).map(([name, table]) => [
          name,
          { present: table.present, missingColumns: table.missingColumns },
        ]),
      ),
    },
    storageInspection,
    destructiveInspection,
    frontendInspection,
    testInventory: testInspection,
    governanceRequirementCount: governance.requirements.length,
    requiredEvidencePath: PHASE3_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE3_EVIDENCE_PATH, await validatePhase3());
  } catch (error) {
    await finishVerification(
      PHASE3_EVIDENCE_PATH,
      unexpectedFailure(
        "Phase 3 persistent project lifecycle foundation",
        error,
      ),
    );
  }
}
