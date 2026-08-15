import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase3 } from "./verify-phase3.mjs";

export const PHASE4_EVIDENCE_PATH =
  "artifacts/phase4/page-runtime-validation.json";

export const REQUIRED_PHASE4_REQUIREMENTS = Object.freeze([
  "REQ-008",
  "REQ-009",
  "REQ-010",
  "REQ-011",
  "REQ-020",
  "REQ-021",
  "REQ-022",
]);

export const CANONICAL_PHASE4_ROUTES = Object.freeze([
  { method: "GET", path: "/api/v1/projects/:projectId/pages" },
  { method: "POST", path: "/api/v1/projects/:projectId/pages" },
  { method: "PATCH", path: "/api/v1/pages/:pageId" },
  { method: "DELETE", path: "/api/v1/pages/:pageId" },
  { method: "POST", path: "/api/v1/projects/:projectId/pages/reorder" },
  { method: "PATCH", path: "/api/v1/pages/:pageId/icon" },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/pages/commands/:commandId/undo",
  },
  { method: "GET", path: "/api/v1/ui/icons" },
  { method: "GET", path: "/api/v1/ui/icons/:iconName" },
  { method: "POST", path: "/api/v1/projects/:projectId/publish/plan" },
  { method: "POST", path: "/api/v1/projects/:projectId/publish" },
  { method: "GET", path: "/api/v1/runtime/:projectId/navigation" },
]);

export const REQUIRED_PAGE_TABLES = Object.freeze({
  pages: [
    "id",
    "project_id",
    "schema_version",
    "revision",
    "name",
    "route",
    "page_type",
    "icon_name",
    "icon_catalog_version",
    "navigation_visible",
    "navigation_group",
    "sort_order",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  page_commands: [
    "id",
    "project_id",
    "page_id",
    "command_type",
    "snapshot_json",
    "impact_json",
    "created_at",
    "undone_at",
  ],
  project_definition_operations: [
    "id",
    "project_id",
    "operation_type",
    "idempotency_key",
    "request_hash",
    "response_status",
    "response_json",
    "created_at",
  ],
  project_versions: [
    "id",
    "project_id",
    "schema_version",
    "sequence",
    "source_project_revision",
    "snapshot_json",
    "published_at",
  ],
});

export const REQUIRED_PHASE4_TEST_CAPABILITIES = Object.freeze([
  "sqlite-active-route-and-order-constraints",
  "optimistic-revision-and-idempotency",
  "exact-atomic-reorder",
  "delete-impact-and-same-id-undo",
  "publish-blocks-all-hidden-navigation",
  "import-rejects-all-hidden-published-navigation",
  "immutable-publish-and-draft-isolation",
  "page-lifecycle-clone-export-import-trash-restore-purge",
  "real-page-api-persistence",
  "pointer-and-keyboard-dnd",
  "single-overlay-and-reduced-motion",
  "same-level-sibling-geometry",
  "double-click-inline-rename",
  "virtual-icon-picker-keyboard-and-fallback",
  "runtime-left-nav-history-collapse-drawer",
]);

export const REQUIRED_DYNAMIC_ICON_NAMES = Object.freeze([
  "file",
  "file-question",
  "grip-vertical",
  "house",
  "layout-dashboard",
  "trash-2",
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".css",
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
      if (error?.code === "ENOENT") return;
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

  for (const root of roots) await visit(resolve(repositoryRoot, root));
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

function normalizeRoutePath(path) {
  const withoutQuery = (path.split("?")[0] ?? path).replace(/\/+$/u, "");
  const parameterNames = ["projectId", "pageId", "commandId", "iconName"];
  const normalized = parameterNames.reduce(
    (value, name) =>
      value.replace(
        new RegExp(`\\$\\{[^}]*${name}[^}]*\\}`, "giu"),
        `:${name}`,
      ),
    withoutQuery,
  );
  return normalized || "/";
}

export function extractRouteInventory(source) {
  const routes = [];
  const directRoute =
    /\.\s*(get|post|patch|delete)\s*(?:<[\s\S]{0,5000}?>\s*)?\(\s*(["'`])([^"'`]+)\2/giu;
  for (const match of source.matchAll(directRoute)) {
    routes.push({
      method: (match[1] ?? "").toUpperCase(),
      path: normalizeRoutePath(match[3] ?? ""),
    });
  }

  const routeObject = /\.route\s*\(\s*\{(?<body>[\s\S]{0,7000}?)\}\s*\)/giu;
  for (const match of source.matchAll(routeObject)) {
    const body = match.groups?.body ?? "";
    const method = /\bmethod\s*:\s*(["'])(GET|POST|PATCH|DELETE)\1/iu.exec(
      body,
    )?.[2];
    const path = /\b(?:url|path)\s*:\s*(["'`])([^"'`]+)\1/iu.exec(body)?.[2];
    if (method && path) {
      routes.push({
        method: method.toUpperCase(),
        path: normalizeRoutePath(path),
      });
    }
  }

  const descriptors = [
    /\bmethod\s*:\s*(["'])(GET|POST|PATCH|DELETE)\1[^{}]{0,700}?\b(?:url|path)\s*:\s*(["'`])([^"'`]+)\3/giu,
    /\b(?:url|path)\s*:\s*(["'`])([^"'`]+)\1[^{}]{0,700}?\bmethod\s*:\s*(["'])(GET|POST|PATCH|DELETE)\3/giu,
  ];
  for (const [index, pattern] of descriptors.entries()) {
    for (const match of source.matchAll(pattern)) {
      routes.push(
        index === 0
          ? {
              method: (match[2] ?? "").toUpperCase(),
              path: normalizeRoutePath(match[4] ?? ""),
            }
          : {
              method: (match[4] ?? "").toUpperCase(),
              path: normalizeRoutePath(match[2] ?? ""),
            },
      );
    }
  }

  return uniqueBy(routes, routeKey).sort((left, right) =>
    routeKey(left).localeCompare(routeKey(right)),
  );
}

export function inspectCanonicalRouteContract(files) {
  const source = combinedSource(files);
  const extracted = uniqueBy(
    files.flatMap(({ source: fileSource }) =>
      extractRouteInventory(fileSource),
    ),
    routeKey,
  );
  const prefixes = [
    ...source.matchAll(/\bprefix\s*:\s*(["'`])(\/api\/v1\/?)["'`]\s*[,}]/giu),
  ].map((match) => (match[2] ?? "").replace(/\/$/u, ""));
  const prefixed = extracted.flatMap((route) => {
    if (
      route.path.startsWith("/api/") ||
      !/^\/(?:projects|pages|ui|runtime)(?:\/|$)/u.test(route.path)
    ) {
      return [];
    }
    return prefixes.map((prefix) => ({
      method: route.method,
      path: `${prefix}${route.path}`,
    }));
  });
  const actualRoutes = uniqueBy([...extracted, ...prefixed], routeKey).sort(
    (left, right) => routeKey(left).localeCompare(routeKey(right)),
  );
  const keys = new Set(actualRoutes.map(routeKey));
  const missingRoutes = CANONICAL_PHASE4_ROUTES.filter(
    (route) => !keys.has(routeKey(route)),
  );
  const unversionedRoutes = actualRoutes.filter(
    (route) =>
      /^\/(?:projects|pages|ui|runtime)(?:\/|$)/u.test(route.path) &&
      !prefixes.some((prefix) =>
        keys.has(routeKey({ ...route, path: `${prefix}${route.path}` })),
      ),
  );

  return { actualRoutes, missingRoutes, unversionedRoutes };
}

function extractCreateTableBlock(source, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return (
    new RegExp(
      `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+["'\\x60\\[]?${escaped}["'\\x60\\]]?\\s*\\((?<body>[\\s\\S]*?)\\)\\s*;`,
      "iu",
    ).exec(source)?.groups?.body ?? ""
  );
}

function tableInspection(source, tableName, requiredColumns) {
  const block = extractCreateTableBlock(source, tableName);
  const normalized = block.toLowerCase();
  return {
    present: block.length > 0,
    missingColumns: requiredColumns.filter(
      (column) => !new RegExp(`\\b${column}\\b`, "u").test(normalized),
    ),
    block,
  };
}

export function inspectPageSchema(source) {
  const tables = Object.fromEntries(
    Object.entries(REQUIRED_PAGE_TABLES).map(([name, columns]) => [
      name,
      tableInspection(source, name, columns),
    ]),
  );
  const pages = tables.pages.block;
  const commands = tables.page_commands.block;
  const operations = tables.project_definition_operations.block;
  const versions = tables.project_versions.block;

  return {
    tables,
    pagesProjectForeignKey:
      /project_id\s+[^,\n]*references\s+projects\s*\(\s*id\s*\)/iu.test(pages),
    pageRevisionConstraint:
      /revision\s+[^,\n]*check\s*\(\s*revision\s*>=\s*1\s*\)/iu.test(pages),
    pageNameConstraint:
      /name\s+[\s\S]{0,180}length\s*\(\s*trim\s*\(\s*name\s*\)\s*\)[\s\S]{0,100}(?:99|100)/iu.test(
        pages,
      ),
    pageRouteConstraint:
      /route\s+[\s\S]{0,260}substr\s*\(\s*route\s*,\s*1\s*,\s*1\s*\)\s*=\s*["']\/["']/iu.test(
        pages,
      ),
    pageTypeConstraint:
      /page_type\s+[^,\n]*check\s*\(\s*page_type\s*=\s*["']blank["']\s*\)/iu.test(
        pages,
      ),
    iconCatalogVersionConstraint:
      /icon_catalog_version\s+[^,\n]*check\s*\(\s*icon_catalog_version\s*=\s*["']1\.31\.0["']\s*\)/iu.test(
        pages,
      ),
    navigationVisibleConstraint:
      /navigation_visible\s+[\s\S]{0,140}check\s*\(\s*navigation_visible\s+in\s*\(\s*0\s*,\s*1\s*\)\s*\)/iu.test(
        pages,
      ),
    sortOrderConstraint:
      /sort_order\s+[^,\n]*check\s*\(\s*sort_order\s*>=\s*0\s*\)/iu.test(pages),
    activeRouteUniqueIndex:
      /create\s+unique\s+index[^;]*on\s+pages\s*\(\s*project_id\s*,\s*route\s+collate\s+nocase\s*\)[^;]*where\s+deleted_at\s+is\s+null/iu.test(
        source,
      ),
    activeOrderUniqueIndex:
      /create\s+unique\s+index[^;]*on\s+pages\s*\(\s*project_id\s*,\s*sort_order\s*\)[^;]*where\s+deleted_at\s+is\s+null/iu.test(
        source,
      ),
    deleteCommandOnly:
      /command_type\s+[^,\n]*check\s*\(\s*command_type\s*=\s*["']DELETE["']\s*\)/iu.test(
        commands,
      ),
    commandHasSnapshotAndImpact:
      /\bsnapshot_json\b/iu.test(commands) &&
      /\bimpact_json\b/iu.test(commands),
    idempotencyUniqueConstraint:
      /unique\s*\(\s*project_id\s*,\s*idempotency_key\s*\)/iu.test(operations),
    operationStoresRequestAndResponse:
      /\brequest_hash\b/iu.test(operations) &&
      /\bresponse_status\b/iu.test(operations) &&
      /\bresponse_json\b/iu.test(operations),
    publishSequenceUniqueConstraint:
      /unique\s*\(\s*project_id\s*,\s*sequence\s*\)/iu.test(versions),
    immutablePublishedVersions:
      /create\s+trigger[\s\S]{0,300}before\s+update\s+on\s+project_versions[\s\S]{0,300}raise\s*\(\s*abort/iu.test(
        source,
      ),
  };
}

function contextsFor(files, pattern, radius = 7000) {
  const contexts = [];
  for (const file of files) {
    const match = pattern.exec(file.source);
    pattern.lastIndex = 0;
    if (!match) continue;
    contexts.push(
      file.source.slice(
        Math.max(0, match.index - Math.floor(radius / 4)),
        Math.min(file.source.length, match.index + radius),
      ),
    );
  }
  return contexts.join("\n");
}

function forwardContextsFor(files, pattern, radius = 5000) {
  const contexts = [];
  for (const file of files) {
    const match = pattern.exec(file.source);
    pattern.lastIndex = 0;
    if (!match) continue;
    contexts.push(
      file.source.slice(
        match.index,
        Math.min(file.source.length, match.index + radius),
      ),
    );
  }
  return contexts.join("\n");
}

export function inspectPageProtocol(files) {
  const source = combinedSource(files);
  const reorder = contextsFor(
    files,
    /\breorderPages\s*\(|\breorder_pages\s*\(|\breorder\s*\(/iu,
    12000,
  );
  const runtime = forwardContextsFor(
    files,
    /\bruntimeNavigation\s*\(|\bgetRuntimeNavigation\s*\(|\breadPublishedNavigation\s*\(|\blatestPublished\s*\(/iu,
    5000,
  );
  const publish = contextsFor(
    files,
    /publishProject|createPublishedVersion|\bpublish\s*\(|insertVersion/iu,
    10000,
  );
  const publishPlan = forwardContextsFor(files, /\bpublishPlan\s*\(/iu, 3500);
  const importPublishedVersions = forwardContextsFor(
    files,
    /\bparseImportPublishedVersions\s*\(/iu,
    18000,
  );
  const publishedRepository = contextsFor(
    files,
    /latestVersion\s*\(|insertVersion\s*\(|toRuntimeNavigation\s*\(/iu,
    7000,
  );
  const idempotencyOccurrences =
    source.match(/idempotency_?key/giu)?.length ?? 0;

  return {
    hasPageExpectedRevision:
      /expected_?revision/iu.test(source) &&
      /page[\s\S]{0,1200}revision/iu.test(source),
    hasProjectExpectedRevision: /expected_?project_?revision/iu.test(source),
    rejectsRevisionConflict:
      /(?:409|conflict)[\s\S]{0,500}(?:expected|revision)|(?:expected|revision)[\s\S]{0,500}(?:409|conflict)/iu.test(
        source,
      ),
    hasIdempotencyContract: idempotencyOccurrences >= 5,
    hashesIdempotentRequest:
      /request_?hash/iu.test(source) && /sha-?256|createHash/iu.test(source),
    replaysStoredResponse:
      /(?:return|send|reply)[\s\S]{0,300}(?:existing(?:Operation)?|storedResponse)[\s\S]{0,300}response_?json|(?:existing(?:Operation)?|storedResponse)[\s\S]{0,300}response_?json[\s\S]{0,300}(?:return|send|reply)/iu.test(
        source,
      ),
    rejectsIdempotencyMismatch:
      /request_?hash[\s\S]{0,500}(?:conflict|mismatch|different)|(?:conflict|mismatch|different)[\s\S]{0,500}request_?hash/iu.test(
        source,
      ),
    exactReorderPermutation:
      /new\s+Set\s*\(\s*(?:(?:input|request)\.)?pageIds\s*\)/u.test(reorder) &&
      /(?:pageIds\.length|requestedIds\.size)[\s\S]{0,900}(?:activePages|existingPages|currentPages|currentIds|\bcurrent\b|activeIds)[\s\S]{0,900}(?:length|size)/iu.test(
        reorder,
      ) &&
      /(?:every|has|includes)[\s\S]{0,400}(?:pageIds|activeIds|requestedIds)/iu.test(
        reorder,
      ),
    atomicReorderTransaction:
      /(?:\.transaction\s*\(|begin\s+(?:immediate\s+)?transaction|\bBEGIN\b)/iu.test(
        reorder,
      ) && /update\s+pages[\s\S]{0,300}sort_order/iu.test(reorder),
    collisionSafeReorder:
      /(?:temporary|offset|negative|sort_order\s*=\s*sort_order\s*\+|sort_order[\s\S]{0,120}=\s*-)/iu.test(
        reorder,
      ),
    publishesSnapshotInTransaction:
      /(?:\.transaction\s*\(|\bBEGIN\b)/iu.test(publish) &&
      (/insert\s+into\s+project_versions/iu.test(publish) ||
        (/insertVersion\s*\(/u.test(publish) &&
          /insert\s+into\s+project_versions/iu.test(publishedRepository))) &&
      /snapshot_json|JSON\.stringify|snapshot\s*:/iu.test(
        `${publish}\n${publishedRepository}`,
      ),
    publishPlanBlocksAllHiddenNavigation:
      /\.some\s*\([\s\S]{0,240}navigationVisible/iu.test(source) &&
      (/errors\s*:\s*(?!\[\s*\])(?:[\w.#]+|[^,\n]*\()/iu.test(publishPlan) ||
        /publishValidation\s*\(\s*pages\s*\)[\s\S]{0,300}(?:\.\.\.validation|errors)/iu.test(
          publishPlan,
        )),
    publishBlocksAllHiddenNavigation:
      /\.some\s*\([\s\S]{0,240}navigationVisible/iu.test(source) &&
      /(?:assertApi\s*\(|throw\s+new\s+ApiError\s*\()[\s\S]{0,500}(?:PUBLISH|NAVIGATION|VISIBLE|HIDDEN)/iu.test(
        publish,
      ),
    importRejectsAllHiddenPublishedNavigation:
      /pages\.length\s*(?:===?|!==?)\s*0/iu.test(importPublishedVersions) &&
      /\.some\s*\([\s\S]{0,240}navigationVisible/iu.test(
        importPublishedVersions,
      ) &&
      /(?:assertApi\s*\(|throw\s+new\s+ApiError\s*\()[\s\S]{0,700}(?:IMPORT|VERSION|NAVIGATION|VISIBLE|HIDDEN)/iu.test(
        importPublishedVersions,
      ),
    runtimeReadsPublishedSnapshot:
      (/project_versions/iu.test(runtime) && /snapshot_json/iu.test(runtime)) ||
      (/latestVersion\s*\(/u.test(runtime) &&
        /project_versions/iu.test(publishedRepository) &&
        /snapshot_json/iu.test(publishedRepository)),
    runtimeAvoidsDraftPages:
      ((/project_versions/iu.test(runtime) &&
        /snapshot_json/iu.test(runtime)) ||
        (/latestVersion\s*\(/u.test(runtime) &&
          /project_versions/iu.test(publishedRepository))) &&
      !/from\s+pages\b|\blistActive\s*\(/iu.test(runtime),
    idempotencyOccurrences,
  };
}

function expectedDynamicName(displayName) {
  return displayName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d+)/g, "$1-$2")
    .replace(/(\d+)([A-Za-z])/g, "$1-$2")
    .toLowerCase();
}

export async function loadLucideCatalog(repositoryRoot = REPOSITORY_ROOT) {
  const require = createRequire(import.meta.url);
  const webPackageJson = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/web/package.json"), "utf8"),
  );
  const packageJsonPath = require.resolve("lucide-react/package.json", {
    paths: [resolve(repositoryRoot, "apps/web")],
  });
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const importsPath = resolve(
    dirname(packageJsonPath),
    "dynamicIconImports.mjs",
  );
  const imported = await import(
    `${pathToFileURL(importsPath).href}?phase4-validation=1`
  );
  const dynamicImports = imported.default ?? {};
  const names = Object.keys(dynamicImports).sort();
  const loaded = await Promise.all(
    names.map(async (dynamicName) => ({
      dynamicName,
      displayName: (await dynamicImports[dynamicName]()).default?.displayName,
    })),
  );
  const aliasesByDisplayName = new Map();
  for (const item of loaded) {
    const aliases = aliasesByDisplayName.get(item.displayName) ?? [];
    aliases.push(item.dynamicName);
    aliasesByDisplayName.set(item.displayName, aliases);
  }
  const icons = [...aliasesByDisplayName.entries()]
    .map(([displayName, aliases]) => {
      const expected = expectedDynamicName(displayName);
      const dynamicName = aliases.includes(expected)
        ? expected
        : [...aliases].sort(
            (left, right) =>
              left.length - right.length || left.localeCompare(right),
          )[0];
      return {
        name: displayName,
        dynamicName,
        aliases: [...aliases].sort(),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    packageJsonPath,
    version: packageJson.version,
    declaredVersion: webPackageJson.dependencies?.["lucide-react"],
    names,
    icons,
  };
}

export function inspectLucideImplementation(files, catalog) {
  const source = combinedSource(files);
  const nameSet = new Set(catalog.names);
  const generatedSource =
    files.find(({ path }) =>
      /lucide-icon-catalog\.generated\.[^.]+$/u.test(path),
    )?.source ?? "";
  let generatedItems = [];
  let generatedCatalogParseError = null;
  const generatedMatch =
    /export\s+const\s+LUCIDE_ICON_CATALOG\s*=\s*(?<catalog>\[[\s\S]*?\])\s+as\s+const(?:\s+satisfies[^;]+)?\s*;/u.exec(
      generatedSource,
    );
  if (generatedMatch?.groups?.catalog) {
    try {
      generatedItems = JSON.parse(generatedMatch.groups.catalog);
    } catch (error) {
      const records = [
        ...generatedMatch.groups.catalog.matchAll(
          /\{\s*name:\s*"(?<name>[^"]+)",\s*dynamicName:\s*"(?<dynamicName>[^"]+)",\s*categories:\s*(?<categories>\[[\s\S]*?\]),\s*keywords:\s*(?<keywords>\[[\s\S]*?\]),?\s*\}/gu,
        ),
      ];
      try {
        generatedItems = records.map((record) => ({
          name: record.groups?.name,
          dynamicName: record.groups?.dynamicName,
          categories: JSON.parse(
            (record.groups?.categories ?? "[]").replace(/,\s*\]/gu, "]"),
          ),
          keywords: JSON.parse(
            (record.groups?.keywords ?? "[]").replace(/,\s*\]/gu, "]"),
          ),
        }));
        if (generatedItems.length === 0) throw error;
      } catch (fallbackError) {
        generatedCatalogParseError =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
      }
    }
  } else {
    generatedCatalogParseError = "LUCIDE_ICON_CATALOG declaration is missing";
  }
  const declaredDynamicNames = [
    ...(generatedSource
      .match(
        /export\s+const\s+LUCIDE_DYNAMIC_ICON_NAMES\s*=\s*\[(?<names>[\s\S]*?)\]\s+as\s+const/u,
      )
      ?.groups?.names?.matchAll(/"([^"]+)"/gu) ?? []),
  ].map((match) => match[1]);
  const generatedDynamicNames = generatedItems
    .map((item) => item?.dynamicName)
    .filter((name) => typeof name === "string");
  const generatedSet = new Set(generatedDynamicNames);
  const actualByName = new Map(catalog.icons.map((item) => [item.name, item]));
  const generatedNames = generatedItems
    .map((item) => item?.name)
    .filter((name) => typeof name === "string");
  const generatedNameSet = new Set(generatedNames);
  const coveredLoaderKeys = new Set(
    generatedItems.flatMap((item) => [
      item?.dynamicName,
      ...(Array.isArray(item?.keywords) ? item.keywords : []),
    ]),
  );
  const missingGeneratedNames = catalog.names.filter(
    (name) => !coveredLoaderKeys.has(name),
  );
  const unexpectedGeneratedNames = generatedDynamicNames.filter(
    (name) => !nameSet.has(name),
  );
  const declaredDynamicSet = new Set(declaredDynamicNames);
  const missingDeclaredDynamicNames = catalog.names.filter(
    (name) => !declaredDynamicSet.has(name),
  );
  const unexpectedDeclaredDynamicNames = declaredDynamicNames.filter(
    (name) => !nameSet.has(name),
  );
  const missingDisplayNames = catalog.icons
    .map((item) => item.name)
    .filter((name) => !generatedNameSet.has(name));
  const unexpectedDisplayNames = generatedNames.filter(
    (name) => !actualByName.has(name),
  );
  const invalidGeneratedMappings = generatedItems.flatMap((item) => {
    const actual = actualByName.get(item?.name);
    if (!actual) {
      return [{ name: item?.name, reason: "unknown displayName" }];
    }
    const keywords = new Set(Array.isArray(item.keywords) ? item.keywords : []);
    const missingAliases = actual.aliases.filter(
      (alias) => alias !== item.dynamicName && !keywords.has(alias),
    );
    return item.dynamicName === actual.dynamicName &&
      missingAliases.length === 0
      ? []
      : [
          {
            name: item.name,
            expectedDynamicName: actual.dynamicName,
            actualDynamicName: item.dynamicName,
            missingAliases,
          },
        ];
  });
  const eagerWholeCatalog =
    /import\s+\*\s+as\s+\w+\s+from\s+["']lucide-react["']|import\s*\{[^}]*\bicons\b[^}]*\}\s*from\s*["']lucide-react["']/iu.test(
      source,
    );
  const loadsEverySvg =
    /(?:Object\.(?:values|entries)\s*\(\s*dynamicIconImports\s*\)|dynamicIconImports[\s\S]{0,200}Promise\.all)[\s\S]{0,300}(?:importer|load|map)\s*\(/iu.test(
      source,
    );
  const fixedIconDeclarations = [
    ...source.matchAll(
      /\b(?:availableIcons|iconOptions|fixedIcons|ICON_OPTIONS)\b\s*(?::[^=]+)?=\s*\[([^\]]*)\]/giu,
    ),
  ].filter((match) => (match[1]?.match(/["'`]/gu)?.length ?? 0) <= 80);

  return {
    pinnedVersion:
      catalog.version === "1.31.0" && catalog.declaredVersion === "1.31.0",
    catalogSize: catalog.names.length,
    fullCatalogPresent: catalog.names.length >= 2000,
    requiredNamesPresent: REQUIRED_DYNAMIC_ICON_NAMES.filter(
      (name) => !nameSet.has(name),
    ),
    generatedCatalogParseError,
    generatedCatalogCount: generatedItems.length,
    generatedCatalogExact:
      generatedCatalogParseError === null &&
      generatedItems.length === catalog.icons.length &&
      generatedNames.length === generatedNameSet.size &&
      generatedDynamicNames.length === generatedSet.size &&
      missingGeneratedNames.length === 0 &&
      unexpectedGeneratedNames.length === 0 &&
      declaredDynamicNames.length === catalog.names.length &&
      declaredDynamicNames.length === declaredDynamicSet.size &&
      missingDeclaredDynamicNames.length === 0 &&
      unexpectedDeclaredDynamicNames.length === 0 &&
      missingDisplayNames.length === 0 &&
      unexpectedDisplayNames.length === 0 &&
      invalidGeneratedMappings.length === 0,
    missingGeneratedNames,
    unexpectedGeneratedNames,
    missingDisplayNames,
    unexpectedDisplayNames,
    declaredDynamicNameCount: declaredDynamicNames.length,
    missingDeclaredDynamicNames,
    unexpectedDeclaredDynamicNames,
    invalidGeneratedMappings,
    usesDynamicImports: /lucide-react\/dynamicIconImports/iu.test(source),
    mapsStoredNameToDynamicName:
      /getIcon\s*\(\s*iconName\s*\)/u.test(source) &&
      /item\.dynamicName/u.test(source) &&
      /catalogNameCache|rememberIconCatalogItem/u.test(source) &&
      /loadIcon\s*\(\s*resolvedName\s*\)/u.test(source),
    hasFileQuestionFallback: /\bFileQuestion\b/u.test(source),
    eagerWholeCatalog,
    loadsEverySvg,
    tinyFixedCatalog: fixedIconDeclarations.length > 0,
  };
}

export function inspectFrontendPageImplementation(files) {
  const source = combinedSource(files);
  const hardcodedInitialPages = [
    ...source.matchAll(
      /\b(?:const|let|var)\s+(?<name>initialPages|mockPages|samplePages|pageFixtures)\b|useState\s*<[^>]*Page[^>]*>\s*\(\s*\[\s*\{/giu,
    ),
  ].map((match) => match.groups?.name ?? match[0]);
  const overlayCount = source.match(/<DragOverlay\b/gu)?.length ?? 0;
  const hasPageClient =
    /services\/pages-api|from\s+["'][^"']*pages-api["']/iu.test(source);
  const rowGeometryRule =
    /\.page-drag-handle\s*,\s*\.page-icon-trigger\s*,\s*\.page-trash-button\s*\{(?<body>[^}]*)\}/iu.exec(
      source,
    )?.groups?.body ?? "";
  const headerGeometryRule =
    /\.page-manager-actions\s*>\s*\[data-slot=["']button["']\][^{]*\{(?<body>[^}]*)\}/iu.exec(
      source,
    )?.groups?.body ?? "";
  const pickerGeometryRule =
    /\.icon-picker-tools\s*>\s*\[data-slot=["']button["']\][^{]*\{(?<body>[^}]*)\}/iu.exec(
      source,
    )?.groups?.body ?? "";
  const dialogGeometryRule =
    /\[data-slot=["']dialog-footer["']\]\s*>\s*button\s*,\s*\[data-slot=["']alert-dialog-footer["']\]\s*>\s*button\s*\{(?<body>[^}]*)\}/iu.exec(
      source,
    )?.groups?.body ?? "";
  const hasSharedControlGeometry = (rule, { square = false } = {}) =>
    /height\s*:\s*var\(\s*--control-height\s*\)/iu.test(rule) &&
    /min-height\s*:\s*var\(\s*--control-height\s*\)/iu.test(rule) &&
    /border-radius\s*:\s*var\(\s*--control-radius\s*\)/iu.test(rule) &&
    (!square || /width\s*:\s*var\(\s*--control-height\s*\)/iu.test(rule));

  return {
    usesRealPageApi:
      hasPageClient &&
      /\blistPages\s*\(/u.test(source) &&
      /\b(?:createBlankPage|updatePage|reorderPages|deletePage)\s*\(/u.test(
        source,
      ),
    hardcodedInitialPages,
    hasDndContext:
      /<DndContext\b/u.test(source) && /<SortableContext\b/u.test(source),
    hasPointerSensor:
      /PointerSensor/u.test(source) && /useSensor\s*\(/u.test(source),
    hasKeyboardSensor:
      /KeyboardSensor/u.test(source) &&
      /sortableKeyboardCoordinates/u.test(source),
    overlayCount,
    hasDragTransform:
      /rotate\s*\([^)]*(?:-?2deg|dragTilt)|rotate:\s*["'`][^"'`]*2/iu.test(
        source,
      ) && /scale\s*\(\s*1\.0?2\s*\)|scale:\s*1\.0?2/iu.test(source),
    hasDragShadow: /box-shadow|boxShadow/iu.test(source),
    honorsReducedMotion:
      /prefers-reduced-motion|useReducedMotion|reducedMotion/iu.test(source),
    doubleClickRename:
      /onDoubleClick\s*=|dblClick\s*\(/u.test(source) &&
      /(?:event\.key|key)\s*===?\s*["']Enter["']/u.test(source) &&
      /(?:event\.key|key)\s*===?\s*["']Escape["']/u.test(source) &&
      /onBlur\s*=/u.test(source),
    destructiveImpactDialog:
      /(?:AlertDialog|Dialog)/u.test(source) &&
      ["elementCount", "bindingCount", "validationScenarioCount"].every(
        (field) => source.includes(field),
      ),
    sameCommandUndo:
      /commandId/u.test(source) && /undoPageDelete\s*\(/u.test(source),
    virtualizedIconPicker:
      /useVirtualizer\s*\(/u.test(source) &&
      /getVirtualItems\s*\(/u.test(source),
    searchableCategorizedIcons:
      /listIcons\s*\(\s*\{[\s\S]{0,300}query[\s\S]{0,300}category/iu.test(
        source,
      ),
    recentIcons: /recentOnly|recentIcons|RECENT_LIMIT|최근/iu.test(source),
    keyboardIconPicker: [
      "ArrowRight",
      "ArrowLeft",
      "ArrowDown",
      "ArrowUp",
      "Enter",
      "Escape",
    ].every((key) => source.includes(key)),
    fileQuestionFallback: /\bFileQuestion\b/u.test(source),
    sameLevelRowGeometry: hasSharedControlGeometry(rowGeometryRule, {
      square: true,
    }),
    sameLevelHeaderGeometry:
      hasSharedControlGeometry(headerGeometryRule) &&
      /\.page-manager-actions\s*\{[^}]*gap\s*:\s*var\(\s*--control-gap\s*\)/iu.test(
        source,
      ),
    sameLevelPickerGeometry:
      hasSharedControlGeometry(pickerGeometryRule) &&
      /\.icon-picker-tools\s*\{[^}]*gap\s*:\s*var\(\s*--control-gap\s*\)/iu.test(
        source,
      ),
    sameLevelDialogGeometry:
      hasSharedControlGeometry(dialogGeometryRule) &&
      /data-slot=["'](?:dialog-footer|alert-dialog-footer)["'][\s\S]{0,300}\bgap-(?:2|\[)/iu.test(
        source,
      ),
  };
}

export function inspectRuntimeImplementation(files) {
  const source = combinedSource(files);
  const runtimeFiles = files.filter(({ path }) => /\/runtime\//u.test(path));
  const runtimeSource = combinedSource(runtimeFiles);
  return {
    hasDedicatedRuntime: runtimeFiles.length > 0,
    readsPublishedNavigation:
      /getRuntimeNavigation\s*\(/u.test(runtimeSource) &&
      !/\blistPages\s*\(/u.test(runtimeSource),
    separatedFromPageManager:
      !/PageManager/u.test(runtimeSource) &&
      /PublishedRuntime|published-runtime/iu.test(runtimeSource),
    leftNavigation:
      /<(?:aside|nav)\b/u.test(runtimeSource) &&
      /(?:runtime-left|left-nav|sidebar|grid-template-columns)/iu.test(source),
    deepLinkRouting: /window\.location\.pathname|location\.pathname/u.test(
      runtimeSource,
    ),
    historyNavigation:
      (/history\.pushState\s*\(/u.test(runtimeSource) &&
        /popstate/u.test(runtimeSource)) ||
      (/useNavigate\s*\(/u.test(runtimeSource) &&
        /useLocation\s*\(/u.test(runtimeSource)),
    collapsible: /collaps(?:e|ed|ible)/iu.test(runtimeSource),
    mobileDrawer: /<Drawer\b|<Sheet\b|MobileDrawer|runtime-drawer/iu.test(
      runtimeSource,
    ),
    selectedSemantics: /aria-current\s*=|aria-current/u.test(runtimeSource),
    avoidsDraftApi:
      !/\/api\/v1\/projects\/[^\s"'`]*pages|\blistPages\s*\(/iu.test(
        runtimeSource,
      ),
  };
}

function someFileMatches(files, patterns) {
  return files.some(({ source }) =>
    patterns.every((pattern) => pattern.test(source)),
  );
}

function someTestCaseMatches(files, patterns) {
  return files.some(({ source }) =>
    source
      .split(/(?=\b(?:it|test)\s*\()/u)
      .filter((candidate) => /\b(?:it|test)\s*\(/u.test(candidate))
      .some((candidate) =>
        patterns.every((pattern) => pattern.test(candidate)),
      ),
  );
}

function isBehavioralTest(source) {
  return (
    /\b(?:it|test)\s*\(/u.test(source) &&
    /\b(?:expect|assert\.(?:equal|deepEqual|ok|match|throws))\s*\(/u.test(
      source,
    )
  );
}

export function inspectPhase4TestInventory(files) {
  const paths = files.map(({ path }) => path);
  const behavioralFiles = files.filter(({ source }) =>
    isBehavioralTest(source),
  );
  const domainTests = behavioralFiles.filter(({ path }) =>
    /packages\/domain\/test\//u.test(path),
  );
  const serverTests = behavioralFiles.filter(({ path }) =>
    /apps\/server\/test\//u.test(path),
  );
  const webTests = behavioralFiles.filter(({ path }) =>
    /apps\/web\/src\//u.test(path),
  );
  const source = combinedSource(files);
  const skippedTests = [
    ...source.matchAll(
      /\b(?:describe|it|test)\.skip\s*\(|\b(?:xit|xdescribe)\s*\(|\.todo\s*\(/gu,
    ),
  ].map((match) => match[0]);

  const capabilities = {
    "sqlite-active-route-and-order-constraints": someFileMatches(serverTests, [
      /active[^\n]{0,80}constraints|unique constraints/iu,
      /pages_active_route_unique_idx|UNIQUE constraint failed: pages\.project_id, pages\.route|(?:duplicate[^\n]{0,80}route|route[^\n]{0,80}duplicate)/iu,
      /pages_active_sort_order_unique_idx|UNIQUE constraint failed: pages\.project_id, pages\.sort_order|(?:duplicate[^\n]{0,80}(?:order|sort)|(?:order|sort_order)[^\n]{0,80}duplicate)/iu,
      /(?:new\s+Database|prepare|exec|inject|sqlite)/iu,
      /toThrow\s*\(/u,
    ]),
    "optimistic-revision-and-idempotency": someFileMatches(serverTests, [
      /expectedProjectRevision|expected_project_revision/iu,
      /idempotency/iu,
      /(?:409|conflict)/iu,
      /(?:replay|same response|deepEqual|toEqual)/iu,
    ]),
    "exact-atomic-reorder": someFileMatches(serverTests, [
      /pages\/reorder|reorderPages/iu,
      /(?:duplicate|missing|foreign|permutation)/iu,
      /(?:rollback|unchanged|atomic|transaction)/iu,
      /sortOrder|sort_order/iu,
    ]),
    "delete-impact-and-same-id-undo": someFileMatches(serverTests, [
      /DELETE[\s\S]{0,1200}pages|deletePage|page delete/iu,
      /impact|elementCount|bindingCount/iu,
      /commands\/[\s\S]{0,160}undo|undoPage/iu,
      /same[^\n]{0,100}(?:id|identifier)|restored[^\n]{0,100}\bid\b|toBe\([^)]*page\.id/iu,
    ]),
    "publish-blocks-all-hidden-navigation": someTestCaseMatches(serverTests, [
      /(?:ALL_NAVIGATION_HIDDEN|all[^\n]{0,80}hidden|every Page is hidden|모든[^\n]{0,80}(?:hidden|숨김))/iu,
      /publish\/plan|publishPlan/iu,
      /navigationVisible\s*:\s*false|navigation_visible\s*=\s*0/iu,
      /errors[\s\S]{0,240}(?:length|contain|equal|match)|(?:validation|publish)[\s\S]{0,240}(?:400|409|422)/iu,
      /expect\s*\(\s*(?:blockedPublish|rejected|publishResponse)\.status(?:Code)?\s*\)\.(?:toBe|toEqual)\s*\(\s*(?:400|409|422)\s*\)/iu,
      /(?:version|revision|project_versions)[\s\S]{0,300}(?:unchanged|same|not|equal)/iu,
    ]),
    "import-rejects-all-hidden-published-navigation": someTestCaseMatches(
      serverTests,
      [
        /(?:import[^\n]{0,100}all[^\n]{0,100}hidden|all[^\n]{0,100}hidden[^\n]{0,100}import|ALL_NAVIGATION_HIDDEN)/iu,
        /(?:publishedVersions|project_versions|published navigation)/iu,
        /navigationVisible\s*:\s*false|navigation_visible\s*=\s*0/iu,
        /(?:\/import|\.import\s*\(|importProject|imported)/iu,
        /expect\s*\([^)]*(?:statusCode|status)[^)]*\)\.(?:toBe|toEqual)\s*\(\s*400\s*\)/iu,
        /(?:unchanged|not\.toContain|not\.toEqual|count)[\s\S]{0,300}(?:project|version)|(?:project|version)[\s\S]{0,300}(?:unchanged|not\.toContain|not\.toEqual|count)/iu,
      ],
    ),
    "immutable-publish-and-draft-isolation": someFileMatches(serverTests, [
      /publish\/plan|publishProject/iu,
      /runtime[\s\S]{0,100}navigation/iu,
      /(?:draft|unpublished)/iu,
      /(?:immutable|UPDATE project_versions|published version|snapshot)/iu,
    ]),
    "page-lifecycle-clone-export-import-trash-restore-purge": someFileMatches(
      serverTests,
      [
        /clone/iu,
        /export/iu,
        /import/iu,
        /(?:remap|not\.toEqual)[\s\S]{0,500}(?:page|id)|(?:page|id)[\s\S]{0,500}(?:remap|not\.toEqual)/iu,
        /\/trash|trash-pages/iu,
        /\/restore|restore-pages/iu,
        /\/purge|purge-pages|purge-plan/iu,
        /project_versions|runtime/iu,
      ],
    ),
    "real-page-api-persistence": someFileMatches(webTests, [
      /(?:render|userEvent|fireEvent|screen\.)/u,
      /(?:fetch|request|server\.use|mockResolvedValue)/u,
      /(?:listPages|path\.endsWith\(["']\/pages["']\)|\/api\/v1\/projects\/[^\s"']+\/pages)/u,
      /(?:rerender|refresh|reload|remount|persist|method\s*===\s*["']GET["'])/iu,
    ]),
    "pointer-and-keyboard-dnd": someFileMatches(webTests, [
      /pointer|PointerSensor/iu,
      /keyboard|KeyboardSensor|Arrow(?:Up|Down)/iu,
      /reorder|sort order/iu,
      /toHaveBeenCalledTimes\s*\(\s*1\s*\)|toHaveLength\s*\(\s*1\s*\)/u,
    ]),
    "single-overlay-and-reduced-motion": someFileMatches(webTests, [
      /DragOverlay|drag overlay|page-drag-overlay|이동 중/iu,
      /(?:queryAllBy|findAllBy|getAllBy)[\s\S]{0,220}toHaveLength\s*\(\s*1\s*\)/iu,
      /reduced[ -]?motion|prefers-reduced-motion/iu,
      /(?:rotate|transform)[\s\S]{0,300}(?:none|scale)|not[\s\S]{0,200}rotate/iu,
    ]),
    "same-level-sibling-geometry": someTestCaseMatches(webTests, [
      /getBoundingClientRect|new\s+DOMRect|stylesCss/iu,
      /page-drag-handle[\s\S]{0,500}page-icon-trigger[\s\S]{0,500}page-trash-button/iu,
      /page-manager-actions|게시[\s\S]{0,500}빈 페이지/iu,
      /icon-picker-tools|최근[\s\S]{0,500}기본/iu,
      /dialog-footer|취소[\s\S]{0,500}(?:삭제|confirm)/iu,
      /data-size|dataset\.size|computed\.(?:minHeight|borderRadius)/iu,
      /--control-height|computed\.(?:minHeight|height)/iu,
      /toMatch\s*\(|toEqual\s*\(|toHaveAttribute\s*\(/u,
    ]),
    "double-click-inline-rename": someFileMatches(webTests, [
      /dblClick|doubleClick|double-click/iu,
      /Enter/u,
      /Escape/u,
      /blur\s*\(|fireEvent\.blur|user\.tab\s*\(/iu,
    ]),
    "virtual-icon-picker-keyboard-and-fallback": someFileMatches(webTests, [
      /icon/iu,
      /search|query/iu,
      /category|최근|recent/iu,
      /Arrow(?:Right|Left|Down|Up)[\s\S]{0,800}Enter|Enter[\s\S]{0,800}Arrow(?:Right|Left|Down|Up)/iu,
      /FileQuestion|아이콘 오류|fallback/iu,
      /virtual|getVirtualItems|aria-activedescendant/iu,
      /toBeLessThan\s*\(\s*200\s*\)/u,
      /fireEvent\.scroll|userEvent\.scroll|virtual[ -]window/iu,
      /CatalogIcon\d+|window[\s\S]{0,160}(?:change|shift)/iu,
      /Axis3d|ArrowDown01|Building2/iu,
      /lucide-arrow-down-0-1|lucide-building-2|not[\s\S]{0,160}(?:FileQuestion|fallback)|(?:valid|resolved)[\s\S]{0,160}(?:icon|dynamic)/iu,
    ]),
    "runtime-left-nav-history-collapse-drawer": someFileMatches(webTests, [
      /PublishedRuntime|runtime navigation/iu,
      /(?:left|좌측)[\s\S]{0,200}(?:nav|navigation)|(?:nav|navigation)[\s\S]{0,200}(?:left|좌측)|runtime-sidebar[\s\S]{0,500}runtime-page/iu,
      /grid-template-columns[\s\S]{0,100}17rem|getBoundingClientRect[\s\S]{0,300}toBeLessThan/iu,
      /pushState|popstate|history/iu,
      /collapse|collapsed/iu,
      /Drawer|mobile|모바일/iu,
    ]),
  };

  return {
    paths,
    behavioralPaths: behavioralFiles.map(({ path }) => path),
    skippedTests,
    capabilities,
    hasDomainPageTest: domainTests.length > 0,
    hasServerPageIntegrationTest: serverTests.some(
      ({ path, source: fileSource }) =>
        /integration/u.test(path) && /page|publish|runtime/iu.test(fileSource),
    ),
    hasWebPageComponentTest: webTests.some(({ source: fileSource }) =>
      /PageManager|IconPicker|PublishedRuntime/iu.test(fileSource),
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
    validation.check(false, "Phase 4 traceability JSON can be read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const requirements = Object.fromEntries(
    (traceability.requirements ?? []).map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );
  for (const id of REQUIRED_PHASE4_REQUIREMENTS) {
    const requirement = requirements[id];
    validation.check(Boolean(requirement), `${id} is present in traceability`);
    if (!requirement) continue;
    validation.equal(requirement.phase, 4, `${id} remains assigned to Phase 4`);
    validation.check(
      [
        "IMPLEMENTED",
        "VERIFIED",
        "EXHAUSTIVELY VERIFIED",
        "OPERATIONALLY VERIFIED",
        "RELEASED",
      ].includes(requirement.status),
      `${id} is no longer NOT STARTED or IN PROGRESS`,
      { status: requirement.status },
    );
    validation.check(
      Array.isArray(requirement.implementation) &&
        requirement.implementation.length > 0,
      `${id} references Phase 4 implementation`,
    );
    validation.check(
      Array.isArray(requirement.tests) &&
        requirement.tests.length >= 2 &&
        requirement.tests.includes("scripts/verify-phase4.mjs"),
      `${id} references behavioral tests and scripts/verify-phase4.mjs`,
    );
    validation.check(
      Array.isArray(requirement.evidence) &&
        requirement.evidence.includes(PHASE4_EVIDENCE_PATH),
      `${id} references ${PHASE4_EVIDENCE_PATH}`,
    );
  }
  return { requirements: Object.values(requirements) };
}

export async function validatePhase4({
  repositoryRoot = REPOSITORY_ROOT,
  includeGovernance = true,
  includePhase3Regression = true,
} = {}) {
  const validation = new Validation(
    "Phase 4 page management and published runtime navigation",
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
    "all canonical Phase 4 routes are registered under /api/v1",
    { missing: routeInspection.missingRoutes.map(routeKey) },
  );
  validation.check(
    routeInspection.unversionedRoutes.length === 0,
    "no unversioned page, icon, publish, or runtime routes are registered",
    { routes: routeInspection.unversionedRoutes.map(routeKey) },
  );

  const schemaInspection = inspectPageSchema(combinedSource(serverFiles));
  for (const [tableName, table] of Object.entries(schemaInspection.tables)) {
    validation.check(table.present, `SQLite table ${tableName} exists`);
    validation.check(
      table.missingColumns.length === 0,
      `SQLite table ${tableName} has every required column`,
      { missing: table.missingColumns },
    );
  }
  for (const [property, message] of [
    ["pagesProjectForeignKey", "Pages reference their Project"],
    ["pageRevisionConstraint", "Page revisions are positive"],
    ["pageNameConstraint", "Page names are nonempty and shorter than 100"],
    ["pageRouteConstraint", "Page routes are constrained to absolute paths"],
    ["pageTypeConstraint", "Phase 4 page type is constrained to blank"],
    [
      "iconCatalogVersionConstraint",
      "Lucide catalog version is pinned in SQLite",
    ],
    [
      "navigationVisibleConstraint",
      "Navigation visibility is boolean constrained",
    ],
    ["sortOrderConstraint", "Page sort order is nonnegative"],
    [
      "activeRouteUniqueIndex",
      "Active Page routes are case-insensitively unique",
    ],
    ["activeOrderUniqueIndex", "Active Page order is unique within a Project"],
    [
      "deleteCommandOnly",
      "Page command storage is constrained to Delete commands",
    ],
    [
      "commandHasSnapshotAndImpact",
      "Delete commands retain snapshot and impact",
    ],
    [
      "idempotencyUniqueConstraint",
      "Definition idempotency keys are unique per Project",
    ],
    [
      "operationStoresRequestAndResponse",
      "Idempotency records bind request and response",
    ],
    [
      "publishSequenceUniqueConstraint",
      "Published version sequence is unique per Project",
    ],
    [
      "immutablePublishedVersions",
      "Published Project versions reject mutation",
    ],
  ]) {
    validation.check(schemaInspection[property], message);
  }

  const protocolInspection = inspectPageProtocol(serverFiles);
  for (const [property, message] of [
    [
      "hasPageExpectedRevision",
      "Page mutations require optimistic Page revisions",
    ],
    [
      "hasProjectExpectedRevision",
      "Page mutations require optimistic Project revisions",
    ],
    ["rejectsRevisionConflict", "Stale revisions produce an explicit conflict"],
    [
      "hasIdempotencyContract",
      "Durable definition mutations carry idempotency keys",
    ],
    [
      "hashesIdempotentRequest",
      "Idempotency is bound to a canonical request hash",
    ],
    ["replaysStoredResponse", "Idempotent retries replay the stored response"],
    [
      "rejectsIdempotencyMismatch",
      "Idempotency key payload mismatches are rejected",
    ],
    [
      "exactReorderPermutation",
      "Reorder accepts only an exact active Page permutation",
    ],
    [
      "atomicReorderTransaction",
      "Reorder writes execute in one SQLite transaction",
    ],
    [
      "collisionSafeReorder",
      "Reorder avoids transient active-order collisions",
    ],
    [
      "publishesSnapshotInTransaction",
      "Publish writes an immutable snapshot transactionally",
    ],
    [
      "publishPlanBlocksAllHiddenNavigation",
      "Publish plan reports an error when every Page is hidden",
    ],
    [
      "publishBlocksAllHiddenNavigation",
      "Publish rejects a snapshot when every Page is hidden",
    ],
    [
      "importRejectsAllHiddenPublishedNavigation",
      "Import cannot bypass the all-hidden published-navigation gate",
    ],
    [
      "runtimeReadsPublishedSnapshot",
      "Runtime navigation reads Project version snapshots",
    ],
    ["runtimeAvoidsDraftPages", "Runtime navigation never reads draft Pages"],
  ]) {
    validation.check(protocolInspection[property], message);
  }

  const catalog = await loadLucideCatalog(repositoryRoot);
  const lucideInspection = inspectLucideImplementation(
    [...serverFiles, ...webFiles],
    catalog,
  );
  validation.check(
    lucideInspection.pinnedVersion,
    "lucide-react is pinned to 1.31.0",
  );
  validation.check(
    lucideInspection.fullCatalogPresent,
    "the installed Lucide 1.31.0 dynamic catalog is complete",
    { catalogSize: lucideInspection.catalogSize },
  );
  validation.check(
    lucideInspection.requiredNamesPresent.length === 0,
    "required Lucide dynamic names exist in the installed catalog",
    { missing: lucideInspection.requiredNamesPresent },
  );
  validation.check(
    lucideInspection.generatedCatalogExact,
    "server icon catalog exactly covers installed Lucide 1.31.0 dynamic names",
    {
      generatedCatalogCount: lucideInspection.generatedCatalogCount,
      declaredDynamicNameCount: lucideInspection.declaredDynamicNameCount,
      parseError: lucideInspection.generatedCatalogParseError,
      missing: lucideInspection.missingGeneratedNames,
      unexpected: lucideInspection.unexpectedGeneratedNames,
      missingDeclared: lucideInspection.missingDeclaredDynamicNames,
      unexpectedDeclared: lucideInspection.unexpectedDeclaredDynamicNames,
    },
  );
  validation.check(
    lucideInspection.invalidGeneratedMappings.length === 0,
    "server icon catalog maps stored names to exact dynamic names",
    { invalid: lucideInspection.invalidGeneratedMappings },
  );
  validation.check(
    lucideInspection.usesDynamicImports,
    "icons use Lucide dynamic imports",
  );
  validation.check(
    lucideInspection.mapsStoredNameToDynamicName,
    "stored Lucide names map to dynamic catalog names",
  );
  validation.check(
    lucideInspection.hasFileQuestionFallback,
    "unknown icons render FileQuestion",
  );
  validation.check(
    !lucideInspection.eagerWholeCatalog,
    "the whole Lucide component bundle is not eagerly imported",
  );
  validation.check(
    !lucideInspection.loadsEverySvg,
    "the icon picker never loads every SVG payload",
  );
  validation.check(
    !lucideInspection.tinyFixedCatalog,
    "the icon picker is not a tiny fixed dropdown",
  );

  const frontendInspection = inspectFrontendPageImplementation(webFiles);
  validation.check(
    frontendInspection.usesRealPageApi,
    "Page Manager uses the real Page API",
  );
  validation.check(
    frontendInspection.hardcodedInitialPages.length === 0,
    "frontend has no hardcoded initial Page inventory",
    { declarations: frontendInspection.hardcodedInitialPages },
  );
  for (const [property, message] of [
    ["hasDndContext", "Page reorder uses dnd-kit sortable context"],
    ["hasPointerSensor", "Page reorder supports pointer input"],
    ["hasKeyboardSensor", "Page reorder supports keyboard input"],
    ["hasDragTransform", "drag preview has tilt and scale"],
    ["hasDragShadow", "drag preview has a shadow"],
    ["honorsReducedMotion", "drag preview honors reduced motion"],
    ["doubleClickRename", "Page rename is double-click inline and cancellable"],
    ["destructiveImpactDialog", "Page delete shows destructive impact"],
    ["sameCommandUndo", "Page delete offers command-bound undo"],
    ["virtualizedIconPicker", "icon picker grid is virtualized"],
    [
      "searchableCategorizedIcons",
      "icon picker searches and filters by category",
    ],
    ["recentIcons", "icon picker exposes recently used icons"],
    [
      "keyboardIconPicker",
      "icon picker implements arrow, Enter, and Escape keys",
    ],
    ["fileQuestionFallback", "frontend exposes an invalid-icon fallback"],
    [
      "sameLevelRowGeometry",
      "Page row drag, icon, and trash controls share square geometry",
    ],
    [
      "sameLevelHeaderGeometry",
      "Page Manager header sibling controls share geometry",
    ],
    [
      "sameLevelPickerGeometry",
      "icon picker toolbar sibling controls share geometry",
    ],
    [
      "sameLevelDialogGeometry",
      "dialog footer sibling controls share geometry",
    ],
  ]) {
    validation.check(frontendInspection[property], message);
  }
  validation.equal(
    frontendInspection.overlayCount,
    1,
    "Page Manager renders exactly one DragOverlay",
  );

  const runtimeInspection = inspectRuntimeImplementation(webFiles);
  for (const [property, message] of [
    ["hasDedicatedRuntime", "published runtime has a dedicated renderer"],
    [
      "readsPublishedNavigation",
      "runtime renderer reads only published navigation API",
    ],
    [
      "separatedFromPageManager",
      "runtime renderer is separate from draft Page Manager",
    ],
    ["leftNavigation", "published runtime navigation is on the left"],
    ["deepLinkRouting", "published runtime resolves direct deep links"],
    ["historyNavigation", "published runtime integrates browser history"],
    ["collapsible", "desktop runtime navigation can collapse"],
    ["mobileDrawer", "mobile runtime navigation uses a Drawer"],
    ["selectedSemantics", "selected runtime Page exposes aria-current"],
    ["avoidsDraftApi", "runtime frontend never calls the draft Page API"],
  ]) {
    validation.check(runtimeInspection[property], message);
  }

  const testInspection = inspectPhase4TestInventory(testFiles);
  validation.check(
    testInspection.skippedTests.length === 0,
    "Phase 4 test inventory has no skipped or TODO tests",
    { skipped: testInspection.skippedTests },
  );
  validation.check(
    testInspection.hasDomainPageTest,
    "domain Page contract tests exist",
  );
  validation.check(
    testInspection.hasServerPageIntegrationTest,
    "server Page/publish/runtime integration tests exist",
  );
  validation.check(
    testInspection.hasWebPageComponentTest,
    "web Page/Icon/runtime component tests exist",
  );
  for (const capability of REQUIRED_PHASE4_TEST_CAPABILITIES) {
    validation.check(
      testInspection.capabilities[capability],
      `behavioral test inventory covers ${capability}`,
    );
  }

  let phase3Regression = null;
  if (includePhase3Regression) {
    phase3Regression = await validatePhase3({
      repositoryRoot,
      includeGovernance: false,
    });
    validation.check(
      phase3Regression.result === "PASS",
      "clone/export/import/trash/restore/purge regression evidence remains green",
      { failures: phase3Regression.failures },
    );
  }

  const governance = includeGovernance
    ? await inspectGovernance(repositoryRoot, validation)
    : { requirements: [] };

  return validation.result({
    canonicalRouteCount: CANONICAL_PHASE4_ROUTES.length,
    registeredCanonicalRoutes:
      CANONICAL_PHASE4_ROUTES.length - routeInspection.missingRoutes.length,
    requiredTableCount: Object.keys(REQUIRED_PAGE_TABLES).length,
    presentTableCount: Object.values(schemaInspection.tables).filter(
      (table) => table.present,
    ).length,
    lucideCatalogVersion: catalog.version,
    lucideDeclaredVersion: catalog.declaredVersion,
    lucideCatalogSize: catalog.names.length,
    lucideUniqueIconCount: catalog.icons.length,
    serverSourceFiles: serverFiles.map(({ path }) => path),
    domainSourceFiles: domainFiles.map(({ path }) => path),
    webSourceFiles: webFiles.map(({ path }) => path),
    testFiles: testInspection.paths,
    behavioralTestFiles: testInspection.behavioralPaths,
    routeInspection,
    schemaInspection: {
      ...schemaInspection,
      tables: Object.fromEntries(
        Object.entries(schemaInspection.tables).map(([name, table]) => [
          name,
          { present: table.present, missingColumns: table.missingColumns },
        ]),
      ),
    },
    protocolInspection,
    lucideInspection,
    frontendInspection,
    runtimeInspection,
    testInventory: testInspection,
    phase3RegressionResult: phase3Regression?.result ?? "NOT_RUN",
    governanceRequirementCount: governance.requirements.length,
    requiredEvidencePath: PHASE4_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE4_EVIDENCE_PATH, await validatePhase4());
  } catch (error) {
    await finishVerification(
      PHASE4_EVIDENCE_PATH,
      unexpectedFailure(
        "Phase 4 page management and published runtime navigation",
        error,
      ),
    );
  }
}
