import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

type NotifyLevel = "info" | "success" | "warning" | "error";

interface ObsidianSettings {
  readonly vaultPath?: string;
  readonly projectFolder?: string;
  readonly attachmentsFolder?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly rewriteImageLinks?: boolean;
  readonly maxFileSizeMB?: number;
}

interface EffectiveSettings {
  readonly vaultPath: string;
  readonly projectFolder: string;
  readonly attachmentsFolder: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly rewriteImageLinks: boolean;
  readonly maxFileSizeMB: number;
}

interface SyncOptions {
  readonly projectName: string;
  readonly explicitFiles: readonly string[];
  readonly dryRun: boolean;
  readonly syncAll: boolean;
}

interface SyncFile {
  readonly srcRelative: string;
  readonly srcAbsolute: string;
  readonly dstFileName: string;
  readonly dstAbsolute: string;
}

interface SyncResult {
  readonly syncedFiles: number;
  readonly copiedImages: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly dryRun: boolean;
  readonly projectName: string;
  readonly projectDir: string;
}

interface PreparedContent {
  readonly content: string;
  readonly referencedImages: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// vaultPath resolution order (highest → lowest priority):
//   1. .pi/settings.json  → { "obsidian": { "vaultPath": "/abs/path" } }
//   2. ~/.pi/agent/settings.json → same shape
//   3. OBSIDIAN_VAULT_PATH environment variable
//   4. "" (empty) → validateVault() will throw a clear config error
//
// Never hard-code an absolute path here. Configure per machine via settings.json.
// ---------------------------------------------------------------------------
const DEFAULTS: EffectiveSettings = {
  vaultPath: process.env.OBSIDIAN_VAULT_PATH ?? "",
  projectFolder: "PROJECTS",
  attachmentsFolder: "attachments",
  include: [
    // Root-level docs present in most projects
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "SUMMARY.md",
    // Recursive patterns (cover all sub-paths)
    "docs/**/*.md",
    "setup-doc/**/*.md",
    ".pi/**/*.md",
  ],
  exclude: [".git/**", "node_modules/**", ".DS_Store"],
  rewriteImageLinks: true,
  maxFileSizeMB: 50,
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
const MARKDOWN_EXT = ".md";

export default function obsidianSyncExtension(pi: ExtensionAPI) {
  pi.registerCommand("obsidian", {
    description: "Sync repository markdown docs to an Obsidian vault",
    getArgumentCompletions: async (
      args: string,
      ctx?: Partial<ExtensionContext>,
    ) => {
      const safeCwd = getSafeCwd(ctx);
      const settings = getEffectiveSettings(ctx);
      const discovered = discoverMarkdownFiles(safeCwd, settings).slice(0, 50);
      const projectGuess = inferProjectName(safeCwd);

      // pi-tui replaces the entire argumentText with the selected item's value,
      // so items must be full argument strings, not individual tokens.
      //
      // Split args into the already-completed tokens and the partial token being typed.
      const endsWithSpace = args !== args.trimEnd();
      const tokens = tokenizeArgs(args);
      const completedTokens = endsWithSpace ? tokens : tokens.slice(0, -1);
      const partialToken =
        (endsWithSpace ? "" : tokens[tokens.length - 1]) ?? "";

      // Understand what's already present in completedTokens.
      const sepIdx = completedTokens.indexOf("--");
      const leftOfSep =
        sepIdx >= 0 ? completedTokens.slice(0, sepIdx) : completedTokens;
      const usedFlags = new Set(leftOfSep.filter((t) => t.startsWith("--")));
      const hasProjectName = leftOfSep.some((t) => !t.startsWith("--"));
      const afterSep = sepIdx >= 0;

      // Build candidates for the next token.
      const nextCandidates: string[] = [];
      if (afterSep) {
        nextCandidates.push(...discovered);
      } else {
        if (!hasProjectName) nextCandidates.push(projectGuess);
        if (!usedFlags.has("--dry-run")) nextCandidates.push("--dry-run");
        if (!usedFlags.has("--all")) nextCandidates.push("--all");
        nextCandidates.push("--");
        nextCandidates.push(...discovered);
      }

      // Filter by the partial token being typed.
      const lower = partialToken.toLowerCase();
      const filtered = nextCandidates.filter(
        (c) => !lower || c.toLowerCase().startsWith(lower),
      );
      if (filtered.length === 0) return null;

      // Return full argument strings so applyCompletion replaces correctly.
      const base = completedTokens.join(" ");
      return filtered.map((candidate) => {
        const fullValue = base ? `${base} ${candidate}` : candidate;
        return {
          value: fullValue,
          label: fullValue,
          description: candidate.endsWith(".md")
            ? "Markdown file"
            : candidate === "--"
              ? "Files separator"
              : candidate.startsWith("--")
                ? "Option"
                : "Project name",
        };
      });
    },
    handler: async (args: string, ctx: ExtensionContext) => {
      const statusKey = "obsidian-sync";

      try {
        const options = parseArgs(args, ctx.cwd);
        const settings = getEffectiveSettings(ctx);

        ctx.ui.setStatus?.(statusKey, "💎 Obsidian sync starting...");

        await validateVault(settings.vaultPath);

        const result = await runSync(ctx, settings, options);

        const summary = [
          `${result.dryRun ? "Dry run:" : "Synced:"} ${result.syncedFiles} file(s)`,
          `${result.copiedImages} image(s)`,
          `project=${result.projectName}`,
        ].join(" | ");

        ctx.ui.setStatus?.(statusKey, `💎 ${summary}`);
        setTimeout(() => ctx.ui.setStatus?.(statusKey, undefined), 5000);

        if (result.errors.length > 0) {
          ctx.ui.notify(
            `Obsidian sync finished with ${result.errors.length} error(s).`,
            "warning",
          );
          for (const err of result.errors.slice(0, 5)) {
            ctx.ui.notify(err, "warning");
          }
        } else {
          ctx.ui.notify(
            `${result.dryRun ? "Dry run complete" : "Obsidian sync complete"}: ${summary}`,
            "success",
          );
        }

        return `${result.dryRun ? "Dry run complete" : "Sync complete"} — ${summary}`;
      } catch (error: unknown) {
        const message = formatError("Obsidian sync failed", error);
        ctx.ui.setStatus?.(statusKey, "💎 Sync failed");
        setTimeout(() => ctx.ui.setStatus?.(statusKey, undefined), 5000);
        ctx.ui.notify(message, "error");
        return message;
      }
    },
  });

  // No persistent footer status line on session_start (removed 2026-08-29 as
  // part of the footer decluttering pass — a permanent idle "💎 /obsidian →
  // <vault>" line was one of several one-extension-per-line status entries
  // that pushed the footer well past a readable size; sync-in-progress and
  // sync-result status above still show transiently and self-clear after 5s.
  // See ~/.pi/setup-refactor-plan.md.)
}

/* =========================
 * Argument parsing
 * ========================= */

function parseArgs(args: string, cwd: string): SyncOptions {
  const tokens = tokenizeArgs(args);

  let dryRun = false;
  let syncAll = false;
  let projectName: string | undefined;
  const explicitFiles: string[] = [];

  const sepIndex = tokens.indexOf("--");
  const left = sepIndex >= 0 ? tokens.slice(0, sepIndex) : tokens;
  const right = sepIndex >= 0 ? tokens.slice(sepIndex + 1) : [];

  for (const token of left) {
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--all") {
      syncAll = true;
      continue;
    }
    if (!projectName) {
      projectName = token;
      continue;
    }
    right.push(token);
  }

  explicitFiles.push(...right.filter(Boolean));

  if (!projectName) {
    projectName = inferProjectName(cwd);
  }

  return {
    projectName,
    explicitFiles,
    dryRun,
    syncAll,
  };
}

function tokenizeArgs(args: string): string[] {
  return (
    args
      .trim()
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map((token) => token.replace(/^"(.*)"$/, "$1")) ?? []
  );
}

/* =========================
 * Settings
 * ========================= */

function getSafeCwd(ctx?: Partial<ExtensionContext> | null): string {
  if (ctx && "cwd" in ctx && typeof ctx.cwd === "string" && ctx.cwd.trim()) {
    return ctx.cwd;
  }
  return process.cwd();
}

function getEffectiveSettings(
  ctx?: Partial<ExtensionContext> | null,
): EffectiveSettings {
  const homeDir = homeDirFromCtx(ctx);
  const cwd = getSafeCwd(ctx);

  const globalPath = homeDir
    ? path.join(homeDir, ".pi", "agent", "settings.json")
    : "";
  const localPath = path.join(cwd, ".pi", "settings.json");

  const globalSettings = globalPath ? readJsonFile(globalPath) : undefined;
  const localSettings = readJsonFile(localPath);

  const merged: ObsidianSettings = {
    ...(globalSettings?.obsidian ?? {}),
    ...(localSettings?.obsidian ?? {}),
  };

  return {
    vaultPath: merged.vaultPath || DEFAULTS.vaultPath,
    projectFolder: merged.projectFolder || DEFAULTS.projectFolder,
    attachmentsFolder: merged.attachmentsFolder || DEFAULTS.attachmentsFolder,
    include: merged.include || DEFAULTS.include,
    exclude: merged.exclude || DEFAULTS.exclude,
    rewriteImageLinks: merged.rewriteImageLinks ?? DEFAULTS.rewriteImageLinks,
    maxFileSizeMB: merged.maxFileSizeMB ?? DEFAULTS.maxFileSizeMB,
  };
}

function readJsonFile(filePath: string): any | undefined {
  try {
    if (!fsSync.existsSync(filePath)) return undefined;
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function homeDirFromCtx(ctx?: any): string {
  return ctx?.home || process.env.HOME || "";
}

async function validateVault(vaultPath: string): Promise<void> {
  // 1. Empty → not configured. Give actionable setup instructions.
  if (!vaultPath || !vaultPath.trim()) {
    throw new Error(
      "Obsidian vault path is not configured.\n\n" +
        "Set it in ~/.pi/agent/settings.json (global, recommended):\n" +
        '  { "obsidian": { "vaultPath": "/absolute/path/to/your/vault" } }\n\n' +
        "Or in .pi/settings.json (project-local override):\n" +
        '  { "obsidian": { "vaultPath": "/absolute/path/to/your/vault" } }\n\n' +
        "Or via environment variable:\n" +
        "  export OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault\n\n" +
        "See docs/obsidian-sync-guide.md for full setup instructions.",
    );
  }

  // 2. Validate the string itself (null bytes, must be absolute).
  validatePath(vaultPath, "vault path");

  // 3. Check the path exists and is a directory on disk.
  try {
    const stats = await fs.stat(vaultPath);
    if (!stats.isDirectory()) {
      throw new Error(
        `Obsidian vault path is not a directory: ${vaultPath}\n` +
          "Make sure the path points to the root of your Obsidian vault folder.",
      );
    }
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        `Obsidian vault not found at: ${vaultPath}\n` +
          "Verify the path exists and that Obsidian has been opened there at least once.\n" +
          "Check the path in your settings.json or OBSIDIAN_VAULT_PATH env var.",
      );
    }
    throw error;
  }
}

function validatePath(p: string, name: string): void {
  if (!p || p.includes("\0")) {
    throw new Error(`Invalid ${name}: empty or contains null byte`);
  }
  // Optionally: restrict to home dir
  const home = process.env.HOME ?? "";
  const resolved = path.resolve(p);
  if (home && !resolved.startsWith(home + "/") && resolved !== home) {
    throw new Error(`Invalid ${name}: path must be within home directory`);
  }
}

/* =========================
 * Main sync flow
 * ========================= */

async function runSync(
  ctx: ExtensionContext,
  settings: EffectiveSettings,
  options: SyncOptions,
): Promise<SyncResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const projectDir = path.join(
    settings.vaultPath,
    settings.projectFolder,
    options.projectName,
  );
  const attachmentsDir = path.join(projectDir, settings.attachmentsFolder);

  const markdownFiles = resolveMarkdownSelection(ctx.cwd, settings, options);
  if (markdownFiles.length === 0) {
    throw new Error("No markdown files found to sync.");
  }

  const syncPlan = buildSyncPlan(markdownFiles, ctx.cwd, projectDir);

  ctx.ui.setStatus?.(
    "obsidian-sync",
    `💎 ${options.dryRun ? "Dry run" : "Syncing"} ${syncPlan.length} markdown file(s)...`,
  );

  if (!options.dryRun) {
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(attachmentsDir, { recursive: true });
  }

  // Build image map for potential images
  const imageMap = discoverImages(ctx.cwd, settings);
  const imageLookup = new Map(
    imageMap.map((img) => [normalizeRelativePath(img.rel), img]),
  );

  // Track which images are actually referenced
  const allReferencedImages = new Set<string>();
  let syncedFiles = 0;

  for (const file of syncPlan) {
    try {
      await validateFileSize(
        file.srcAbsolute,
        settings.maxFileSizeMB,
        "markdown file",
      );

      const rawContent = await fs.readFile(file.srcAbsolute, "utf8");
      const { content: enhanced, referencedImages } = prepareMarkdownContent({
        content: rawContent,
        srcRelative: file.srcRelative,
        projectName: options.projectName,
        rewriteImageLinks: settings.rewriteImageLinks,
        imageLookup,
        attachmentsFolder: settings.attachmentsFolder,
      });

      // Collect all referenced images
      for (const img of referencedImages) {
        allReferencedImages.add(img);
      }

      if (!options.dryRun) {
        await fs.writeFile(file.dstAbsolute, enhanced, "utf8");
      }

      syncedFiles += 1;
    } catch (error: unknown) {
      errors.push(formatError(`Failed to sync ${file.srcRelative}`, error));
    }
  }

  // Only copy images that are actually referenced
  let copiedImages = 0;
  if (!options.dryRun) {
    copiedImages = await copyReferencedImages(
      imageLookup,
      allReferencedImages,
      attachmentsDir,
      settings.maxFileSizeMB,
      errors,
    );
  } else {
    copiedImages = allReferencedImages.size;
  }

  // Create index
  try {
    const indexContent = createIndex({
      projectName: options.projectName,
      files: syncPlan,
      attachmentsFolder: settings.attachmentsFolder,
    });

    if (!options.dryRun) {
      await fs.writeFile(
        path.join(projectDir, "00-INDEX.md"),
        indexContent,
        "utf8",
      );
    }
  } catch (error: unknown) {
    errors.push(formatError("Failed to create index", error));
  }

  return {
    syncedFiles,
    copiedImages,
    errors,
    warnings,
    dryRun: options.dryRun,
    projectName: options.projectName,
    projectDir,
  };
}

/* =========================
 * Discovery
 * ========================= */

function resolveMarkdownSelection(
  cwd: string,
  settings: EffectiveSettings,
  options: SyncOptions,
): string[] {
  if (options.explicitFiles.length > 0) {
    return uniqueSorted(
      options.explicitFiles
        .map((f) => normalizeRelativePath(f))
        .filter((f) => fsSync.existsSync(path.join(cwd, f))),
    );
  }

  const discovered = discoverMarkdownFiles(cwd, settings);

  if (options.syncAll) {
    return discovered;
  }

  return discovered;
}

function discoverMarkdownFiles(
  cwd: string,
  settings: EffectiveSettings,
): string[] {
  const found = new Set<string>();

  for (const pattern of settings.include) {
    if (!pattern.toLowerCase().endsWith(".md") && !pattern.includes("**")) {
      continue;
    }

    if (pattern.includes("**")) {
      const { baseDir, extension } = splitRecursivePattern(pattern);
      const absBase = path.join(cwd, baseDir);
      if (!fsSync.existsSync(absBase)) continue;

      for (const rel of walkFiles(absBase, cwd)) {
        if (shouldExclude(rel, settings.exclude)) continue;
        if (extension && path.extname(rel).toLowerCase() !== extension)
          continue;
        found.add(rel);
      }
    } else {
      const rel = normalizeRelativePath(pattern);
      const abs = path.join(cwd, rel);
      if (fsSync.existsSync(abs) && fsSync.statSync(abs).isFile()) {
        if (!shouldExclude(rel, settings.exclude)) {
          found.add(rel);
        }
      }
    }
  }

  return uniqueSorted(Array.from(found));
}

function discoverImages(
  cwd: string,
  settings: EffectiveSettings,
): Array<{ rel: string; abs: string; dstName: string }> {
  const found: Array<{ rel: string; abs: string; dstName: string }> = [];

  for (const rel of walkFiles(cwd, cwd)) {
    if (shouldExclude(rel, settings.exclude)) continue;
    const ext = path.extname(rel).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    found.push({
      rel,
      abs: path.join(cwd, rel),
      dstName: relativePathToSafeFileName(rel),
    });
  }

  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

function walkFiles(dir: string, root: string): string[] {
  const output: string[] = [];
  if (!fsSync.existsSync(dir)) return output;

  try {
    const entries = fsSync.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = normalizeRelativePath(path.relative(root, abs));

      if (entry.isDirectory()) {
        output.push(...walkFiles(abs, root));
        continue;
      }

      if (entry.isFile()) {
        output.push(rel);
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return output;
}

function splitRecursivePattern(pattern: string): {
  baseDir: string;
  extension?: string;
} {
  const normalized = normalizeRelativePath(pattern);
  const starIndex = normalized.indexOf("/**/");
  if (starIndex === -1) {
    return { baseDir: "." };
  }

  const baseDir = normalized.slice(0, starIndex);
  const tail = normalized.slice(starIndex + 4);
  const ext = tail.startsWith("*.") ? tail.slice(1).toLowerCase() : undefined;

  return {
    baseDir,
    extension: ext,
  };
}

/* =========================
 * File planning
 * ========================= */

function buildSyncPlan(
  markdownFiles: string[],
  cwd: string,
  projectDir: string,
): SyncFile[] {
  return markdownFiles.map((srcRelative) => {
    const dstFileName = relativePathToSafeMarkdownName(srcRelative);
    return {
      srcRelative,
      srcAbsolute: path.join(cwd, srcRelative),
      dstFileName,
      dstAbsolute: path.join(projectDir, dstFileName),
    };
  });
}

function inferProjectName(cwd: string): string {
  return path.basename(cwd);
}

/* =========================
 * Content transformation
 * ========================= */

function prepareMarkdownContent(params: {
  content: string;
  srcRelative: string;
  projectName: string;
  rewriteImageLinks: boolean;
  imageLookup: Map<string, { rel: string; abs: string; dstName: string }>;
  attachmentsFolder: string;
}): PreparedContent {
  const {
    content,
    srcRelative,
    projectName,
    rewriteImageLinks,
    imageLookup,
    attachmentsFolder,
  } = params;

  const { transformed, referencedImages } = rewriteImageLinks
    ? rewriteMarkdownImageLinks(
        content,
        srcRelative,
        imageLookup,
        attachmentsFolder,
      )
    : { transformed: content, referencedImages: new Set<string>() };

  const enhanced = upsertFrontmatter(transformed, {
    title: path.basename(srcRelative, ".md"),
    tags: buildTagsForFile(srcRelative, projectName),
    status: inferStatus(srcRelative),
    project: projectName,
    type: "documentation",
  });

  return { content: enhanced, referencedImages };
}

function rewriteMarkdownImageLinks(
  content: string,
  srcRelative: string,
  imageLookup: Map<string, { rel: string; abs: string; dstName: string }>,
  attachmentsFolder: string,
): { transformed: string; referencedImages: Set<string> } {
  const referencedImages = new Set<string>();
  const sourceDir = path.posix.dirname(normalizeRelativePath(srcRelative));

  const transformed = content.replace(
    /(!?\[[^\]]*?\]\()([^)]+)(\))/g,
    (full, prefix, rawTarget, suffix) => {
      const target = rawTarget.trim();

      if (
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("data:") ||
        target.startsWith("#")
      ) {
        return full;
      }

      const cleanTarget = target.split("#")[0].split("?")[0];
      const ext = path.extname(cleanTarget).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) {
        return full;
      }

      const resolved = normalizeRelativePath(
        path.posix.normalize(
          sourceDir === "."
            ? cleanTarget
            : path.posix.join(sourceDir, cleanTarget),
        ),
      );

      const imageInfo = imageLookup.get(resolved);
      if (!imageInfo) {
        return full;
      }

      // Track this image as referenced
      referencedImages.add(resolved);

      const rewritten = `${attachmentsFolder}/${imageInfo.dstName}`;
      return `${prefix}${rewritten}${suffix}`;
    },
  );

  return { transformed, referencedImages };
}

function upsertFrontmatter(
  content: string,
  metadata: {
    title: string;
    tags: string[];
    status: string;
    project: string;
    type: string;
  },
): string {
  const today = todayIso();
  const existing = parseFrontmatter(content);

  const mergedBody = existing.body;
  const mergedMeta = {
    ...existing.data,
    title: existing.data.title ?? metadata.title,
    tags: uniqueSorted([
      ...asStringArray(existing.data.tags),
      ...metadata.tags,
      "obsidian-sync",
    ]),
    status: existing.data.status ?? metadata.status,
    project: existing.data.project ?? metadata.project,
    type: existing.data.type ?? metadata.type,
    created: existing.data.created ?? today,
    updated: today,
  };

  return `${serializeFrontmatter(mergedMeta)}\n${mergedBody}`;
}

function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---\n")) {
    return { data: {}, body: content };
  }

  const end = trimmed.indexOf("\n---\n", 4);
  if (end === -1) {
    return { data: {}, body: content };
  }

  const fmText = trimmed.slice(4, end);
  const body = trimmed.slice(end + 5);

  const data: Record<string, unknown> = {};
  for (const line of fmText.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const items = rawValue
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      data[key] = items;
    } else {
      data[key] = rawValue.replace(/^"|"$/g, "");
    }
  }

  return { data, body };
}

function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ["---"];

  const orderedKeys = [
    "title",
    "tags",
    "status",
    "created",
    "updated",
    "project",
    "type",
  ];

  for (const key of orderedKeys) {
    if (!(key in data)) continue;

    const value = data[key];
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value.map((v) => quoteYaml(String(v))).join(", ")}]`,
      );
    } else {
      lines.push(`${key}: ${quoteYaml(String(value))}`);
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (orderedKeys.includes(key)) continue;
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value.map((v) => quoteYaml(String(v))).join(", ")}]`,
      );
    } else {
      lines.push(`${key}: ${quoteYaml(String(value))}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

/* =========================
 * Index
 * ========================= */

function createIndex(params: {
  projectName: string;
  files: readonly SyncFile[];
  attachmentsFolder: string;
}): string {
  const { projectName, files } = params;
  const today = todayIso();

  const links = files
    .map((file) => `- [[${path.basename(file.dstFileName, ".md")}]]`)
    .join("\n");

  return `---
title: ${quoteYaml(`${projectName} Documentation Index`)}
tags: [${quoteYaml("index")}, ${quoteYaml("moc")}, ${quoteYaml(projectName)}]
status: ${quoteYaml("active")}
created: ${quoteYaml(today)}
updated: ${quoteYaml(today)}
project: ${quoteYaml(projectName)}
type: ${quoteYaml("index")}
---

# ${projectName} Documentation

> Map of Content

## Documents

${links || "- No documents synced"}

## Dataview

\`\`\`dataview
TABLE status as Status, file.mtime as Updated
FROM "${projectName}"
WHERE type = "documentation"
SORT file.mtime DESC
\`\`\`

## Tags

- \`#${projectName}\`
- \`#obsidian-sync\`

_Last synced: ${today}_
`;
}

/* =========================
 * Images
 * ========================= */

async function copyReferencedImages(
  imageLookup: Map<string, { rel: string; abs: string; dstName: string }>,
  referencedImages: ReadonlySet<string>,
  attachmentsDir: string,
  maxFileSizeMB: number,
  errors: string[],
): Promise<number> {
  let count = 0;

  for (const imageRel of referencedImages) {
    const imageInfo = imageLookup.get(imageRel);
    if (!imageInfo) {
      errors.push(`Referenced image not found: ${imageRel}`);
      continue;
    }

    try {
      await validateFileSize(imageInfo.abs, maxFileSizeMB, "image");

      const dst = path.join(attachmentsDir, imageInfo.dstName);
      await fs.copyFile(imageInfo.abs, dst);
      count += 1;
    } catch (error: unknown) {
      errors.push(formatError(`Failed to copy image ${imageInfo.rel}`, error));
    }
  }

  return count;
}

async function validateFileSize(
  filePath: string,
  maxSizeMB: number,
  fileType: string,
): Promise<void> {
  const maxBytes = maxSizeMB * 1024 * 1024;
  const stats = await fs.stat(filePath);

  if (stats.size > maxBytes) {
    throw new Error(
      `${fileType} too large: ${(stats.size / (1024 * 1024)).toFixed(2)}MB ` +
        `(max: ${maxSizeMB}MB)`,
    );
  }
}

/* =========================
 * Helpers
 * ========================= */

function buildTagsForFile(srcRelative: string, projectName: string): string[] {
  const file = path.basename(srcRelative).toLowerCase();
  const tags = [projectName];

  if (file === "readme.md") tags.push("setup", "guide");
  if (file === "agents.md" || file === "claude.md")
    tags.push("rules", "standards");
  if (file.includes("improvement")) tags.push("roadmap", "planning");
  if (file.includes("summary")) tags.push("summary", "overview");
  if (file.includes("reference")) tags.push("reference", "cheatsheet");

  return uniqueSorted(tags);
}

function inferStatus(srcRelative: string): string {
  const file = path.basename(srcRelative).toLowerCase();
  if (file.includes("improvement")) return "in-progress";
  return "active";
}

function relativePathToSafeMarkdownName(rel: string): string {
  const noExt = rel.replace(/\.md$/i, "");
  return (
    noExt
      .replace(/^[.][/\\]?/, "")
      .replace(/[\\/]+/g, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") + ".md"
  );
}

function relativePathToSafeFileName(rel: string): string {
  const ext = path.extname(rel);
  const noExt = rel.slice(0, -ext.length);
  const safeName = noExt
    .replace(/^[.][/\\]?/, "")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safeName + ext;
}

function normalizeRelativePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^.\//, "");
}

function shouldExclude(
  rel: string,
  excludePatterns: readonly string[],
): boolean {
  const normalized = normalizeRelativePath(rel);

  for (const pattern of excludePatterns) {
    const p = normalizeRelativePath(pattern);

    if (p.endsWith("/**")) {
      const prefix = p.slice(0, -3);
      if (normalized === prefix || normalized.startsWith(prefix + "/")) {
        return true;
      }
    } else if (p.includes("/**/")) {
      const prefix = p.split("/**/")[0];
      if (normalized.startsWith(prefix + "/")) {
        return true;
      }
    } else if (normalized === p) {
      return true;
    } else if (normalized.startsWith(p.replace(/\/$/, "") + "/")) {
      return true;
    }
  }

  return false;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatError(context: string, error: unknown): string {
  if (error instanceof Error) {
    return `${context}: ${error.message}`;
  }
  return `${context}: ${String(error)}`;
}
