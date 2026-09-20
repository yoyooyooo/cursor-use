import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { packageJsonBackupPath, packageJsonPath } from "./package-paths.ts";

const backupPath = packageJsonBackupPath();
if (!existsSync(backupPath)) process.exit(0);
writeFileSync(packageJsonPath, readFileSync(backupPath));
unlinkSync(backupPath);
