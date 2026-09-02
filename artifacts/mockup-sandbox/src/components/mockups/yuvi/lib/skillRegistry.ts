// lib/skillRegistry.ts — the single source of truth for what Skills are
// installed, their enabled state, mode, schedule, and config.
//
// Ported from aa-os-yuvi/skills/skillRegistry.js. Module-level Map replaces
// the original's window.YuviSkillRegistry singleton.
//
// SCOPE NOTE: this ports the registry/state layer only — it's what tracks
// "which skills exist and are they on." It does NOT include:
//  - skillLoader.js (dynamic loading of skill.js files from disk/network)
//  - promptSkillEngine.js (prompt-based skill execution)
//  - skillManager.js (the ~470-line settings UI for managing skills)
// Those depend on real product decisions this repo hasn't made yet — e.g.
// whether skills ship as bundled TS modules or dynamically-loaded files in
// a React app — and a full settings screen is its own scoped UI project.
// Porting them without those decisions would mean guessing, which is how
// you end up with code that "exists" but doesn't actually work right.

import { emit } from "./eventBus";

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  category?: string;
  icon?: string;
  capabilities?: string[];
  dependencies?: string[];
}

export type SkillMode = "manual" | "suggested" | "automatic";

export interface SkillSchedule {
  frequency: "daily" | "weekly" | "monthly" | "custom";
  time: string;
  days: string[];
}

export interface SkillApi {
  onEnable?: () => void;
  onDisable?: () => void;
  onUninstall?: () => void;
  [key: string]: unknown;
}

interface SkillEntry {
  manifest: SkillManifest;
  api: SkillApi;
  enabled: boolean;
  mode: SkillMode;
  schedule: SkillSchedule | null;
  config: Record<string, unknown>;
}

export interface SkillListItem {
  id: string;
  name: string;
  version: string;
  description?: string;
  category?: string;
  icon?: string;
  capabilities: string[];
  dependencies: string[];
  enabled: boolean;
  mode: SkillMode;
  schedule: SkillSchedule | null;
  config: Record<string, unknown>;
}

const registry = new Map<string, SkillEntry>();
const STATE_KEY = "yuvi_skill_states";

type PersistedState = Pick<SkillEntry, "enabled" | "mode" | "schedule" | "config">;

function loadStates(): Record<string, Partial<PersistedState>> {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStates(): void {
  const obj: Record<string, PersistedState> = {};
  registry.forEach((entry, id) => {
    obj[id] = { enabled: entry.enabled, mode: entry.mode, schedule: entry.schedule, config: entry.config };
  });
  localStorage.setItem(STATE_KEY, JSON.stringify(obj));
}

export function register(manifest: SkillManifest, api: SkillApi): boolean {
  if (!manifest?.id) {
    console.error("[skillRegistry] manifest.id required");
    return false;
  }
  const states = loadStates();
  const saved = states[manifest.id] || {};
  const entry: SkillEntry = {
    manifest,
    api,
    enabled: saved.enabled !== false, // default: true
    mode: saved.mode || "automatic",
    schedule: saved.schedule || null,
    config: saved.config || {},
  };
  registry.set(manifest.id, entry);

  if (entry.enabled && typeof api.onEnable === "function") {
    try {
      api.onEnable();
    } catch (e) {
      console.error(`[skillRegistry] onEnable error: ${manifest.id}`, e);
    }
  }

  emit("skill.registered", { skill_id: manifest.id, version: manifest.version });
  return true;
}

export function get(id: string): SkillEntry | null {
  return registry.get(id) || null;
}
export function getApi(id: string): SkillApi | null {
  const e = registry.get(id);
  return e?.enabled ? e.api : null;
}
export function getManifest(id: string): SkillManifest | null {
  return registry.get(id)?.manifest || null;
}

export function list(): SkillListItem[] {
  return [...registry.values()].map((e) => ({
    id: e.manifest.id,
    name: e.manifest.name,
    version: e.manifest.version,
    description: e.manifest.description,
    category: e.manifest.category,
    icon: e.manifest.icon,
    capabilities: e.manifest.capabilities || [],
    dependencies: e.manifest.dependencies || [],
    enabled: e.enabled,
    mode: e.mode,
    schedule: e.schedule,
    config: e.config,
  }));
}

export function setEnabled(id: string, enabled: boolean): boolean {
  const e = registry.get(id);
  if (!e) return false;
  e.enabled = enabled;
  if (enabled && typeof e.api.onEnable === "function") e.api.onEnable();
  if (!enabled && typeof e.api.onDisable === "function") e.api.onDisable();
  saveStates();
  emit("skill.toggled", { skill_id: id, enabled });
  return true;
}

export function setMode(id: string, mode: SkillMode): boolean {
  const e = registry.get(id);
  if (!e) return false;
  e.mode = mode;
  saveStates();
  return true;
}

export function setSchedule(id: string, schedule: SkillSchedule | null): boolean {
  const e = registry.get(id);
  if (!e) return false;
  e.schedule = schedule;
  saveStates();
  return true;
}

export function setConfig(id: string, config: Record<string, unknown>): boolean {
  const e = registry.get(id);
  if (!e) return false;
  e.config = { ...e.config, ...config };
  saveStates();
  return true;
}

export function remove(id: string): boolean {
  const e = registry.get(id);
  if (!e) return false;
  if (typeof e.api.onUninstall === "function") e.api.onUninstall();
  registry.delete(id);
  const states = loadStates();
  delete states[id];
  localStorage.setItem(STATE_KEY, JSON.stringify(states));
  emit("skill.removed", { skill_id: id });
  return true;
}

export function findByCapability(capability: string): { id: string; api: SkillApi; manifest: SkillManifest; enabled: boolean }[] {
  return [...registry.values()]
    .filter((e) => e.enabled && (e.manifest.capabilities || []).includes(capability))
    .map((e) => ({ id: e.manifest.id, api: e.api, manifest: e.manifest, enabled: e.enabled }));
}

export function isEnabled(id: string): boolean {
  return registry.get(id)?.enabled ?? false;
}
export function count(): number {
  return registry.size;
}
