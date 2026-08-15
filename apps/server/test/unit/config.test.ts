import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  resolveMetadataDatabasePath,
  resolveServerPort,
  resolveStorageRoot,
} from "../../src/config.js";

describe("server configuration", () => {
  it("keeps default data inside the repository and validates port overrides", () => {
    const serverTestDirectory = dirname(fileURLToPath(import.meta.url));
    const repositoryRoot = join(serverTestDirectory, "../../../..");
    const expectedDataRoot = join(repositoryRoot, "data");

    expect(resolveStorageRoot()).toBe(expectedDataRoot);
    expect(resolveMetadataDatabasePath()).toBe(
      join(expectedDataRoot, "metadata", "webeditor.sqlite"),
    );
    expect(resolveServerPort("3211")).toBe(3211);
    expect(() => resolveServerPort("0")).toThrow(/between 1 and 65535/);
    expect(() => resolveServerPort("3210oops")).toThrow(/between 1 and 65535/);
  });
});
