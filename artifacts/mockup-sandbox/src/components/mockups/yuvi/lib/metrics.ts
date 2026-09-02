// lib/metrics.ts — derives real dashboard numbers from actual app state
// (currently: leads) instead of the hardcoded values Dashboard previously
// rendered directly in JSX.
//
// Scope note: this covers everything that can honestly be computed from
// state that already exists (leads → pipeline funnel, lead counts, hot-lead
// value total). Revenue, "business health score," recent activity, and
// AI-team progress are NOT computed here because there is no real revenue
// ledger, health-scoring logic, activity log, or agent-execution state
// anywhere in the app yet — faking numbers for those would be worse than
// leaving them as clearly-labeled preview data. Wiring those up is real,
// separate work (a revenue/activity data model doesn't exist yet).

export type Lead = {
  name: string;
  company: string;
  value: string;
  stage: string;
  initials: string;
  score: number;
  category: string;
  status: string;
  phone: string;
};

const PIPELINE_STAGES = ["New", "Contacted", "Qualified", "Proposal", "Closed"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Lead.value is a free-form display string like "₹18,400" — parse the
// numeric part out for totals/averages. Returns 0 for unparseable values
// rather than throwing, since this feeds display-only aggregates.
export function parseLeadValue(value: string): number {
  const digits = value.replace(/[^0-9.]/g, "");
  const n = parseFloat(digits);
  return Number.isFinite(n) ? n : 0;
}

export interface DashboardMetrics {
  totalLeads: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  totalPipelineValue: number;
  hotPipelineValue: number;
  stageCounts: Record<PipelineStage, number>;
}

export function computeDashboardMetrics(leads: Lead[]): DashboardMetrics {
  const stageCounts = PIPELINE_STAGES.reduce(
    (acc, stage) => ({ ...acc, [stage]: 0 }),
    {} as Record<PipelineStage, number>,
  );

  let hotLeads = 0;
  let warmLeads = 0;
  let coldLeads = 0;
  let totalPipelineValue = 0;
  let hotPipelineValue = 0;

  for (const lead of leads) {
    const value = parseLeadValue(lead.value);
    totalPipelineValue += value;

    const status = (lead.status || "").toLowerCase();
    if (status === "hot") {
      hotLeads++;
      hotPipelineValue += value;
    } else if (status === "warm") {
      warmLeads++;
    } else if (status === "cold") {
      coldLeads++;
    }

    // Lead.stage values in the current data model are free text (e.g.
    // "Qualified", "Now", "Contacted") — match case-insensitively against
    // the known funnel stages, anything unrecognized is simply not counted
    // in the funnel rather than guessed at.
    const matchedStage = PIPELINE_STAGES.find(
      (s) => s.toLowerCase() === (lead.stage || "").toLowerCase(),
    );
    if (matchedStage) stageCounts[matchedStage]++;
  }

  return {
    totalLeads: leads.length,
    hotLeads,
    warmLeads,
    coldLeads,
    totalPipelineValue,
    hotPipelineValue,
    stageCounts,
  };
}

export function formatINR(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
