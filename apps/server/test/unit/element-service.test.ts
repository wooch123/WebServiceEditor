import { describe, expect, it } from "vitest";

import { ElementService } from "../../src/elements/element-service.js";
import { MetadataDatabase } from "../../src/metadata/database.js";
import { PageRepository } from "../../src/pages/page-repository.js";
import { ProjectRepository } from "../../src/projects/project-repository.js";

describe("ElementService placement preview boundary", () => {
  it("creates a layout revision for every new Page and writes nothing during candidate preview", () => {
    const metadata = new MetadataDatabase(":memory:");
    const projectRepository = new ProjectRepository(metadata);
    const pageRepository = new PageRepository(metadata);
    const now = "2026-08-16T00:00:00.000Z";
    const projectId = "00000000-0000-4000-8000-000000000001";
    const pageId = "00000000-0000-4000-8000-000000000002";
    try {
      projectRepository.insert({
        id: projectId,
        name: "Candidate",
        slug: "candidate",
        description: null,
        favorite: false,
        themeId: "light-clean-paper",
        now,
      });
      pageRepository.insert({
        id: pageId,
        projectId,
        name: "Page",
        route: "/page",
        pageType: "blank",
        iconName: "File",
        sortOrder: 0,
        now,
      });
      expect(
        metadata.connection
          .prepare(
            "SELECT desktop_revision FROM page_layout_revisions WHERE page_id = ?",
          )
          .get(pageId),
      ).toEqual({ desktop_revision: 0 });

      const service = new ElementService({ metadataDatabase: metadata });
      const totalChangesBefore = (
        metadata.connection
          .prepare("SELECT total_changes() AS count")
          .get() as {
          readonly count: number;
        }
      ).count;
      const stateBefore = metadata.connection
        .prepare(
          `SELECT p.revision, p.updated_at,
             (SELECT count(*) FROM audit_logs WHERE project_id = p.id) AS audits,
             (SELECT count(*) FROM element_commands WHERE project_id = p.id) AS commands,
             (SELECT desktop_revision FROM page_layout_revisions WHERE page_id = ?) AS layout_revision
           FROM projects p WHERE p.id = ?`,
        )
        .get(pageId, projectId);

      const candidate = service.placementCandidate(pageId, {
        elementType: "text",
        pointer: {
          rawCanvasX: 16,
          rawCanvasY: 16,
          correctedCanvasX: 16,
          correctedCanvasY: 16,
        },
        canvasWidth: 1_000,
        canvasHeight: 640,
        expectedLayoutRevision: 0,
        expectedProjectRevision: 1,
      });
      expect(candidate.candidate).toMatchObject({ x: 0, y: 0, w: 6, h: 5 });
      expect(
        (
          metadata.connection
            .prepare("SELECT total_changes() AS count")
            .get() as {
            readonly count: number;
          }
        ).count,
      ).toBe(totalChangesBefore);
      expect(
        metadata.connection
          .prepare(
            `SELECT p.revision, p.updated_at,
               (SELECT count(*) FROM audit_logs WHERE project_id = p.id) AS audits,
               (SELECT count(*) FROM element_commands WHERE project_id = p.id) AS commands,
               (SELECT desktop_revision FROM page_layout_revisions WHERE page_id = ?) AS layout_revision
             FROM projects p WHERE p.id = ?`,
          )
          .get(pageId, projectId),
      ).toEqual(stateBefore);
    } finally {
      metadata.close();
    }
  });
});
