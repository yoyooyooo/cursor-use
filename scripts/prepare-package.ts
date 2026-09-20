import { readFileSync, writeFileSync } from "node:fs";
import { packageJsonBackupPath, packageJsonPath } from "./package-paths.ts";

const sourceText = readFileSync(packageJsonPath, "utf8");
const source = JSON.parse(sourceText) as {
  workspaces: { catalog: Record<string, string> };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides: Record<string, string>;
};

function resolveCatalog(name: string, reference: string) {
  if (reference !== "catalog:") return reference;
  const version = source.workspaces.catalog[name];
  if (!version) throw new Error(`Missing catalog version for ${name}.`);
  return version;
}

writeFileSync(packageJsonBackupPath(), sourceText);
writeFileSync(packageJsonPath, `${JSON.stringify({
  ...source,
  dependencies: Object.fromEntries(Object.entries(source.dependencies).map(([name, value]) => [name, resolveCatalog(name, value)])),
  devDependencies: Object.fromEntries(Object.entries(source.devDependencies).map(([name, value]) => [name, resolveCatalog(name, value)])),
  overrides: Object.fromEntries(Object.entries(source.overrides).map(([name, value]) => [name, resolveCatalog(name, value)])),
}, null, 2)}\n`);
