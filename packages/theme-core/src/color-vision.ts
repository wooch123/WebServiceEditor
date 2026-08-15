export const COLOR_VISION_MODES = [
  "normal",
  "protanopia",
  "deuteranopia",
  "tritanopia",
] as const;

export type ColorVisionMode = (typeof COLOR_VISION_MODES)[number];

const matrices = {
  protanopia: [
    [0.152_286, 1.052_583, -0.204_868],
    [0.114_503, 0.786_281, 0.099_216],
    [-0.003_882, -0.048_116, 1.051_998],
  ],
  deuteranopia: [
    [0.367_322, 0.860_646, -0.227_968],
    [0.280_085, 0.672_501, 0.047_413],
    [-0.011_82, 0.042_94, 0.968_881],
  ],
  tritanopia: [
    [1.255_528, -0.076_749, -0.178_779],
    [-0.078_411, 0.930_809, 0.147_602],
    [0.004_733, 0.691_367, 0.303_9],
  ],
} as const;

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function toHex(value: number): string {
  return clampChannel(value).toString(16).padStart(2, "0").toUpperCase();
}

export function simulateColorVision(
  color: string,
  mode: ColorVisionMode,
): string {
  if (!/^#[\dA-Fa-f]{6}$/u.test(color)) {
    throw new Error(`Expected a six-digit hex color, received ${color}.`);
  }
  if (mode === "normal") return color.toUpperCase();

  const channels = [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
  const matrix = matrices[mode];
  const converted = matrix.map((row) =>
    row.reduce(
      (sum, coefficient, index) => sum + coefficient * (channels[index] ?? 0),
      0,
    ),
  );

  return `#${converted.map(toHex).join("")}`;
}
