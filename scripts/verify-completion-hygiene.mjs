import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";

export const COMPLETION_HYGIENE_EVIDENCE =
  "artifacts/release/completion-hygiene-validation.json";
const SOURCE_ROOTS = [
  "apps/server/src",
  "apps/web/src",
  "packages/domain/src",
  "packages/theme-core/src",
  "deployment/windows",
];
const TEST_ROOTS = [
  "apps/server/test",
  "apps/web/src",
  "packages/domain/test",
  "packages/theme-core/test",
];
const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".ps1",
  ".ts",
  ".tsx",
  ".xml",
]);

async function listFiles(root) {
  const absoluteRoot = join(REPOSITORY_ROOT, root);
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!new Set(["dist", "node_modules", "coverage"]).has(entry.name)) {
          await visit(path);
        }
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(path);
      }
    }
  }
  await visit(absoluteRoot);
  return files;
}

async function readInventory(roots) {
  const paths = [...new Set((await Promise.all(roots.map(listFiles))).flat())];
  return Promise.all(
    paths.sort().map(async (path) => ({
      path: relative(REPOSITORY_ROOT, path).split("\\").join("/"),
      source: await readFile(path, "utf8"),
    })),
  );
}

function matchingFiles(files, expression) {
  return files
    .filter(({ source }) => expression.test(source))
    .map(({ path }) => path);
}

export function inspectCompletionHygiene({ productionFiles, testFiles }) {
  return {
    commentMarkers: matchingFiles(
      productionFiles,
      /(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME|HACK|XXX)\b/iu,
    ),
    incompleteProductCopy: matchingFiles(
      productionFiles,
      /\b(?:coming soon|not implemented|mock only|placeholder only|temporary placeholder|disabled completion)\b/iu,
    ),
    fakeProductionBoundary: matchingFiles(
      productionFiles,
      /\b(?:mock server|mock persistence|fake database|fake runtime)\b/iu,
    ),
    noOpUserActions: matchingFiles(
      productionFiles,
      /on[A-Z][A-Za-z0-9]*\s*=\s*\{\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{\s*\}\s*\}/u,
    ),
    unsupportedRoutes: matchingFiles(
      productionFiles,
      /\b(?:NOT_IMPLEMENTED|HTTP 501|statusCode:\s*501)\b/u,
    ),
    debuggerOrConsole: matchingFiles(
      productionFiles,
      /\bdebugger\s*;|\bconsole\.(?:log|debug)\s*\(/u,
    ),
    testCommentMarkers: matchingFiles(
      testFiles,
      /(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME|HACK|XXX|EXPECTED[ -]?FAIL)\b/iu,
    ),
    skippedTests: matchingFiles(
      testFiles,
      /\b(?:describe|it|test)\.(?:skip|todo|failing)\s*\(|\b(?:xdescribe|xit|xtest)\s*\(|\bexpect\.fail\s*\(/u,
    ),
  };
}

export async function validateCompletionHygiene() {
  const validation = new Validation("Release completion hygiene");
  const [productionFiles, testFiles] = await Promise.all([
    readInventory(SOURCE_ROOTS),
    readInventory(TEST_ROOTS),
  ]);
  const inspection = inspectCompletionHygiene({
    productionFiles,
    testFiles,
  });
  for (const [name, paths] of Object.entries(inspection)) {
    validation.equal(paths.length, 0, `Completion hygiene: ${name}`);
  }
  return validation.result({
    productionFileCount: productionFiles.length,
    testFileCount: testFiles.length,
    inspection,
  });
}

async function main() {
  try {
    await finishVerification(
      COMPLETION_HYGIENE_EVIDENCE,
      await validateCompletionHygiene(),
    );
  } catch (error) {
    await finishVerification(
      COMPLETION_HYGIENE_EVIDENCE,
      unexpectedFailure("Release completion hygiene", error),
    );
  }
}

if (isMainModule(import.meta.url)) await main();
