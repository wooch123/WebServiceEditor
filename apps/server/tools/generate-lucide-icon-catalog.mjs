/* global console */

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { format } from "prettier";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolsDirectory, "../../..");
const requireFromWeb = createRequire(
  resolve(repositoryRoot, "apps/web/package.json"),
);
const packagePath = requireFromWeb.resolve("lucide-react/package.json");
const dynamicImportsPath = resolve(
  dirname(packagePath),
  "dynamicIconImports.mjs",
);
const { version } = requireFromWeb(packagePath);

if (version !== "1.31.0") {
  throw new Error(`Expected lucide-react 1.31.0, found ${version}`);
}

const dynamicImports = (await import(pathToFileURL(dynamicImportsPath).href))
  .default;

const categoryRules = [
  ["accessibility", ["accessibility", "ear", "eye", "speech"]],
  ["arrows", ["arrow", "chevron", "move", "rotate", "undo", "redo"]],
  ["charts", ["chart", "activity", "trending", "gauge"]],
  ["files", ["file", "folder", "archive", "clipboard"]],
  ["layout", ["layout", "panel", "columns", "rows", "sidebar"]],
  ["communication", ["message", "mail", "phone", "send", "radio"]],
  ["people", ["user", "contact", "person", "baby"]],
  ["time", ["calendar", "clock", "timer", "alarm", "hourglass"]],
  ["data", ["database", "table", "server", "cloud", "hard-drive"]],
  ["settings", ["settings", "wrench", "tool", "sliders", "cog"]],
  ["media", ["image", "video", "audio", "music", "camera", "mic"]],
  ["commerce", ["shopping", "cart", "wallet", "credit", "receipt"]],
  ["security", ["lock", "shield", "key", "scan", "fingerprint"]],
  ["transport", ["car", "bus", "train", "plane", "ship", "bike"]],
  ["weather", ["sun", "moon", "cloud", "rain", "snow", "wind"]],
];

function expectedDynamicName(displayName) {
  return displayName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d+)/g, "$1-$2")
    .replace(/(\d+)([A-Za-z])/g, "$1-$2")
    .toLowerCase();
}

function words(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const byDisplayName = new Map();
for (const dynamicName of Object.keys(dynamicImports).sort()) {
  const loaded = await dynamicImports[dynamicName]();
  const displayName = loaded.default?.displayName;
  if (
    typeof displayName !== "string" ||
    !/^[A-Z][A-Za-z0-9]*$/.test(displayName)
  ) {
    throw new Error(`Invalid Lucide displayName for ${dynamicName}`);
  }
  const aliases = byDisplayName.get(displayName) ?? [];
  aliases.push(dynamicName);
  byDisplayName.set(displayName, aliases);
}

const items = [...byDisplayName.entries()]
  .map(([name, aliases]) => {
    const expected = expectedDynamicName(name);
    const dynamicName = aliases.includes(expected)
      ? expected
      : [...aliases].sort(
          (left, right) =>
            left.length - right.length || left.localeCompare(right),
        )[0];
    const keywordSet = new Set([
      ...words(name),
      ...aliases,
      ...aliases.flatMap(words),
    ]);
    const searchable = [...keywordSet].join(" ");
    const categories = categoryRules
      .filter(([, tokens]) =>
        tokens.some((token) => searchable.includes(token)),
      )
      .map(([category]) => category);
    if (categories.length === 0) categories.push("general");
    return {
      name,
      dynamicName,
      categories: [...new Set(categories)].sort(),
      keywords: [...keywordSet].sort(),
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const unformattedOutput =
  `// Generated from lucide-react/dynamicIconImports.mjs v${version}.\n` +
  `// Run apps/server/tools/generate-lucide-icon-catalog.mjs to regenerate.\n` +
  `import type { IconCatalogItemDto } from "@webeditor/domain";\n\n` +
  `export const LUCIDE_ICON_CATALOG = ${JSON.stringify(items, null, 2)} as const satisfies readonly IconCatalogItemDto[];\n\n` +
  `export const LUCIDE_DYNAMIC_ICON_NAMES = ${JSON.stringify(Object.keys(dynamicImports).sort(), null, 2)} as const;\n`;
const output = await format(unformattedOutput, { parser: "typescript" });

await writeFile(
  resolve(
    repositoryRoot,
    "apps/server/src/icons/lucide-icon-catalog.generated.ts",
  ),
  output,
  "utf8",
);

console.log(
  `Generated ${items.length} Lucide icon records from ${Object.keys(dynamicImports).length} dynamic names.`,
);
