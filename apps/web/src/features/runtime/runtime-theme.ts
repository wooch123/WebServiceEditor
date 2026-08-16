import {
  defaultTheme,
  findTheme,
  type RuntimeThemeManifest,
  type ThemeTokens,
} from "@webeditor/theme-core";

export const RUNTIME_THEME_PREFERENCE_PREFIX =
  "webeditor.runtime.theme.v3." as const;

export interface RuntimeThemePreference {
  readonly themeId: string;
  readonly themeRevisionId?: string;
  readonly selectedAt: string;
}

export interface RuntimeThemeResolution {
  readonly themeId: string;
  readonly themeRevisionId: string;
  readonly tokens: ThemeTokens;
  readonly userOverrideActive: boolean;
}

const memoryPreferences = new Map<string, RuntimeThemePreference>();

function storageKey(projectId: string): string {
  return `${RUNTIME_THEME_PREFERENCE_PREFIX}${projectId}`;
}

function validPreference(value: unknown): value is RuntimeThemePreference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const source = value as Record<string, unknown>;
  return (
    typeof source.themeId === "string" &&
    typeof source.selectedAt === "string" &&
    Number.isFinite(Date.parse(source.selectedAt)) &&
    (source.themeRevisionId === undefined ||
      typeof source.themeRevisionId === "string")
  );
}

export function readRuntimeThemePreference(
  projectId: string,
): RuntimeThemePreference | null {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (raw === null) return memoryPreferences.get(projectId) ?? null;
    const parsed: unknown = JSON.parse(raw);
    if (!validPreference(parsed)) {
      window.localStorage.removeItem(storageKey(projectId));
      memoryPreferences.delete(projectId);
      return null;
    }
    return parsed;
  } catch {
    return memoryPreferences.get(projectId) ?? null;
  }
}

export function writeRuntimeThemePreference(
  projectId: string,
  themeId: string,
): {
  readonly preference: RuntimeThemePreference;
  readonly persisted: boolean;
} {
  const preference: RuntimeThemePreference = {
    themeId,
    selectedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(
      storageKey(projectId),
      JSON.stringify(preference),
    );
    memoryPreferences.delete(projectId);
    return { preference, persisted: true };
  } catch {
    memoryPreferences.set(projectId, preference);
    return { preference, persisted: false };
  }
}

export function clearRuntimeThemePreference(projectId: string): boolean {
  memoryPreferences.delete(projectId);
  try {
    window.localStorage.removeItem(storageKey(projectId));
    return true;
  } catch {
    return false;
  }
}

export function resolveRuntimeTheme(
  manifest: RuntimeThemeManifest,
  preference: RuntimeThemePreference | null,
): RuntimeThemeResolution {
  const preferred =
    manifest.allowRuntimeThemeSelection &&
    preference !== null &&
    manifest.allowedThemeIds.includes(preference.themeId)
      ? findTheme(preference.themeId)
      : undefined;
  if (preferred) {
    return {
      themeId: preferred.id,
      themeRevisionId: `preset:${preferred.id}`,
      tokens: preferred.tokens,
      userOverrideActive: preferred.id !== manifest.resolvedThemeId,
    };
  }
  const fallback = findTheme(manifest.resolvedThemeId) ?? defaultTheme;
  return {
    themeId: fallback.id,
    themeRevisionId:
      manifest.resolvedThemeRevisionId || `preset:${fallback.id}`,
    tokens: manifest.tokens,
    userOverrideActive: false,
  };
}

export function runtimeThemePreferenceIsAllowed(
  manifest: RuntimeThemeManifest,
  preference: RuntimeThemePreference | null,
): boolean {
  return (
    preference === null ||
    (manifest.allowRuntimeThemeSelection &&
      manifest.allowedThemeIds.includes(preference.themeId) &&
      findTheme(preference.themeId) !== undefined)
  );
}
