import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

export const REPOSITORY_ROOT = fileURLToPath(
  new URL("../../", import.meta.url),
);

export class Validation {
  constructor(subject) {
    this.subject = subject;
    this.checkCount = 0;
    this.failures = [];
  }

  check(condition, message, details = undefined) {
    this.checkCount += 1;
    if (!condition) {
      this.failures.push(
        details === undefined ? { message } : { message, details },
      );
    }
  }

  equal(actual, expected, message) {
    this.check(
      Object.is(actual, expected),
      message,
      Object.is(actual, expected) ? undefined : { expected, actual },
    );
  }

  result(details = {}) {
    return {
      subject: this.subject,
      result: this.failures.length === 0 ? "PASS" : "FAIL",
      checks: this.checkCount,
      failureCount: this.failures.length,
      failures: this.failures,
      details,
    };
  }
}

export async function readJson(relativePath) {
  const absolutePath = resolve(REPOSITORY_ROOT, relativePath);
  const source = await readFile(absolutePath, "utf8");

  try {
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${relativePath}: ${error.message}`, {
      cause: error,
    });
  }
}

export async function readRepositoryFile(relativePath) {
  return readFile(resolve(REPOSITORY_ROOT, relativePath));
}

export async function repositoryFileSize(relativePath) {
  const metadata = await stat(resolve(REPOSITORY_ROOT, relativePath));
  return metadata.size;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

export function validateExactSet(
  validation,
  actualValues,
  expectedValues,
  label,
) {
  const actual = new Set(actualValues);
  const expected = new Set(expectedValues);
  const missing = setDifference(expected, actual);
  const unexpected = setDifference(actual, expected);

  validation.equal(
    actualValues.length,
    actual.size,
    `${label} must not contain duplicates`,
  );
  validation.check(
    missing.length === 0,
    `${label} is missing required values`,
    {
      missing,
    },
  );
  validation.check(
    unexpected.length === 0,
    `${label} contains unexpected values`,
    {
      unexpected,
    },
  );
}

export async function pathExists(relativePath) {
  try {
    await stat(resolve(REPOSITORY_ROOT, relativePath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function writeEvidence(relativePath, report) {
  const absolutePath = resolve(REPOSITORY_ROOT, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...report,
  };
  await writeFile(
    absolutePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  return absolutePath;
}

export async function finishVerification(relativePath, report) {
  const evidencePath = await writeEvidence(relativePath, report);
  const summary = `${report.subject}: ${report.result} (${report.checks} checks, ${report.failureCount} failures)\nEvidence: ${evidencePath}\n`;
  process.stdout.write(summary);
  if (report.result !== "PASS") {
    process.exitCode = 1;
  }
}

export function isMainModule(moduleUrl) {
  if (!process.argv[1]) {
    return false;
  }
  return pathToFileURL(resolve(process.argv[1])).href === moduleUrl;
}

export function unexpectedFailure(subject, error) {
  return {
    subject,
    result: "FAIL",
    checks: 0,
    failureCount: 1,
    failures: [
      {
        message: error instanceof Error ? error.message : String(error),
      },
    ],
    details: {},
  };
}
