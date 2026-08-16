import {
  inspectMetadataVersion,
  supportedMetadataSchemaVersion,
} from "./metadata-version.js";

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
const result =
  operation === "supported"
    ? { supportedSchemaVersion: supportedMetadataSchemaVersion() }
    : operation === "inspect"
      ? inspectMetadataVersion(required(values, "metadata-db"))
      : undefined;
if (result === undefined) throw new Error(`Unknown operation: ${operation}`);
process.stdout.write(`${JSON.stringify(result)}\n`);
