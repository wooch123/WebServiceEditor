import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(toolDirectory, "..");
const canonicalPath = resolve(
  packageRoot,
  "src/presets/webeditor-theme-presets.v3.json",
);
const outputPath = resolve(
  packageRoot,
  "src/presets/webeditor-theme-presets.extension.v1.json",
);

const TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
  "canvas",
  "canvasGrid",
  "canvasGridStrong",
  "selection",
  "selectionForeground",
  "node",
  "nodeForeground",
  "nodeBorder",
  "edge",
  "edgeSelected",
  "success",
  "successForeground",
  "warning",
  "warningForeground",
  "error",
  "errorForeground",
  "info",
  "infoForeground",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "chart6",
  "chart7",
  "chart8",
];

const DARK_FAMILIES = [
  ["cobalt", "Cobalt Midnight", 218],
  ["violet", "Violet Eclipse", 268],
  ["teal", "Teal Nocturne", 174],
  ["ember", "Ember Night", 18],
  ["forest", "Forest Nocturne", 142],
  ["indigo", "Indigo Void", 244],
  ["crimson", "Crimson Dusk", 344],
  ["copper", "Copper Shadow", 28],
  ["cyan", "Cyan Abyss", 190],
  ["plum", "Plum Depth", 306],
  ["moss", "Moss Night", 104],
  ["sapphire", "Sapphire Smoke", 208],
  ["amethyst", "Amethyst Ink", 284],
  ["marine", "Marine Black", 198],
  ["ruby", "Ruby Ash", 354],
  ["bronze", "Bronze Moon", 40],
  ["jade", "Jade Depth", 158],
  ["ultraviolet", "Ultraviolet Night", 256],
  ["storm", "Storm Blue", 228],
  ["orchid", "Orchid Dark", 320],
];

const GRAY_FAMILIES = [
  ["slate", "Slate Signal", 214, "dark"],
  ["graphite", "Graphite Violet", 274, "dark"],
  ["iron", "Iron Teal", 178, "dark"],
  ["charcoal", "Charcoal Ember", 22, "dark"],
  ["basalt", "Basalt Forest", 146, "dark"],
  ["gunmetal", "Gunmetal Indigo", 238, "dark"],
  ["smoke", "Smoke Rose", 338, "dark"],
  ["pewter", "Pewter Copper", 34, "dark"],
  ["ash", "Ash Cyan", 192, "dark"],
  ["lead", "Lead Plum", 302, "dark"],
  ["fog", "Fog Blue", 210, "light"],
  ["silver", "Silver Violet", 266, "light"],
  ["mist", "Mist Teal", 172, "light"],
  ["pearl", "Pearl Ember", 16, "light"],
  ["stone", "Stone Forest", 138, "light"],
  ["zinc", "Zinc Indigo", 242, "light"],
  ["cloud", "Cloud Rose", 346, "light"],
  ["quartz", "Quartz Amber", 42, "light"],
  ["steel", "Steel Cyan", 188, "light"],
  ["nickel", "Nickel Orchid", 312, "light"],
];

const LIGHT_FAMILIES = [
  ["arctic", "Arctic Blue", 214],
  ["lavender", "Lavender Air", 268],
  ["mint", "Mint Glass", 166],
  ["apricot", "Apricot Paper", 24],
  ["meadow", "Meadow Light", 136],
  ["periwinkle", "Periwinkle Day", 238],
  ["rose", "Rose Porcelain", 344],
  ["sand", "Sand Copper", 34],
  ["aqua", "Aqua Frost", 188],
  ["lilac", "Lilac Canvas", 300],
  ["lime", "Lime Wash", 100],
  ["sky", "Sky Linen", 204],
  ["iris", "Iris Paper", 280],
  ["lagoon", "Lagoon Pearl", 194],
  ["coral", "Coral Snow", 356],
  ["honey", "Honey White", 44],
  ["sage", "Sage Glass", 152],
  ["citron", "Citron Frost", 74],
  ["denim", "Denim Day", 224],
  ["magnolia", "Magnolia Light", 318],
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hslToHex(hue, saturation, lightness) {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (section < 1) [red, green] = [chroma, x];
  else if (section < 2) [red, green] = [x, chroma];
  else if (section < 3) [green, blue] = [chroma, x];
  else if (section < 4) [green, blue] = [x, chroma];
  else if (section < 5) [red, blue] = [x, chroma];
  else [red, blue] = [chroma, x];
  const offset = l - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

function hexChannels(hex) {
  return [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
}

function relativeLuminance(hex) {
  const [red, green, blue] = hexChannels(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(left, right) {
  const brighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (brighter + 0.05) / (darker + 0.05);
}

function pickForeground(background) {
  const dark = "#000000";
  const light = "#FFFFFF";
  return contrast(background, dark) >= contrast(background, light)
    ? dark
    : light;
}

function hslWithContrast(
  background,
  hue,
  saturation,
  initialLightness,
  direction,
  minimum = 3.2,
) {
  let lightness = initialLightness;
  let candidate = hslToHex(hue, saturation, lightness);
  while (contrast(background, candidate) < minimum) {
    lightness += direction;
    if (lightness <= 0 || lightness >= 100) break;
    candidate = hslToHex(hue, saturation, lightness);
  }
  if (contrast(background, candidate) < minimum) {
    throw new Error(`Unable to reach ${minimum}: ${background} / ${candidate}`);
  }
  return candidate;
}

function createDarkTokens(hue, variant, neutralSaturation = 22) {
  const background = hslToHex(hue, neutralSaturation, 6 + (variant % 3));
  const canvas = hslToHex(hue, neutralSaturation, 5 + (variant % 2));
  const card = hslToHex(hue, neutralSaturation, 11 + (variant % 3));
  const popover = hslToHex(hue, neutralSaturation, 10 + ((variant + 1) % 3));
  const foreground = hslToHex(hue + 8, 12, 96);
  const primary = hslWithContrast(background, hue, 76, 62, 1);
  const secondary = hslToHex(hue, neutralSaturation, 18 + (variant % 2));
  const muted = hslToHex(hue, Math.max(6, neutralSaturation - 5), 16);
  const mutedForeground = hslWithContrast(muted, hue + 4, 10, 72, 1, 4.7);
  const accent = hslWithContrast(background, hue + 36, 66, 56, 1);
  const input = hslWithContrast(background, hue, 16, 34, 1);
  const sidebar = hslToHex(hue, neutralSaturation, 8 + (variant % 2));
  const sidebarAccent = hslToHex(hue, neutralSaturation, 18);
  const node = hslToHex(hue, neutralSaturation, 12 + (variant % 2));
  const success = hslToHex(145 + (variant % 7), 60, 42);
  const warning = hslToHex(42 + (variant % 5), 88, 48);
  const error = hslToHex(4 + (variant % 5), 72, 48);
  const info = hslToHex(205 + (variant % 9), 74, 50);
  const charts = Array.from({ length: 8 }, (_, index) =>
    hslWithContrast(
      canvas,
      hue + index * 43 + variant * 3,
      72,
      58 + (index % 2) * 5,
      1,
    ),
  );
  return {
    background,
    foreground,
    card,
    cardForeground: foreground,
    popover,
    popoverForeground: foreground,
    primary,
    primaryForeground: pickForeground(primary),
    secondary,
    secondaryForeground: foreground,
    muted,
    mutedForeground,
    accent,
    accentForeground: pickForeground(accent),
    destructive: error,
    destructiveForeground: pickForeground(error),
    border: input,
    input,
    ring: primary,
    sidebar,
    sidebarForeground: foreground,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: pickForeground(primary),
    sidebarAccent,
    sidebarAccentForeground: foreground,
    sidebarBorder: input,
    canvas,
    canvasGrid: hslToHex(hue, 13, 19),
    canvasGridStrong: hslToHex(hue, 14, 30),
    selection: primary,
    selectionForeground: pickForeground(primary),
    node,
    nodeForeground: foreground,
    nodeBorder: input,
    edge: hslWithContrast(canvas, hue + 8, 14, 52, 1),
    edgeSelected: primary,
    success,
    successForeground: pickForeground(success),
    warning,
    warningForeground: pickForeground(warning),
    error,
    errorForeground: pickForeground(error),
    info,
    infoForeground: pickForeground(info),
    ...Object.fromEntries(
      charts.map((color, index) => [`chart${index + 1}`, color]),
    ),
  };
}

function createLightTokens(hue, variant, neutralSaturation = 24) {
  const grayPalette = neutralSaturation <= 10;
  const background = hslToHex(
    hue,
    neutralSaturation,
    (grayPalette ? 94 : 98) - (variant % 2),
  );
  const canvas = hslToHex(
    hue,
    neutralSaturation,
    (grayPalette ? 93 : 97) - (variant % 2),
  );
  const card = hslToHex(
    hue,
    Math.max(5, neutralSaturation - 8),
    grayPalette ? 98 : 100,
  );
  const popover = hslToHex(
    hue,
    Math.max(5, neutralSaturation - 10),
    grayPalette ? 98 : 100,
  );
  const foreground = hslToHex(hue + 8, 24, 10 + (variant % 2));
  const primary = hslWithContrast(
    background,
    hue + (grayPalette ? 12 : 0),
    grayPalette ? 48 : 72,
    grayPalette ? 29 : 34,
    -1,
  );
  const secondary = hslToHex(hue, neutralSaturation, grayPalette ? 86 : 91);
  const muted = hslToHex(
    hue,
    Math.max(6, neutralSaturation - 5),
    grayPalette ? 88 : 92,
  );
  const mutedForeground = hslWithContrast(muted, hue + 4, 18, 38, -1, 4.7);
  const accent = hslToHex(
    hue + (grayPalette ? 82 : 34),
    grayPalette ? 42 : 58,
    grayPalette ? 82 : 87,
  );
  const input = hslWithContrast(background, hue, 16, 57, -1);
  const sidebar = hslToHex(hue, neutralSaturation, grayPalette ? 91 : 95);
  const sidebarAccent = hslToHex(hue, neutralSaturation, grayPalette ? 82 : 87);
  const node = hslToHex(
    hue,
    Math.max(5, neutralSaturation - 7),
    grayPalette ? 98 : 100,
  );
  const success = hslToHex(145 + (variant % 7), 62, 30);
  const warning = hslToHex(38 + (variant % 7), 88, 31);
  const error = hslToHex(4 + (variant % 5), 73, 40);
  const info = hslToHex(208 + (variant % 7), 74, 37);
  const charts = Array.from({ length: 8 }, (_, index) =>
    hslWithContrast(
      canvas,
      hue + index * 43 + variant * 3,
      grayPalette ? 58 : 72,
      38 - (index % 2) * 3,
      -1,
    ),
  );
  return {
    background,
    foreground,
    card,
    cardForeground: foreground,
    popover,
    popoverForeground: foreground,
    primary,
    primaryForeground: pickForeground(primary),
    secondary,
    secondaryForeground: foreground,
    muted,
    mutedForeground,
    accent,
    accentForeground: pickForeground(accent),
    destructive: error,
    destructiveForeground: pickForeground(error),
    border: input,
    input,
    ring: primary,
    sidebar,
    sidebarForeground: foreground,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: pickForeground(primary),
    sidebarAccent,
    sidebarAccentForeground: foreground,
    sidebarBorder: input,
    canvas,
    canvasGrid: hslToHex(hue, 12, grayPalette ? 80 : 87),
    canvasGridStrong: hslToHex(hue, 13, grayPalette ? 66 : 72),
    selection: primary,
    selectionForeground: pickForeground(primary),
    node,
    nodeForeground: foreground,
    nodeBorder: input,
    edge: hslWithContrast(canvas, hue + 8, 14, 48, -1),
    edgeSelected: primary,
    success,
    successForeground: pickForeground(success),
    warning,
    warningForeground: pickForeground(warning),
    error,
    errorForeground: pickForeground(error),
    info,
    infoForeground: pickForeground(info),
    ...Object.fromEntries(
      charts.map((color, index) => [`chart${index + 1}`, color]),
    ),
  };
}

function quality(tokens) {
  const metrics = {
    textBackground: contrast(tokens.foreground, tokens.background),
    textCard: contrast(tokens.cardForeground, tokens.card),
    textPopover: contrast(tokens.popoverForeground, tokens.popover),
    textPrimary: contrast(tokens.primaryForeground, tokens.primary),
    textAccent: contrast(tokens.accentForeground, tokens.accent),
    textMuted: contrast(tokens.mutedForeground, tokens.muted),
    textSidebar: contrast(tokens.sidebarForeground, tokens.sidebar),
    textNode: contrast(tokens.nodeForeground, tokens.node),
    focusRing: contrast(tokens.ring, tokens.background),
    inputBoundary: contrast(tokens.input, tokens.background),
    selectionBoundary: contrast(tokens.selection, tokens.background),
    successText: contrast(tokens.successForeground, tokens.success),
    warningText: contrast(tokens.warningForeground, tokens.warning),
    errorText: contrast(tokens.errorForeground, tokens.error),
    infoText: contrast(tokens.infoForeground, tokens.info),
    minChartBackground: Math.min(
      ...Array.from({ length: 8 }, (_, index) =>
        contrast(tokens[`chart${index + 1}`], tokens.canvas),
      ),
    ),
  };
  return Object.fromEntries(
    Object.entries(metrics).map(([name, value]) => [
      name,
      Number(value.toFixed(2)),
    ]),
  );
}

function orderedTokens(tokens) {
  const names = Object.keys(tokens);
  if (
    names.length !== TOKEN_NAMES.length ||
    TOKEN_NAMES.some((name) => !(name in tokens))
  ) {
    throw new Error("Generated token inventory is incomplete");
  }
  return Object.fromEntries(TOKEN_NAMES.map((name) => [name, tokens[name]]));
}

function createTheme(group, slug, name, hue, mode, index) {
  const neutralSaturation =
    group === "gray" ? 5 + (index % 4) : 20 + (index % 7);
  const tokens = orderedTokens(
    mode === "dark"
      ? createDarkTokens(hue, index, neutralSaturation)
      : createLightTokens(hue, index, neutralSaturation),
  );
  const metrics = quality(tokens);
  for (const metric of [
    "textBackground",
    "textCard",
    "textPopover",
    "textPrimary",
    "textAccent",
    "textMuted",
    "textSidebar",
    "textNode",
    "successText",
    "warningText",
    "errorText",
    "infoText",
  ]) {
    if (metrics[metric] < 4.5) throw new Error(`${group}-${slug}:${metric}`);
  }
  for (const metric of [
    "focusRing",
    "inputBoundary",
    "selectionBoundary",
    "minChartBackground",
  ]) {
    if (metrics[metric] < 3) throw new Error(`${group}-${slug}:${metric}`);
  }
  const tokenHash = createHash("sha256")
    .update(JSON.stringify(tokens))
    .digest("hex");
  return {
    id: `${group}-studio-${slug}`,
    name: `Studio ${name}`,
    group,
    referenceFamily: "WebEditor Studio",
    adaptation: `Original ${mode} semantic palette generated for WebEditor controls, canvas, status, and charts.`,
    tokens,
    quality: metrics,
    tokenHash,
    referenceIds: [],
    sourceUse:
      "Original generated palette; no third-party pixels or token values copied.",
    directCopy: false,
    licenseReviewStatus: "required-before-distribution",
  };
}

const themes = [
  ...DARK_FAMILIES.map(([slug, name, hue], index) =>
    createTheme("dark", slug, name, hue, "dark", index),
  ),
  ...GRAY_FAMILIES.map(([slug, name, hue, mode], index) =>
    createTheme("gray", slug, name, hue, mode, index),
  ),
  ...LIGHT_FAMILIES.map(([slug, name, hue], index) =>
    createTheme("light", slug, name, hue, "light", index),
  ),
];

const canonical = JSON.parse(await readFile(canonicalPath, "utf8"));
const ids = new Set(canonical.themes.map((theme) => theme.id));
const tokenPayloads = new Set(
  canonical.themes.map((theme) => JSON.stringify(theme.tokens)),
);
for (const theme of themes) {
  if (ids.has(theme.id)) throw new Error(`Duplicate theme id: ${theme.id}`);
  ids.add(theme.id);
  const payload = JSON.stringify(theme.tokens);
  if (tokenPayloads.has(payload))
    throw new Error(`Duplicate theme tokens: ${theme.id}`);
  tokenPayloads.add(payload);
}
for (const group of ["dark", "gray", "light"]) {
  const count = themes.filter((theme) => theme.group === group).length;
  if (count !== 20) throw new Error(`${group} extension count is ${count}`);
}

const manifestPayload = JSON.stringify(themes);
const manifest = {
  schemaVersion: "1.0.0",
  generatedFor: "WebEditor theme inventory extension",
  generatedAt: "2026-08-15",
  generationRule:
    "Original deterministic HSL semantic palettes; WCAG contrast is recomputed from emitted #RRGGBB values.",
  qualityGates: {
    normalTextContrastMin: 4.5,
    nonTextContrastMin: 3,
    requiredGroups: { dark: 20, gray: 20, light: 20 },
    requiredTokenCount: 52,
  },
  themes,
  manifestSha256: createHash("sha256").update(manifestPayload).digest("hex"),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(
  `Generated ${themes.length} extension themes at ${outputPath}\n${manifest.manifestSha256}\n`,
);
