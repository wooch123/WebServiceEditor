import { writeFile } from "node:fs/promises";

import { OfflineBackupService } from "./offline-backup.js";

function argumentsMap(args: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (match === null) throw new Error(`Invalid argument: ${argument}`);
    values.set(match[1] as string, match[2] as string);
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}

const values = argumentsMap(process.argv.slice(2));
const operation = required(values, "operation");
const service = new OfflineBackupService({
  metadataDatabasePath: required(values, "metadata-db"),
  storageRoot: required(values, "storage-root"),
  backupRoot: required(values, "backup-root"),
});

const result =
  operation === "create"
    ? await service.create()
    : operation === "verify"
      ? await service.verify(required(values, "backup-id"))
      : operation === "restore-drill"
        ? await service.restoreDrill(required(values, "backup-id"))
        : undefined;
if (result === undefined) throw new Error(`Unknown operation: ${operation}`);

const reportPath = values.get("report");
if (reportPath !== undefined) {
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(result)}\n`);
