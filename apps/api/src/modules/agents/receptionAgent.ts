import type { PMSAdapter } from "../pms/types.js";
import { createTicket, logAgentAction } from "../tickets/ticketService.js";
import type { ExtractedIntent, Urgency } from "../nlu/types.js";
import type { PendingAction } from "../reviews/reviewService.js";
import { runSubAgent } from "./subAgent.js";
import { findApprovedAnswer } from "../knowledge/service.js";
import { prisma } from "../../db.js";

export interface AgentReply {
  text: string;
}

export interface ReceptionProposal {
  draftReply: string;
  pendingAction: PendingAction;
}

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/**
 * True if `text` contains Arabic-script characters — the simplest reliable
 * signal that the guest wrote to us in Arabic, without pulling in a
 * language-ID library (deliberately out of scope for this fix; see the
 * intent-matching regexes in ruleBasedEngine.ts for the same approach).
 */
export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text);
}

/**
 * Guest.preferredDialect stores an Arabic dialect name (seeded default:
 * "saudi") for Arabic-speaking guests, or an explicit "english"/"en" for
 * guests who'd rather we reply in English. Anything else — including no
 * value at all — is treated as Arabic-preferring, matching both the seed
 * default and the product's Saudi/Gulf-first audience.
 */
function dialectPrefersArabic(dialect: string | null | undefined): boolean {
  if (!dialect) return true;
  return !/^(en|english)$/i.test(dialect.trim());
}

/**
 * Resolves which language a guest-facing reply should be written in.
 * Arabic script in the guest's own message (when we have it) is the
 * strongest signal and wins outright; otherwise we fall back to the
 * guest's stored dialect preference (Guest.preferredDialect). Shared by all
 * three agent modules so the same rule applies everywhere a reply is drafted.
 */
export async function resolveGuestLanguage(
  guestId: string | undefined,
  messageHint?: string
): Promise<"ar" | "en"> {
  if (messageHint && containsArabicScript(messageHint)) return "ar";
  if (!guestId) return "ar";
  const guest = await prisma.guest.findUnique({ where: { id: guestId }, select: { preferredDialect: true } });
  return dialectPrefersArabic(guest?.preferredDialect) ? "ar" : "en";
}

/**
 * Formats a Date as a Riyadh-local, minute-precision time string,
 * independent of the server's own timezone/locale. Previously this used
 * `toLocaleTimeString()` with no `timeZone`, so the displayed time followed
 * wherever the server process happened to run, not the hotel's actual
 * location — and it included seconds, reading as robotic rather than
 * something a person would say.
 */
export function formatRiyadhTime(date: Date, lang: "ar" | "en"): string {
  return date.toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Read-only proposal step (FR-3): checks PMS state and drafts a reply, but
 * never mutates anything. The result is what goes into the review queue —
 * the actual PMS write happens only in executeReceptionAction, on approval.
 */
export async function proposeReceptionReply(
  intent: ExtractedIntent,
  ctx: { guestId: string; propertyId: string; intentId: string },
  pms: PMSAdapter
): Promise<ReceptionProposal> {
  if (intent.type === "reception.faq") {
    const question = String(intent.params.question ?? "");
    const lang = await resolveGuestLanguage(ctx.guestId, question);

    // §6-أ: answer ONLY from approved knowledge. The sub-agent report makes
    // "which item answered this?" visible in the ops centre; a miss is an
    // honest "a person will follow up", never an invented policy (§7).
    const match = await runSubAgent(
      { propertyId: ctx.propertyId, intentId: ctx.intentId },
      "reception.knowledge_lookup",
      "reception",
      () => findApprovedAnswer(ctx.propertyId, question),
      (found) =>
        found
          ? { outcome: "ok" as const, detail: `matched "${found.title}"` }
          : { outcome: "blocked" as const, detail: "no approved knowledge item" }
    );

    const answer = match
      ? lang === "ar"
        ? match.contentAr
        : match.contentEn || match.contentAr
      : lang === "ar"
        ? "يعطيك العافية على تواصلك، أحد الفريق يتأكد من طلبك ويردّ عليك بأقرب وقت."
        : "Thanks for reaching out — a team member will confirm shortly.";
    return { draftReply: answer, pendingAction: { type: "no_action", params: {} } };
  }

  const lang = await resolveGuestLanguage(ctx.guestId);
  const hours = Number(intent.params.hours ?? 1);
  const subCtx = { propertyId: ctx.propertyId, intentId: ctx.intentId };

  // Sub-agent: does this guest actually have a stay to extend? Gates the
  // whole request — reported so "why was this refused?" is answerable.
  const reservation = await runSubAgent(
    subCtx,
    "reception.reservation_lookup",
    "reception",
    () => pms.getReservationForGuest(ctx.guestId),
    (r) => (r ? { outcome: "ok" as const } : { outcome: "blocked" as const, detail: "no active reservation" })
  );
  if (!reservation) {
    return {
      draftReply:
        lang === "ar"
          ? "ما لقينا لك حجز فعّال حالياً — ممكن تأكد لنا رقم غرفتك؟"
          : "I couldn't find an active reservation for you — could you confirm your room number?",
      pendingAction: { type: "no_action", params: {} },
    };
  }

  // Sub-agent: a late checkout is chargeable, so a valid payment method is
  // a hard precondition. Second gate, separately attributed.
  const billing = await runSubAgent(
    subCtx,
    "reception.billing_check",
    "reception",
    () => pms.getBillingStatus(ctx.guestId),
    (b) =>
      b.hasValidPaymentMethod
        ? { outcome: "ok" as const }
        : { outcome: "blocked" as const, detail: "no valid payment method on file" }
  );
  if (!billing.hasValidPaymentMethod) {
    return {
      draftReply:
        lang === "ar"
          ? "تمديد الخروج يحتاج وسيلة دفع مسجّلة وسارية — تكرم مرّ على الاستقبال يساعدونك."
          : "Late checkout needs a valid payment method on file — please check in with the front desk.",
      pendingAction: { type: "no_action", params: {} },
    };
  }

  const proposedCheckout = new Date(new Date(reservation.checkOut).getTime() + hours * 60 * 60 * 1000);
  const checkoutTime = formatRiyadhTime(proposedCheckout, lang);
  return {
    draftReply:
      lang === "ar"
        ? `تم التمديد — خروجك الجديد الساعة ${checkoutTime}.`
        : `You're all set — late checkout is confirmed for ${checkoutTime}.`,
    pendingAction: {
      type: "extend_checkout",
      params: { reservationId: reservation.id, hours },
    },
  };
}

/** Executes the mutation a proposal described — only called after human approval. */
export async function executeReceptionAction(
  action: PendingAction,
  ctx: { intentId: string; propertyId: string; urgency: Urgency },
  pms: PMSAdapter
): Promise<void> {
  if (action.type !== "extend_checkout") return; // no_action needs no execution

  const reservationId = String(action.params.reservationId);
  const hours = Number(action.params.hours);
  const result = await pms.extendCheckout(reservationId, hours);

  const ticket = await createTicket({
    intentId: ctx.intentId,
    department: "reception",
    summary: `Extend checkout for reservation ${reservationId} by ${hours}h`,
    propertyId: ctx.propertyId,
    urgency: ctx.urgency,
  });
  await logAgentAction(ticket.id, "reception", "pms.extendCheckout", `new checkout: ${result.newCheckOut}`);
}
