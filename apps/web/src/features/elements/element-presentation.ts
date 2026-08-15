import type { CSSProperties } from "react";

import type { ElementEntryDto } from "@/services/elements-api";

const semanticColorTokens: Readonly<Record<string, string>> = {
  background: "var(--background)",
  foreground: "var(--foreground)",
  card: "var(--card)",
  "card-foreground": "var(--card-foreground)",
  primary: "var(--primary)",
  "primary-foreground": "var(--primary-foreground)",
  secondary: "var(--secondary)",
  "secondary-foreground": "var(--secondary-foreground)",
  muted: "var(--muted)",
  "muted-foreground": "var(--muted-foreground)",
  accent: "var(--accent)",
  "accent-foreground": "var(--accent-foreground)",
  destructive: "var(--destructive)",
  border: "var(--border)",
  input: "var(--input)",
  ring: "var(--ring)",
};

const shadowValues: Readonly<Record<string, string>> = {
  none: "none",
  sm: "0 1px 2px color-mix(in srgb, var(--foreground) 10%, transparent)",
  md: "0 4px 10px color-mix(in srgb, var(--foreground) 12%, transparent)",
  lg: "0 10px 24px color-mix(in srgb, var(--foreground) 16%, transparent)",
};

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function semanticColor(value: unknown): string | undefined {
  return typeof value === "string" ? semanticColorTokens[value] : undefined;
}

function safeHexColor(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)
    ? value
    : undefined;
}

function stringProp(
  props: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = props[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export interface ElementPresentation {
  readonly style: CSSProperties;
  readonly disabled: boolean;
  readonly hidden: boolean;
  readonly title?: string;
  readonly accessibilityLabel?: string;
}

export function elementPresentation(
  entry: ElementEntryDto,
): ElementPresentation {
  const { props, style } = entry.element;
  const padding = boundedNumber(style.padding, 0, 64);
  const margin = boundedNumber(style.margin, 0, 64);
  const radius = boundedNumber(style.radius, 0, 48);
  const fontSize = boundedNumber(style.fontSize, 10, 72);
  const borderWidth = boundedNumber(style.borderWidth, 0, 8);
  const backgroundColor =
    safeHexColor(style.backgroundCustom) ??
    semanticColor(style.backgroundToken);
  const borderColor = semanticColor(style.borderToken);
  const color =
    semanticColor(style.textColorToken) ?? safeHexColor(style.textColor);
  const fontWeight = [400, 500, 600, 700].includes(Number(style.fontWeight))
    ? Number(style.fontWeight)
    : undefined;
  const textAlign = ["left", "center", "right"].includes(
    String(style.textAlign),
  )
    ? (style.textAlign as CSSProperties["textAlign"])
    : undefined;
  const justifyContent =
    style.contentAlign === "start"
      ? "flex-start"
      : style.contentAlign === "center"
        ? "center"
        : style.contentAlign === "end"
          ? "flex-end"
          : style.contentAlign === "stretch"
            ? "stretch"
            : undefined;
  const borderStyle = ["solid", "dashed", "dotted", "none"].includes(
    String(style.borderStyle),
  )
    ? (style.borderStyle as CSSProperties["borderStyle"])
    : undefined;
  const boxShadow =
    typeof style.shadow === "string" ? shadowValues[style.shadow] : undefined;
  const title = stringProp(props, "tooltip");
  const accessibilityLabel = stringProp(props, "accessibilityLabel");

  return {
    style: {
      ...(padding === undefined ? {} : { padding }),
      ...(margin === undefined ? {} : { margin }),
      ...(radius === undefined ? {} : { borderRadius: radius }),
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(fontWeight === undefined ? {} : { fontWeight }),
      ...(backgroundColor === undefined ? {} : { backgroundColor }),
      ...(borderColor === undefined ? {} : { borderColor }),
      ...(borderWidth === undefined ? {} : { borderWidth }),
      ...(borderStyle === undefined ? {} : { borderStyle }),
      ...(color === undefined ? {} : { color }),
      ...(textAlign === undefined ? {} : { textAlign }),
      ...(justifyContent === undefined
        ? {}
        : { display: "flex", flexDirection: "column", justifyContent }),
      ...(boxShadow === undefined ? {} : { boxShadow }),
    },
    disabled: props.disabled === true,
    hidden: entry.element.hidden,
    ...(title ? { title } : {}),
    ...(accessibilityLabel ? { accessibilityLabel } : {}),
  };
}
