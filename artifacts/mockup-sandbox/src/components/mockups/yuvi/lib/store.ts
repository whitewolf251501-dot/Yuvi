// Local persistence for YUVI Command Deck (Mission 1 scope).
// One centralized store — nothing else in the app should call localStorage directly.
// Mission 2/3 will replace this module's internals with real Supabase-backed calls
// without touching call sites, since every consumer goes through get/set here.

const PREFIX = "yuvi:";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can fail (quota, private mode) — fail silently, in-memory state still works.
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

export const store = { read, write, remove };

// Central Groq model registry — the Settings dropdown, the default settings value,
// and the localStorage migration below all read from this single list/constant
// so there is exactly one place that defines which models exist and which is default.
export const GROQ_MODELS: { id: string; label: string }[] = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
  { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
];

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

// Model ids that used to be the default and are no longer reliably available on Groq.
// Anyone with one of these saved locally gets migrated to DEFAULT_GROQ_MODEL once.
const RETIRED_DEFAULT_MODELS = new Set(["llama-3.3-70b-versatile"]);

// Resolves a saved (possibly stale/unknown) modelId to the value that should actually
// be used and persisted: unknown/retired defaults migrate forward, anything else the
// user deliberately picked (including other still-supported models) is preserved.
function resolveGroqModel(savedModelId: string | undefined): string {
  if (!savedModelId) return DEFAULT_GROQ_MODEL;
  if (RETIRED_DEFAULT_MODELS.has(savedModelId)) return DEFAULT_GROQ_MODEL;
  return savedModelId;
}

export type YuviSettings = {
  groq: { modelId: string; keyLastFour: string; hasKey: boolean; connectionStatus: "not_connected" | "connected" | "failed" };
  identity: {
    name: string;
    personalityPrompt: string;
    customInstructions: string;
    capabilities: Record<string, boolean>;
    proactivity: Record<string, boolean>;
  };
  lock: { passcodeDigest: string };
};

export const DEFAULT_PERSONALITY = `You are YUVI, a proactive AI business operating system assistant.
You are smart, sharp, aware, genuine, confident and accurate.
You understand the user's workspace, dashboard, agents, tasks, leads, content, approvals, settings and activity.
You proactively surface important information.
You recommend actions when useful.
You can navigate the application through structured application actions.
You never fabricate actions, results, integrations or completed work.
When something is unavailable, you say so clearly.
When an action requires human approval, ask for it.
Prefer concise, useful communication over unnecessary explanation.`;

export const DEFAULT_SETTINGS: YuviSettings = {
  groq: { modelId: DEFAULT_GROQ_MODEL, keyLastFour: "", hasKey: false, connectionStatus: "not_connected" },
  identity: {
    name: "YUVI",
    personalityPrompt: DEFAULT_PERSONALITY,
    customInstructions: "",
    capabilities: { Chat: true, "Proactive briefings": true, "Dashboard awareness": true, "Agent awareness": true, Navigation: true, Notifications: true, "Task management": false, Memory: false, Knowledge: false, Approvals: true },
    proactivity: { "Proactive mode": true, "Daily briefing": true, "Important-event notifications": true, "Agent completion notifications": true, "Approval notifications": true, "Error notifications": true }
  },
  lock: { passcodeDigest: "" }
};

const SETTINGS_KEY = "settings";
const GROQ_KEY_KEY = "groq_key"; // stored separately from settings metadata so it's easy to exclude/clear independently

export function loadSettings(): YuviSettings {
  const stored = read<Partial<YuviSettings>>(SETTINGS_KEY, {});
  const mergedGroq = { ...DEFAULT_SETTINGS.groq, ...(stored.groq || {}) };
  const resolvedModelId = resolveGroqModel(mergedGroq.modelId);
  const settings: YuviSettings = {
    groq: { ...mergedGroq, modelId: resolvedModelId },
    identity: {
      ...DEFAULT_SETTINGS.identity,
      ...(stored.identity || {}),
      capabilities: { ...DEFAULT_SETTINGS.identity.capabilities, ...(stored.identity?.capabilities || {}) },
      proactivity: { ...DEFAULT_SETTINGS.identity.proactivity, ...(stored.identity?.proactivity || {}) }
    },
    lock: { ...DEFAULT_SETTINGS.lock, ...(stored.lock || {}) }
  };
  // One-time migration: if the saved model id was a retired default, persist the
  // corrected value now so this doesn't need to re-migrate on every load.
  if (stored.groq?.modelId !== resolvedModelId) {
    saveSettings(settings);
  }
  return settings;
}

export function saveSettings(settings: YuviSettings): void {
  write(SETTINGS_KEY, settings);
}

// The raw Groq key is intentionally kept in a separate key from the rest of settings,
// stored in localStorage only (never logged, never sent anywhere except directly to Groq's API
// for the connection test). This is a frontend-only preview; a production build should move
// key storage and the Groq call itself behind the existing API server.
export function loadGroqKey(): string {
  return read<string>(GROQ_KEY_KEY, "");
}
export function saveGroqKey(key: string): void {
  write(GROQ_KEY_KEY, key);
}
export function clearGroqKey(): void {
  remove(GROQ_KEY_KEY);
}
