import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const packageJsonPath = join(packageRoot, "package.json");

export function packageJsonBackupPath() {
  return join(process.env.TMPDIR ?? "/tmp", `cursor-use-package-${createHash("sha256").update(packageRoot).digest("hex")}.json`);
}
