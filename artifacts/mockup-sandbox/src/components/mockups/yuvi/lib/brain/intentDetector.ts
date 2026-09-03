// lib/brain/intentDetector.ts — stateless intent detection. Takes a raw
// user message, returns a structured intent or null. No AI calls, no side
// effects. Brain uses this as step 1 of every chat message: if a message
// matches a known intent, it's handled deterministically by a real skill
// instead of going to the model at all — which is also how this avoids the
// hallucinated-permission-flow failure mode (the model never gets asked to
// improvise an action it can't take, because known actions never reach it).
//
// Ported from aa-os-yuvi/brain/intentDetector.js.

export interface IntentRule {
  id: string;
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => Record<string, unknown>;
}

export interface DetectedIntent {
  id: string;
  args: Record<string, unknown>;
  rule: IntentRule;
}

// Rules reflect capabilities that actually exist as skills. Unlike the
// original (which had rules for leads/pipeline/clients/knowledge management
// that don't exist as skills in this app yet), this starts with only what's
// real: lead-research. Add a rule here when — and only when — a matching
// skill capability actually exists, so a matched intent can never dead-end
// into "no skill found."
const RULES: IntentRule[] = [
  {
    id: "skills.list",
    pattern: /^(show skills?|list skills?|installed skills?|what can you do\??)$/i,
    extract: () => ({}),
  },
];

export function detect(message: string): DetectedIntent | null {
  const msg = (message || "").trim();
  for (const rule of RULES) {
    const match = msg.match(rule.pattern);
    if (match) {
      return { id: rule.id, args: rule.extract(match), rule };
    }
  }
  return null;
}

/** Add a custom intent rule at runtime (called by skills on registration). Skill rules take priority over defaults. */
export function addRule(rule: IntentRule): boolean {
  if (!rule.id || !rule.pattern || typeof rule.extract !== "function") {
    console.warn("[intentDetector] Invalid rule skipped:", rule);
    return false;
  }
  RULES.unshift(rule);
  return true;
}

export function getRules(): IntentRule[] {
  return [...RULES];
}
