import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
  validateExactSet,
} from "./lib/verification.mjs";

// Captured from `shadcn add --all --dry-run` with shadcn 4.18.0 on
// 2026-08-15. The `form` registry item has no form.tsx output; the dry run
// produces the other 61 UI modules plus hooks/use-mobile.ts.
export const SHADCN_DRY_RUN_ITEMS = Object.freeze([
  "accordion",
  "alert",
  "alert-dialog",
  "aspect-ratio",
  "attachment",
  "avatar",
  "badge",
  "breadcrumb",
  "bubble",
  "button",
  "button-group",
  "calendar",
  "card",
  "carousel",
  "chart",
  "checkbox",
  "collapsible",
  "combobox",
  "command",
  "context-menu",
  "dialog",
  "direction",
  "drawer",
  "dropdown-menu",
  "empty",
  "field",
  "form",
  "hover-card",
  "input",
  "input-group",
  "input-otp",
  "item",
  "kbd",
  "label",
  "marker",
  "menubar",
  "message",
  "message-scroller",
  "native-select",
  "navigation-menu",
  "pagination",
  "popover",
  "progress",
  "questionnaire",
  "radio-group",
  "resizable",
  "scroll-area",
  "select",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "slider",
  "sonner",
  "spinner",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toggle",
  "toggle-group",
  "tooltip",
]);

export const EXPECTED_UI_MODULES = Object.freeze(
  SHADCN_DRY_RUN_ITEMS.filter((item) => item !== "form"),
);

const EXPECTED_UI_FILES = Object.freeze(
  EXPECTED_UI_MODULES.map((moduleName) => `${moduleName}.tsx`),
);

const UI_DIRECTORY = "apps/web/src/components/ui";
const DESIGN_SYSTEM_SOURCE = "apps/web/src/DesignSystemGallery.tsx";
const APP_SOURCE = "apps/web/src/App.tsx";
const STYLE_SOURCE = "apps/web/src/styles.css";
const THEME_SOURCE = "apps/web/src/theme.ts";
const THEME_PICKER_SOURCE = "apps/web/src/ThemePicker.tsx";
const MOBILE_HOOK_SOURCE = "apps/web/src/hooks/use-mobile.ts";
const PRODUCT_SOURCE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
]);

function toRepositoryPath(repositoryRoot, absolutePath) {
  return relative(repositoryRoot, absolutePath).split(sep).join("/");
}

async function readRequiredText(repositoryRoot, path, validation) {
  try {
    const source = await readFile(resolve(repositoryRoot, path), "utf8");
    validation.check(source.length > 0, `${path} is non-empty`);
    return source;
  } catch (error) {
    validation.check(false, `${path} can be read`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

async function readRequiredJson(repositoryRoot, path, validation) {
  const source = await readRequiredText(repositoryRoot, path, validation);
  if (source.length === 0) {
    return {};
  }

  try {
    return JSON.parse(source.replace(/^\uFEFF/u, ""));
  } catch (error) {
    validation.check(false, `${path} contains valid JSON`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function listDirectoryFiles(repositoryRoot, path, validation) {
  try {
    const entries = await readdir(resolve(repositoryRoot, path), {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    validation.check(false, `${path} can be enumerated`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function listProductSourceFiles(repositoryRoot) {
  const sourceRoot = resolve(repositoryRoot, "apps/web/src");
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (
        !entry.isFile() ||
        !PRODUCT_SOURCE_EXTENSIONS.has(extname(entry.name))
      ) {
        continue;
      }

      const repositoryPath = toRepositoryPath(repositoryRoot, absolutePath);
      if (
        /(?:^|\/)test(?:\/|$)/u.test(repositoryPath) ||
        /\.(?:test|spec)\.[^.]+$/u.test(repositoryPath)
      ) {
        continue;
      }
      files.push(repositoryPath);
    }
  }

  await visit(sourceRoot);
  return files.sort();
}

export function extractModuleSpecifiers(source) {
  const specifiers = [];
  const declarationPattern =
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?(["'])([^"']+)\1/gu;

  for (const match of source.matchAll(declarationPattern)) {
    if (match[2]) {
      specifiers.push(match[2]);
    }
  }
  return specifiers;
}

export function findEmojiCharacters(source) {
  const matches = source.match(
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/gu,
  );
  return [...new Set(matches ?? [])].sort();
}

function packageRoot(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/")
  ) {
    return null;
  }
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? null);
}

export function isForbiddenIconPackage(specifier) {
  const root = packageRoot(specifier);
  if (!root || root === "lucide-react") {
    return false;
  }

  return (
    /(?:^|[-_/])icons?(?:[-_/]|$)/iu.test(root) ||
    /(?:heroicons|iconify|hugeicons|remixicon)/iu.test(root) ||
    new Set([
      "@mui/icons-material",
      "phosphor-react",
      "react-feather",
      "react-icons",
    ]).has(root)
  );
}

function extractHeaderControlsSource(appSource) {
  const start = appSource.indexOf("function HeaderControls");
  if (start < 0) {
    return "";
  }
  const end = appSource.indexOf("\nfunction ", start + 1);
  return appSource.slice(start, end < 0 ? undefined : end);
}

export function inspectHeaderControlStructure(appSource, stylesSource) {
  const componentSource = extractHeaderControlsSource(appSource);
  const fontIndex = componentSource.indexOf('className="font-size-control"');
  const themeIndexes = [
    componentSource.indexOf('className="theme-control"'),
    componentSource.indexOf("<ThemePicker"),
  ].filter((index) => index >= 0);
  const themeIndex = themeIndexes.length > 0 ? Math.min(...themeIndexes) : -1;
  const minusIndex = componentSource.indexOf("<Minus");
  const outputIndex = componentSource.indexOf("<output");
  const plusIndex = componentSource.indexOf("<Plus");
  const headerFragments = [
    ...appSource.matchAll(
      /<header\b[^>]*className="[^"]*\bapp-header\b[^"]*"[^>]*>([\s\S]*?)<\/header>/gu,
    ),
  ].map((match) => match[1] ?? "");
  const headerControlsRule =
    /\.header-controls\s*\{(?<body>[^}]*)\}/u.exec(stylesSource)?.groups
      ?.body ?? "";

  return {
    hasDefinition: componentSource.length > 0,
    hasControlsContainer: componentSource.includes(
      'className="header-controls"',
    ),
    fontBeforeTheme:
      fontIndex >= 0 && themeIndex >= 0 && fontIndex < themeIndex,
    decrementOutputIncrement:
      minusIndex >= 0 &&
      outputIndex > minusIndex &&
      plusIndex > outputIndex &&
      (themeIndex < 0 || plusIndex < themeIndex),
    headerCount: headerFragments.length,
    allHeadersPlaceControlsLast:
      headerFragments.length > 0 &&
      headerFragments.every((fragment) =>
        /<HeaderControls\s+\{\.\.\.controls\}\s*\/>\s*$/u.test(fragment.trim()),
      ),
    controlsAlignedRight: /margin-left\s*:\s*auto\s*;/u.test(
      headerControlsRule,
    ),
  };
}

function uiModuleFromSpecifier(specifier) {
  const match = /(?:^|\/)components\/ui\/(?<module>[^/]+)$/u.exec(specifier);
  return match?.groups?.module?.replace(/\.(?:[cm]?[jt]sx?)$/u, "") ?? null;
}

function extractComponentFamilies(source) {
  const body =
    /export\s+const\s+COMPONENT_FAMILIES\s*=\s*\[(?<body>[\s\S]*?)\]\s*as\s+const/u.exec(
      source,
    )?.groups?.body ?? "";
  return [...body.matchAll(/["']([^"']+)["']/gu)]
    .map((match) => match[1])
    .filter((value) => typeof value === "string");
}

function extractRenderedComponentFamilies(source) {
  return [...source.matchAll(/<Family\b[^>]*\bfamily=["']([^"']+)["']/gu)]
    .map((match) => match[1])
    .filter((value) => typeof value === "string");
}

export async function validatePhase1({
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const validation = new Validation("Phase 1 design-system foundation");

  const componentsConfig = await readRequiredJson(
    repositoryRoot,
    "apps/web/components.json",
    validation,
  );
  const webPackage = await readRequiredJson(
    repositoryRoot,
    "apps/web/package.json",
    validation,
  );
  const viteSource = await readRequiredText(
    repositoryRoot,
    "apps/web/vite.config.ts",
    validation,
  );

  validation.equal(
    componentsConfig.style,
    "radix-nova",
    "components.json uses the Radix Nova style",
  );
  validation.equal(
    componentsConfig.iconLibrary,
    "lucide",
    "components.json uses Lucide icons",
  );
  validation.equal(
    componentsConfig.tailwind?.cssVariables,
    true,
    "components.json enables CSS variables",
  );
  validation.equal(
    componentsConfig.tailwind?.css,
    "src/styles.css",
    "components.json points at the Vite application stylesheet",
  );
  validation.equal(
    componentsConfig.rsc,
    false,
    "components.json disables React Server Components for Vite",
  );
  validation.equal(
    webPackage.scripts?.dev,
    "vite",
    "components.json host application uses the Vite dev server",
  );
  validation.check(
    typeof webPackage.devDependencies?.vite === "string" &&
      viteSource.includes("defineConfig"),
    "components.json host application has a Vite configuration",
  );
  validation.check(
    typeof webPackage.dependencies?.["radix-ui"] === "string",
    "Radix primitives are installed",
  );

  validation.equal(
    SHADCN_DRY_RUN_ITEMS.length,
    62,
    "Pinned shadcn dry-run inventory contains 62 registry items",
  );
  validation.equal(
    new Set(SHADCN_DRY_RUN_ITEMS).size,
    SHADCN_DRY_RUN_ITEMS.length,
    "Pinned shadcn dry-run inventory contains no duplicates",
  );
  validation.check(
    SHADCN_DRY_RUN_ITEMS.includes("form"),
    "Pinned shadcn dry-run inventory records the fileless form item",
  );

  const uiDirectoryFiles = await listDirectoryFiles(
    repositoryRoot,
    UI_DIRECTORY,
    validation,
  );
  const actualUiFiles = uiDirectoryFiles.filter((file) =>
    /\.(?:[cm]?[jt]sx?)$/u.test(file),
  );
  validateExactSet(
    validation,
    actualUiFiles,
    EXPECTED_UI_FILES,
    "Installed shadcn UI module files",
  );

  const inspectedUiFiles = [];
  for (const file of actualUiFiles) {
    const path = `${UI_DIRECTORY}/${file}`;
    const source = await readRequiredText(repositoryRoot, path, validation);
    validation.check(
      /\bexport\s+(?:\{|(?:const|function|class|type|interface)\b)/u.test(
        source,
      ),
      `${path} exports a component API`,
    );
    inspectedUiFiles.push(path);
  }

  const mobileHook = await readRequiredText(
    repositoryRoot,
    MOBILE_HOOK_SOURCE,
    validation,
  );
  validation.check(
    /\bexport\s+function\s+useIsMobile\b/u.test(mobileHook),
    "The shadcn dry-run mobile hook is installed",
  );

  const productSourceFiles = await listProductSourceFiles(repositoryRoot);
  const forbiddenIconImports = [];
  const emojiViolations = [];
  let scannedImportCount = 0;
  for (const path of productSourceFiles) {
    const source = await readFile(resolve(repositoryRoot, path), "utf8");
    const specifiers = extractModuleSpecifiers(source);
    scannedImportCount += specifiers.length;
    for (const specifier of specifiers) {
      if (isForbiddenIconPackage(specifier)) {
        forbiddenIconImports.push({ path, specifier });
      }
    }
    const emoji = findEmojiCharacters(source);
    if (emoji.length > 0) {
      emojiViolations.push({ path, emoji });
    }
  }

  const dependencyNames = [
    ...Object.keys(webPackage.dependencies ?? {}),
    ...Object.keys(webPackage.devDependencies ?? {}),
  ].sort();
  const forbiddenIconDependencies = dependencyNames.filter(
    isForbiddenIconPackage,
  );
  validation.check(
    forbiddenIconDependencies.length === 0,
    "General product UI installs no non-Lucide icon package",
    { forbiddenIconDependencies },
  );
  validation.check(
    forbiddenIconImports.length === 0,
    "General product UI imports no non-Lucide icon package",
    { forbiddenIconImports },
  );
  validation.check(
    emojiViolations.length === 0,
    "General product UI source contains no emoji glyphs",
    { emojiViolations },
  );

  const appSource = await readRequiredText(
    repositoryRoot,
    APP_SOURCE,
    validation,
  );
  const stylesSource = await readRequiredText(
    repositoryRoot,
    STYLE_SOURCE,
    validation,
  );
  const headerControls = inspectHeaderControlStructure(appSource, stylesSource);
  validation.check(
    headerControls.hasDefinition && headerControls.hasControlsContainer,
    "The shared header display controls are defined",
  );
  validation.check(
    headerControls.fontBeforeTheme,
    "Font controls structurally precede the theme control",
  );
  validation.check(
    headerControls.decrementOutputIncrement,
    "Font controls preserve decrement, value, increment order before theme",
  );
  validation.check(
    headerControls.allHeadersPlaceControlsLast,
    "Every product app header places display controls at the right edge",
    { headerCount: headerControls.headerCount },
  );
  validation.check(
    headerControls.controlsAlignedRight,
    "Header display controls use right alignment",
  );

  const themeManifest = await readRequiredJson(
    repositoryRoot,
    "webeditor_theme_presets_v3.json",
    validation,
  );
  const themeSource = await readRequiredText(
    repositoryRoot,
    THEME_SOURCE,
    validation,
  );
  const themePickerSource = await readRequiredText(
    repositoryRoot,
    THEME_PICKER_SOURCE,
    validation,
  );
  const manifestThemes = Array.isArray(themeManifest.themes)
    ? themeManifest.themes
    : [];
  const themeGroupCounts = Object.fromEntries(
    ["dark", "gray", "light"].map((group) => [
      group,
      manifestThemes.filter((theme) => theme?.group === group).length,
    ]),
  );
  validation.equal(
    manifestThemes.length,
    60,
    "The application theme source remains the canonical 60-theme manifest",
  );
  for (const group of ["dark", "gray", "light"]) {
    validation.equal(
      themeGroupCounts[group],
      20,
      `The application maps all 20 ${group} themes`,
    );
  }
  validation.check(
    themeSource.includes('from "@webeditor/theme-core"') ||
      /from\s+["']\.\.\/\.\.\/\.\.\/webeditor_theme_presets_v3\.json["']/u.test(
        themeSource,
      ),
    "The application imports the canonical theme manifest",
  );
  validation.check(
    /export\s*\{[\s\S]*\bthemes\b[\s\S]*\}/u.test(themeSource) ||
      /export\s+const\s+themes\s*=\s*\([^;]*themeManifest[^;]*\)\.themes\s*;/su.test(
        themeSource,
      ),
    "The application maps the complete canonical theme array",
  );
  const mappedThemeGroups = [
    ...themePickerSource.matchAll(/\bid:\s*["'](dark|gray|light)["']/gu),
  ].map((match) => match[1]);
  validateExactSet(
    validation,
    mappedThemeGroups,
    ["dark", "gray", "light"],
    "Header theme selector groups",
  );
  validation.check(
    /availableThemes\s*=\s*themes/u.test(themePickerSource) &&
      /(?:themes|availableThemes)\.filter\s*\(/u.test(themePickerSource) &&
      /theme\.group\s*===\s*group/u.test(themePickerSource) &&
      /visibleThemes\.map\s*\(/u.test(themePickerSource) &&
      !themePickerSource.includes(".slice("),
    "Header theme selector maps every theme in every group without truncation",
  );

  const gallerySource = await readRequiredText(
    repositoryRoot,
    DESIGN_SYSTEM_SOURCE,
    validation,
  );
  const appSpecifiers = extractModuleSpecifiers(appSource);
  const appLoadsGallery =
    appSpecifiers.includes("./DesignSystemGallery") ||
    /import\(\s*["']\.\/DesignSystemGallery["']\s*\)/u.test(appSource);
  validation.check(
    appLoadsGallery && appSource.includes("<DesignSystemGallery"),
    "The application renders the design-system gallery component",
  );
  validation.check(
    appSource.includes("window.location.pathname") &&
      /["']\/internal\/design-system["']/u.test(appSource),
    "The internal design-system route is explicit",
  );
  const galleryUiModules = extractModuleSpecifiers(gallerySource)
    .map(uiModuleFromSpecifier)
    .filter((moduleName) => moduleName !== null);
  validateExactSet(
    validation,
    galleryUiModules,
    actualUiFiles.map((file) => file.replace(/\.(?:[cm]?[jt]sx?)$/u, "")),
    "Design-system gallery UI module references",
  );
  const componentFamilies = extractComponentFamilies(gallerySource);
  validateExactSet(
    validation,
    componentFamilies,
    actualUiFiles.map((file) => file.replace(/\.(?:[cm]?[jt]sx?)$/u, "")),
    "Design-system gallery component-family inventory",
  );
  const renderedComponentFamilies =
    extractRenderedComponentFamilies(gallerySource);
  validateExactSet(
    validation,
    renderedComponentFamilies,
    actualUiFiles.map((file) => file.replace(/\.(?:[cm]?[jt]sx?)$/u, "")),
    "Rendered design-system gallery component families",
  );
  validation.check(
    /data-component-family=\{family\}/u.test(gallerySource),
    "Design-system gallery renders its component-family inventory markers",
  );

  return validation.result({
    configuration: {
      framework: "vite",
      base: "radix",
      iconLibrary: componentsConfig.iconLibrary ?? null,
      cssVariables: componentsConfig.tailwind?.cssVariables ?? null,
    },
    registryItemCount: SHADCN_DRY_RUN_ITEMS.length,
    registryGeneratedFileCount: EXPECTED_UI_FILES.length + 1,
    installedUiModuleCount: actualUiFiles.length,
    inspectedUiFiles,
    productSourceFileCount: productSourceFiles.length,
    scannedImportCount,
    headerControls,
    themeCount: manifestThemes.length,
    themeGroupCounts,
    designSystem: {
      route: "/internal/design-system",
      referencedUiModuleCount: galleryUiModules.length,
      componentFamilyMarkerCount: componentFamilies.length,
      renderedComponentFamilyCount: renderedComponentFamilies.length,
    },
  });
}

async function main() {
  try {
    await finishVerification(
      "artifacts/phase1/design-system-validation.json",
      await validatePhase1(),
    );
  } catch (error) {
    await finishVerification(
      "artifacts/phase1/design-system-validation.json",
      unexpectedFailure("Phase 1 design-system foundation", error),
    );
  }
}

if (isMainModule(import.meta.url)) {
  await main();
}
