import { LockKeyhole } from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ElementEntryDto, ElementType } from "@/services/elements-api";

interface CanvasRendererProps {
  entry: ElementEntryDto;
  compact: boolean;
}

function textValue(
  props: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
): string {
  return typeof props[key] === "string" && props[key].trim()
    ? props[key]
    : fallback;
}

function TextRenderer({ entry, compact }: CanvasRendererProps) {
  return (
    <div className="canvas-text-element">
      <p>{textValue(entry.element.props, "text", entry.element.name)}</p>
      {!compact && <small>텍스트</small>}
    </div>
  );
}

function ButtonRenderer({ entry }: CanvasRendererProps) {
  return (
    <div className="canvas-button-element">
      <Button className="element-interactive" type="button">
        {textValue(entry.element.props, "label", entry.element.name)}
      </Button>
    </div>
  );
}

function ContainerRenderer({ entry, compact }: CanvasRendererProps) {
  return (
    <Card className="canvas-container-element">
      <CardHeader>
        <CardTitle>{entry.element.name}</CardTitle>
        {!compact && <CardDescription>컨테이너</CardDescription>}
      </CardHeader>
      {!compact && <CardContent>콘텐츠 영역</CardContent>}
    </Card>
  );
}

function KpiRenderer({ entry, compact }: CanvasRendererProps) {
  return (
    <Card className="canvas-kpi-element">
      <CardHeader>
        <CardDescription>
          {textValue(entry.element.props, "label", entry.element.name)}
        </CardDescription>
        <CardTitle>{textValue(entry.element.props, "value", "0")}</CardTitle>
      </CardHeader>
      {!compact && (
        <CardContent>
          {textValue(entry.element.props, "detail", "지표")}
        </CardContent>
      )}
    </Card>
  );
}

const rendererByType: Record<
  ElementType,
  ComponentType<CanvasRendererProps>
> = {
  text: TextRenderer,
  button: ButtonRenderer,
  container: ContainerRenderer,
  "kpi-card": KpiRenderer,
};

export function ElementRenderer({ entry, compact }: CanvasRendererProps) {
  const Renderer = rendererByType[entry.element.type];
  return (
    <div
      className="element-renderer"
      data-render-mode={compact ? "compact" : "full"}
    >
      {entry.element.locked && (
        <Badge className="element-lock-badge" variant="secondary">
          <LockKeyhole data-icon="inline-start" />
          잠금
        </Badge>
      )}
      <Renderer entry={entry} compact={compact} />
    </div>
  );
}
