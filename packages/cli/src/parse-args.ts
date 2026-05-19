/**
 * A tiny argument parser. Just enough for the few flags `anvil` accepts —
 * no dependency, no surprises.
 */
export interface ParsedArgs {
  /** First positional token; "help" when nothing was provided. */
  command: string;
  /** Remaining positional tokens. */
  positional: string[];
  /** Flags: `--flag value` becomes `{ flag: value }`; bare `--flag` becomes `{ flag: true }`. */
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const rest = argv.slice(1);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) break;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

/** Read a string flag, ignoring bare-presence flags. */
export function flagString(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key];
  return typeof value === "string" ? value : undefined;
}

/** Read a positive integer flag. */
export function flagInt(args: ParsedArgs, key: string): number | undefined {
  const text = flagString(args, key);
  if (text === undefined) return undefined;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Read a boolean flag — present means true. */
export function flagBool(args: ParsedArgs, key: string): boolean {
  return args.flags[key] === true || args.flags[key] === "true";
}
