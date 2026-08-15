import {
  Activity,
  MousePointerClick,
  Square,
  Type,
  type LucideIcon,
} from "lucide-react";

import type { ElementType } from "@/services/elements-api";

export interface CanvasElementDefinition {
  type: ElementType;
  label: string;
  description: string;
  icon: LucideIcon;
  defaultW: number;
  defaultH: number;
  defaultSizeLabel: string;
}

export const canvasElementDefinitions: readonly CanvasElementDefinition[] = [
  {
    type: "text",
    label: "텍스트",
    description: "설명과 문장",
    icon: Type,
    defaultW: 6,
    defaultH: 5,
    defaultSizeLabel: "6 × 5",
  },
  {
    type: "button",
    label: "버튼",
    description: "사용자 동작",
    icon: MousePointerClick,
    defaultW: 4,
    defaultH: 5,
    defaultSizeLabel: "4 × 5",
  },
  {
    type: "container",
    label: "컨테이너",
    description: "콘텐츠 묶음",
    icon: Square,
    defaultW: 12,
    defaultH: 12,
    defaultSizeLabel: "12 × 12",
  },
  {
    type: "kpi-card",
    label: "KPI",
    description: "핵심 지표",
    icon: Activity,
    defaultW: 6,
    defaultH: 10,
    defaultSizeLabel: "6 × 10",
  },
] as const;

export const canvasElementDefinitionByType = new Map(
  canvasElementDefinitions.map((definition) => [definition.type, definition]),
);
