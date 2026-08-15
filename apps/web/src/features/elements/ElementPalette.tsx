import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ElementType } from "@/services/elements-api";
import {
  canvasElementDefinitionByType,
  canvasElementDefinitions,
  type CanvasElementDefinition,
} from "./element-definitions";

interface ElementPaletteProps {
  disabled?: boolean;
  onKeyboardPlace: (elementType: ElementType) => void;
}

function PaletteItem({
  definition,
  disabled,
  onKeyboardPlace,
}: {
  definition: CanvasElementDefinition;
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
  const Icon = definition.icon;

  return (
    <Button
      ref={setNodeRef}
      className={cn("palette-item", isDragging && "is-dragging")}
      style={{ transform: CSS.Translate.toString(transform) }}
      variant="outline"
      type="button"
      disabled={disabled}
      data-testid={`palette-item-${definition.type}`}
      aria-label={`${definition.label} 배치 · 기본 ${definition.defaultSizeLabel}`}
      onClick={() => onKeyboardPlace(definition.type)}
      {...listeners}
      {...attributes}
    >
      <Icon aria-hidden="true" />
      <span>
        <strong>{definition.label}</strong>
        <small>{definition.defaultSizeLabel}</small>
      </span>
    </Button>
  );
}

export function ElementPalette({
  disabled = false,
  onKeyboardPlace,
}: ElementPaletteProps) {
  return (
    <section className="element-palette" data-testid="element-palette">
      <div className="panel-heading compact">
        <div>
          <strong>엘리먼트</strong>
          <span>드래그 · Enter</span>
        </div>
      </div>
      <div className="palette-grid">
        {canvasElementDefinitions.map((definition) => (
          <PaletteItem
            key={definition.type}
            definition={definition}
            disabled={disabled}
            onKeyboardPlace={onKeyboardPlace}
          />
        ))}
      </div>
    </section>
  );
}

export function PaletteDragOverlay({
  elementType,
}: {
  elementType: ElementType;
}) {
  const definition = canvasElementDefinitionByType.get(elementType);
  if (!definition) return null;
  const Icon = definition.icon;
  return (
    <div
      className="palette-drag-overlay"
      data-testid="palette-drag-overlay"
      aria-label={`${definition.label} 이동 중`}
    >
      <Icon aria-hidden="true" />
      <span>
        <strong>{definition.label}</strong>
        <small>{definition.defaultSizeLabel}</small>
      </span>
    </div>
  );
}
