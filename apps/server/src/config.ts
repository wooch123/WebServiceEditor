import { fileURLToPath } from "node:url";

export const SERVER_HOST = "127.0.0.1";
export const SERVER_PORT = 3210;

function resolveRepositoryDataPath(): string {
  return fileURLToPath(new URL("../../../data", import.meta.url));
}

export function resolveServerPort(
  configuredPort: number | string | undefined = process.env.WEBEDITOR_PORT,
): number {
  if (configuredPort === undefined) {
    return SERVER_PORT;
  }

  if (
    typeof configuredPort === "string" &&
    !/^[1-9][0-9]{0,4}$/.test(configuredPort)
  ) {
    throw new Error("WEBEDITOR_PORT must be an integer between 1 and 65535");
  }
  const port =
    typeof configuredPort === "number"
      ? configuredPort
      : Number(configuredPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("WEBEDITOR_PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function resolveMetadataDatabasePath(
  configuredPath = process.env.WEBEDITOR_METADATA_DB_PATH,
): string {
  return (
    configuredPath ?? `${resolveRepositoryDataPath()}/metadata/webeditor.sqlite`
  );
}

export function resolveStorageRoot(
  configuredRoot = process.env.WEBEDITOR_STORAGE_ROOT,
): string {
  return configuredRoot ?? resolveRepositoryDataPath();
}
