import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultTheme,
  themes,
  type RuntimeThemeManifest,
  type RuntimeThemePolicy,
} from "@webeditor/theme-core";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";
import type {
  ThemePolicyMutationDto,
  ThemeRevisionMutationDto,
} from "../../src/themes/theme-revision-service.js";

const apps: FastifyInstance[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(directory?: string) {
  const root = directory ?? mkdtempSync(join(tmpdir(), "webeditor-phase15-"));
  if (!directories.includes(root)) directories.push(root);
  const app = buildServer({
    metadataDatabasePath: join(root, "metadata", "webeditor.sqlite"),
    storageRoot: join(root, "projects"),
  });
  apps.push(app);
  return { app, root };
}

async function createProject(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    payload: {
      name: "Theme Revision",
      slug: `theme-${randomUUID().slice(0, 8)}`,
      themeId: defaultTheme.id,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { project: { id: string; revision: number } })
    .project;
}

describe("Phase 15 Editor-to-Runtime Theme Revision", () => {
  it("publishes only validated Drafts, replays commands, and keeps the old pointer on failure", async () => {
    const { app } = fixture();
    const project = await createProject(app);
    const preset =
      themes.find(({ id }) => id === "dark-polar-night") ?? themes[0];
    expect(preset).toBeDefined();
    const createPayload = {
      presetId: preset?.id,
      expectedProjectRevision: project.revision,
      idempotencyKey: `theme-create:${randomUUID()}`,
    };
    const createResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/theme-revisions`,
      payload: createPayload,
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = createResponse.json() as ThemeRevisionMutationDto;
    expect(created.revision).toMatchObject({
      presetId: preset?.id,
      status: "DRAFT",
      revision: 1,
    });
    expect(created.revision.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.keys(created.revision.tokens)).toHaveLength(52);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/theme-revisions`,
      payload: createPayload,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(created);
    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/theme-revisions`,
      payload: { ...createPayload, presetId: defaultTheme.id },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
    });

    const validateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/theme-revisions/${created.revision.id}/validate`,
      payload: {
        expectedRevision: created.revision.revision,
        expectedProjectRevision: created.projectRevision,
        idempotencyKey: `theme-validate:${randomUUID()}`,
      },
    });
    expect(validateResponse.statusCode, validateResponse.body).toBe(200);
    const validated = validateResponse.json() as ThemeRevisionMutationDto;
    expect(validated.revision.status).toBe("PUBLISHED");
    expect(validated.runtimeApplied).toBe(true);
    expect(validated.revision.validation).toMatchObject({
      schemaValid: true,
      contrastValid: true,
      smokeValid: true,
      errors: [],
    });

    const manifestResponse = await app.inject({
      method: "GET",
      url: `/api/v1/runtime/${project.id}/theme-manifest`,
    });
    expect(manifestResponse.statusCode, manifestResponse.body).toBe(200);
    expect(manifestResponse.headers["cache-control"]).toBe("no-store");
    const published = manifestResponse.json() as RuntimeThemeManifest;
    expect(published).toMatchObject({
      projectId: project.id,
      version: 1,
      publishedThemeRevisionId: validated.revision.id,
      publishedThemeId: preset?.id,
      resolvedThemeId: preset?.id,
      resolvedThemeRevisionId: validated.revision.id,
    });
    expect(published.tokens).toEqual(preset?.tokens);

    const invalidCreateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/theme-revisions`,
      payload: {
        presetId: "light-clean-paper",
        tokens: { background: "#FFFFFF" },
        expectedProjectRevision: validated.projectRevision,
        idempotencyKey: `theme-create:${randomUUID()}`,
      },
    });
    expect(invalidCreateResponse.statusCode, invalidCreateResponse.body).toBe(
      201,
    );
    const invalidDraft =
      invalidCreateResponse.json() as ThemeRevisionMutationDto;
    const invalidValidationResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/theme-revisions/${invalidDraft.revision.id}/validate`,
      payload: {
        expectedRevision: 1,
        expectedProjectRevision: invalidDraft.projectRevision,
        idempotencyKey: `theme-validate:${randomUUID()}`,
      },
    });
    expect(
      invalidValidationResponse.statusCode,
      invalidValidationResponse.body,
    ).toBe(200);
    const invalid =
      invalidValidationResponse.json() as ThemeRevisionMutationDto;
    expect(invalid.revision.status).toBe("INVALID");
    expect(invalid.runtimeApplied).toBe(false);
    expect(invalid.policy.publishedThemeRevisionId).toBe(validated.revision.id);
    const manifestAfterFailure = (
      await app.inject({
        method: "GET",
        url: `/api/v1/runtime/${project.id}/theme-manifest`,
      })
    ).json() as RuntimeThemeManifest;
    expect(manifestAfterFailure.version).toBe(1);
    expect(manifestAfterFailure.resolvedThemeRevisionId).toBe(
      validated.revision.id,
    );
  });

  it("supports explicit publish, rollback, allowed-theme policy, and restart persistence", async () => {
    const { app, root } = fixture();
    const project = await createProject(app);
    const policyResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/runtime-theme-policy`,
      payload: {
        autoApplyThemeToRuntime: false,
        allowRuntimeThemeSelection: true,
        allowedRuntimeThemeIds: ["dark-github", "light-clean-paper"],
        expectedProjectRevision: project.revision,
        idempotencyKey: `theme-policy:${randomUUID()}`,
      },
    });
    expect(policyResponse.statusCode, policyResponse.body).toBe(200);
    const policyMutation = policyResponse.json() as ThemePolicyMutationDto;
    expect(policyMutation.policy).toMatchObject({
      autoApplyThemeToRuntime: false,
      allowRuntimeThemeSelection: true,
      allowedRuntimeThemeIds: ["dark-github", "light-clean-paper"],
    });

    async function draftAndValidate(presetId: string, projectRevision: number) {
      const created = (
        await app.inject({
          method: "POST",
          url: `/api/v1/projects/${project.id}/theme-revisions`,
          payload: {
            presetId,
            expectedProjectRevision: projectRevision,
            idempotencyKey: `theme-create:${randomUUID()}`,
          },
        })
      ).json() as ThemeRevisionMutationDto;
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/theme-revisions/${created.revision.id}/validate`,
        payload: {
          expectedRevision: 1,
          expectedProjectRevision: created.projectRevision,
          idempotencyKey: `theme-validate:${randomUUID()}`,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json() as ThemeRevisionMutationDto;
    }

    const firstValid = await draftAndValidate(
      "dark-github",
      policyMutation.projectRevision,
    );
    expect(firstValid.revision.status).toBe("VALID");
    expect(firstValid.policy.publishedThemeRevisionId).toBeNull();
    const firstPublishResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/theme-revisions/${firstValid.revision.id}/publish`,
      payload: {
        expectedRevision: firstValid.revision.revision,
        expectedProjectRevision: firstValid.projectRevision,
        idempotencyKey: `theme-publish:${randomUUID()}`,
      },
    });
    expect(firstPublishResponse.statusCode, firstPublishResponse.body).toBe(
      200,
    );
    const firstPublished =
      firstPublishResponse.json() as ThemeRevisionMutationDto;

    const secondValid = await draftAndValidate(
      "light-clean-paper",
      firstPublished.projectRevision,
    );
    const secondPublished = (
      await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/theme-revisions/${secondValid.revision.id}/publish`,
        payload: {
          expectedRevision: secondValid.revision.revision,
          expectedProjectRevision: secondValid.projectRevision,
          idempotencyKey: `theme-publish:${randomUUID()}`,
        },
      })
    ).json() as ThemeRevisionMutationDto;
    const rollbackResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/theme-revisions/${firstPublished.revision.id}/rollback`,
      payload: {
        expectedRevision: firstPublished.revision.revision + 1,
        expectedProjectRevision: secondPublished.projectRevision,
        idempotencyKey: `theme-rollback:${randomUUID()}`,
      },
    });
    expect(rollbackResponse.statusCode, rollbackResponse.body).toBe(200);
    const rollback = rollbackResponse.json() as ThemeRevisionMutationDto;
    expect(rollback.revision.status).toBe("PUBLISHED");
    expect(rollback.policy.runtimeThemeVersion).toBe(4);

    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const restarted = fixture(root).app;
    const manifest = (
      await restarted.inject({
        method: "GET",
        url: `/api/v1/runtime/${project.id}/theme-manifest`,
      })
    ).json() as RuntimeThemeManifest;
    const persistedPolicy = (
      await restarted.inject({
        method: "GET",
        url: `/api/v1/projects/${project.id}/runtime-theme-policy`,
      })
    ).json() as { policy: RuntimeThemePolicy };
    expect(manifest.resolvedThemeId).toBe("dark-github");
    expect(manifest.allowedThemeIds).toEqual([
      "dark-github",
      "light-clean-paper",
    ]);
    expect(persistedPolicy.policy.publishedThemeRevisionId).toBe(
      firstPublished.revision.id,
    );
  });

  it("exposes exactly 120 immutable preset choices", async () => {
    const { app } = fixture();
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/themes/presets",
    });
    expect(list.statusCode, list.body).toBe(200);
    const payload = list.json() as { themes: typeof themes };
    expect(payload.themes).toHaveLength(120);
    expect(new Set(payload.themes.map(({ id }) => id)).size).toBe(120);
    expect(payload.themes.filter(({ group }) => group === "dark")).toHaveLength(
      40,
    );
    expect(payload.themes.filter(({ group }) => group === "gray")).toHaveLength(
      40,
    );
    expect(
      payload.themes.filter(({ group }) => group === "light"),
    ).toHaveLength(40);
  });
});
