import type { AnvilTool } from "../types.js";
import { discoveryTools } from "./discovery.js";
import { fileOpTools } from "./file-ops.js";

export { discoveryTools } from "./discovery.js";
export { fileOpTools } from "./file-ops.js";

/** Every built-in foundational tool — discovery (read) and file ops (write). */
export function builtinTools(): AnvilTool[] {
  return [...discoveryTools, ...fileOpTools];
}
