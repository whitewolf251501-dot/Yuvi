// lib/skills/lead-research/index.ts — generates a short outreach brief for
// a lead (pain point, opening line, objection to expect).
//
// This is the "AI Research" button on the Leads view, converted from an
// inline function in YuviOS.tsx into a proper skill so it goes through the
// same registry/dependency/capability system every other skill will use —
// the point of Phase 6 is that capabilities are dispatched uniformly, not
// that this one feature is special-cased.

import { askGroq, type ChatMessage } from "../../groq";
import type { SkillModule } from "../types";

export interface GenerateBriefArgs {
  lead: { name: string; company: string; category: string; stage: string; value: string };
  personalityPrompt: string;
  apiKey: string;
  modelId: string;
}

export type GenerateBriefResult = { ok: true; text: string } | { ok: false; reason: string };

async function generateBrief(args: GenerateBriefArgs): Promise<GenerateBriefResult> {
  const { lead, personalityPrompt, apiKey, modelId } = args;
  if (!apiKey) {
    return { ok: false, reason: "No Groq API key saved yet. Add one in Settings → API & AI." };
  }

  const prompt = `Give a short, practical outreach brief for a business approaching this lead:
Name: ${lead.name}
Company: ${lead.company}
Category: ${lead.category}
Current stage: ${lead.stage}
Estimated value: ${lead.value}

Give: 1) a likely pain point for a business like this, 2) one specific opening line to use in outreach, 3) one risk/objection to expect. Keep it under 120 words, no headers, just tight prose.`;

  const messages: ChatMessage[] = [
    { role: "system", content: personalityPrompt },
    { role: "user", content: prompt },
  ];

  const result = await askGroq(messages, apiKey, modelId);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, text: result.text };
}

const skill: SkillModule = {
  manifest: {
    id: "lead-research",
    name: "Lead Research",
    version: "1.0.0",
    description: "Generates a short outreach brief (pain point, opening line, objection) for a lead.",
    category: "business",
    icon: "🔍",
    dependencies: [],
    capabilities: ["lead-research.generate-brief"],
  },
  api: {
    execute(capability, args) {
      switch (capability) {
        case "lead-research.generate-brief":
          return generateBrief(args as unknown as GenerateBriefArgs);
        default:
          throw new Error(`[lead-research] Unknown capability: ${capability}`);
      }
    },
  },
};

export default skill;
