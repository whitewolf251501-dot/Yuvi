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
  groq: { modelId: "llama-3.3-70b-versatile", keyLastFour: "", hasKey: false, connectionStatus: "not_connected" },
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
  return {
    groq: { ...DEFAULT_SETTINGS.groq, ...(stored.groq || {}) },
    identity: {
      ...DEFAULT_SETTINGS.identity,
      ...(stored.identity || {}),
      capabilities: { ...DEFAULT_SETTINGS.identity.capabilities, ...(stored.identity?.capabilities || {}) },
      proactivity: { ...DEFAULT_SETTINGS.identity.proactivity, ...(stored.identity?.proactivity || {}) }
    },
    lock: { ...DEFAULT_SETTINGS.lock, ...(stored.lock || {}) }
  };
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
