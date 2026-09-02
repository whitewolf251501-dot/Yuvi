// lib/skillLoader.ts — auto-discovers skill modules under lib/skills/*/index.ts
// at build time and registers each into skillRegistry.
//
// Equivalent in spirit to aa-os-yuvi/skills/skillLoader.js: drop a new
// folder under skills/, it's found and registered automatically, no other
// file needs editing to "wire it in." See lib/skills/types.ts for why this
// uses import.meta.glob instead of the original's runtime <script> injection.
//
// What's carried over from the original loader:
//  - manifest validation (via lib/security.ts validateSkillManifest)
//  - dependency check (skill's declared deps must already be enabled)
//  - circular dependency detection
//  - a load report or console-visible reason for every skill that fails
// What's dropped because it doesn't apply to a bundled app:
//  - version-compat check against a fetched installed.json (there's no
//    separate "platform version" for bundled code — the skill ships with
//    whatever app version it's compiled into)
//  - script load timeout (nothing is fetched at runtime, so nothing hangs)

import { register, isEnabled, type SkillManifest } from "./skillRegistry";
import { validateSkillManifest } from "./security";
import { emit } from "./eventBus";
import type { SkillModule } from "./skills/types";

export interface SkillLoadReportEntry {
  skill_id: string;
  status: "loaded" | "error";
  version?: string;
  error?: string;
}

const loadReport: SkillLoadReportEntry[] = [];

function hasCycle(skillId: string, deps: Record<string, string[]>, visited: Set<string> = new Set()): boolean {
  if (visited.has(skillId)) return true;
  visited.add(skillId);
  for (const dep of deps[skillId] || []) {
    if (hasCycle(dep, deps, new Set(visited))) return true;
  }
  return false;
}

function loadOne(mod: SkillModule, allDeps: Record<string, string[]>): boolean {
  const manifest = mod.manifest as SkillManifest;

  const validation = validateSkillManifest(manifest);
  if (!validation.valid) {
    const err = `Invalid manifest: ${validation.errors.join(", ")}`;
    console.error(`[skillLoader] ✗ ${manifest?.id ?? "(unknown)"}: ${err}`);
    loadReport.push({ skill_id: manifest?.id ?? "(unknown)", status: "error", error: err });
    return false;
  }

  const deps = manifest.dependencies || [];
  if (deps.length) {
    const missing = deps.filter((dep) => !isEnabled(dep));
    if (missing.length) {
      const err = `Missing dependencies: ${missing.join(", ")}`;
      console.warn(`[skillLoader] ✗ ${manifest.id}: ${err}`);
      loadReport.push({ skill_id: manifest.id, status: "error", error: err });
      return false;
    }
    allDeps[manifest.id] = deps;
    if (hasCycle(manifest.id, allDeps)) {
      const err = "Circular dependency detected";
      console.error(`[skillLoader] ✗ ${manifest.id}: ${err}`);
      loadReport.push({ skill_id: manifest.id, status: "error", error: err });
      return false;
    }
  }

  const ok = register(manifest, mod.api);
  if (ok) {
    loadReport.push({ skill_id: manifest.id, status: "loaded", version: manifest.version });
  } else {
    loadReport.push({ skill_id: manifest.id, status: "error", error: "register() returned false" });
  }
  return ok;
}

/**
 * Discovers every skills/<id>/index.ts module bundled into the app and
 * registers it. Call once at app startup (see YuviOS.tsx init).
 */
export function loadAllSkills(): SkillLoadReportEntry[] {
  loadReport.length = 0;

  // Eager glob: skill modules are small and always needed, so no lazy-load
  // benefit here — and eager keeps registration synchronous/predictable.
  const modules = import.meta.glob<SkillModule>("./skills/*/index.ts", { eager: true });

  const allDeps: Record<string, string[]> = {};
  let loaded = 0;
  let errors = 0;

  for (const mod of Object.values(modules)) {
    const ok = loadOne(mod, allDeps);
    if (ok) loaded++;
    else errors++;
  }

  emit("skills.loaded", { loaded, total: loaded + errors, errors });
  return getReport();
}

export function getReport(): SkillLoadReportEntry[] {
  return [...loadReport];
}
