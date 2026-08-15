import { fileURLToPath } from "node:url";

export const SERVER_HOST = "127.0.0.1";
export const SERVER_PORT = 3210;

export function resolveMetadataDatabasePath(
  configuredPath = process.env.WEBEDITOR_METADATA_DB_PATH,
): string {
  return (
    configuredPath ??
    fileURLToPath(
      new URL("../../../../data/metadata/webeditor.sqlite", import.meta.url),
    )
  );
}
