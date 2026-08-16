import { fileURLToPath } from "node:url";

export const SERVER_HOST = "127.0.0.1";
export const SERVER_PORT = 3210;

export interface AuthenticationConfig {
  readonly required: boolean;
  readonly adminUsername: string;
  readonly adminPassword?: string;
  readonly publicOrigin: string;
  readonly secureCookies: boolean;
  readonly sessionLifetimeHours: number;
}

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

export function resolveProjectCorpusManifestPath(
  configuredPath = process.env.WEBEDITOR_CORPUS_MANIFEST_PATH,
): string {
  return (
    configuredPath ??
    fileURLToPath(
      new URL("../../../webeditor_project_corpus_v3.json", import.meta.url),
    )
  );
}

function booleanEnvironment(
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function resolveAuthenticationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthenticationConfig {
  const required = booleanEnvironment(
    "WEBEDITOR_AUTH_REQUIRED",
    environment.WEBEDITOR_AUTH_REQUIRED,
    false,
  );
  const adminUsername = environment.WEBEDITOR_ADMIN_USERNAME?.trim() || "admin";
  const adminPassword = environment.WEBEDITOR_ADMIN_PASSWORD;
  const publicOrigin =
    environment.WEBEDITOR_PUBLIC_ORIGIN?.trim() ||
    "https://webeditor.dove9999.com";
  const sessionLifetimeHours = Number(
    environment.WEBEDITOR_SESSION_HOURS?.trim() || "8",
  );
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/iu.test(publicOrigin)) {
    throw new Error("WEBEDITOR_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  if (!/^[A-Za-z0-9._-]{3,64}$/u.test(adminUsername)) {
    throw new Error(
      "WEBEDITOR_ADMIN_USERNAME must contain 3 to 64 safe characters",
    );
  }
  if (required && (adminPassword === undefined || adminPassword.length < 8)) {
    throw new Error(
      "WEBEDITOR_ADMIN_PASSWORD must contain at least 8 characters when authentication is required",
    );
  }
  if (
    !Number.isFinite(sessionLifetimeHours) ||
    sessionLifetimeHours < 0.25 ||
    sessionLifetimeHours > 24
  ) {
    throw new Error("WEBEDITOR_SESSION_HOURS must be between 0.25 and 24");
  }
  return {
    required,
    adminUsername,
    ...(adminPassword === undefined ? {} : { adminPassword }),
    publicOrigin,
    secureCookies: booleanEnvironment(
      "WEBEDITOR_SECURE_COOKIES",
      environment.WEBEDITOR_SECURE_COOKIES,
      required,
    ),
    sessionLifetimeHours,
  };
}
