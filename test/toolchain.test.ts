import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import manifest from "../package.json";

const catalog: Readonly<Record<string, string>> = manifest.workspaces.catalog;

test("dependency and override declarations resolve through exact catalog entries", () => {
  for (const [name, reference] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.overrides,
  })) {
    expect(reference).toBe("catalog:");
    expect(catalog[name]).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  }
});

test("installed versions agree with the catalog, including the Effect transitive package", async () => {
  for (const [name, version] of Object.entries(catalog)) {
    const metadata: { name: string; version: string } = JSON.parse(
      await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"),
    );
    expect({ name: metadata.name, version: metadata.version }).toEqual({ name, version });
  }

  expect(catalog["@effect/platform-bun"]).toBe(catalog["effect"]);
  expect(catalog["@effect/platform-node-shared"]).toBe(catalog["effect"]);
  expect(catalog["effect"]).toMatch(/^4\.0\.0-beta\.\d+$/);
});
