import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase4 } from "./verify-phase4.mjs";

export const PHASE5_EVIDENCE_PATH =
  "artifacts/phase5/element-layout-validation.json";
export const PHASE5_BROWSER_GEOMETRY_EVIDENCE_PATH =
  "artifacts/phase5/browser-geometry-validation.json";

export const REQUIRED_PHASE5_REQUIREMENTS = Object.freeze([
  "REQ-013",
  "REQ-014",
  "REQ-026",
]);

export const CANONICAL_PHASE5_ROUTES = Object.freeze([
  { method: "GET", path: "/api/v1/pages/:pageId/elements" },
  { method: "POST", path: "/api/v1/pages/:pageId/elements" },
  { method: "PATCH", path: "/api/v1/elements/:elementId" },
  { method: "DELETE", path: "/api/v1/elements/:elementId" },
  { method: "POST", path: "/api/v1/elements/batch-layout" },
  {
    method: "POST",
    path: "/api/v1/pages/:pageId/placement-candidates",
  },
  {
    method: "POST",
    path: "/api/v1/pages/:pageId/elements/from-placement",
  },
]);

const PHASE5_COMPATIBLE_ADDITIVE_ROUTES = new Set([
  "GET /api/v1/elements/:elementId",
  "GET /api/v1/elements/registry",
  "GET /api/v1/elements/registry/:elementType",
]);

export const REQUIRED_ELEMENT_TABLES = Object.freeze({
  page_layout_revisions: [
    "page_id",
    "project_id",
    "desktop_revision",
    "updated_at",
  ],
  elements: [
    "id",
    "project_id",
    "page_id",
    "type",
    "type_version",
    "name",
    "props_json",
    "style_json",
    "events_json",
    "locked",
    "hidden",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  element_layouts: [
    "element_id",
    "project_id",
    "page_id",
    "breakpoint",
    "x",
    "y",
    "w",
    "h",
    "min_w",
    "min_h",
    "max_w",
    "max_h",
  ],
  element_commands: [
    "id",
    "project_id",
    "page_id",
    "element_id",
    "command_type",
    "idempotency_key",
    "request_hash",
    "before_json",
    "after_json",
    "response_status",
    "response_json",
    "before_layout_revision",
    "after_layout_revision",
    "created_at",
  ],
});

export const REQUIRED_RESIZE_HANDLES = Object.freeze([
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
]);

export const REQUIRED_PHASE5_TEST_CAPABILITIES = Object.freeze([
  "sqlite-v4-constraints-and-ownership",
  "page-layout-revision-lifecycle",
  "layout-revision-and-idempotency",
  "delete-idempotent-replay",
  "server-5xx-rollback-and-retry",
  "candidate-bounded-ttl-and-no-database-write",
  "candidate-consume-expire-stale-tamper-cross-page",
  "server-snap-boundary-and-nearest-collision",
  "out-of-bounds-invalid-and-blocked",
  "server-bottom-boundary-invalid",
  "server-placement-vertical-compaction",
  "preview-and-commit-exact-geometry",
  "all-kernel-element-types-preview-and-commit",
  "twenty-elements-reload-and-restart",
  "eight-resize-handles-minmax-and-lock",
  "selection-keyboard-and-cancel-delete",
  "zoom-scroll-boundary-input-matrix",
  "project-lifecycle-element-ownership",
  "immutable-publish-and-draft-isolation",
  "palette-pointer-keyboard-and-rgl-boundary",
  "latest-candidate-race-and-final-pointer",
  "candidate-request-coalescing",
  "candidate-key-matches-server-rounding",
  "expired-candidate-cache-refresh",
  "compaction-atomic-batch-reload",
  "measured-placeholder-and-control-geometry",
  "candidate-controls-keyboard-isolation",
  "candidate-child-focus-escape-cancels",
  "candidate-actions-pointer-clickable",
  "pointer-outside-invalid-preview",
  "global-multiselection-escape-delete",
  "collision-error-classification",
  "visible-candidate-identity-on-drop",
  "locked-delete-preflight-no-partial",
  "project-revision-monotonic-stale-read",
  "page-layout-revision-monotonic-stale-read",
  "keyboard-collision-compaction-batch",
  "nested-control-arrows-do-not-move",
  "canonical-render-no-mount-compaction",
  "selection-delete-exact-sequential",
  "bidirectional-viewport-overflow-ownership",
  "reduced-motion-and-accessibility",
  "single-save-after-drag-or-resize",
  "real-persisted-element-rendering",
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
  const parameterNames = ["projectId", "pageId", "elementId"];
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

  return uniqueBy(routes, routeKey).sort((left, right) =>
    routeKey(left).localeCompare(routeKey(right)),
  );
}

function isElementRoute(path) {
  return (
    /^\/api\/v1\/elements(?:\/|$)/u.test(path) ||
    /^\/api\/v1\/pages\/:pageId\/(?:elements|placement-candidates)(?:\/|$)/u.test(
      path,
    )
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
    ...source.matchAll(/\bprefix\s*:\s*(["'`])(\/api\/v1\/?)\1\s*[,}]/giu),
  ].map((match) => (match[2] ?? "").replace(/\/$/u, ""));
  const prefixed = extracted.flatMap((route) => {
    if (
      route.path.startsWith("/api/") ||
      !/^\/(?:elements|pages)(?:\/|$)/u.test(route.path)
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
  const elementRoutes = actualRoutes.filter((route) =>
    isElementRoute(route.path),
  );
  const canonicalKeys = new Set(CANONICAL_PHASE5_ROUTES.map(routeKey));
  const actualKeys = new Set(elementRoutes.map(routeKey));
  const missingRoutes = CANONICAL_PHASE5_ROUTES.filter(
    (route) => !actualKeys.has(routeKey(route)),
  );
  const unexpectedRoutes = elementRoutes.filter(
    (route) =>
      !canonicalKeys.has(routeKey(route)) &&
      !PHASE5_COMPATIBLE_ADDITIVE_ROUTES.has(routeKey(route)),
  );
  const unversionedRoutes = actualRoutes.filter((route) =>
    /^\/(?:elements|pages\/[^/]+\/(?:elements|placement-candidates))(?:\/|$)/u.test(
      route.path,
    ),
  );
  return {
    actualRoutes,
    elementRoutes,
    missingRoutes,
    unexpectedRoutes,
    unversionedRoutes,
  };
}

function extractCreateTableBlock(source, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const start = new RegExp(
    `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+["'\\x60\\[]?${escaped}["'\\x60\\]]?\\s*\\(`,
    "iu",
  ).exec(source);
  if (!start) return "";
  const open = source.indexOf("(", start.index);
  let depth = 0;
  let quote = null;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
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

export function inspectElementSchema(source) {
  const tables = Object.fromEntries(
    Object.entries(REQUIRED_ELEMENT_TABLES).map(([name, columns]) => [
      name,
      tableInspection(source, name, columns),
    ]),
  );
  const pageLayouts = tables.page_layout_revisions.block;
  const elements = tables.elements.block;
  const layouts = tables.element_layouts.block;
  const commands = tables.element_commands.block;
  const migrationContext =
    /canvas-element-layout-kernel[\s\S]{0,16000}/iu.exec(source)?.[0] ?? "";
  const latestSchemaVersion = Number(
    /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(\d+)\b/u.exec(source)?.[1] ?? -1,
  );
  return {
    tables,
    schemaVersionAtLeastFour:
      latestSchemaVersion >= 4 && /version\s*:\s*4\b/u.test(migrationContext),
    migrationNamed: /canvas-element-layout-kernel/iu.test(source),
    futureVersionFailClosed:
      /userVersion\s*>\s*LATEST_METADATA_SCHEMA_VERSION/u.test(source) &&
      /Refusing unknown future metadata schema version/u.test(source),
    pageLayoutOwnsProjectAndPage:
      /foreign\s+key\s*\(\s*page_id\s*,\s*project_id\s*\)\s*references\s+pages\s*\(\s*id\s*,\s*project_id\s*\)/iu.test(
        pageLayouts,
      ),
    pageLayoutRevisionNonnegative:
      /desktop_revision\s+[^,]*check\s*\(\s*desktop_revision\s*>=\s*0\s*\)/iu.test(
        pageLayouts,
      ),
    oneLayoutRevisionPerPage:
      /(?:primary\s+key|unique)\s*\(\s*page_id\s*\)|page_id\s+[^,]*primary\s+key/iu.test(
        pageLayouts,
      ),
    elementOwnsProjectAndPage:
      /project_id\s+[^,]*references\s+projects\s*\(\s*id\s*\)/iu.test(
        elements,
      ) &&
      /foreign\s+key\s*\(\s*page_id\s*,\s*project_id\s*\)\s*references\s+pages\s*\(\s*id\s*,\s*project_id\s*\)/iu.test(
        elements,
      ),
    elementRevisionPositive:
      /revision\s+[^,]*check\s*\(\s*revision\s*>=\s*1\s*\)/iu.test(elements),
    elementTypeConstrained:
      /\btype\s+[\s\S]{0,500}check\s*\([\s\S]{0,500}["']text["'][\s\S]{0,500}["']button["']/iu.test(
        elements,
      ),
    elementLockBoolean:
      /locked\s+[\s\S]{0,180}check\s*\(\s*locked\s+in\s*\(\s*0\s*,\s*1\s*\)\s*\)/iu.test(
        elements,
      ),
    layoutOwnsElementProjectAndPage:
      /foreign\s+key\s*\(\s*element_id\s*,\s*page_id\s*,\s*project_id\s*\)\s*references\s+elements\s*\(\s*id\s*,\s*page_id\s*,\s*project_id\s*\)/iu.test(
        layouts,
      ),
    layoutBreakpointConstrained:
      /breakpoint\s+[\s\S]{0,240}check\s*\(\s*breakpoint\s+in\s*\([\s\S]{0,100}["']desktop["'][\s\S]{0,100}["']tablet["'][\s\S]{0,100}["']mobile["']/iu.test(
        layouts,
      ),
    layoutIntegerGeometry: ["x", "y", "w", "h"].every((column) =>
      new RegExp(`\\b${column}\\s+INTEGER\\b`, "iu").test(layouts),
    ),
    layoutGeometryConstrained:
      /check\s*\(\s*x\s*>=\s*0\s*\)/iu.test(layouts) &&
      /check\s*\(\s*y\s*>=\s*0\s*\)/iu.test(layouts) &&
      /check\s*\(\s*w\s*>=\s*1\s*\)/iu.test(layouts) &&
      /check\s*\(\s*h\s*>=\s*1\s*\)/iu.test(layouts) &&
      /check\s*\([\s\S]{0,220}breakpoint\s*!=\s*["']desktop["'][\s\S]{0,220}x\s*\+\s*w\s*<=\s*24(?!\d)/iu.test(
        layouts,
      ),
    oneLayoutPerBreakpoint:
      /(?:primary\s+key|unique)\s*\(\s*element_id\s*,\s*breakpoint\s*\)/iu.test(
        layouts,
      ),
    commandTypesConstrained:
      /command_type\s+[\s\S]{0,600}check\s*\([\s\S]{0,600}["'](?:ADD|CREATE)["'][\s\S]{0,600}["']MOVE["'][\s\S]{0,600}["']RESIZE["'][\s\S]{0,600}["']LOCK["']/iu.test(
        commands,
      ),
    commandBeforeAfter:
      /\bbefore_json\b/iu.test(commands) && /\bafter_json\b/iu.test(commands),
    commandIdempotencyConstrained:
      /unique\s*\(\s*project_id\s*,\s*idempotency_key\s*\)/iu.test(commands) &&
      /\brequest_hash\b/iu.test(commands) &&
      /\bresponse_json\b/iu.test(commands),
    commandResponseExcludesFiveHundreds:
      /response_status\s+[\s\S]{0,180}check\s*\(\s*response_status\s+between\s+200\s+and\s+499\s*\)/iu.test(
        commands,
      ),
    newPagesSeedLayoutRevision:
      /create\s+trigger\s+pages_initialize_layout_revision[\s\S]{0,500}after\s+insert\s+on\s+pages[\s\S]{0,700}insert\s+into\s+page_layout_revisions/iu.test(
        source,
      ),
    migrationTransactional:
      /metadataDatabase\.transaction|database\.transaction|\.transaction\s*\(/u.test(
        source,
      ) && /migrate\.immediate\s*\(/u.test(source),
  };
}

function contextsFor(files, pattern, radius = 9000) {
  const contexts = [];
  for (const file of files) {
    const match = pattern.exec(file.source);
    pattern.lastIndex = 0;
    if (!match) continue;
    contexts.push(
      file.source.slice(
        Math.max(0, match.index - Math.floor(radius / 5)),
        Math.min(file.source.length, match.index + radius),
      ),
    );
  }
  return contexts.join("\n");
}

function sourceForPath(files, pattern) {
  return files
    .filter(({ path }) => pattern.test(path))
    .map(({ source }) => source)
    .join("\n");
}

function cssRuleBody(source, selector) {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex < 0) return "";
  const blockStart = source.indexOf("{", selectorIndex + selector.length);
  if (blockStart < 0) return "";
  const blockEnd = source.indexOf("}", blockStart + 1);
  return blockEnd < 0 ? "" : source.slice(blockStart + 1, blockEnd);
}

function routeHandlerContext(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return "";
  const tail = source.slice(markerIndex);
  const nextRoute = /\n\s*server\.(?:get|post|patch|delete)\s*</u.exec(
    tail.slice(marker.length),
  );
  const end =
    nextRoute === null ? tail.length : marker.length + nextRoute.index;
  return tail.slice(0, end);
}

export function inspectCandidateProtocol(files) {
  const source = combinedSource(files);
  const store = sourceForPath(files, /placement-candidate-store/iu);
  const elementService = sourceForPath(files, /elements\/element-service/iu);
  const registry = sourceForPath(files, /elements\/element-registry/iu);
  const candidate = contextsFor(
    files,
    /createPlacementCandidate|placementCandidate|placement-candidates/iu,
    14000,
  );
  const commit = contextsFor(
    files,
    /fromPlacement|from-placement|consumeCandidate/iu,
    16000,
  );
  const route = sourceForPath(files, /routes\/elements\.[cm]?[jt]s$/u);
  const fromPlacementRoute = routeHandlerContext(
    route,
    "/api/v1/pages/:pageId/elements/from-placement",
  );
  const candidateKernel = `${candidate}\n${elementService}\n${registry}`;
  const consumeIndex = commit.search(/\.consume\s*\(|consumeCandidate/iu);
  const replayIndex = commit.search(
    /existingOperation|storedResponse|replayDefinitionOperation|const\s+replay|#replay/iu,
  );
  return {
    storeClass: /class\s+PlacementCandidateStore\b/u.test(store),
    exactTtl:
      /(?:TTL|ttl)[A-Z_a-z]*\s*=\s*15(?:_?000|\s*\*\s*1000)\b/u.test(store) ||
      /ttlMs\s*:\s*15_?000\b/u.test(store),
    exactCapacity:
      /(?:CAPACITY|capacity|max(?:Size|Entries|Candidates))[A-Z_a-z]*\s*=\s*512\b/u.test(
        store,
      ),
    boundedMap:
      /new\s+Map\s*</u.test(store) &&
      /(?:capacity|maxSize|maxEntries|maxCandidates)/iu.test(store) &&
      /\.delete\s*\(/u.test(store),
    expiryUsesInjectedClock:
      /clock\s*[:=]/iu.test(store) &&
      /expiresAt/iu.test(store) &&
      /(?:ttlMs|TTL|15_?000)/u.test(store),
    purgesExpired:
      /expiresAt[\s\S]{0,260}(?:<=|<)[\s\S]{0,120}(?:now|clock)[\s\S]{0,400}\.delete\s*\(/iu.test(
        store,
      ) ||
      /(?:now|clock)[\s\S]{0,120}(?:>=|>)[\s\S]{0,160}expiresAt[\s\S]{0,400}\.delete\s*\(/iu.test(
        store,
      ),
    memoryOnly:
      store.length > 0 &&
      !/better-sqlite3|MetadataDatabase|\.prepare\s*\(|\bINSERT\b|\bUPDATE\b|\bDELETE\s+FROM\b|writeFile|appendFile/iu.test(
        store,
      ),
    candidateBinding: [
      /projectId/iu,
      /pageId/iu,
      /elementType/iu,
      /(?:defaultSize|defaultW|defaultH|registrySnapshot|sizeRule)/iu,
      /projectRevision/iu,
      /layoutRevision/iu,
      /canvasHeight/iu,
      /expiresAt/iu,
    ].every((pattern) => pattern.test(`${store}\n${candidate}`)),
    serverGridConstants:
      /(?:GRID_COLUMNS|columns|cols)\s*[:=]\s*24\b/iu.test(source) &&
      /(?:ROW_HEIGHT|rowHeight)\s*[:=]\s*8\b/iu.test(source) &&
      /(?:GRID_GAP|gap)\s*[:=]\s*8\b/iu.test(source) &&
      /(?:CANVAS_PADDING|padding)\s*[:=]\s*16\b/iu.test(source),
    serverOwnsCoordinateConversion:
      /canvasWidth/iu.test(candidateKernel) &&
      /(?:pointerX|localX|rawX|correctedCanvasX)/iu.test(candidateKernel) &&
      /(?:Math\.round|Math\.floor|snap)/iu.test(candidateKernel) &&
      /(?:columnWidth|strideX|GRID_COLUMNS|CANVAS_GRID\.columns|\/\s*24)/iu.test(
        candidateKernel,
      ),
    serverOwnsRegistryLimits:
      /(?:defaultW|defaultH|minW|minH|maxW|maxH)/iu.test(candidateKernel) &&
      /elementRegistry|getElementDefinition|elementDefinition|ELEMENT_REGISTRY/iu.test(
        candidateKernel,
      ),
    clampsBoundary:
      /Math\.(?:max|min)[\s\S]{0,500}(?:24|GRID_COLUMNS|CANVAS_GRID\.columns|columns)/iu.test(
        candidateKernel,
      ) &&
      /CANVAS_GRID\.columns\s*-\s*(?:size\.)?w|x\s*\+\s*w[\s\S]{0,120}(?:24|GRID_COLUMNS|CANVAS_GRID\.columns)/iu.test(
        candidateKernel,
      ),
    outOfBoundsIsInvalid:
      /valid\s*:\s*correctedCanvasX\s*>=\s*0[\s\S]{0,300}correctedCanvasX\s*<=\s*request\.canvasWidth[\s\S]{0,300}correctedCanvasY\s*>=\s*0/iu.test(
        candidateKernel,
      ) && /PLACEMENT_CANDIDATE_INVALID/u.test(store),
    verticalBoundaryBound:
      /canvasHeight|canonicalRows|maxRows/iu.test(candidateKernel) &&
      /correctedCanvasY\s*<=\s*(?:(?:request|input)\.)?(?:canvasHeight|[\w.]*maxRows[\w.]*|[\w.]*canonicalRows[\w.]*)/iu.test(
        candidateKernel,
      ) &&
      /(?:candidate|placement|layout)[\w]*(?:Pixel)?Bottom|bottom(?:Pixel|Pixels)|y\s*\+\s*h/iu.test(
        candidateKernel,
      ) &&
      /(?:bottom|y\s*\+\s*h)[\s\S]{0,300}<=\s*(?:(?:request|input)\.)?canvasHeight/iu.test(
        candidateKernel,
      ),
    serverVerticalCompaction:
      /verticalCompact|compactVertical|compactPlacement/iu.test(
        candidateKernel,
      ) &&
      ((/(?:while|for)\s*\([^)]*(?:y|row)[^)]*(?:>|>=)\s*0/iu.test(
        candidateKernel,
      ) &&
        /collision|rectanglesOverlap/iu.test(candidateKernel)) ||
        (/forbiddenVerticalIntervals/iu.test(candidateKernel) &&
          /\.filter\s*\([\s\S]{0,300}interval\.end\s*<\s*rectangle\.y/iu.test(
            candidateKernel,
          ) &&
          /\.at\s*\(\s*-1\s*\)/u.test(candidateKernel))),
    deterministicNearestCollision:
      /collision|rectanglesOverlap/iu.test(candidateKernel) &&
      /(?:distance|nearest|Manhattan|rowOffset|candidateY|search)/iu.test(
        candidateKernel,
      ) &&
      /(?:sort\s*\(|for\s*\(|while\s*\()/u.test(candidateKernel),
    fromPlacementForbidsGeometry:
      fromPlacementRoute.length > 0 &&
      /candidateId/iu.test(fromPlacementRoute) &&
      !/["'](?:x|y|w|h)["']/u.test(fromPlacementRoute.slice(0, 1800)),
    fromPlacementHasExpectedRevisions:
      /expectedProjectRevision/iu.test(fromPlacementRoute) &&
      /expectedLayoutRevision/iu.test(fromPlacementRoute) &&
      /idempotencyKey/iu.test(fromPlacementRoute),
    consumesOneTime:
      /\.consume\s*\(|consumeCandidate/iu.test(commit) &&
      /\.delete\s*\(|consumed/iu.test(`${store}\n${commit}`),
    replayBeforeConsume:
      replayIndex >= 0 && consumeIndex >= 0 && replayIndex < consumeIndex,
    rejectsExpired:
      /(?:CANDIDATE_EXPIRED|PLACEMENT_CANDIDATE_EXPIRED)/u.test(source) &&
      /(?:410|409)/u.test(`${store}\n${commit}`),
    rejectsStale:
      /(?:CANDIDATE_STALE|PLACEMENT_CANDIDATE_STALE|LAYOUT_REVISION_CONFLICT)/u.test(
        source,
      ) && /(?:409|conflict)/iu.test(commit),
    rejectsCrossPage:
      /candidate\.pageId[\s\S]{0,300}(?:pageId|page\.id)[\s\S]{0,300}(?:assert|throw|ApiError)/iu.test(
        commit,
      ) || /PLACEMENT_CANDIDATE_(?:PAGE|OWNERSHIP)_MISMATCH/u.test(source),
    noCommitRecompute:
      !/calculatePlacementCandidate\s*\(|resolvePlacementCandidate\s*\(|createPlacementCandidate\s*\(/u.test(
        commit.slice(Math.max(0, consumeIndex)),
      ),
    candidateResponseComplete: [
      /candidateId/iu,
      /\bx\b/u,
      /\by\b/u,
      /\bw\b/u,
      /\bh\b/u,
      /valid/iu,
      /collisionResolved/iu,
      /layoutRevision/iu,
      /expiresAt/iu,
    ].every((pattern) => pattern.test(candidate)),
  };
}

export function inspectLayoutProtocol(files) {
  const source = combinedSource(files);
  const patch = contextsFor(
    files,
    /patchElement|PATCH_ELEMENT|change\.kind/iu,
    16000,
  );
  const batch = contextsFor(files, /batchLayout|batch-layout/iu, 16000);
  const lifecycle = sourceForPath(
    files,
    /projects\/(?:project-service|project-repository)/u,
  );
  const elementService = sourceForPath(files, /elements\/element-service/iu);
  const deleteStart = elementService.search(/\n\s*delete\s*\(/u);
  const deleteTail = deleteStart < 0 ? "" : elementService.slice(deleteStart);
  const deleteEnd = deleteTail.search(/\n\s*(?:batchLayout|#insert)\s*\(/u);
  const deleteContext =
    deleteEnd < 0 ? deleteTail : deleteTail.slice(0, deleteEnd);
  const deleteReplayIndex = deleteContext.search(/#replay\s*(?:<|\()/u);
  const deleteActiveIndex = deleteContext.search(/#activeElement\s*\(/u);
  return {
    deleteReplaysBeforeActiveLookup:
      deleteReplayIndex >= 0 &&
      (deleteActiveIndex < 0 || deleteReplayIndex < deleteActiveIndex),
    fiveHundredsRollbackWithoutCommand:
      /error\s+instanceof\s+ApiError[\s\S]{0,300}statusCode\s*>=\s*400[\s\S]{0,300}statusCode\s*<\s*500/iu.test(
        elementService,
      ),
    centralProjectRevision:
      /expectedProjectRevision/iu.test(source) &&
      /revision\s*=\s*revision\s*\+\s*1/iu.test(source) &&
      /layoutRevision/iu.test(source),
    patchDiscriminatedChanges: ["MOVE", "RESIZE", "LOCK"].every((value) =>
      new RegExp(`["']${value}["']`, "u").test(patch),
    ),
    integerAndBoundsValidation:
      /Number\.isInteger/iu.test(source) &&
      /(?:x\s*\+\s*w|x\s*\+\s*width)[\s\S]{0,200}(?:24|GRID_COLUMNS)/iu.test(
        source,
      ) &&
      /minW|minimumWidth|definition\.min/iu.test(source) &&
      /maxW|maximumWidth|definition\.max/iu.test(source),
    lockedMoveResizeRejected:
      /locked[\s\S]{0,800}(?:MOVE|RESIZE)[\s\S]{0,800}(?:409|423|LOCKED|assertApi)/iu.test(
        patch,
      ) ||
      /(?:MOVE|RESIZE)[\s\S]{0,800}locked[\s\S]{0,800}(?:409|423|LOCKED|assertApi)/iu.test(
        patch,
      ) ||
      /current\.locked\s*===\s*0[\s\S]{0,240}["']ELEMENT_LOCKED["']/u.test(
        elementService,
      ),
    patchTransactional:
      /\.transaction\s*\(|BEGIN\s+(?:IMMEDIATE\s+)?TRANSACTION/iu.test(patch) &&
      /layout_revision|layoutRevision/iu.test(patch),
    batchSupportsCompleteAndPartial:
      /["']COMPLETE["']/u.test(batch) && /["']PARTIAL["']/u.test(batch),
    batchAtomicAndIdempotent:
      /\.transaction\s*\(|BEGIN\s+(?:IMMEDIATE\s+)?TRANSACTION/iu.test(batch) &&
      /idempotency/iu.test(batch) &&
      /request_?hash/iu.test(batch),
    batchOwnershipValidated:
      /projectId/iu.test(batch) &&
      /pageId/iu.test(batch) &&
      /(?:every|some|assertApi|mismatch|ownership)/iu.test(batch),
    durableBeforeAfterCommand:
      /element_commands/iu.test(source) &&
      /before_json|beforeJson/iu.test(source) &&
      /after_json|afterJson/iu.test(source),
    deleteIsSoftOrCommanded:
      /deleted_at/iu.test(source) &&
      /ELEMENT_DELETE|DELETE_ELEMENT|command_type/iu.test(source),
    publishIncludesElementLayouts:
      /snapshot\s*:\s*\{[\s\S]{0,1200}\bpages\b[\s\S]{0,1200}\belements\b[\s\S]{0,1200}\blayoutRevisions\b/iu.test(
        source,
      ) && /snapshot_json|snapshotJson|JSON\.stringify/iu.test(source),
    draftDoesNotRewriteVersions:
      /project_versions/iu.test(source) &&
      !/UPDATE\s+project_versions[\s\S]{0,400}(?:element|layout)/iu.test(
        source,
      ),
    lifecycleIncludesElements:
      /elements/iu.test(lifecycle) &&
      /elementLayouts|layouts/iu.test(lifecycle) &&
      /clone/iu.test(lifecycle) &&
      /export/iu.test(lifecycle) &&
      /import/iu.test(lifecycle),
    lifecycleRemapsStableIds:
      /elementIdMap|element_id_map|new\s+Map[\s\S]{0,500}element/iu.test(
        lifecycle,
      ) && /pageIdMap/iu.test(lifecycle),
    lifecyclePurgeRemovesElementData:
      /purge/iu.test(lifecycle) &&
      (/deleteProjectData|DELETE\s+FROM\s+elements|deleteElements/iu.test(
        lifecycle,
      ) ||
        (/deleteOwnedDefinitions/iu.test(lifecycle) &&
          /DELETE\s+FROM\s+pages\s+WHERE\s+project_id/iu.test(source) &&
          /references\s+pages[\s\S]{0,200}on\s+delete\s+cascade/iu.test(
            source,
          ))),
  };
}

export function inspectFrontendCanvasImplementation(files) {
  const elementFiles = files.filter(({ path }) =>
    /features\/elements\//u.test(path),
  );
  const source = combinedSource(elementFiles);
  const palette = sourceForPath(
    elementFiles,
    /ElementPalette|ElementWorkspace/iu,
  );
  const canvas = sourceForPath(elementFiles, /ElementCanvas/iu);
  const renderer = sourceForPath(elementFiles, /ElementRenderer/iu);
  const api = sourceForPath(files, /services\/elements-api/iu);
  const pageManager = sourceForPath(files, /PageManager\.tsx$/u);
  const styles = sourceForPath(files, /styles\.css$/u);
  const packageManifest = sourceForPath(files, /apps\/web\/package\.json$/u);
  const app = sourceForPath(files, /apps\/web\/src\/App\.tsx$/u);
  const editorWorkspaceStyles = cssRuleBody(styles, ".editor-workspace");
  const editorMainStyles = cssRuleBody(styles, ".editor-main");
  const canvasViewportStyles = cssRuleBody(styles, ".element-canvas-viewport");
  const zoomShellStyles = cssRuleBody(styles, ".element-canvas-zoom-shell");
  const dragEndContext =
    /(?:finishPointerDrop|handleDragEnd|onDragEnd)[\s\S]{0,2400}/iu.exec(
      palette,
    )?.[0] ?? "";
  const candidatePlaceholderContext =
    /(?:function\s+CandidatePlaceholder|const\s+CandidatePlaceholder)[\s\S]{0,7000}/iu.exec(
      canvas,
    )?.[0] ?? canvas;
  const placedElementKeyContext =
    /function\s+handleKeyDown\s*\([^)]*\)[\s\S]{0,1800}/u.exec(canvas)?.[0] ??
    canvas;
  const revisionApplyContext =
    /(?:const\s+applyRevisions\s*=|function\s+applyRevisions)[\s\S]{0,1500}/u.exec(
      palette,
    )?.[0] ?? palette;
  const removalContext =
    /(?:removeSelectedElements|removeElement)\s*=\s*useCallback[\s\S]{0,5000}/iu.exec(
      palette,
    )?.[0] ?? "";
  const requestKeyMatch =
    /requestKey|candidateGridKey|placementRequestKey/iu.exec(palette);
  const requestKeyContext =
    requestKeyMatch === null
      ? ""
      : palette.slice(
          Math.max(0, requestKeyMatch.index - 1800),
          requestKeyMatch.index + 3500,
        );
  const requestKeyExpression =
    /(?:const|let|var)\s+(?:requestKey|candidateGridKey|placementRequestKey)\s*=\s*([\s\S]{0,800}?);/iu.exec(
      requestKeyContext,
    )?.[1] ?? "";
  const overlayCount = palette.match(/<DragOverlay\b/gu)?.length ?? 0;
  const handles = new Set(
    [...canvas.matchAll(/["'](n|s|e|w|ne|nw|se|sw)["']/gu)].map(
      (match) => match[1],
    ),
  );
  const fakeMarkers = [
    ...source.matchAll(
      /\b(?:TODO|FIXME|mock element|coming soon|fake canvas)\b/giu,
    ),
  ].map((match) => match[0]);
  return {
    files: elementFiles.map(({ path }) => path),
    usesRealElementApi:
      /listElements|createElementFromPlacement|createPlacementCandidate/iu.test(
        source,
      ) && /\/api\/v1\//u.test(api),
    candidateRequestsMeasuredHeight:
      /createPlacementCandidate[\s\S]{0,1800}canvasHeight/iu.test(api) &&
      /createPlacementCandidate[\s\S]{0,1800}canvasHeight/iu.test(palette),
    candidateCommitOnlyById:
      /candidateId/iu.test(api) &&
      /from-placement/iu.test(api) &&
      !/from-placement[\s\S]{0,1200}\b(?:x|y|w|h)\s*:/iu.test(api),
    dndKitPaletteOnly:
      /@dnd-kit\/core/u.test(palette) &&
      /PointerSensor/u.test(palette) &&
      /KeyboardSensor|onKeyboardPlace|beginKeyboardPlacement/iu.test(palette) &&
      !/\bDndContext\b|useDraggable\s*\(|PointerSensor|KeyboardSensor|DragOverlay/iu.test(
        canvas,
      ),
    onePaletteOverlay: overlayCount === 1,
    pageReorderContextSeparate:
      /<DndContext\b/u.test(pageManager) && /<DndContext\b/u.test(palette),
    controlledReactGridLayout:
      /react-grid-layout/u.test(canvas) &&
      /\blayout\s*=|layout\s*:/u.test(canvas) &&
      /onDragStop/u.test(canvas) &&
      /onResizeStop/u.test(canvas) &&
      !/react-grid-layout/u.test(palette),
    reactGridLayoutV2: /["']react-grid-layout["']\s*:\s*["'](?:\^|~)?2\./u.test(
      packageManifest,
    ),
    allEightResizeHandles: REQUIRED_RESIZE_HANDLES.every((handle) =>
      handles.has(handle),
    ),
    requiredTestIds: [
      /element-palette/u,
      /palette-item-/u,
      /palette-drag-overlay/u,
      /element-canvas/u,
      /placement-placeholder/u,
      /placed-element-/u,
      /resize-handle-/u,
      /resize-tooltip/u,
    ].every((pattern) => pattern.test(source)),
    placeholderShowsCandidateGeometry:
      ["data-x", "data-y", "data-w", "data-h", "data-valid"].every(
        (attribute) => source.includes(attribute),
      ) && /collision-resolved/u.test(source),
    placeholderUsesServerCandidate:
      /placementCandidate|candidate/iu.test(source) &&
      /candidate\.(?:x|y|w|h)/u.test(source),
    moveAndResizePersistOnlyOnStop:
      /onDragStop/u.test(canvas) &&
      /onResizeStop/u.test(canvas) &&
      !/onDrag\s*=\s*\{[^}]*update|onResize\s*=\s*\{[^}]*update/iu.test(canvas),
    rejectsOutOfOrderCandidate:
      /candidateSequence|requestSequence|candidateRequestId/iu.test(palette) &&
      /(?:sequence|requestId)[\s\S]{0,500}(?:!==|===)[\s\S]{0,500}(?:return|setCandidate)/iu.test(
        palette,
      ),
    finalDropAwaitsLastCandidate:
      /await[\s\S]{0,500}(?:requestCandidate|createPlacementCandidate)/iu.test(
        dragEndContext,
      ) &&
      /(?:commitPlacement|commitCandidate|createElementFromPlacement)[\s\S]{0,800}(?:candidateId|candidate)/iu.test(
        dragEndContext,
      ),
    freshDropReusesVisibleCandidate:
      !/force\s*:\s*true/iu.test(dragEndContext) &&
      /(?:requestCandidate|cachedCandidate|existingRequest)/iu.test(
        dragEndContext,
      ),
    candidateRequestsCoalesced:
      (/(?:existingRequest|cachedRequest)[\s\S]{0,300}(?:key|requestKey)[\s\S]{0,100}===[\s\S]{0,100}requestKey/iu.test(
        palette,
      ) &&
        /return[\s\S]{0,100}(?:existingRequest\.promise|cachedCandidate)/iu.test(
          palette,
        )) ||
      (/requestAnimationFrame|animationFrame/iu.test(palette) &&
        /candidateCell[\s\S]{0,200}!={0,1}[\s\S]{0,200}(?:gridCell|requestKey)/iu.test(
          palette,
        )),
    candidateKeyMatchesServerRounding:
      (/Math\.round|roundAndClamp|snappedColumn|candidateGridKey/iu.test(
        requestKeyContext,
      ) ||
        (/snapPlacementCell/iu.test(requestKeyContext) &&
          /function\s+snapPlacementCell[\s\S]{0,1800}Math\.round/iu.test(
            source,
          ))) &&
      /CANVAS_PADDING|padding/iu.test(`${requestKeyContext}\n${source}`) &&
      /gridColumnWidth|columnPitch|strideX/iu.test(
        `${requestKeyContext}\n${source}`,
      ) &&
      !/Math\.floor/iu.test(requestKeyContext),
    candidateKeyIncludesBounds:
      /(?:inBounds|outOfBounds|outside|boundary|boundsKey|validityKey)/iu.test(
        requestKeyExpression,
      ) &&
      /canvasHeight/iu.test(requestKeyExpression) &&
      /correctedCanvas[XY]|canvasWidth/iu.test(requestKeyContext),
    expiredCandidateCacheRefresh:
      /expiresAt/iu.test(source) &&
      /Date\.parse|new\s+Date|getTime\s*\(/iu.test(source) &&
      /(?:safety|margin|force\s*:|fresh|minimumValidity)/iu.test(source) &&
      /(?:handleDragEnd|finishPointerDrop)[\s\S]{0,2200}await[\s\S]{0,300}(?:requestCandidate|createPlacementCandidate)/iu.test(
        palette,
      ),
    candidateControlKeysIsolated:
      /(?:event\.target\s*!==\s*event\.currentTarget|event\.currentTarget\s*!==\s*event\.target)[\s\S]{0,180}(?:return|commitPlacement)/iu.test(
        palette,
      ) ||
      /event\.target\s*===\s*event\.currentTarget[\s\S]{0,180}(?:handleCandidateKeyDown|commitPlacement)/iu.test(
        candidatePlaceholderContext,
      ) ||
      /placement-placeholder-actions[\s\S]{0,1800}onKeyDown\s*=\s*\{[\s\S]{0,220}stopPropagation/iu.test(
        candidatePlaceholderContext,
      ),
    candidateChildEscapeRouted:
      /onKeyDown[\s\S]{0,500}(?:event\.key\s*===?\s*["']Escape["'][\s\S]{0,260}(?:handleCandidateKeyDown|cancelPlacement)|(?:handleCandidateKeyDown|cancelPlacement)[\s\S]{0,260}event\.key\s*===?\s*["']Escape["'])/iu.test(
        candidatePlaceholderContext,
      ),
    candidateActionsPointerEnabled:
      /role\s*=\s*\{[^}]*["']group["']|role\s*=\s*["']group["']/iu.test(
        candidatePlaceholderContext,
      ) &&
      /placement-placeholder(?:\[role=["']group["']\]|-actions[\s\S]{0,180}\[data-slot=["']button["']\])[\s\S]{0,300}pointer-events\s*:\s*auto/iu.test(
        styles,
      ),
    distinguishesCollisionFromConcurrency:
      /(?:reason|error)\.code\s*===?\s*["']ELEMENT_COLLISION["'][\s\S]{0,700}(?:collision|충돌)/iu.test(
        palette,
      ),
    lockedDeletePreflight:
      /element-delete-control[\s\S]{0,700}disabled\s*=\s*\{[^}]*locked/iu.test(
        canvas,
      ) &&
      /locked[\s\S]{0,1200}(?:return|setError)[\s\S]{0,1800}deleteElement/iu.test(
        removalContext,
      ),
    monotonicProjectRevision:
      /onProjectRevisionChange[\s\S]{0,900}(?:Math\.max\s*\(\s*current\.revision\s*,\s*revision\s*\)|revision\s*:\s*Math\.max)/iu.test(
        app,
      ),
    monotonicPageLayoutRevision:
      /layoutRevision\s*:\s*Math\.max\s*\(\s*current\.layoutRevision\s*,\s*nextLayoutRevision\s*\)/iu.test(
        revisionApplyContext,
      ),
    nestedControlKeyIsolation:
      /event\.target\s*!==\s*event\.currentTarget|event\.currentTarget\s*!==\s*event\.target/iu.test(
        placedElementKeyContext,
      ) &&
      /Arrow(?:Up|Down|Left|Right)|startsWith\s*\(\s*["']Arrow["']/u.test(
        placedElementKeyContext,
      ),
    compactionPersistsCompleteLayout:
      /verticalCompactor/iu.test(canvas) &&
      /verticalCompactor(?:\.compact)?\s*\(/iu.test(canvas) &&
      /batchElementLayout|batchLayout/iu.test(`${canvas}\n${palette}`) &&
      /(?:handleDragStop|onDragStop)[\s\S]{0,1800}(?:nextLayout|layout)[\s\S]{0,1800}(?:COMPLETE|batch)/iu.test(
        canvas,
      ) &&
      /(?:handleResizeStop|onResizeStop)[\s\S]{0,1800}(?:nextLayout|layout)[\s\S]{0,1800}(?:COMPLETE|batch)/iu.test(
        canvas,
      ),
    canonicalLayoutUncompactedOnRender:
      /\bnoCompactor\b/u.test(canvas) &&
      /compactor\s*=\s*\{\s*noCompactor\s*\}/u.test(canvas) &&
      !/compactor\s*=\s*\{\s*verticalCompactor\s*\}/u.test(canvas),
    viewportOwnsBidirectionalOverflow:
      /(?:^|;)\s*height\s*:/u.test(editorWorkspaceStyles) &&
      /(?:^|;)\s*min-height\s*:\s*0\b/u.test(editorWorkspaceStyles) &&
      /(?:^|;)\s*min-height\s*:\s*0\b/u.test(editorMainStyles) &&
      /(?:^|;)\s*overflow\s*:\s*(?:hidden|clip)\b/u.test(editorMainStyles) &&
      /(?:^|;)\s*min-width\s*:\s*0\b/u.test(canvasViewportStyles) &&
      /(?:^|;)\s*min-height\s*:\s*0\b/u.test(canvasViewportStyles) &&
      /(?:^|;)\s*overflow\s*:\s*(?:auto|scroll)\b/u.test(
        canvasViewportStyles,
      ) &&
      /(?:^|;)\s*width\s*:[\s\S]*--canvas-zoom/iu.test(zoomShellStyles) &&
      /(?:^|;)\s*min-height\s*:[\s\S]*--canvas-zoom/iu.test(zoomShellStyles),
    honorsReducedMotion:
      /prefers-reduced-motion|useReducedMotion|reducedMotion/iu.test(
        `${source}\n${styles}`,
      ) && /palette-drag-overlay|placement-placeholder/iu.test(styles),
    selectionAndLock:
      /selectedElement|selection/iu.test(source) &&
      /locked/iu.test(source) &&
      /isDraggable|isResizable|static\s*:/iu.test(canvas),
    keyboardMovement:
      /ArrowUp|ArrowDown|ArrowLeft|ArrowRight/u.test(source) &&
      /shiftKey/iu.test(source) &&
      /(?:4|STEP_LARGE)/u.test(source),
    escapeAndDelete: /Escape/u.test(source) && /Delete/u.test(source),
    accessiblePalette:
      /aria-label|aria-describedby|role=/iu.test(palette) &&
      /tabIndex|button/iu.test(palette),
    validSelectionSemantics:
      /role=["']listbox["']|role\s*=\s*["']listbox["']/iu.test(canvas) &&
      /aria-multiselectable/iu.test(canvas) &&
      /role=["']option["']|role\s*=\s*["']option["']/iu.test(canvas) &&
      /aria-selected/iu.test(canvas),
    singleDroppableRefRegistration:
      (canvas.match(/setDroppableRef\s*\(/gu)?.length ?? 0) === 1,
    realRenderer:
      renderer.length > 0 &&
      /element\.type|elementType|definition\.type/iu.test(renderer) &&
      /<(?:div|button|input|p|span|article|section)\b/u.test(renderer),
    noFakeMarkers: fakeMarkers.length === 0,
    fakeMarkers,
    overlayCount,
    resizeHandles: [...handles].sort(),
  };
}

function isBehavioralTest(source) {
  return (
    /\b(?:it|test)(?:\.each\s*\([^;\n]*\))?\s*\(/u.test(source) &&
    /\b(?:expect|assert\.(?:equal|deepEqual|ok|match|throws|rejects))\s*\(/u.test(
      source,
    )
  );
}

function parameterTableContext(fileSource, caseSource) {
  const tableName = /\b(?:it|test)\.each\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/u.exec(
    caseSource,
  )?.[1];
  if (tableName === undefined) return "";
  const declaration = new RegExp(
    `\\b(?:const|let|var)\\s+${tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^=]*=`,
    "u",
  ).exec(fileSource);
  if (declaration === null) return "";
  const tail = fileSource.slice(declaration.index);
  const end = tail.search(/\n\s*\];?\s*(?:\n|$)/u);
  return end < 0 ? tail.slice(0, 8000) : tail.slice(0, end + 4);
}

function behavioralCases(files) {
  return files
    .filter(({ source }) => isBehavioralTest(source))
    .flatMap((file) =>
      file.source
        .split(/(?=\b(?:it|test)(?:\.each\s*\([^;\n]*\))?\s*\()/u)
        .filter(
          (source) =>
            /\b(?:it|test)(?:\.each\s*\([^;\n]*\))?\s*\(/u.test(source) &&
            /\b(?:expect|assert\.)/u.test(source),
        )
        .map((source) => ({
          path: file.path,
          source: `${parameterTableContext(file.source, source)}\n${source}`,
        })),
    );
}

function someCaseMatches(cases, patterns) {
  return cases.some(({ source }) =>
    patterns.every((pattern) => pattern.test(source)),
  );
}

function casesCollectivelyMatch(cases, patternGroups) {
  return patternGroups.every((patterns) => someCaseMatches(cases, patterns));
}

function hasPositiveRect(rect) {
  return (
    rect !== null &&
    typeof rect === "object" &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function sameRectSize(rects) {
  return (
    rects.length > 1 &&
    rects.every(hasPositiveRect) &&
    rects.every(
      (rect) =>
        rect.width === rects[0].width && rect.height === rects[0].height,
    )
  );
}

export function inspectBrowserGeometryEvidence(evidence) {
  const projectControls = Array.isArray(evidence?.projectSiblingControlRects)
    ? evidence.projectSiblingControlRects
    : [];
  const paletteControls = Array.isArray(evidence?.paletteSiblingRects)
    ? evidence.paletteSiblingRects
    : [];
  const canvasControls = Array.isArray(evidence?.canvasSiblingControlRects)
    ? evidence.canvasSiblingControlRects
    : [];
  const candidate = evidence?.previewCommitGeometry?.candidate;
  const committed = evidence?.previewCommitGeometry?.committed;
  const overflow = evidence?.zoomOverflowOwnership;
  const layoutKeys = ["x", "y", "w", "h"];
  const rectKeys = ["x", "y", "width", "height"];
  return {
    operationalPass:
      evidence?.result === "PASS" &&
      evidence?.target === "isolated local browser session" &&
      /^http:\/\/127\.0\.0\.1:\d+\/$/u.test(evidence?.url ?? "") &&
      Number.isFinite(Date.parse(evidence?.generatedAt ?? "")),
    projectSiblingGeometry:
      projectControls.length === 2 && sameRectSize(projectControls),
    paletteSiblingGeometry:
      paletteControls.length === 4 && sameRectSize(paletteControls),
    canvasSiblingGeometry:
      canvasControls.length === 2 && sameRectSize(canvasControls),
    previewCommitLayoutExact:
      candidate?.valid === true &&
      layoutKeys.every(
        (key) =>
          Number.isInteger(candidate?.layout?.[key]) &&
          candidate.layout[key] === committed?.layout?.[key],
      ),
    previewCommitMeasuredRectExact:
      hasPositiveRect(candidate?.canvasDocumentRelativeRect) &&
      hasPositiveRect(committed?.canvasDocumentRelativeRect) &&
      rectKeys.every(
        (key) =>
          candidate.canvasDocumentRelativeRect[key] ===
          committed.canvasDocumentRelativeRect[key],
      ),
    bidirectionalViewportOverflow:
      overflow?.zoom === 2 &&
      overflow?.viewportWidth === 1280 &&
      overflow?.viewportHeight === 720 &&
      Number.isFinite(overflow?.clientWidth) &&
      Number.isFinite(overflow?.scrollWidth) &&
      overflow.scrollWidth > overflow.clientWidth &&
      Number.isFinite(overflow?.clientHeight) &&
      Number.isFinite(overflow?.scrollHeight) &&
      overflow.scrollHeight > overflow.clientHeight &&
      overflow?.scrollLeftAfter > 0 &&
      overflow?.scrollTopAfter > 0 &&
      overflow?.pageScrollWidthAfter === overflow?.pageScrollWidthBefore &&
      overflow?.pageScrollHeightAfter === overflow?.pageScrollHeightBefore,
  };
}

export function inspectPhase5TestInventory(files) {
  const paths = files.map(({ path }) => path);
  const behavioralFiles = files.filter(({ source }) =>
    isBehavioralTest(source),
  );
  const cases = behavioralCases(files);
  const serverCases = cases.filter(({ path }) =>
    /apps\/server\/test\//u.test(path),
  );
  const domainCases = cases.filter(({ path }) =>
    /packages\/domain\/test\//u.test(path),
  );
  const webCases = cases.filter(({ path }) =>
    /apps\/web\/src\/|(?:^|\/)e2e\//u.test(path),
  );
  const testSourceByPath = new Map(
    files.map((file) => [file.path, file.source]),
  );
  const geometryCases = webCases.filter(({ path, source: caseSource }) => {
    const fileSource = testSourceByPath.get(path) ?? "";
    const globallyMocksLayout =
      /spyOn\s*\(\s*HTMLElement\.prototype\s*,\s*["']getBoundingClientRect["'][\s\S]{0,300}mockImplementation/iu.test(
        fileSource,
      );
    if (!globallyMocksLayout) return true;
    return (
      (/getComputedStyle\s*\(/u.test(fileSource) ||
        (/stylesCss/u.test(fileSource) &&
          /cssDeclaration\s*\(/u.test(fileSource) &&
          /cssPixels\s*\(/u.test(fileSource))) &&
      /(?:\.style\.(?:left|top|width|height)|parseFloat\s*\(|CSSStyleDeclaration)/u.test(
        fileSource,
      ) &&
      /getBoundingClientRect|DOMRect/iu.test(caseSource)
    );
  });
  const source = combinedSource(files);
  const skippedTests = [
    ...source.matchAll(
      /\b(?:describe|it|test)\.skip\s*\(|\b(?:xit|xdescribe)\s*\(|\.todo\s*\(/gu,
    ),
  ].map((match) => match[0]);

  const candidateSecurity = casesCollectivelyMatch(serverCases, [
    [
      /candidate/iu,
      /(?:consume|reuse|second)/iu,
      /(?:409|410|CONSUMED|conflict)/iu,
      /expect|assert/u,
    ],
    [/candidate/iu, /expir/iu, /(?:409|410|EXPIRED)/iu, /expect|assert/u],
    [
      /candidate/iu,
      /stale|revision/iu,
      /409|STALE|CONFLICT/u,
      /expect|assert/u,
    ],
    [
      /candidate/iu,
      /cross[ -]?(?:page|project)|another page|ownership/iu,
      /(?:404|409|MISMATCH)/iu,
      /expect|assert/u,
    ],
    [
      /from-placement|fromPlacement/iu,
      /(?:x\s*:|geometry|unknown field|tamper)/iu,
      /400|UNKNOWN_REQUEST_FIELD/u,
      /expect|assert/u,
    ],
  ]);

  const resizeHandleCoverage = REQUIRED_RESIZE_HANDLES.every((handle) =>
    someCaseMatches(webCases, [
      new RegExp(`resize-handle-${handle}\\b|["']${handle}["']`, "u"),
      /pointer\.drag|(?:pointer|mouse)(?:Move|Up)|drag/iu,
      /batch|persist|save|updateElement|data-[wh]|layout/iu,
      /expect|assert/u,
    ]),
  );

  const zoomValues = [50, 75, 100, 125, 150, 200];
  const zoomCoverage = zoomValues.every((zoom) =>
    webCases.some(({ source: caseSource }) =>
      new RegExp(
        `(?:zoom|배율)[^\\n]{0,80}${zoom}|${zoom}[^\\n]{0,80}(?:zoom|%)`,
        "iu",
      ).test(caseSource),
    ),
  );

  const capabilities = {
    "sqlite-v4-constraints-and-ownership": casesCollectivelyMatch(serverCases, [
      [/user_version|schema version/iu, /\b4\b/u, /expect|assert/u],
      [
        /elements|element_layouts/iu,
        /foreign key|constraint|ownership/iu,
        /(?:toThrow|reject|SQLITE_CONSTRAINT|expect|assert)/iu,
      ],
      [
        /x|geometry/iu,
        /(?:integer|boundary|24|constraint)/iu,
        /(?:toThrow|reject|SQLITE_CONSTRAINT)/iu,
      ],
    ]),
    "page-layout-revision-lifecycle": casesCollectivelyMatch(serverCases, [
      [
        /(?:new|create)[ -]?Page|Page create/iu,
        /page_layout_revisions|layoutRevision/iu,
        /(?:\b0\b|initial|listElements|GET)/iu,
        /expect|assert/u,
      ],
      [
        /import|clone/iu,
        /page_layout_revisions|layoutRevision/iu,
        /element|canvas/iu,
        /expect|assert/u,
      ],
    ]),
    "layout-revision-and-idempotency": casesCollectivelyMatch(serverCases, [
      [
        /layoutRevision|layout_revision/iu,
        /(?:stale|409|conflict)/iu,
        /expect|assert/u,
      ],
      [
        /idempotency/iu,
        /(?:replay|same response|toEqual|deepEqual)/iu,
        /expect|assert/u,
      ],
      [
        /idempotency/iu,
        /(?:different|mismatch|payload)/iu,
        /(?:409|conflict)/iu,
        /expect|assert/u,
      ],
    ]),
    "delete-idempotent-replay": someCaseMatches(serverCases, [
      /delete/iu,
      /same idempotency|same key|retry|replay/iu,
      /(?:twice|second|2)/iu,
      /(?:200|same response|toEqual|deepEqual)/iu,
      /expect|assert/u,
    ]),
    "server-5xx-rollback-and-retry": someCaseMatches(serverCases, [
      /500|5xx|server failure/iu,
      /rollback|unchanged|no command|not recorded/iu,
      /same idempotency|same key|retry/iu,
      /succeed|201|200/iu,
      /expect|assert/u,
    ]),
    "candidate-bounded-ttl-and-no-database-write": casesCollectivelyMatch(
      serverCases,
      [
        [
          /PlacementCandidateStore|candidate store/iu,
          /(?:512|capacity|evict|bounded)/iu,
          /expect|assert/u,
        ],
        [
          /candidate/iu,
          /(?:15_?000|15 seconds|expire|clock)/iu,
          /expect|assert/u,
        ],
        [
          /placement-candidates|createCandidate/iu,
          /(?:total_changes|database|sqlite|file hash|stat|count)/iu,
          /(?:toBe|equal|deepEqual)[\s\S]{0,100}(?:before|baseline)/iu,
        ],
      ],
    ),
    "candidate-consume-expire-stale-tamper-cross-page": candidateSecurity,
    "server-snap-boundary-and-nearest-collision": casesCollectivelyMatch(
      serverCases,
      [
        [
          /placement|candidate/iu,
          /24|column|snap/iu,
          /(?:x|y|w|h)/u,
          /expect|assert/u,
        ],
        [
          /boundary|clamp|out of bounds/iu,
          /(?:left|right|top|bottom|24)/iu,
          /expect|assert/u,
        ],
        [
          /collision/iu,
          /nearest|deterministic|closest/iu,
          /collisionResolved/iu,
          /collisionResolved\s*:\s*true[\s\S]{0,240}\b(?:x|y)\s*:\s*\d|\b(?:x|y)\s*:\s*\d[\s\S]{0,240}collisionResolved\s*:\s*true/iu,
          /expect|assert/u,
        ],
        [/locked/iu, /collision/iu, /expect|assert/u],
      ],
    ),
    "out-of-bounds-invalid-and-blocked": someCaseMatches(serverCases, [
      /out(?:[ -]?of[ -]?bounds|side)|outside canvas|negative pointer/iu,
      /clamp|\bx\s*:\s*0\b/iu,
      /valid[\s\S]{0,100}false|toBe\s*\(\s*false\s*\)/iu,
      /from-placement|commit/iu,
      /409|PLACEMENT_CANDIDATE_INVALID/u,
      /expect|assert/u,
    ]),
    "server-bottom-boundary-invalid": someCaseMatches(serverCases, [
      /bottom|canvasHeight|below canvas/iu,
      /(?:\+\s*1|one pixel|1px|outside|out[ -]?of[ -]?bounds)/iu,
      /valid[\s\S]{0,120}false|toBe\s*\(\s*false\s*\)/iu,
      /from-placement|commit/iu,
      /409|PLACEMENT_CANDIDATE_INVALID/u,
      /expect|assert/u,
    ]),
    "server-placement-vertical-compaction": casesCollectivelyMatch(
      serverCases,
      [
        [
          /empty/iu,
          /(?:pointer|row|y)[^\n]{0,100}(?:12|below)/iu,
          /candidate|placement/iu,
          /(?:\by\s*:\s*0\b|\.y\)\.toBe\s*\(\s*0\s*\))/u,
          /expect|assert/u,
        ],
        [
          /blocker|occupied|existing element/iu,
          /vertical[ -]?compact|compactPlacement|candidate/iu,
          /\by\s*:\s*\d+|\.y\)\.toBe\s*\(\s*\d+/u,
          /expect|assert/u,
        ],
      ],
    ),
    "preview-and-commit-exact-geometry": someCaseMatches(
      [...serverCases, ...webCases],
      [
        /candidate|placeholder/iu,
        /from-placement|commit|created/iu,
        /\b(?:x|y|w|h)\b/u,
        /toEqual|deepEqual|toMatchObject/iu,
      ],
    ),
    "all-kernel-element-types-preview-and-commit": someCaseMatches(
      [...serverCases, ...domainCases],
      [
        /ELEMENT_DEFINITIONS|registered element|every element type/iu,
        /for\s*\(|\.map\s*\(|\.forEach\s*\(/u,
        /placement|candidate/iu,
        /from-placement|commit|created/iu,
        /\b(?:x|y|w|h)\b/u,
        /toEqual|deepEqual|toMatchObject/iu,
      ],
    ),
    "twenty-elements-reload-and-restart": casesCollectivelyMatch(serverCases, [
      [
        /20|twenty/iu,
        /element/iu,
        /(?:toHaveLength|length|count)/iu,
        /expect|assert/u,
      ],
      [
        /restart|reopen|new MetadataDatabase|close\(\)/iu,
        /element|layout/iu,
        /toEqual|deepEqual|expect|assert/u,
      ],
    ]),
    "eight-resize-handles-minmax-and-lock":
      resizeHandleCoverage &&
      casesCollectivelyMatch(
        [...serverCases, ...webCases],
        [
          [/resize/iu, /minW|minH|minimum|min size/iu, /expect|assert/u],
          [/resize/iu, /maxW|maxH|maximum|max size/iu, /expect|assert/u],
          [
            /locked/iu,
            /(?:resize|move)/iu,
            /(?:reject|disabled|false|409|423)/iu,
            /expect|assert/u,
          ],
        ],
      ),
    "selection-keyboard-and-cancel-delete": casesCollectivelyMatch(webCases, [
      [/select|selection/iu, /click|pointer/iu, /expect|assert/u],
      [
        /Arrow(?:Up|Down|Left|Right)/u,
        /shiftKey|Shift/iu,
        /(?:1|4|grid)/iu,
        /expect|assert/u,
      ],
      [
        /Escape/u,
        /(?:palette|pointer)[ -]?(?:drag|placement)|drag overlay/iu,
        /cancel|rollback|revert|not\.toBeInTheDocument|toHaveLength\s*\(\s*0/iu,
        /expect|assert/u,
      ],
      [
        /Escape/u,
        /(?:RGL|react-grid-layout|canvas|element)[ -]?drag/iu,
        /rollback|revert|original|no save|not\.toHaveBeenCalled|toHaveLength\s*\(\s*0/iu,
        /expect|assert/u,
      ],
      [
        /Escape/u,
        /resize/iu,
        /rollback|revert|original|no save|not\.toHaveBeenCalled|toHaveLength\s*\(\s*0/iu,
        /expect|assert/u,
      ],
      [
        /Escape/u,
        /selection|selected/iu,
        /clear|false|not\.toHaveAttribute/iu,
        /expect|assert/u,
      ],
      [/Delete/u, /element/iu, /expect|assert/u],
    ]),
    "zoom-scroll-boundary-input-matrix":
      zoomCoverage &&
      casesCollectivelyMatch(webCases, [
        [/scroll/iu, /(?:scrollLeft|horizontal)/iu, /expect|assert/u],
        [/scroll/iu, /(?:scrollTop|vertical)/iu, /expect|assert/u],
        [/boundary/iu, /(?:left|right|top|bottom)/iu, /expect|assert/u],
        [/pointer/iu, /candidate|placement/iu, /expect|assert/u],
        [/keyboard/iu, /candidate|placement/iu, /expect|assert/u],
      ]),
    "project-lifecycle-element-ownership": someCaseMatches(serverCases, [
      /clone/iu,
      /export/iu,
      /import/iu,
      /trash/iu,
      /restore/iu,
      /purge/iu,
      /element/iu,
      /(?:remap|not\.toEqual|same id|ownership|checksum)/iu,
      /expect|assert/u,
    ]),
    "immutable-publish-and-draft-isolation": someCaseMatches(serverCases, [
      /publish|project_versions/iu,
      /element|layout/iu,
      /draft/iu,
      /immutable|unchanged|snapshot/iu,
      /expect|assert/u,
    ]),
    "palette-pointer-keyboard-and-rgl-boundary": casesCollectivelyMatch(
      webCases,
      [
        [
          /palette/iu,
          /pointer|PointerSensor/iu,
          /DragOverlay|overlay/iu,
          /expect|assert/u,
        ],
        [
          /palette/iu,
          /keyboard|KeyboardSensor/iu,
          /candidate|drop|placement/iu,
          /expect|assert/u,
        ],
        [
          /react-grid-layout|GridLayout|\bRGL\b/iu,
          /onDragStop|onResizeStop|mouseMove|pointerMove/iu,
          /move|resize/iu,
          /batch|persist|save|updateElement/iu,
          /toHave(?:BeenCalledTimes|Length)\s*\(\s*1\s*\)/u,
          /expect|assert/u,
        ],
      ],
    ),
    "latest-candidate-race-and-final-pointer": someCaseMatches(webCases, [
      /delayed|out[ -]of[ -]order|race|deferred/iu,
      /final pointer|last pointer|DragEnd|drop/iu,
      /candidate/iu,
      /commit|from-placement/iu,
      /toBe|toEqual|toMatchObject|toHaveBeenLastCalledWith/iu,
    ]),
    "candidate-request-coalescing": casesCollectivelyMatch(webCases, [
      [
        /pointerMove|mouseMove|dragMove/iu,
        /(?:many|pixel|repeat|20|100|moves? that snap|for\s*\()/iu,
        /requestAnimationFrame|coalesc|grid cell/iu,
        /toHave(?:BeenCalledTimes|Length)\s*\(\s*[1-9]\d?\s*\)/u,
      ],
      [
        /DragEnd|final request|final pointer|last candidate/iu,
        /not dropped|resolve|await/iu,
        /expect|assert/u,
      ],
    ]),
    "candidate-key-matches-server-rounding": someCaseMatches(webCases, [
      /half[ -]?cell|round(?:ing)? threshold|floor.*round/iu,
      /same[^\n]{0,100}(?:floor|coarse|cell)|(?:49|51|0\.49|0\.51)/iu,
      /candidate|request/iu,
      /(?:two|2|different|not\.toEqual)/iu,
      /expect|assert/u,
    ]),
    "expired-candidate-cache-refresh": someCaseMatches(webCases, [
      /15(?:_?000| seconds)|expire|stationary long drag/iu,
      /cache|same key|stationary/iu,
      /pointer(?:Move|Up)|mouse(?:Move|Up)|dragOver/iu,
      /DragEnd|drop|final/iu,
      /fresh|refresh|new candidate|not\.toEqual/iu,
      /commit|from-placement|succeed/iu,
      /expect|assert/u,
    ]),
    "compaction-atomic-batch-reload": someCaseMatches(webCases, [
      /vertical[ -]?compact|compaction|verticalCompactor/iu,
      /RGL|react-grid-layout|mouse(?:Move|Up)|pointer(?:Move|Up)|onDragStop|onResizeStop/iu,
      /(?:2|two|multiple)[^\n]{0,100}(?:item|element)|(?:item|element)[^\n]{0,100}(?:2|two|multiple)/iu,
      /batch|COMPLETE|atomic/iu,
      /reload|listElements|GET/iu,
      /toHave(?:BeenCalledTimes|Length)\s*\(\s*1\s*\)/u,
      /toEqual|deepEqual|toHaveAttribute/iu,
    ]),
    "measured-placeholder-and-control-geometry": casesCollectivelyMatch(
      geometryCases,
      [
        [
          /placement-placeholder/iu,
          /getBoundingClientRect|DOMRect/iu,
          /placed-element|\bplaced\b|findByRole\s*\(\s*["']option/iu,
          /toEqual|deepEqual|toBeCloseTo/iu,
        ],
        [
          /palette/iu,
          /getBoundingClientRect|DOMRect/iu,
          /(?:4|four|all)[^\n]{0,100}(?:item|control|button)|(?:item|control|button)[^\n]{0,100}(?:4|four|all)|paletteItems[\s\S]{0,1200}toHaveLength\s*\(\s*4\s*\)/iu,
          /(?:height|width)/iu,
          /toEqual|deepEqual|toBe/iu,
        ],
        [
          /canvas/iu,
          /(?:sibling|zoom|grid|control)/iu,
          /getBoundingClientRect|DOMRect/iu,
          /(?:minHeight|borderRadius|padding|height|width)/iu,
          /toEqual|deepEqual|toBe/iu,
        ],
      ],
    ),
    "candidate-controls-keyboard-isolation": someCaseMatches(webCases, [
      /cancel|취소/iu,
      /Enter/u,
      /candidate|placement-placeholder|배치 후보/iu,
      /fromPlacement|from-placement|createElementFromPlacement|commit/iu,
      /not\.toHaveBeenCalled|toHaveBeenCalledTimes\s*\(\s*0\s*\)|toHaveLength\s*\(\s*0\s*\)|toBeVisible|toBeNull|not\.toBeInTheDocument/iu,
      /expect|assert/u,
    ]),
    "candidate-child-focus-escape-cancels": someCaseMatches(webCases, [
      /candidate|placement-placeholder|배치 후보/iu,
      /child|cancel button|commit button|취소|배치/iu,
      /\.focus\s*\(|toHaveFocus|focused/iu,
      /Escape/u,
      /not\.toBeInTheDocument|toBeNull|toHaveLength\s*\(\s*0\s*\)/iu,
      /mutationCalls|fromPlacement|from-placement|commit/iu,
      /not\.toHaveBeenCalled|toHaveBeenCalledTimes\s*\(\s*0\s*\)|toHaveLength\s*\(\s*0\s*\)/iu,
      /expect|assert/u,
    ]),
    "candidate-actions-pointer-clickable": casesCollectivelyMatch(webCases, [
      [
        /cancel|취소/iu,
        /user\.click|pointer\.click|\.click\s*\(/u,
        /placement-placeholder|candidate/iu,
        /not\.toBeInTheDocument|toHaveLength\s*\(\s*0\s*\)|queryByTestId/iu,
        /fromPlacement|createElementFromPlacement|commit/iu,
        /not\.toHaveBeenCalled|toHaveBeenCalledTimes\s*\(\s*0\s*\)/iu,
        /expect|assert/u,
      ],
      [
        /commit|배치/iu,
        /user\.click|pointer\.click|\.click\s*\(/u,
        /fromPlacement|createElementFromPlacement|created/iu,
        /toHaveBeenCalledTimes\s*\(\s*1\s*\)|toBeInTheDocument|toHaveLength\s*\(\s*1\s*\)/iu,
        /expect|assert/u,
      ],
    ]),
    "pointer-outside-invalid-preview": someCaseMatches(webCases, [
      /outside|out[ -]?of[ -]?bounds|boundary|canvas 밖|right edge/iu,
      /same clamped cell|same cell|one pixel|1px|right\s*\+\s*1|valid[^\n]{0,100}invalid|inside[^\n]{0,100}outside/iu,
      /pointer|drag/iu,
      /placement-placeholder|candidate/iu,
      /data-valid|\bvalid\b/iu,
      /false|invalid/iu,
      /fromPlacement|from-placement|createElementFromPlacement|commit/iu,
      /not\.toHaveBeenCalled|toHaveBeenCalledTimes\s*\(\s*0\s*\)|toHaveLength\s*\(\s*0\s*\)/iu,
      /createPlacementCandidate|placement-candidate|candidate endpoint/iu,
      /toHaveBeenCalledTimes\s*\(\s*2\s*\)|toHaveLength\s*\(\s*2\s*\)/u,
      /expect|assert/u,
    ]),
    "global-multiselection-escape-delete": casesCollectivelyMatch(webCases, [
      [
        /Escape/u,
        /canvas|document|global|listbox/iu,
        /select|aria-selected/iu,
        /(?:false|clear|toHaveLength\s*\(\s*0)/iu,
        /expect|assert/u,
      ],
      [
        /Delete/u,
        /(?:2|two|multiple|multi)[ -]?(?:selected|selection|element)|(?:selected|selection|element)[^\n]{0,100}(?:2|two|multiple|multi)/iu,
        /deleteElement|removeElement|delete selected|\bDELETE\b/iu,
        /toHaveBeenCalledTimes\s*\(\s*2\s*\)|toHaveLength\s*\(\s*(?:0|2)\s*\)/u,
        /expect|assert/u,
      ],
    ]),
    "collision-error-classification": someCaseMatches(webCases, [
      /ELEMENT_COLLISION|collisionNextBatch/iu,
      /409|collisionNextBatch/u,
      /collision|충돌/iu,
      /concurr|변경 충돌/iu,
      /not\.toHaveTextContent|not\.toEqual|not\.toBe|toHaveTextContent/iu,
      /expect|assert/u,
    ]),
    "visible-candidate-identity-on-drop": someCaseMatches(webCases, [
      /same final cell|same cell|fresh candidate|visible candidate|보이는 후보/iu,
      /candidateId/u,
      /DragEnd|drop/iu,
      /fromPlacement|createElementFromPlacement|commit/iu,
      /toBe|toEqual|toMatchObject|toHaveBeenLastCalledWith/iu,
      /expect|assert/u,
    ]),
    "locked-delete-preflight-no-partial": casesCollectivelyMatch(webCases, [
      [
        /locked/iu,
        /Delete|delete control|삭제/iu,
        /disabled|not\.toHaveBeenCalled|toHaveBeenCalledTimes\s*\(\s*0\s*\)|toHaveLength\s*\(\s*0\s*\)/iu,
        /expect|assert/u,
      ],
      [
        /(?:multi|multiple|two|2)[ -]?(?:select|element)|(?:select|element)[^\n]{0,100}(?:multi|multiple|two|2)|unlocked[\s\S]{0,1200}locked|locked[\s\S]{0,1200}unlocked/iu,
        /locked/iu,
        /Delete/u,
        /not\.toHaveBeenCalled|toHaveBeenCalledTimes\s*\(\s*0\s*\)|toHaveLength\s*\(\s*0\s*,?\s*\)/iu,
        /partial|unchanged|toHaveLength\s*\(\s*2\s*\)|still|toBeInTheDocument/iu,
        /expect|assert/u,
      ],
    ]),
    "project-revision-monotonic-stale-read": someCaseMatches(webCases, [
      /projectRevision|project revision/iu,
      /delayed|out[ -]?of[ -]?order|stale|older/iu,
      /newer|latest|monotonic|lower|regress/iu,
      /toBe|toEqual|toMatchObject/iu,
      /expect|assert/u,
    ]),
    "page-layout-revision-monotonic-stale-read": someCaseMatches(webCases, [
      /layoutRevision|layout revision/iu,
      /same page|same-page|page/iu,
      /delayed|out[ -]?of[ -]?order|stale|older/iu,
      /newer|latest|monotonic|lower|regress/iu,
      /expectedLayoutRevision/iu,
      /toBe|toEqual|toMatchObject|toHaveBeenLastCalledWith/iu,
      /expect|assert/u,
    ]),
    "keyboard-collision-compaction-batch": someCaseMatches(webCases, [
      /Arrow(?:Up|Down|Left|Right)/u,
      /occupied|overlap|collision|compaction/iu,
      /(?:2|two)[^\n]{0,100}(?:element|item)|(?:element|item)[^\n]{0,100}(?:2|two)|items\)\.toHaveLength\s*\(\s*2\s*\)/iu,
      /COMPLETE|batchElementLayout|atomic batch/iu,
      /toHaveBeenCalledTimes\s*\(\s*1\s*\)|toHaveLength\s*\(\s*1\s*\)/u,
      /nonoverlap|not overlap|pairwise|collision.*false|overlaps[\s\S]{0,100}false|변경 충돌/iu,
      /expect|assert/u,
    ]),
    "nested-control-arrows-do-not-move": someCaseMatches(webCases, [
      /nested|child|lock control|delete control|drag control|잠금|삭제|이동/iu,
      /\.focus\s*\(|toHaveFocus|focused/iu,
      /Arrow(?:Up|Down|Left|Right)/u,
      /batchElementLayout|persistCompleteBatch|mutationCalls|save/iu,
      /not\.toHaveBeenCalled|toHaveBeenCalledTimes\s*\(\s*0\s*\)|toHaveLength\s*\(\s*0\s*\)/iu,
      /data-[xy]|unchanged|toHaveAttribute|toEqual/iu,
      /expect|assert/u,
    ]),
    "canonical-render-no-mount-compaction": someCaseMatches(webCases, [
      /persisted|committed|server layout|below row zero/iu,
      /(?:\by\s*[:=]\s*(?:8|12)\b|row[^\n]{0,80}(?:8|12))/iu,
      /transform|getBoundingClientRect|computed/iu,
      /inspector|data-y|position/iu,
      /batchElementLayout|save|mutationCalls/iu,
      /not\.toHaveBeenCalled|toHaveBeenCalledTimes\s*\(\s*0\s*\)|toHaveLength\s*\(\s*0\s*\)/iu,
      /expect|assert/u,
    ]),
    "selection-delete-exact-sequential": casesCollectivelyMatch(webCases, [
      [
        /single|one selected|1 selected/iu,
        /Delete/u,
        /deleteElement|DELETE/iu,
        /toHaveBeenCalledTimes\s*\(\s*1\s*\)/u,
        /expect|assert/u,
      ],
      [
        /(?:2|two|multiple|multi)[ -]?(?:selected|selection|element)|(?:selected|selection|element)[^\n]{0,100}(?:2|two|multiple|multi)/iu,
        /Delete/u,
        /deleteElement|DELETE/iu,
        /toHaveBeenCalledTimes\s*\(\s*2\s*\)|toHaveLength\s*\(\s*2\s*\)/u,
        /sequential|deferred|resolve first|revision/iu,
        /expect|assert/u,
      ],
    ]),
    "bidirectional-viewport-overflow-ownership": someCaseMatches(webCases, [
      /element-canvas-viewport|Canvas viewport/iu,
      /(?:200%|zoom[^\n]{0,80}(?:2|200)|(?:2|200)[^\n]{0,80}zoom)/iu,
      /scrollWidth[\s\S]{0,160}clientWidth|clientWidth[\s\S]{0,160}scrollWidth/u,
      /scrollHeight[\s\S]{0,160}clientHeight|clientHeight[\s\S]{0,160}scrollHeight/u,
      /scrollLeft[\s\S]{0,160}(?:GreaterThan|>\s*0)|(?:GreaterThan|>\s*0)[\s\S]{0,160}scrollLeft/u,
      /scrollTop[\s\S]{0,160}(?:GreaterThan|>\s*0)|(?:GreaterThan|>\s*0)[\s\S]{0,160}scrollTop/u,
      /documentElement|document\.body|body|page scroll/iu,
      /unchanged|toBe\s*\([^)]*(?:before|baseline|initial)|toEqual\s*\([^)]*(?:before|baseline|initial)|(?:documentElement|document\.body)[\s\S]{0,260}scroll(?:Width|Height)[\s\S]{0,160}toBe\s*\([^)]*client(?:Width|Height)/iu,
      /expect|assert/u,
    ]),
    "reduced-motion-and-accessibility": casesCollectivelyMatch(webCases, [
      [
        /reduced[ -]?motion|prefers-reduced-motion/iu,
        /overlay|placeholder/iu,
        /expect|assert/u,
      ],
      [
        /aria-|role|accessible|keyboard/iu,
        /palette|canvas|element/iu,
        /expect|assert/u,
      ],
      [/focus|tab/iu, /palette|element/iu, /expect|assert/u],
    ]),
    "single-save-after-drag-or-resize": casesCollectivelyMatch(webCases, [
      [
        /drag|move/iu,
        /pointerMove|mouseMove|onDrag/iu,
        /toHave(?:BeenCalledTimes|Length)\s*\(\s*1\s*\)/u,
      ],
      [
        /resize/iu,
        /pointerMove|mouseMove|onResize/iu,
        /toHave(?:BeenCalledTimes|Length)\s*\(\s*1\s*\)/u,
      ],
    ]),
    "real-persisted-element-rendering": someCaseMatches(webCases, [
      /placed-element-|ElementRenderer/iu,
      /listElements|GET|reload|rerender|remount/iu,
      /(?:button|text|metric|element type|data-element-type)/iu,
      /toBeVisible|toHaveTextContent|toBeInTheDocument/iu,
    ]),
  };

  return {
    paths,
    behavioralPaths: behavioralFiles.map(({ path }) => path),
    behavioralCaseCount: cases.length,
    skippedTests,
    capabilities,
    resizeHandleCoverage,
    zoomCoverage,
    hasDomainElementTest: domainCases.some(({ source: caseSource }) =>
      /element|placement|layout/iu.test(caseSource),
    ),
    hasServerElementIntegrationTest: serverCases.some(
      ({ path, source: caseSource }) =>
        /integration/u.test(path) &&
        /element|placement|layout/iu.test(caseSource),
    ),
    hasWebCanvasComponentTest: webCases.some(({ source: caseSource }) =>
      /ElementCanvas|ElementWorkspace|placement-placeholder/iu.test(caseSource),
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
    validation.check(false, "Phase 5 traceability JSON can be read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const requirements = Object.fromEntries(
    (traceability.requirements ?? []).map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );
  for (const id of REQUIRED_PHASE5_REQUIREMENTS) {
    const requirement = requirements[id];
    validation.check(Boolean(requirement), `${id} is present in traceability`);
    if (!requirement) continue;
    validation.equal(requirement.phase, 5, `${id} remains assigned to Phase 5`);
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
      `${id} references Phase 5 implementation`,
    );
    validation.check(
      Array.isArray(requirement.tests) &&
        requirement.tests.length >= 2 &&
        requirement.tests.includes("scripts/verify-phase5.mjs"),
      `${id} references behavioral tests and scripts/verify-phase5.mjs`,
    );
    validation.check(
      Array.isArray(requirement.evidence) &&
        requirement.evidence.includes(PHASE5_EVIDENCE_PATH),
      `${id} references ${PHASE5_EVIDENCE_PATH}`,
    );
  }
  return { requirements: Object.values(requirements) };
}

export async function validatePhase5({
  repositoryRoot = REPOSITORY_ROOT,
  includeGovernance = true,
  includePhase4Regression = true,
} = {}) {
  const validation = new Validation(
    "Phase 5 Canvas placement candidate, grid movement, and resize",
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
  const webFiles = await collectFiles(repositoryRoot, ["apps/web"], (path) =>
    path === "apps/web/package.json" ? true : sourcePredicate(path),
  );
  const testFiles = await collectFiles(
    repositoryRoot,
    [
      "apps/server/test",
      "packages/domain/test",
      "apps/web/src",
      "e2e",
      "tests/e2e",
    ],
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
    "all canonical Phase 5 routes and the ADR read route are registered",
    { missing: routeInspection.missingRoutes.map(routeKey) },
  );
  validation.check(
    routeInspection.unexpectedRoutes.length === 0,
    "the Phase 5 Element route surface exactly matches the accepted contract",
    { unexpected: routeInspection.unexpectedRoutes.map(routeKey) },
  );
  validation.check(
    routeInspection.unversionedRoutes.length === 0,
    "no unversioned Element routes are registered",
    { routes: routeInspection.unversionedRoutes.map(routeKey) },
  );

  const schemaInspection = inspectElementSchema(combinedSource(serverFiles));
  for (const [tableName, table] of Object.entries(schemaInspection.tables)) {
    validation.check(table.present, `SQLite table ${tableName} exists`);
    validation.check(
      table.missingColumns.length === 0,
      `SQLite table ${tableName} has every required column`,
      { missing: table.missingColumns },
    );
  }
  for (const [property, message] of [
    [
      "schemaVersionAtLeastFour",
      "metadata history retains the canonical schema v4 migration",
    ],
    ["migrationNamed", "the v4 migration has the accepted stable name"],
    ["futureVersionFailClosed", "unknown future metadata versions fail closed"],
    [
      "pageLayoutOwnsProjectAndPage",
      "Page layout revisions enforce Project/Page ownership",
    ],
    ["pageLayoutRevisionNonnegative", "Page layout revisions are nonnegative"],
    ["oneLayoutRevisionPerPage", "each Page owns one layout revision row"],
    ["elementOwnsProjectAndPage", "Elements enforce Project/Page ownership"],
    ["elementRevisionPositive", "Element revisions are positive"],
    ["elementTypeConstrained", "Element types are SQLite constrained"],
    ["elementLockBoolean", "Element lock state is boolean constrained"],
    [
      "layoutOwnsElementProjectAndPage",
      "layouts bind Element, Project, and Page ownership",
    ],
    [
      "layoutBreakpointConstrained",
      "layout breakpoints reserve desktop, tablet, and mobile",
    ],
    [
      "layoutIntegerGeometry",
      "layout geometry is stored as integer grid units",
    ],
    [
      "layoutGeometryConstrained",
      "desktop layout geometry is bounded to 24 columns",
    ],
    [
      "oneLayoutPerBreakpoint",
      "each Element has at most one layout per breakpoint",
    ],
    [
      "commandTypesConstrained",
      "Element command types include add, move, resize, and lock",
    ],
    [
      "commandBeforeAfter",
      "Element commands persist before and after snapshots",
    ],
    [
      "commandIdempotencyConstrained",
      "Element commands enforce Project-scoped idempotency",
    ],
    [
      "commandResponseExcludesFiveHundreds",
      "transient 5xx failures cannot poison the idempotency ledger",
    ],
    [
      "newPagesSeedLayoutRevision",
      "new, imported, and cloned Pages atomically seed a layout revision",
    ],
    ["migrationTransactional", "metadata migrations execute transactionally"],
  ]) {
    validation.check(schemaInspection[property], message);
  }

  const candidateInspection = inspectCandidateProtocol([
    ...serverFiles,
    ...domainFiles,
  ]);
  for (const [property, message] of [
    ["storeClass", "Placement Candidates use the dedicated transient store"],
    ["exactTtl", "Placement Candidate TTL is exactly 15 seconds"],
    ["exactCapacity", "Placement Candidate capacity is exactly 512"],
    ["boundedMap", "Placement Candidate memory is bounded and evicts entries"],
    ["expiryUsesInjectedClock", "candidate expiry uses a controllable clock"],
    ["purgesExpired", "expired candidates are removed from memory"],
    ["memoryOnly", "candidate storage has no SQLite or file writer"],
    [
      "candidateBinding",
      "candidate state binds ownership, type, sizes, and both revisions",
    ],
    ["serverGridConstants", "the server pins the 24/8/8/16 Canvas constants"],
    [
      "serverOwnsCoordinateConversion",
      "the server owns pixel-to-grid conversion",
    ],
    [
      "serverOwnsRegistryLimits",
      "the server owns Registry defaults and size limits",
    ],
    ["clampsBoundary", "candidate placement clamps the 24-column boundary"],
    [
      "outOfBoundsIsInvalid",
      "out-of-bounds pointers produce a clamped but invalid candidate",
    ],
    [
      "verticalBoundaryBound",
      "server candidate validity rejects pointers below the measured Canvas",
    ],
    [
      "serverVerticalCompaction",
      "server candidates vertically compact the new item before preview",
    ],
    [
      "deterministicNearestCollision",
      "collision resolution is deterministic and nearest-first",
    ],
    [
      "fromPlacementForbidsGeometry",
      "commit accepts candidateId but no client geometry",
    ],
    [
      "fromPlacementHasExpectedRevisions",
      "commit requires Project/Layout revisions and idempotency",
    ],
    ["consumesOneTime", "successful commit consumes the candidate once"],
    [
      "replayBeforeConsume",
      "idempotent replay is checked before candidate consumption",
    ],
    ["rejectsExpired", "expired candidates fail closed"],
    ["rejectsStale", "stale candidates fail with a revision conflict"],
    ["rejectsCrossPage", "cross-Page candidates fail ownership checks"],
    [
      "noCommitRecompute",
      "commit reuses candidate geometry without recomputation",
    ],
    [
      "candidateResponseComplete",
      "candidate response exposes exact preview geometry and state",
    ],
  ]) {
    validation.check(candidateInspection[property], message);
  }

  const layoutInspection = inspectLayoutProtocol([
    ...serverFiles,
    ...domainFiles,
  ]);
  for (const [property, message] of [
    [
      "deleteReplaysBeforeActiveLookup",
      "successful Element delete replays before active-row lookup",
    ],
    [
      "fiveHundredsRollbackWithoutCommand",
      "5xx Element failures roll back without a durable replay record",
    ],
    [
      "centralProjectRevision",
      "Element mutations advance the central Project revision",
    ],
    [
      "patchDiscriminatedChanges",
      "Element PATCH discriminates MOVE, RESIZE, and LOCK",
    ],
    [
      "integerAndBoundsValidation",
      "Element mutation geometry is integer and Registry bounded",
    ],
    ["lockedMoveResizeRejected", "locked Elements reject move and resize"],
    [
      "patchTransactional",
      "Element PATCH and layout revision update are transactional",
    ],
    [
      "batchSupportsCompleteAndPartial",
      "batch layout defines COMPLETE and PARTIAL modes",
    ],
    ["batchAtomicAndIdempotent", "batch layout is atomic and idempotent"],
    [
      "batchOwnershipValidated",
      "batch layout validates Project/Page ownership",
    ],
    [
      "durableBeforeAfterCommand",
      "layout commands persist before and after geometry",
    ],
    [
      "deleteIsSoftOrCommanded",
      "Element delete is tombstoned and command recorded",
    ],
    [
      "publishIncludesElementLayouts",
      "immutable publish snapshots include Elements and layouts",
    ],
    [
      "draftDoesNotRewriteVersions",
      "Draft Element writes never update published versions",
    ],
    [
      "lifecycleIncludesElements",
      "clone/export/import includes Element ownership and layouts",
    ],
    [
      "lifecycleRemapsStableIds",
      "clone/import remaps Page and Element stable IDs",
    ],
    [
      "lifecyclePurgeRemovesElementData",
      "purge removes Project-owned Element metadata",
    ],
  ]) {
    validation.check(layoutInspection[property], message);
  }

  const frontendInspection = inspectFrontendCanvasImplementation(webFiles);
  for (const [property, message] of [
    ["usesRealElementApi", "Canvas reads and writes the real Element API"],
    [
      "candidateRequestsMeasuredHeight",
      "Canvas sends measured content height for server-owned vertical validity",
    ],
    [
      "candidateCommitOnlyById",
      "frontend commit sends candidateId without geometry",
    ],
    [
      "dndKitPaletteOnly",
      "dnd-kit owns Palette pointer drag and exposes bounded keyboard placement",
    ],
    ["onePaletteOverlay", "Palette renders exactly one dangling DragOverlay"],
    [
      "pageReorderContextSeparate",
      "Page reorder and Palette use separate DndContext owners",
    ],
    [
      "controlledReactGridLayout",
      "controlled react-grid-layout owns placed move and resize",
    ],
    [
      "reactGridLayoutV2",
      "Canvas uses the controlled react-grid-layout v2 API",
    ],
    ["allEightResizeHandles", "Canvas exposes all eight resize handles"],
    [
      "requiredTestIds",
      "Canvas exposes stable interaction and geometry test IDs",
    ],
    [
      "placeholderShowsCandidateGeometry",
      "placeholder exposes x/y/w/h validity and collision state",
    ],
    [
      "placeholderUsesServerCandidate",
      "placeholder renders server candidate geometry",
    ],
    [
      "moveAndResizePersistOnlyOnStop",
      "move and resize persist only after stop",
    ],
    [
      "rejectsOutOfOrderCandidate",
      "stale candidate responses cannot replace the latest pointer",
    ],
    [
      "finalDropAwaitsLastCandidate",
      "DragEnd awaits and commits the final pointer candidate",
    ],
    [
      "freshDropReusesVisibleCandidate",
      "fresh same-cell drops consume the visible candidateId",
    ],
    [
      "candidateRequestsCoalesced",
      "drag-over candidate requests are frame or grid-cell coalesced",
    ],
    [
      "candidateKeyMatchesServerRounding",
      "client request coalescing uses the server-identical rounded grid key",
    ],
    [
      "candidateKeyIncludesBounds",
      "candidate cache keys distinguish valid edge pointers from out-of-bounds pointers",
    ],
    [
      "expiredCandidateCacheRefresh",
      "stationary long drags refresh candidates before final commit",
    ],
    [
      "candidateControlKeysIsolated",
      "candidate child controls cannot bubble Enter into placement commit",
    ],
    [
      "candidateChildEscapeRouted",
      "Escape from focused candidate child controls still cancels placement",
    ],
    [
      "candidateActionsPointerEnabled",
      "keyboard-placement commit and cancel controls remain pointer clickable",
    ],
    [
      "distinguishesCollisionFromConcurrency",
      "ELEMENT_COLLISION is not mislabeled as a revision conflict",
    ],
    [
      "lockedDeletePreflight",
      "locked Elements block control and keyboard deletion before API writes",
    ],
    [
      "monotonicProjectRevision",
      "stale frontend responses cannot lower the central Project revision",
    ],
    [
      "monotonicPageLayoutRevision",
      "stale same-page responses cannot lower the active Layout revision",
    ],
    [
      "nestedControlKeyIsolation",
      "Arrow keys on nested Element controls cannot move the parent Element",
    ],
    [
      "compactionPersistsCompleteLayout",
      "vertical compaction persists every changed item in one atomic batch",
    ],
    [
      "canonicalLayoutUncompactedOnRender",
      "controlled RGL renders canonical server coordinates without mount compaction",
    ],
    [
      "viewportOwnsBidirectionalOverflow",
      "constrained Canvas viewport owns horizontal and vertical zoom overflow",
    ],
    ["honorsReducedMotion", "Palette motion honors reduced-motion preference"],
    ["selectionAndLock", "Canvas supports selection and locked geometry"],
    [
      "keyboardMovement",
      "Canvas keyboard movement supports 1-grid and Shift+4",
    ],
    ["escapeAndDelete", "Canvas handles Escape cancellation and Delete"],
    ["accessiblePalette", "Palette exposes keyboard and assistive semantics"],
    [
      "validSelectionSemantics",
      "Canvas selection uses listbox/option aria-selected semantics",
    ],
    [
      "singleDroppableRefRegistration",
      "Canvas registers the dnd-kit droppable node exactly once",
    ],
    ["realRenderer", "placed Elements use a real renderer"],
    [
      "noFakeMarkers",
      "Canvas implementation contains no fake/TODO completion markers",
    ],
  ]) {
    validation.check(frontendInspection[property], message, {
      fakeMarkers: frontendInspection.fakeMarkers,
    });
  }

  const testInspection = inspectPhase5TestInventory(testFiles);
  validation.check(
    testInspection.skippedTests.length === 0,
    "Phase 5 test inventory has no skipped or TODO tests",
    { skipped: testInspection.skippedTests },
  );
  validation.check(
    testInspection.hasDomainElementTest,
    "domain Element contract tests exist",
  );
  validation.check(
    testInspection.hasServerElementIntegrationTest,
    "server Element/placement integration tests exist",
  );
  validation.check(
    testInspection.hasWebCanvasComponentTest,
    "web Canvas component tests exist",
  );
  for (const capability of REQUIRED_PHASE5_TEST_CAPABILITIES) {
    validation.check(
      testInspection.capabilities[capability],
      `behavioral test inventory covers ${capability}`,
    );
  }

  let browserGeometryEvidence = {};
  try {
    browserGeometryEvidence = JSON.parse(
      await readFile(
        resolve(repositoryRoot, PHASE5_BROWSER_GEOMETRY_EVIDENCE_PATH),
        "utf8",
      ),
    );
  } catch (error) {
    validation.check(
      false,
      "operational browser geometry evidence can be read",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  const browserGeometryInspection = inspectBrowserGeometryEvidence(
    browserGeometryEvidence,
  );
  for (const [property, message] of [
    ["operationalPass", "isolated local browser verification is recorded"],
    [
      "projectSiblingGeometry",
      "Project import and create controls have equal measured geometry",
    ],
    [
      "paletteSiblingGeometry",
      "all four Palette siblings have equal measured geometry",
    ],
    [
      "canvasSiblingGeometry",
      "Canvas sibling controls have equal measured geometry",
    ],
    [
      "previewCommitLayoutExact",
      "browser preview and commit layouts are exactly equal",
    ],
    [
      "previewCommitMeasuredRectExact",
      "browser preview and commit measured rectangles are exactly equal",
    ],
    [
      "bidirectionalViewportOverflow",
      "zoomed browser Canvas owns measurable horizontal and vertical overflow",
    ],
  ]) {
    validation.check(browserGeometryInspection[property], message);
  }

  let phase4Regression = null;
  if (includePhase4Regression) {
    phase4Regression = await validatePhase4({
      repositoryRoot,
      includeGovernance: false,
    });
    validation.check(
      phase4Regression.result === "PASS",
      "Phase 0-4 regression evidence remains green",
      { failures: phase4Regression.failures },
    );
  }

  const governance = includeGovernance
    ? await inspectGovernance(repositoryRoot, validation)
    : { requirements: [] };

  return validation.result({
    canonicalRouteCount: CANONICAL_PHASE5_ROUTES.length,
    registeredCanonicalRoutes:
      CANONICAL_PHASE5_ROUTES.length - routeInspection.missingRoutes.length,
    requiredTableCount: Object.keys(REQUIRED_ELEMENT_TABLES).length,
    presentTableCount: Object.values(schemaInspection.tables).filter(
      (table) => table.present,
    ).length,
    requiredResizeHandles: REQUIRED_RESIZE_HANDLES,
    frontendResizeHandles: frontendInspection.resizeHandles,
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
    candidateInspection,
    layoutInspection,
    frontendInspection,
    browserGeometryInspection,
    testInventory: testInspection,
    serverSourceFiles: serverFiles.map(({ path }) => path),
    domainSourceFiles: domainFiles.map(({ path }) => path),
    webSourceFiles: webFiles.map(({ path }) => path),
    testFiles: testInspection.paths,
    phase4RegressionResult: phase4Regression?.result ?? "NOT_RUN",
    governanceRequirementCount: governance.requirements.length,
    requiredEvidencePath: PHASE5_EVIDENCE_PATH,
    browserGeometryEvidencePath: PHASE5_BROWSER_GEOMETRY_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE5_EVIDENCE_PATH, await validatePhase5());
  } catch (error) {
    await finishVerification(
      PHASE5_EVIDENCE_PATH,
      unexpectedFailure(
        "Phase 5 Canvas placement candidate, grid movement, and resize",
        error,
      ),
    );
  }
}
