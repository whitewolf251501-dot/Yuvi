// lib/brain/skillOrchestrator.ts — executes skills in response to detected
// intents or direct capability calls. Nothing outside this module (and
// brain.ts, which owns it) calls a skill's execute() directly — this is the
// single dispatch point, same rule as the original.
//
// Ported from aa-os-yuvi/brain/skillOrchestrator.js.

import { findByCapability } from "../skillRegistry";
import { emit } from "../eventBus";

export interface ChainStep {
  capability: string;
  args?: Record<string, unknown>;
}
export interface ChainStepResult {
  capability: string;
  result?: unknown;
  error?: string;
}

/** Executes a capability on the first registered, enabled skill that provides it. Returns null if no skill matches. */
export async function execute(capability: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const skills = findByCapability(capability);
  if (!skills.length) return null;
  const skill = skills[0];
  if (!skill.enabled) return null;
  try {
    const executeFn = skill.api.execute as (capability: string, args?: Record<string, unknown>) => unknown | Promise<unknown>;
    const result = await executeFn(capability, args);
    emit("skill.executed", { capability, skill_id: skill.id });
    return result;
  } catch (e) {
    console.error(`[skillOrchestrator] Error executing ${capability} on ${skill.id}:`, e);
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Runs a chain of steps sequentially, passing each result to the next as `previous`. */
export async function runChain(steps: ChainStep[]): Promise<ChainStepResult[]> {
  const results: ChainStepResult[] = [];
  let previous: unknown = null;
  for (const step of steps) {
    const result = await execute(step.capability, { ...(step.args || {}), previous });
    if (typeof result === "string" && result.startsWith("Error:")) {
      results.push({ capability: step.capability, error: result });
      break;
    }
    results.push({ capability: step.capability, result });
    previous = result;
  }
  emit("chain.executed", { steps: steps.map((s) => s.capability), count: results.length });
  return results;
}
