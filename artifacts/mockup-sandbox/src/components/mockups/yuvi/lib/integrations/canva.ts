// lib/integrations/canva.ts — hands a generated design brief off to Canva
// via a deep link. Structured so a real Canva API integration (Canva MCP
// connector, if the user has it enabled, is a stronger option than this)
// can replace the internals later without touching any calling code.
//
// Ported from aa-os-yuvi/integrations/canva.js.

export function openDesignBrief(briefText: string): string {
  const encoded = encodeURIComponent(briefText.slice(0, 1500));
  const url = `https://www.canva.com/design/create?brief=${encoded}`;
  window.open("https://www.canva.com/create/", "_blank");
  return url;
}
