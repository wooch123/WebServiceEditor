import {
  CANVAS_GRID,
  type BatchLayoutItem,
  type ElementCommandSummaryDto,
  type ElementCommandType,
  type ElementDefinition,
  type ElementDto,
  type ElementEntryDto,
  type ElementLayoutDto,
  type ElementType,
  type LayoutPresetApplyMode,
  type LayoutPresetBindingPlaceholderDto,
  type LayoutPresetInstanceDto,
  type LayoutPresetInstanceOrigin,
  type LayoutPresetInstanceState,
  type LayoutPresetProposedElementDto,
} from "@webeditor/domain";
import type Database from "better-sqlite3";

import type { MetadataDatabase } from "../metadata/database.js";
import {
  elementDefinition,
  validateElementStoredState,
} from "./element-registry.js";
import {
  layoutPresetCoordinateChecksum,
  validateLayoutPresetDefinitionSnapshot,
} from "./layout-preset-registry.js";

export interface ElementRow {
  readonly id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly type: ElementType;
  readonly type_version: 1;
  readonly name: string;
  readonly props_json: string;
  readonly style_json: string;
  readonly events_json: string;
  readonly locked: 0 | 1;
  readonly hidden: 0 | 1;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface ElementLayoutRow {
  readonly element_id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly breakpoint: "desktop";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly min_w: number;
  readonly min_h: number;
  readonly max_w: number;
  readonly max_h: number;
}

export interface ElementCommandRow {
  readonly id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly element_id: string | null;
  readonly command_type: ElementCommandType;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly before_json: string | null;
  readonly after_json: string | null;
  readonly response_status: number;
  readonly response_json: string;
  readonly before_layout_revision: number;
  readonly after_layout_revision: number;
  readonly history_state: "APPLIED" | "UNDONE" | "DISCARDED" | null;
  readonly history_sequence: number | null;
  readonly history_updated_at: string | null;
  readonly created_at: string;
}

export interface ElementHistoryOperationRow {
  readonly id: string;
  readonly project_id: string;
  readonly command_id: string | null;
  readonly requested_command_id: string;
  readonly operation_type: "UNDO" | "REDO";
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly response_status: number;
  readonly response_json: string;
  readonly created_at: string;
}

export interface LayoutPresetInstanceRow {
  readonly id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly preset_id: string;
  readonly preset_version: 1;
  readonly preset_snapshot_json: string;
  readonly registry_checksum: string;
  readonly coordinate_checksum: string;
  readonly apply_mode: LayoutPresetApplyMode;
  readonly instance_state: LayoutPresetInstanceState;
  readonly origin: LayoutPresetInstanceOrigin;
  readonly command_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LayoutPresetInstanceElementRow {
  readonly instance_id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly template_id: string;
  readonly element_id: string;
  readonly element_type: ElementType;
  readonly element_type_version: 1;
  readonly initial_x: number;
  readonly initial_y: number;
  readonly initial_w: number;
  readonly initial_h: number;
  readonly entry_snapshot_json: string;
}

export interface ElementBindingPlaceholderRow {
  readonly element_id: string;
  readonly project_id: string;
  readonly page_id: string;
  readonly element_type_version: 1;
  readonly port_id: string;
  readonly instance_id: string | null;
  readonly template_id: string | null;
  readonly status: "UNCONNECTED";
  readonly created_at: string;
}

const elementColumns = `
  id, project_id, page_id, type, type_version, name, props_json, style_json,
  events_json, locked, hidden, revision, created_at, updated_at, deleted_at
`;
const layoutColumns = `
  element_id, project_id, page_id, breakpoint, x, y, w, h,
  min_w, min_h, max_w, max_h
`;
const commandColumns = `
  id, project_id, page_id, element_id, command_type, idempotency_key,
  request_hash, before_json, after_json, response_status, response_json,
  before_layout_revision, after_layout_revision, history_state,
  history_sequence, history_updated_at, created_at
`;
const presetInstanceColumns = `
  id, project_id, page_id, preset_id, preset_version, preset_snapshot_json,
  registry_checksum, coordinate_checksum, apply_mode, instance_state, origin,
  command_id, created_at, updated_at
`;
const presetInstanceElementColumns = `
  instance_id, project_id, page_id, template_id, element_id, element_type,
  element_type_version, initial_x, initial_y, initial_w, initial_h,
  entry_snapshot_json
`;
const bindingPlaceholderColumns = `
  element_id, project_id, page_id, element_type_version, port_id, instance_id,
  template_id, status, created_at
`;

export class ElementRepository {
  constructor(readonly metadataDatabase: MetadataDatabase) {}

  get connection(): Database.Database {
    return this.metadataDatabase.connection;
  }

  assertBindingPlaceholderTopology(projectId?: string): void {
    const where = projectId === undefined ? "" : " WHERE project_id = ?";
    const parameters = projectId === undefined ? [] : [projectId];
    const elements = this.connection
      .prepare(`SELECT ${elementColumns} FROM elements${where} ORDER BY id`)
      .all(...parameters) as readonly ElementRow[];
    const placeholders = this.connection
      .prepare(
        `SELECT ${bindingPlaceholderColumns}
         FROM element_binding_placeholders${where}
         ORDER BY element_id, port_id`,
      )
      .all(...parameters) as readonly ElementBindingPlaceholderRow[];
    const memberships = this.connection
      .prepare(
        `SELECT ${presetInstanceElementColumns}
         FROM layout_preset_instance_elements${where}
         ORDER BY element_id`,
      )
      .all(...parameters) as readonly LayoutPresetInstanceElementRow[];
    const instances = this.connection
      .prepare(
        `SELECT ${presetInstanceColumns}
         FROM layout_preset_instances${where}
         ORDER BY id`,
      )
      .all(...parameters) as readonly LayoutPresetInstanceRow[];

    for (const instance of instances) this.toLayoutPresetInstanceDto(instance);

    const elementsById = new Map(
      elements.map((element) => [element.id, element]),
    );
    const membershipByElementId = new Map<
      string,
      LayoutPresetInstanceElementRow
    >();
    for (const membership of memberships) {
      if (
        membershipByElementId.has(membership.element_id) ||
        !elementsById.has(membership.element_id)
      ) {
        throw new Error("Layout Preset membership topology is invalid");
      }
      membershipByElementId.set(membership.element_id, membership);
    }
    const placeholdersByElementId = new Map<
      string,
      ElementBindingPlaceholderRow[]
    >();
    for (const placeholder of placeholders) {
      if (!elementsById.has(placeholder.element_id)) {
        throw new Error("Element binding placeholder topology is invalid");
      }
      const rows = placeholdersByElementId.get(placeholder.element_id) ?? [];
      rows.push(placeholder);
      placeholdersByElementId.set(placeholder.element_id, rows);
    }

    for (const element of elements) {
      const definition = elementDefinition(element.type);
      const expectedPortIds = definition.bindingPorts
        .filter(
          (port) =>
            port.required && port.direction === "input" && port.side === "left",
        )
        .map(({ id }) => id)
        .sort();
      const actual = placeholdersByElementId.get(element.id) ?? [];
      const actualPortIds = actual.map(({ port_id }) => port_id).sort();
      const membership = membershipByElementId.get(element.id);
      if (
        element.type_version !== definition.typeVersion ||
        JSON.stringify(actualPortIds) !== JSON.stringify(expectedPortIds)
      ) {
        throw new Error("Element binding placeholder topology is invalid");
      }
      for (const placeholder of actual) {
        const standalone =
          placeholder.instance_id === null && placeholder.template_id === null;
        const presetBound =
          membership !== undefined &&
          placeholder.instance_id === membership.instance_id &&
          placeholder.template_id === membership.template_id;
        if (
          placeholder.project_id !== element.project_id ||
          placeholder.page_id !== element.page_id ||
          placeholder.element_type_version !== element.type_version ||
          placeholder.status !== "UNCONNECTED" ||
          (membership === undefined ? !standalone : !presetBound)
        ) {
          throw new Error("Element binding placeholder topology is invalid");
        }
      }
    }
  }

  layoutRevision(pageId: string): number | undefined {
    const row = this.connection
      .prepare(
        "SELECT desktop_revision FROM page_layout_revisions WHERE page_id = ?",
      )
      .get(pageId) as { readonly desktop_revision: number } | undefined;
    return row?.desktop_revision;
  }

  listActive(pageId: string): readonly ElementEntryDto[] {
    const rows = this.connection
      .prepare(
        `SELECT
           e.id, e.project_id, e.page_id, e.type, e.type_version, e.name,
           e.props_json, e.style_json, e.events_json, e.locked, e.hidden,
           e.revision, e.created_at, e.updated_at, e.deleted_at,
           l.element_id AS layout_element_id, l.breakpoint, l.x, l.y, l.w,
           l.h, l.min_w, l.min_h, l.max_w, l.max_h
         FROM elements e
         JOIN element_layouts l
           ON l.element_id = e.id AND l.breakpoint = 'desktop'
         WHERE e.page_id = ? AND e.deleted_at IS NULL
         ORDER BY l.y, l.x, e.created_at, e.id`,
      )
      .all(pageId) as readonly (ElementRow & {
      readonly layout_element_id: string;
      readonly breakpoint: "desktop";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly min_w: number;
      readonly min_h: number;
      readonly max_w: number;
      readonly max_h: number;
    })[];
    return rows.map((row) => ({
      element: this.toElementDto(row),
      layout: {
        elementId: row.layout_element_id,
        breakpoint: row.breakpoint,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        minW: row.min_w,
        minH: row.min_h,
        maxW: row.max_w,
        maxH: row.max_h,
      },
    }));
  }

  listActiveForProject(projectId: string): readonly ElementEntryDto[] {
    const pageIds = this.connection
      .prepare(
        `SELECT id FROM pages
         WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`,
      )
      .all(projectId) as readonly { readonly id: string }[];
    return pageIds.flatMap(({ id }) => this.listActive(id));
  }

  activeCountForProject(projectId: string): number {
    const row = this.connection
      .prepare(
        `SELECT count(*) AS count FROM elements e
         JOIN pages p ON p.id = e.page_id
         WHERE e.project_id = ? AND e.deleted_at IS NULL AND p.deleted_at IS NULL`,
      )
      .get(projectId) as { readonly count: number };
    return row.count;
  }

  activeCountForPage(pageId: string): number {
    const row = this.connection
      .prepare(
        "SELECT count(*) AS count FROM elements WHERE page_id = ? AND deleted_at IS NULL",
      )
      .get(pageId) as { readonly count: number };
    return row.count;
  }

  get(elementId: string): ElementRow | undefined {
    return this.connection
      .prepare(`SELECT ${elementColumns} FROM elements WHERE id = ?`)
      .get(elementId) as ElementRow | undefined;
  }

  getActive(elementId: string): ElementRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${elementColumns} FROM elements
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(elementId) as ElementRow | undefined;
  }

  getLayout(elementId: string): ElementLayoutRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${layoutColumns} FROM element_layouts
         WHERE element_id = ? AND breakpoint = 'desktop'`,
      )
      .get(elementId) as ElementLayoutRow | undefined;
  }

  getEntry(elementId: string): ElementEntryDto | undefined {
    const element = this.getActive(elementId);
    const layout = this.getLayout(elementId);
    if (element === undefined || layout === undefined) return undefined;
    return {
      element: this.toElementDto(element),
      layout: this.toLayoutDto(layout),
    };
  }

  insert(input: {
    readonly id: string;
    readonly projectId: string;
    readonly pageId: string;
    readonly definition: ElementDefinition;
    readonly x: number;
    readonly y: number;
    readonly now: string;
  }): ElementEntryDto {
    const { definition } = input;
    this.connection
      .prepare(
        `INSERT INTO elements (
           id, project_id, page_id, type, type_version, name, props_json,
           style_json, events_json, locked, hidden, revision, created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        definition.type,
        definition.typeVersion,
        definition.defaultName,
        JSON.stringify(definition.defaultProps),
        JSON.stringify(definition.defaultStyle),
        JSON.stringify(definition.defaultEvents),
        input.now,
        input.now,
      );
    this.connection
      .prepare(
        `INSERT INTO element_layouts (
           element_id, project_id, page_id, breakpoint, x, y, w, h,
           min_w, min_h, max_w, max_h
         ) VALUES (?, ?, ?, 'desktop', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        input.x,
        input.y,
        definition.layout.defaultW,
        definition.layout.defaultH,
        definition.layout.minW,
        definition.layout.minH,
        definition.layout.maxW,
        definition.layout.maxH,
      );
    this.insertRequiredBindingPlaceholders({
      elementId: input.id,
      projectId: input.projectId,
      pageId: input.pageId,
      definition,
      instanceId: null,
      templateId: null,
      now: input.now,
    });
    return this.getEntry(input.id) as ElementEntryDto;
  }

  insertImported(input: {
    readonly entry: ElementEntryDto;
    readonly id: string;
    readonly pageId: string;
    readonly projectId: string;
    readonly now: string;
  }): void {
    const { element, layout } = input.entry;
    this.connection
      .prepare(
        `INSERT INTO elements (
           id, project_id, page_id, type, type_version, name, props_json,
           style_json, events_json, locked, hidden, revision, created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        element.type,
        element.name,
        JSON.stringify(element.props),
        JSON.stringify(element.style),
        JSON.stringify(element.events),
        element.locked ? 1 : 0,
        element.hidden ? 1 : 0,
        input.now,
        input.now,
      );
    this.connection
      .prepare(
        `INSERT INTO element_layouts (
           element_id, project_id, page_id, breakpoint, x, y, w, h,
           min_w, min_h, max_w, max_h
         ) VALUES (?, ?, ?, 'desktop', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        layout.x,
        layout.y,
        layout.w,
        layout.h,
        layout.minW,
        layout.minH,
        layout.maxW,
        layout.maxH,
      );
    this.insertRequiredBindingPlaceholders({
      elementId: input.id,
      projectId: input.projectId,
      pageId: input.pageId,
      definition: elementDefinition(element.type),
      instanceId: null,
      templateId: null,
      now: input.now,
    });
  }

  insertPresetElement(
    proposed: LayoutPresetProposedElementDto,
    now: string,
  ): void {
    const { element, layout } = proposed.entry;
    this.connection
      .prepare(
        `INSERT INTO elements (
           id, project_id, page_id, type, type_version, name, props_json,
           style_json, events_json, locked, hidden, revision, created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        element.id,
        element.projectId,
        element.pageId,
        element.type,
        element.typeVersion,
        element.name,
        JSON.stringify(element.props),
        JSON.stringify(element.style),
        JSON.stringify(element.events),
        element.locked ? 1 : 0,
        element.hidden ? 1 : 0,
        now,
        now,
      );
    this.connection
      .prepare(
        `INSERT INTO element_layouts (
           element_id, project_id, page_id, breakpoint, x, y, w, h,
           min_w, min_h, max_w, max_h
         ) VALUES (?, ?, ?, 'desktop', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        element.id,
        element.projectId,
        element.pageId,
        layout.x,
        layout.y,
        layout.w,
        layout.h,
        layout.minW,
        layout.minH,
        layout.maxW,
        layout.maxH,
      );
  }

  insertRequiredBindingPlaceholders(input: {
    readonly elementId: string;
    readonly projectId: string;
    readonly pageId: string;
    readonly definition: ElementDefinition;
    readonly instanceId: string | null;
    readonly templateId: string | null;
    readonly now: string;
  }): void {
    const insert = this.connection.prepare(
      `INSERT INTO element_binding_placeholders (
         element_id, project_id, page_id, element_type_version, port_id,
         instance_id, template_id, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UNCONNECTED', ?)`,
    );
    for (const port of input.definition.bindingPorts) {
      if (port.required && port.direction === "input" && port.side === "left") {
        insert.run(
          input.elementId,
          input.projectId,
          input.pageId,
          input.definition.typeVersion,
          port.id,
          input.instanceId,
          input.templateId,
          input.now,
        );
      }
    }
  }

  setImportedLayoutRevision(
    pageId: string,
    revision: number,
    now: string,
  ): void {
    this.connection
      .prepare(
        `UPDATE page_layout_revisions
         SET desktop_revision = ?, updated_at = ? WHERE page_id = ?`,
      )
      .run(revision, now, pageId);
  }

  insertLayoutPresetInstance(input: {
    readonly id: string;
    readonly projectId: string;
    readonly pageId: string;
    readonly presetId: string;
    readonly presetVersion: 1;
    readonly presetSnapshot: LayoutPresetInstanceDto["presetSnapshot"];
    readonly registryChecksum: string;
    readonly coordinateChecksum: string;
    readonly mode: LayoutPresetApplyMode;
    readonly state: LayoutPresetInstanceState;
    readonly origin: LayoutPresetInstanceOrigin;
    readonly commandId: string | null;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO layout_preset_instances (
           id, project_id, page_id, preset_id, preset_version,
           preset_snapshot_json, registry_checksum, coordinate_checksum,
           apply_mode, instance_state, origin, command_id, created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.pageId,
        input.presetId,
        input.presetVersion,
        JSON.stringify(input.presetSnapshot),
        input.registryChecksum,
        input.coordinateChecksum,
        input.mode,
        input.state,
        input.origin,
        input.commandId,
        input.now,
        input.now,
      );
  }

  insertLayoutPresetMembership(
    instanceId: string,
    proposed: LayoutPresetProposedElementDto,
  ): void {
    const { element, layout } = proposed.entry;
    this.connection
      .prepare(
        `INSERT INTO layout_preset_instance_elements (
           instance_id, project_id, page_id, template_id, element_id,
           element_type, element_type_version, initial_x, initial_y, initial_w,
           initial_h, entry_snapshot_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        instanceId,
        element.projectId,
        element.pageId,
        proposed.templateId,
        element.id,
        element.type,
        element.typeVersion,
        layout.x,
        layout.y,
        layout.w,
        layout.h,
        JSON.stringify(proposed.entry),
      );
  }

  insertLayoutPresetPlaceholder(
    placeholder: LayoutPresetBindingPlaceholderDto,
    projectId: string,
    pageId: string,
    now: string,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO element_binding_placeholders (
           element_id, project_id, page_id, element_type_version, port_id,
           instance_id, template_id, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        placeholder.elementId,
        projectId,
        pageId,
        placeholder.elementTypeVersion,
        placeholder.portId,
        placeholder.instanceId,
        placeholder.templateId,
        placeholder.status,
        now,
      );
  }

  attachImportedLayoutPresetPlaceholder(input: {
    readonly instanceId: string;
    readonly templateId: string;
    readonly elementId: string;
    readonly elementTypeVersion: 1;
    readonly portId: string;
  }): void {
    const result = this.connection
      .prepare(
        `UPDATE element_binding_placeholders
         SET instance_id = ?, template_id = ?
         WHERE element_id = ? AND element_type_version = ? AND port_id = ?
           AND instance_id IS NULL AND template_id IS NULL
           AND status = 'UNCONNECTED'`,
      )
      .run(
        input.instanceId,
        input.templateId,
        input.elementId,
        input.elementTypeVersion,
        input.portId,
      );
    if (result.changes !== 1) {
      throw new Error("Imported Layout Preset placeholder topology changed");
    }
  }

  getLayoutPresetInstance(
    instanceId: string,
  ): LayoutPresetInstanceDto | undefined {
    const row = this.connection
      .prepare(
        `SELECT ${presetInstanceColumns}
         FROM layout_preset_instances WHERE id = ?`,
      )
      .get(instanceId) as LayoutPresetInstanceRow | undefined;
    return row === undefined ? undefined : this.toLayoutPresetInstanceDto(row);
  }

  listLayoutPresetInstances(
    pageId: string,
  ): readonly LayoutPresetInstanceDto[] {
    const rows = this.connection
      .prepare(
        `SELECT ${presetInstanceColumns}
         FROM layout_preset_instances
         WHERE page_id = ? ORDER BY created_at, id`,
      )
      .all(pageId) as readonly LayoutPresetInstanceRow[];
    return rows.map((row) => this.toLayoutPresetInstanceDto(row));
  }

  listExportableLayoutPresetInstances(
    projectId: string,
  ): readonly LayoutPresetInstanceDto[] {
    const rows = this.connection
      .prepare(
        `SELECT ${presetInstanceColumns}
         FROM layout_preset_instances i
         WHERE i.project_id = ? AND i.instance_state = 'APPLIED'
           AND EXISTS (
             SELECT 1 FROM pages p
             WHERE p.id = i.page_id AND p.deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM layout_preset_instance_elements m
             JOIN elements e ON e.id = m.element_id
             WHERE m.instance_id = i.id AND e.deleted_at IS NOT NULL
           )
         ORDER BY i.created_at, i.id`,
      )
      .all(projectId) as readonly LayoutPresetInstanceRow[];
    return rows.map((row) => this.toLayoutPresetInstanceDto(row));
  }

  toLayoutPresetInstanceDto(
    row: LayoutPresetInstanceRow,
  ): LayoutPresetInstanceDto {
    const definition = validateLayoutPresetDefinitionSnapshot(
      JSON.parse(row.preset_snapshot_json),
    );
    if (
      row.preset_id !== definition.id ||
      row.preset_version !== definition.version
    ) {
      throw new Error(`Layout Preset instance ${row.id} is unsupported`);
    }
    const membershipRows = this.connection
      .prepare(
        `SELECT ${presetInstanceElementColumns}
         FROM layout_preset_instance_elements
         WHERE instance_id = ? ORDER BY template_id`,
      )
      .all(row.id) as readonly LayoutPresetInstanceElementRow[];
    const proposedElements = [...definition.elements]
      .sort((left, right) => left.templateId.localeCompare(right.templateId))
      .map((template): LayoutPresetProposedElementDto => {
        const membership = membershipRows.find(
          ({ template_id }) => template_id === template.templateId,
        );
        if (membership === undefined) {
          throw new Error(`Layout Preset instance ${row.id} is incomplete`);
        }
        const entry = JSON.parse(
          membership.entry_snapshot_json,
        ) as ElementEntryDto;
        const elementDefinitionValue = elementDefinition(
          membership.element_type,
        );
        const state = validateElementStoredState(elementDefinitionValue, {
          props: entry.element.props,
          style: entry.element.style,
          events: entry.element.events,
        });
        if (
          template.elementType !== membership.element_type ||
          membership.element_type_version !==
            elementDefinitionValue.typeVersion ||
          entry.element.id !== membership.element_id ||
          entry.element.projectId !== membership.project_id ||
          entry.element.pageId !== membership.page_id ||
          entry.element.type !== membership.element_type ||
          entry.element.typeVersion !== membership.element_type_version ||
          typeof entry.element.name !== "string" ||
          entry.element.name.trim().length === 0 ||
          entry.element.name.length > 120 ||
          typeof entry.element.locked !== "boolean" ||
          typeof entry.element.hidden !== "boolean" ||
          !Number.isSafeInteger(entry.element.revision) ||
          entry.element.revision < 1 ||
          entry.layout.elementId !== membership.element_id ||
          entry.layout.breakpoint !== "desktop" ||
          entry.layout.x !== membership.initial_x ||
          entry.layout.y !== membership.initial_y ||
          entry.layout.w !== membership.initial_w ||
          entry.layout.h !== membership.initial_h ||
          !Number.isSafeInteger(entry.layout.x) ||
          !Number.isSafeInteger(entry.layout.y) ||
          !Number.isSafeInteger(entry.layout.w) ||
          !Number.isSafeInteger(entry.layout.h) ||
          entry.layout.x < 0 ||
          entry.layout.y < 0 ||
          entry.layout.x + entry.layout.w > CANVAS_GRID.columns ||
          entry.layout.minW !== elementDefinitionValue.layout.minW ||
          entry.layout.minH !== elementDefinitionValue.layout.minH ||
          entry.layout.maxW !== elementDefinitionValue.layout.maxW ||
          entry.layout.maxH !== elementDefinitionValue.layout.maxH ||
          entry.layout.w < entry.layout.minW ||
          entry.layout.w > entry.layout.maxW ||
          entry.layout.h < entry.layout.minH ||
          entry.layout.h > entry.layout.maxH
        ) {
          throw new Error(
            `Layout Preset instance ${row.id} membership is invalid`,
          );
        }
        return {
          templateId: template.templateId,
          entry: {
            ...entry,
            element: {
              ...entry.element,
              props: state.props,
              style: state.style,
              events: state.events,
            },
          },
        };
      });
    if (
      membershipRows.length !== definition.elements.length ||
      layoutPresetCoordinateChecksum(proposedElements) !==
        row.coordinate_checksum
    ) {
      throw new Error(`Layout Preset instance ${row.id} snapshot is invalid`);
    }
    const placeholderRows = this.connection
      .prepare(
        `SELECT ${bindingPlaceholderColumns}
         FROM element_binding_placeholders
         WHERE instance_id = ? ORDER BY template_id, port_id`,
      )
      .all(row.id) as readonly ElementBindingPlaceholderRow[];
    const bindingPlaceholders = placeholderRows.map(
      (placeholder): LayoutPresetBindingPlaceholderDto => {
        if (
          placeholder.instance_id !== row.id ||
          placeholder.template_id === null
        ) {
          throw new Error(
            `Layout Preset instance ${row.id} placeholder is invalid`,
          );
        }
        return {
          instanceId: row.id,
          elementId: placeholder.element_id,
          elementTypeVersion: placeholder.element_type_version,
          templateId: placeholder.template_id,
          portId: placeholder.port_id,
          status: placeholder.status,
        };
      },
    );
    const expectedPlaceholders = definition.bindingPlaceholders
      .map((placeholder) => {
        const proposed = proposedElements.find(
          ({ templateId }) => templateId === placeholder.templateId,
        );
        if (proposed === undefined) {
          throw new Error(`Layout Preset instance ${row.id} is incomplete`);
        }
        return {
          instanceId: row.id,
          elementId: proposed.entry.element.id,
          elementTypeVersion: proposed.entry.element.typeVersion,
          templateId: placeholder.templateId,
          portId: placeholder.portId,
          status: "UNCONNECTED" as const,
        };
      })
      .sort(
        (left, right) =>
          left.templateId.localeCompare(right.templateId) ||
          left.portId.localeCompare(right.portId),
      );
    if (
      JSON.stringify(bindingPlaceholders) !==
      JSON.stringify(expectedPlaceholders)
    ) {
      throw new Error(
        `Layout Preset instance ${row.id} placeholder topology is invalid`,
      );
    }
    return {
      id: row.id,
      projectId: row.project_id,
      pageId: row.page_id,
      presetId: definition.id,
      presetVersion: row.preset_version,
      presetSnapshot: definition,
      registryChecksum: row.registry_checksum,
      coordinateChecksum: row.coordinate_checksum,
      mode: row.apply_mode,
      state: row.instance_state,
      origin: row.origin,
      commandId: row.command_id,
      elements: proposedElements.map(({ templateId, entry }) => ({
        templateId,
        elementId: entry.element.id,
      })),
      proposedElements,
      bindingPlaceholders: expectedPlaceholders,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateLayout(
    elementId: string,
    expectedRevision: number,
    layout: {
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    },
    now: string,
  ): ElementEntryDto | undefined {
    const changed = this.connection
      .prepare(
        `UPDATE elements SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      )
      .run(now, elementId, expectedRevision);
    if (changed.changes !== 1) return undefined;
    this.connection
      .prepare(
        `UPDATE element_layouts SET x = ?, y = ?, w = ?, h = ?
         WHERE element_id = ? AND breakpoint = 'desktop'`,
      )
      .run(layout.x, layout.y, layout.w, layout.h, elementId);
    return this.getEntry(elementId);
  }

  setLocked(
    elementId: string,
    expectedRevision: number,
    locked: boolean,
    now: string,
  ): ElementEntryDto | undefined {
    const changed = this.connection
      .prepare(
        `UPDATE elements SET locked = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      )
      .run(locked ? 1 : 0, now, elementId, expectedRevision);
    return changed.changes === 1 ? this.getEntry(elementId) : undefined;
  }

  updateProperties(
    elementId: string,
    expectedRevision: number,
    value: {
      readonly name: string;
      readonly props: Readonly<Record<string, unknown>>;
      readonly style: Readonly<Record<string, unknown>>;
      readonly locked: boolean;
      readonly hidden: boolean;
    },
    now: string,
  ): ElementEntryDto | undefined {
    const changed = this.connection
      .prepare(
        `UPDATE elements
         SET name = ?, props_json = ?, style_json = ?, locked = ?, hidden = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      )
      .run(
        value.name,
        JSON.stringify(value.props),
        JSON.stringify(value.style),
        value.locked ? 1 : 0,
        value.hidden ? 1 : 0,
        now,
        elementId,
        expectedRevision,
      );
    return changed.changes === 1 ? this.getEntry(elementId) : undefined;
  }

  applyHistoryEntry(
    snapshot: ElementEntryDto,
    shouldBeActive: boolean,
    now: string,
  ): ElementEntryDto | undefined {
    const current = this.get(snapshot.element.id);
    if (current === undefined) return undefined;
    const changed = this.connection
      .prepare(
        `UPDATE elements
         SET name = ?, props_json = ?, style_json = ?, events_json = ?,
             locked = ?, hidden = ?, deleted_at = ?, revision = revision + 1,
             updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(
        snapshot.element.name,
        JSON.stringify(snapshot.element.props),
        JSON.stringify(snapshot.element.style),
        JSON.stringify(snapshot.element.events),
        snapshot.element.locked ? 1 : 0,
        snapshot.element.hidden ? 1 : 0,
        shouldBeActive ? null : now,
        now,
        snapshot.element.id,
        current.revision,
      );
    if (changed.changes !== 1) return undefined;
    this.connection
      .prepare(
        `UPDATE element_layouts
         SET x = ?, y = ?, w = ?, h = ?, min_w = ?, min_h = ?,
             max_w = ?, max_h = ?
         WHERE element_id = ? AND breakpoint = 'desktop'`,
      )
      .run(
        snapshot.layout.x,
        snapshot.layout.y,
        snapshot.layout.w,
        snapshot.layout.h,
        snapshot.layout.minW,
        snapshot.layout.minH,
        snapshot.layout.maxW,
        snapshot.layout.maxH,
        snapshot.element.id,
      );
    return shouldBeActive ? this.getEntry(snapshot.element.id) : undefined;
  }

  updateBatch(items: readonly BatchLayoutItem[], now: string): void {
    const updateElement = this.connection.prepare(
      `UPDATE elements SET revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
    );
    const updateLayout = this.connection.prepare(
      `UPDATE element_layouts SET x = ?, y = ?, w = ?, h = ?
       WHERE element_id = ? AND breakpoint = 'desktop'`,
    );
    for (const item of items) {
      if (
        updateElement.run(now, item.elementId, item.expectedRevision)
          .changes !== 1
      ) {
        throw new Error("Element batch changed during its transaction");
      }
      updateLayout.run(item.x, item.y, item.w, item.h, item.elementId);
    }
  }

  tombstone(elementId: string, expectedRevision: number, now: string): boolean {
    return (
      this.connection
        .prepare(
          `UPDATE elements SET deleted_at = ?, revision = revision + 1,
             updated_at = ?
           WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
        )
        .run(now, now, elementId, expectedRevision).changes === 1
    );
  }

  bumpLayoutRevision(
    pageId: string,
    expectedRevision: number,
    now: string,
  ): number | undefined {
    const result = this.connection
      .prepare(
        `UPDATE page_layout_revisions
         SET desktop_revision = desktop_revision + 1, updated_at = ?
         WHERE page_id = ? AND desktop_revision = ?`,
      )
      .run(now, pageId, expectedRevision);
    return result.changes === 1 ? expectedRevision + 1 : undefined;
  }

  bumpProjectRevision(
    projectId: string,
    expectedRevision: number,
    now: string,
  ): number | undefined {
    const result = this.connection
      .prepare(
        `UPDATE projects SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND lifecycle_status = 'ACTIVE' AND revision = ?`,
      )
      .run(now, projectId, expectedRevision);
    return result.changes === 1 ? expectedRevision + 1 : undefined;
  }

  findCommand(
    projectId: string,
    idempotencyKey: string,
  ): ElementCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns}
         FROM element_commands WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, idempotencyKey) as ElementCommandRow | undefined;
  }

  storeCommand(command: {
    readonly id: string;
    readonly projectId: string;
    readonly pageId: string;
    readonly elementId: string | null;
    readonly type: ElementCommandRow["command_type"];
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly before: unknown;
    readonly after: unknown;
    readonly responseStatus: number;
    readonly response: unknown;
    readonly beforeLayoutRevision: number;
    readonly afterLayoutRevision: number;
    readonly now: string;
  }): void {
    const successful =
      command.responseStatus >= 200 && command.responseStatus < 300;
    let historySequence: number | null = null;
    if (successful) {
      this.connection
        .prepare(
          `UPDATE element_commands
           SET history_state = 'DISCARDED', history_updated_at = ?
           WHERE project_id = ? AND history_state = 'UNDONE'`,
        )
        .run(command.now, command.projectId);
      this.connection
        .prepare(
          `UPDATE layout_preset_instances
           SET instance_state = 'DISCARDED', updated_at = ?
           WHERE project_id = ? AND instance_state = 'UNDONE'
             AND command_id IN (
               SELECT id FROM element_commands
               WHERE project_id = ? AND history_state = 'DISCARDED'
             )`,
        )
        .run(command.now, command.projectId, command.projectId);
      const row = this.connection
        .prepare(
          `SELECT coalesce(max(history_sequence), 0) + 1 AS next_sequence
           FROM element_commands WHERE project_id = ?`,
        )
        .get(command.projectId) as { readonly next_sequence: number };
      historySequence = row.next_sequence;
    }
    this.connection
      .prepare(
        `INSERT INTO element_commands (
           id, project_id, page_id, element_id, command_type,
           idempotency_key, request_hash, before_json, after_json,
           response_status, response_json, before_layout_revision,
           after_layout_revision, history_state, history_sequence,
           history_updated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        command.id,
        command.projectId,
        command.pageId,
        command.elementId,
        command.type,
        command.idempotencyKey,
        command.requestHash,
        command.before === null ? null : JSON.stringify(command.before),
        command.after === null ? null : JSON.stringify(command.after),
        command.responseStatus,
        JSON.stringify(command.response),
        command.beforeLayoutRevision,
        command.afterLayoutRevision,
        successful ? "APPLIED" : null,
        historySequence,
        successful ? command.now : null,
        command.now,
      );
  }

  listHistory(projectId: string): readonly ElementCommandRow[] {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM element_commands
         WHERE project_id = ? AND history_state IS NOT NULL
         ORDER BY history_sequence`,
      )
      .all(projectId) as readonly ElementCommandRow[];
  }

  undoCommand(projectId: string): ElementCommandRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM element_commands
         WHERE project_id = ? AND history_state = 'APPLIED'
         ORDER BY history_sequence DESC LIMIT 1`,
      )
      .get(projectId) as ElementCommandRow | undefined;
  }

  redoCommand(projectId: string): ElementCommandRow | undefined {
    const cursor = this.connection
      .prepare(
        `SELECT coalesce(max(history_sequence), 0) AS cursor
         FROM element_commands
         WHERE project_id = ? AND history_state = 'APPLIED'`,
      )
      .get(projectId) as { readonly cursor: number };
    return this.connection
      .prepare(
        `SELECT ${commandColumns} FROM element_commands
         WHERE project_id = ? AND history_state = 'UNDONE'
           AND history_sequence > ?
         ORDER BY history_sequence LIMIT 1`,
      )
      .get(projectId, cursor.cursor) as ElementCommandRow | undefined;
  }

  setHistoryState(
    commandId: string,
    expectedState: "APPLIED" | "UNDONE",
    nextState: "APPLIED" | "UNDONE",
    now: string,
  ): boolean {
    const changed = this.connection
      .prepare(
        `UPDATE element_commands SET history_state = ?, history_updated_at = ?
         WHERE id = ? AND history_state = ?`,
      )
      .run(nextState, now, commandId, expectedState);
    if (changed.changes === 1) {
      this.connection
        .prepare(
          `UPDATE layout_preset_instances
           SET instance_state = ?, updated_at = ? WHERE command_id = ?`,
        )
        .run(nextState, now, commandId);
    }
    return changed.changes === 1;
  }

  toCommandSummary(row: ElementCommandRow): ElementCommandSummaryDto {
    if (row.history_state === null || row.history_sequence === null) {
      throw new Error(`Command ${row.id} is not part of Element history`);
    }
    return {
      id: row.id,
      pageId: row.page_id,
      elementId: row.element_id,
      type: row.command_type,
      state: row.history_state,
      sequence: row.history_sequence,
      createdAt: row.created_at,
    };
  }

  findHistoryOperation(
    projectId: string,
    idempotencyKey: string,
  ): ElementHistoryOperationRow | undefined {
    return this.connection
      .prepare(
        `SELECT id, project_id, command_id, requested_command_id,
           operation_type, idempotency_key, request_hash, response_status,
           response_json, created_at
         FROM element_history_operations
         WHERE project_id = ? AND idempotency_key = ?`,
      )
      .get(projectId, idempotencyKey) as ElementHistoryOperationRow | undefined;
  }

  storeHistoryOperation(operation: {
    readonly id: string;
    readonly projectId: string;
    readonly commandId: string | null;
    readonly requestedCommandId: string;
    readonly type: "UNDO" | "REDO";
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly responseStatus: number;
    readonly response: unknown;
    readonly now: string;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO element_history_operations (
           id, project_id, command_id, requested_command_id, operation_type,
           idempotency_key, request_hash, response_status, response_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        operation.id,
        operation.projectId,
        operation.commandId,
        operation.requestedCommandId,
        operation.type,
        operation.idempotencyKey,
        operation.requestHash,
        operation.responseStatus,
        JSON.stringify(operation.response),
        operation.now,
      );
  }

  definitionState(projectId: string): Record<string, unknown> {
    const layoutRevisions = this.connection
      .prepare(
        `SELECT page_id, project_id, desktop_revision, updated_at
         FROM page_layout_revisions WHERE project_id = ? ORDER BY page_id`,
      )
      .all(projectId);
    const elements = this.connection
      .prepare(
        `SELECT ${elementColumns} FROM elements
         WHERE project_id = ? ORDER BY page_id, created_at, id`,
      )
      .all(projectId);
    const layouts = this.connection
      .prepare(
        `SELECT ${layoutColumns} FROM element_layouts
         WHERE project_id = ? ORDER BY page_id, breakpoint, y, x, element_id`,
      )
      .all(projectId);
    const commands = this.connection
      .prepare(
        `SELECT ${commandColumns}
         FROM element_commands WHERE project_id = ? ORDER BY created_at, id`,
      )
      .all(projectId);
    const historyOperations = this.connection
      .prepare(
        `SELECT id, project_id, command_id, requested_command_id,
           operation_type, idempotency_key, request_hash, response_status,
           response_json, created_at
         FROM element_history_operations
         WHERE project_id = ? ORDER BY created_at, id`,
      )
      .all(projectId);
    const presetInstances = this.connection
      .prepare(
        `SELECT ${presetInstanceColumns} FROM layout_preset_instances
         WHERE project_id = ? ORDER BY created_at, id`,
      )
      .all(projectId);
    const presetInstanceElements = this.connection
      .prepare(
        `SELECT ${presetInstanceElementColumns}
         FROM layout_preset_instance_elements
         WHERE project_id = ? ORDER BY instance_id, template_id`,
      )
      .all(projectId);
    const bindingPlaceholders = this.connection
      .prepare(
        `SELECT ${bindingPlaceholderColumns}
         FROM element_binding_placeholders
         WHERE project_id = ? ORDER BY page_id, element_id, port_id`,
      )
      .all(projectId);
    return {
      layoutRevisions,
      elements,
      layouts,
      commands,
      historyOperations,
      presetInstances,
      presetInstanceElements,
      bindingPlaceholders,
    };
  }

  layoutRevisionSnapshot(projectId: string): readonly {
    readonly pageId: string;
    readonly breakpoint: "desktop";
    readonly revision: number;
  }[] {
    return (
      this.connection
        .prepare(
          `SELECT r.page_id, r.desktop_revision
           FROM page_layout_revisions r
           JOIN pages p ON p.id = r.page_id
           WHERE r.project_id = ? AND p.deleted_at IS NULL ORDER BY r.page_id`,
        )
        .all(projectId) as readonly {
        readonly page_id: string;
        readonly desktop_revision: number;
      }[]
    ).map((row) => ({
      pageId: row.page_id,
      breakpoint: "desktop",
      revision: row.desktop_revision,
    }));
  }

  toElementDto(row: ElementRow): ElementDto {
    const definition = elementDefinition(row.type);
    if (row.type_version !== definition.typeVersion) {
      throw new Error(`Element ${row.id} has an unsupported type version`);
    }
    const state = validateElementStoredState(definition, {
      props: JSON.parse(row.props_json),
      style: JSON.parse(row.style_json),
      events: JSON.parse(row.events_json),
    });
    return {
      id: row.id,
      projectId: row.project_id,
      pageId: row.page_id,
      type: row.type,
      typeVersion: row.type_version,
      name: row.name,
      props: state.props,
      style: state.style,
      events: state.events,
      locked: row.locked === 1,
      hidden: row.hidden === 1,
      revision: row.revision,
    };
  }

  toLayoutDto(row: ElementLayoutRow): ElementLayoutDto {
    return {
      elementId: row.element_id,
      breakpoint: row.breakpoint,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
      minW: row.min_w,
      minH: row.min_h,
      maxW: row.max_w,
      maxH: row.max_h,
    };
  }
}
