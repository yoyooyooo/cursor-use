import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if ([".git", "node_modules", "dist", ".github"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && path.endsWith(".md") ? [path] : [];
  });
}
const prose = (text: string) => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
const slug = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

test("explicit local Markdown links, heading anchors and discovery routes are valid", () => {
  const files = markdownFiles(root);
  const graph = new Map<string, string[]>();
  const failures: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!text.endsWith("\n") || /[\t ]+$/m.test(text)) failures.push(`Formatting: ${file}`);
    const edges: string[] = [];
    for (const match of prose(text).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1]!;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const [relative, anchor] = href.split("#");
      const target = relative ? resolve(dirname(file), decodeURIComponent(relative)) : file;
      if (!existsSync(target)) { failures.push(`Missing: ${file} -> ${href}`); continue; }
      edges.push(target);
      if (anchor) {
        const headings = [...prose(readFileSync(target, "utf8")).matchAll(/^#{1,6}\s+(.+)$/gm)].map(h => slug(h[1]!));
        if (!headings.includes(decodeURIComponent(anchor))) failures.push(`Anchor: ${file} -> ${href}`);
      }
    }
    graph.set(file, edges);
  }
  const reached = new Set<string>();
  function visit(file: string) { if (reached.has(file)) return; reached.add(file); for (const child of graph.get(file) ?? []) visit(child); }
  visit(join(root, "README.md"));
  for (const file of files) if (!reached.has(file)) failures.push(`Unreachable: ${file}`);
  expect(failures).toEqual([]);
});
