import type {
  ElementCategory,
  ElementDefinitionDto,
  ElementType,
} from "@/services/elements-api";

export const elementCategoryLabels: Readonly<Record<ElementCategory, string>> =
  {
    basic: "기본",
    input: "입력",
    data: "데이터",
    statistics: "통계",
  };

export function elementDefinitionSizeLabel(
  definition: ElementDefinitionDto,
): string {
  return `${definition.layout.defaultW} × ${definition.layout.defaultH}`;
}

export function elementDefinitionMap(
  definitions: readonly ElementDefinitionDto[],
): ReadonlyMap<ElementType, ElementDefinitionDto> {
  return new Map(
    definitions.map((definition) => [definition.type, definition]),
  );
}
