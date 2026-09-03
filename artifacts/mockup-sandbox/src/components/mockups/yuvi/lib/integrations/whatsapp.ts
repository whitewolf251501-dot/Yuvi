// lib/integrations/whatsapp.ts — WhatsApp outreach via wa.me deep links,
// no paid API needed. Structured so a real WhatsApp Business API can
// replace the internals later without touching any calling code.
//
// Ported from aa-os-yuvi/integrations/whatsapp.js.

import { emit } from "../eventBus";

export function buildLink(phone: string, message: string): string {
  const cleanPhone = (phone || "").replace(/\D/g, "");
  const withCountryCode = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message || "")}`;
}

export function send(phone: string, message: string): string {
  const link = buildLink(phone, message);
  window.open(link, "_blank");
  emit("whatsapp.sent", { phone });
  return link;
}
