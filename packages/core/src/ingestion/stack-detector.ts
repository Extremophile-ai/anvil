/**
 * Stack detection — inspect a workspace and work out what it is built with:
 * languages, package manager, frameworks, and whether it is a monorepo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { walkFiles } from "../lib/fs.js";
import type { Workspace } from "../lib/workspace.js";
import type { StackProfile } from "./types.js";

const FRAMEWORK_MARKERS: Record<string, string> = {
  next: "next",
  react: "react",
  "react-dom": "react",
  vue: "vue",
  svelte: "svelte",
  "@sveltejs/kit": "sveltekit",
  "@angular/core": "angular",
  astro: "astro",
  express: "express",
  fastify: "fastify",
  "@nestjs/core": "nestjs",
  koa: "koa",
  hono: "hono",
  vitest: "vitest",
  jest: "jest",
  mocha: "mocha",
  "@playwright/test": "playwright",
  prisma: "prisma",
  "drizzle-orm": "drizzle",
  typeorm: "typeorm",
  mongoose: "mongoose",
  tailwindcss: "tailwind",
  vite: "vite",
  webpack: "webpack",
};

/** Read and parse a JSON file, returning undefined on any failure. */
export function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function detectStack(workspace: Workspace): StackProfile {
  const root = workspace.root;
  const has = (relativePath: string): boolean => existsSync(join(root, relativePath));
  const pkg = readJson(join(root, "package.json"));
  const deps = { ...asRecord(pkg?.dependencies), ...asRecord(pkg?.devDependencies) };

  const frameworks = [
    ...new Set(
      Object.keys(deps).flatMap((dep) => {
        const framework = FRAMEWORK_MARKERS[dep];
        return framework ? [framework] : [];
      }),
    ),
  ];

  let packageManager: string | undefined;
  const packageManagerField = pkg?.packageManager;
  if (has("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (has("yarn.lock")) packageManager = "yarn";
  else if (has("bun.lockb") || has("bun.lock")) packageManager = "bun";
  else if (has("package-lock.json")) packageManager = "npm";
  else if (typeof packageManagerField === "string") {
    packageManager = packageManagerField.split("@")[0];
  }

  const extensions = new Set(
    walkFiles(root, { maxEntries: 4000 }).map((file) => {
      const dot = file.lastIndexOf(".");
      return dot === -1 ? "" : file.slice(dot).toLowerCase();
    }),
  );
  const languages: string[] = [];
  if (has("tsconfig.json") || extensions.has(".ts") || extensions.has(".tsx")) {
    languages.push("typescript");
  }
  if (pkg !== undefined || extensions.has(".js") || extensions.has(".jsx") || extensions.has(".mjs")) {
    languages.push("javascript");
  }
  if (has("pyproject.toml") || has("requirements.txt") || extensions.has(".py")) languages.push("python");
  if (has("go.mod") || extensions.has(".go")) languages.push("go");
  if (has("Cargo.toml") || extensions.has(".rs")) languages.push("rust");
  if (has("pom.xml") || has("build.gradle") || extensions.has(".java")) languages.push("java");
  if (has("Gemfile") || extensions.has(".rb")) languages.push("ruby");

  const workspaces = pkg?.workspaces;
  const monorepo =
    has("pnpm-workspace.yaml") ||
    has("lerna.json") ||
    has("turbo.json") ||
    has("nx.json") ||
    Array.isArray(workspaces) ||
    (workspaces !== null && workspaces !== undefined && typeof workspaces === "object");

  const profile: StackProfile = {
    languages,
    frameworks,
    runtimes: pkg !== undefined ? ["node"] : [],
    hasDocker: has("Dockerfile") || has("docker-compose.yml") || has("compose.yaml"),
    hasGit: has(".git"),
    monorepo,
  };
  if (packageManager !== undefined) profile.packageManager = packageManager;
  return profile;
}
