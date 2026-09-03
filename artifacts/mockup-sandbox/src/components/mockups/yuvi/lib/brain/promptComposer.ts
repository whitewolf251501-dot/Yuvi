// lib/brain/promptComposer.ts — assembles the system prompt for every AI
// call that goes through brain.ts.
//
// THE KEY FIX THIS FILE MAKES: the original app's system prompt
// (settings.identity.personalityPrompt) told the model it's a business
// assistant with "leads, approvals, dashboard" awareness, but never told it
// which actions actually exist as working code. That's exactly why it
// hallucinated a fake "Settings → Permissions → Agents & Integrations"
// flow — nothing in its prompt distinguished "things I can actually do"
// from "things a business assistant plausibly could do." getSkillsSummary()
// below lists only skills that are actually registered and enabled, so an
// honest prompt now says "you have: Lead Research" instead of implying
// unlimited CRM/dashboard access.
//
// Ported from aa-os-yuvi/brain/promptComposer.js, adapted to read from this
// app's actual state shape (store.ts's "leads" key) instead of the
// original's yuvi_leads/yuvi_clients/yuvi_pipeline keys, which don't exist
// here — those are separate, not-yet-built data models (see Phase 4 notes).

import { store } from "../store";
import { list as listSkills } from "../skillRegistry";

// Minimal local shape — intentionally not importing lib/metrics.ts's Lead
// type here, since that lives on a separate branch (feat/real-dashboard-metrics)
// not guaranteed to be merged before this one. Only the fields actually
// read below.
interface LeadLite {
  status?: string;
}

export type PromptMode = "chat" | "plan" | "outreach" | "proposal" | "brief" | "research";

const MODE_INSTRUCTIONS: Record<PromptMode, string> = {
  chat: "Answer directly and concisely. You know this business inside out.",
  plan: "Create a structured action plan with clear steps and timelines.",
  outreach:
    "Write WhatsApp/email outreach. Punchy, under 3 lines unless asked. End with a clear call to action when relevant.",
  proposal: "Draft a professional proposal for the business. Include problem, solution, pricing, and next step.",
  brief: "Write a sharp briefing. Bullet points. No fluff. What happened, what matters, what to do next.",
  research: "Research thoroughly. Structure the output clearly with headings and key takeaways.",
};

function getLiveState(): string {
  const leads = store.read<LeadLite[]>("leads", []);
  if (!leads.length) return "";
  const hot = leads.filter((l) => (l.status || "").toLowerCase() === "hot").length;
  return `Leads: ${leads.length} total, ${hot} hot.`;
}

/**
 * Lists only skills that are actually registered and enabled. This is what
 * keeps the model honest about its real capabilities — see file header.
 */
function getSkillsSummary(): string {
  const skills = listSkills().filter((s) => s.enabled);
  if (!skills.length) return "No skills are currently installed — you cannot take any actions, only answer from the conversation and general knowledge. Say so plainly if asked to do something you have no skill for.";
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

export interface ComposeOptions {
  mode?: PromptMode;
  personality?: string;
  extraContext?: string;
}

export function compose(opts: ComposeOptions = {}): string {
  const mode = opts.mode || "chat";
  const personality = opts.personality || "Sharp, direct, practical.";
  const liveState = getLiveState();
  const skills = getSkillsSummary();
  const modeInstr = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.chat;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  return [
    personality,
    liveState ? `\n--- LIVE STATE ---\n${liveState}` : "",
    `\n--- DATE/TIME ---\n${dateStr} at ${timeStr}`,
    `\n--- CAPABILITIES ---\nYou have exactly these installed skills — nothing else. Never claim, offer, or invent an action, integration, or permission flow beyond what's listed here. If someone asks for something not listed, say plainly that it isn't available yet.\n${skills}`,
    opts.extraContext ? `\n--- CONTEXT ---\n${opts.extraContext}` : "",
    `\n--- MODE: ${mode.toUpperCase()} ---\n${modeInstr}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export { getLiveState, getSkillsSummary, MODE_INSTRUCTIONS };
