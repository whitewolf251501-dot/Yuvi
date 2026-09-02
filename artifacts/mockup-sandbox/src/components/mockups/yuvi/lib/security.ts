/**
 * lib/security.ts — sanitization, escaping, and validation utilities.
 *
 * React already escapes text content by default (unlike the vanilla-JS build
 * this is ported from, which used innerHTML directly and needed escapeHTML
 * on every render). What still matters here even in React: sanitizing data
 * BEFORE it's stored (localStorage, CSV import, lead forms) and validating
 * shapes before they enter app state — React's auto-escaping doesn't help
 * with "did the user paste a script tag into a phone field," data integrity,
 * or safe JSON/localStorage access.
 *
 * Ported from aa-os-yuvi/core/security.js.
 */

// ── Sanitize a plain string for storage (strip HTML tags, trim) ────────────
export function sanitizeText(str: unknown, maxLength = 500): string {
  if (str === null || str === undefined || str === "") return "";
  return String(str)
    .replace(/<[^>]*>/g, "") // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip control chars
    .trim()
    .slice(0, maxLength);
}

// ── Sanitize a phone number ─────────────────────────────────────────────────
export function sanitizePhone(str: unknown): string {
  if (!str) return "";
  return String(str).replace(/[^0-9+\-() ]/g, "").trim().slice(0, 20);
}

// ── Sanitize a URL (allow only http/https) ──────────────────────────────────
export function sanitizeURL(str: unknown): string {
  if (!str) return "";
  const clean = String(str).trim();
  if (!/^https?:\/\//i.test(clean)) return "";
  return clean.slice(0, 500);
}

// ── Sanitize a CSV row (array of strings from import) ──────────────────────
export function sanitizeCSVRow(row: unknown): string[] {
  if (!Array.isArray(row)) return [];
  return row.map((cell) => sanitizeText(String(cell ?? ""), 300));
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Validate a lead object before storage ───────────────────────────────────
export function validateLead(lead: { name?: unknown; phone?: unknown }): ValidationResult {
  const errors: string[] = [];
  if (!lead.name || String(lead.name).trim().length < 1) errors.push("name required");
  if (lead.phone && !/^[0-9+\-() ]{7,20}$/.test(String(lead.phone))) errors.push("invalid phone");
  return { valid: errors.length === 0, errors };
}

// ── Validate a Skill manifest ────────────────────────────────────────────────
export interface SkillManifest {
  id?: string;
  name?: string;
  version?: string;
  capabilities?: unknown;
}

export function validateSkillManifest(manifest: SkillManifest | null | undefined): ValidationResult {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["manifest must be an object"] };
  }
  if (!manifest.id) errors.push("missing: id");
  if (!manifest.name) errors.push("missing: name");
  if (!manifest.version) errors.push("missing: version");
  if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
    errors.push("id must be lowercase letters, numbers, hyphens only");
  }
  if (manifest.id && manifest.id.length > 64) errors.push("id too long (max 64 chars)");
  if (!Array.isArray(manifest.capabilities)) errors.push("capabilities must be an array");
  return { valid: errors.length === 0, errors };
}

// ── Validate a PromptSkill document ──────────────────────────────────────────
export interface PromptSkillDoc {
  type?: string;
  id?: string;
  name?: string;
  prompt?: string;
}

export function validatePromptSkill(ps: PromptSkillDoc | null | undefined): ValidationResult {
  const errors: string[] = [];
  if (!ps || typeof ps !== "object") return { valid: false, errors: ["invalid skill document"] };
  if (ps.type !== "yuvi-skill") errors.push('type must be "yuvi-skill"');
  if (!ps.id) errors.push("missing: id");
  if (!ps.name) errors.push("missing: name");
  if (ps.id && ps.id.length > 64) errors.push("id too long");
  if (ps.prompt && ps.prompt.length > 8000) errors.push("prompt too long (max 8000 chars)");
  return { valid: errors.length === 0, errors };
}

// ── Sanitize an object's string fields for safe storage ─────────────────────
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  fields?: (keyof T)[],
): T {
  if (!obj || typeof obj !== "object") return obj;
  const result: T = { ...obj };
  const keys = fields ?? (Object.keys(result) as (keyof T)[]);
  keys.forEach((key) => {
    if (typeof result[key] === "string") {
      (result[key] as unknown) = sanitizeText(result[key]);
    }
  });
  return result;
}

// ── Safe JSON parse (returns fallback on failure, never throws) ─────────────
export function safeParseJSON<T = unknown>(str: string | null | undefined, fallback: T | null = null): T | null {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

// ── Safe localStorage read ───────────────────────────────────────────────────
export function safeGetLocal<T = unknown>(key: string, fallback: T | null = null): T | null {
  try {
    return safeParseJSON<T>(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

// ── Safe localStorage write ──────────────────────────────────────────────────
export function safeSetLocal(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[security] localStorage write failed for key "${key}":`, e instanceof Error ? e.message : e);
    return false;
  }
}

// ── Content Security: detect potential injection in a string ────────────────
export function isLikelySafe(str: unknown): boolean {
  if (!str) return true;
  const s = String(str);
  return !/<script|javascript:|on\w+\s*=|<iframe|<svg.*on/i.test(s);
}
