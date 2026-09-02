// lib/skills/types.ts — the contract every skill module implements.
//
// This is the React/Vite-native equivalent of aa-os-yuvi's
// skills/_TEMPLATE_skill.js pattern (manifest + execute(capability, args)
// dispatcher + optional lifecycle hooks), adapted for a bundled app:
// skills are TS modules discovered at build time via import.meta.glob
// in skillLoader.ts, not <script> tags injected into the DOM at runtime.
//
// WHY NOT PORT THE ORIGINAL'S SCRIPT-INJECTION LOADER AS-IS:
// aa-os-yuvi's skillLoader.js does `document.createElement('script'); el.src
// = 'skills/<id>/skill.js'` — fetching and executing arbitrary JS at
// runtime. That's the same class of risk lib/security.ts (Phase 2) exists
// to guard against, and it doesn't fit a Vite SPA anyway (no bare
// filesystem to fetch from post-build). import.meta.glob gets the same
// practical outcome — drop a folder in skills/, it's auto-discovered and
// registered, no other file needs editing — while keeping everything
// type-checked and bundled, not dynamically eval'd.

import type { SkillManifest, SkillApi } from "../skillRegistry";

export interface SkillModule {
  manifest: SkillManifest;
  api: SkillApi & {
    /** Dispatches a capability by name. Throws for unknown capabilities. */
    execute: (capability: string, args?: Record<string, unknown>) => unknown | Promise<unknown>;
  };
}
