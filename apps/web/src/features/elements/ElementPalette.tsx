import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { RotateCcw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DynamicLucideIcon,
  iconNameToDynamicName,
} from "@/features/pages/DynamicLucideIcon";
import { cn } from "@/lib/utils";
import type {
  ElementDefinitionDto,
  ElementType,
} from "@/services/elements-api";
import {
  elementCategoryLabels,
  elementDefinitionSizeLabel,
} from "./element-definitions";

interface ElementPaletteProps {
  definitions: readonly ElementDefinitionDto[];
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  presetControl?: ReactNode;
  onRetry?: () => void;
  onKeyboardPlace: (elementType: ElementType) => void;
}

function PaletteItem({
  definition,
  disabled,
  onKeyboardPlace,
}: {
  definition: ElementDefinitionDto;
  disabled: boolean;
  onKeyboardPlace: (elementType: ElementType) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `element-palette:${definition.type}`,
      disabled,
      data: {
        source: "element-palette",
        elementType: definition.type,
      },
    });
  const sizeLabel = elementDefinitionSizeLabel(definition);

  return (
    <Button
      ref={setNodeRef}
      className={cn("palette-item", isDragging && "is-dragging")}
      style={{ transform: CSS.Translate.toString(transform) }}
      variant="outline"
      type="button"
      disabled={disabled}
      data-testid={`palette-item-${definition.type}`}
      aria-label={`${definition.label} 배치 · 기본 ${sizeLabel}`}
      onClick={() => onKeyboardPlace(definition.type)}
      {...listeners}
      {...attributes}
    >
      <DynamicLucideIcon
        iconName={definition.iconName}
        dynamicName={iconNameToDynamicName(definition.iconName)}
      />
      <span>
        <strong>{definition.label}</strong>
        <small>
          {elementCategoryLabels[definition.category]} · {sizeLabel}
        </small>
      </span>
    </Button>
  );
}

export function ElementPalette({
  definitions,
  disabled = false,
  loading = false,
  error = "",
  presetControl,
  onRetry,
  onKeyboardPlace,
}: ElementPaletteProps) {
  return (
    <section className="element-palette" data-testid="element-palette">
      <div className="panel-heading compact">
        <div>
          <strong>엘리먼트</strong>
        </div>
        {presetControl}
      </div>
      {error ? (
        <Alert className="palette-alert" variant="destructive">
          <TriangleAlert />
          <AlertTitle>목록 오류</AlertTitle>
          <AlertDescription>
            <span>{error}</span>
            <Button variant="outline" size="sm" type="button" onClick={onRetry}>
              <RotateCcw data-icon="inline-start" />
              재시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="palette-grid" aria-busy={loading}>
          {loading && definitions.length === 0
            ? Array.from({ length: 6 }, (_, index) => (
                <Skeleton
                  className="palette-item"
                  data-testid="palette-loading-item"
                  key={index}
                />
              ))
            : null}
          {definitions.map((definition) => (
            <PaletteItem
              key={definition.type}
              definition={definition}
              disabled={disabled}
              onKeyboardPlace={onKeyboardPlace}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function PaletteDragOverlay({
  definition,
}: {
  definition: ElementDefinitionDto;
}) {
  const sizeLabel = elementDefinitionSizeLabel(definition);
  return (
    <div
      className="palette-drag-overlay"
      data-testid="palette-drag-overlay"
      aria-label={`${definition.label} 이동 중`}
    >
      <DynamicLucideIcon
        iconName={definition.iconName}
        dynamicName={iconNameToDynamicName(definition.iconName)}
      />
      <span>
        <strong>{definition.label}</strong>
        <small>{sizeLabel}</small>
      </span>
    </div>
  );
}
