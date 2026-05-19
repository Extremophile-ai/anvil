/**
 * A minimal frontmatter reader/writer for memory fact files. The frontmatter
 * schema is small and fixed (flat `key: value` pairs), so a hand-rolled parser
 * is used rather than a YAML dependency.
 */

export interface ParsedDocument {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseDocument(content: string): ParsedDocument {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized.trim() };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return { frontmatter: {}, body: normalized.trim() };
  }
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, "").trimEnd();
  const frontmatter: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter, body };
}

export function serializeDocument(frontmatter: Record<string, string>, body: string): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("---", "", body.trimEnd(), "");
  return lines.join("\n");
}
