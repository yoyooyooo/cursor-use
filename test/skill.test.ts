import { expect, test } from "bun:test";

test("the shipped skill has parseable discovery metadata", async () => {
  const text = await Bun.file(new URL("../skills/cursor-use/SKILL.md", import.meta.url)).text();
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  expect(frontmatter).toBeDefined();
  const metadata = Bun.YAML.parse(frontmatter!) as { name: string; description: string };
  expect(metadata.name).toBe("cursor-use");
  expect(typeof metadata.description).toBe("string");
  expect(metadata.description).toContain("Cloud Agents");
  expect(metadata.description.length).toBeGreaterThan(80);
});

test("the skill matches shipped busy follow-up, env git and empty-result behavior", async () => {
  const text = await Bun.file(new URL("../skills/cursor-use/SKILL.md", import.meta.url)).text();
  expect(text).toContain("agents follow-up");
  expect(text).toContain("--wait");
  expect(text).toContain("wait-then-new-request-id");
  expect(text).toContain("never queued");
  expect(text).toContain("emptyResult");
  expect(text).toContain("envs show");
  expect(text).toContain("Prompt clone URLs do not replace");
  expect(text).toContain("agent.repos");
});
