/**
 * The role model from the brief (§3), enforced in the API (§11-10).
 *
 * One exhaustive table instead of role checks scattered through routes:
 * every permission decision goes through can(), so "who may do what" is
 * one reviewable file rather than an archaeology project.
 */

export const ROLES = [
  "alta_admin", // مدير منصة ALTA — cross-tenant platform operator
  "hotel_manager", // مدير الفندق
  "general_manager", // المدير العام — read-heavy oversight
  "reception", // الاستقبال
  "maintenance_manager", // مدير الصيانة
  "technician", // الفني — sees only their own work
  "marketing_manager", // مدير التسويق
] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "conversations.view",
  "conversations.takeover",
  "conversations.resume_ai", // §6-ب: manager-gated
  "conversations.reply",
  "tickets.view",
  "tickets.update",
  "reviews.decide",
  "credentials.manage", // per-hotel API tokens
  "audit.view",
  "reports.view",
  "agents.view",
  "simulate.run",
  "workorders.view_all", // the maintenance board
  "workorders.view_own", // technician: only their assignments (§4)
  "workorders.create",
  "workorders.assign",
  "workorders.update_status", // progress notes + photos
  "workorders.close", // normal-priority close
  "workorders.close_critical", // §6-ج: manager confirm gates critical closes
  "knowledge.view",
  "knowledge.manage", // create/edit/approve/retire — approval is what agents trust
  "agents.toggle", // مركز الوكلاء on/off (§4)
  "reputation.view",
  "reputation.reply", // approve + publish a review reply — no auto-publish (§7)
  "reputation.link", // link/unlink the platform account
  "content.view",
  "content.edit", // ideas, drafts, brand profile
  "content.approve", // §7: publish only after this human act
  "platform.manage", // §13: create hotels, plans/quotas, suspend — alta_admin ONLY
  "social.view",
  "social.manage", // per-channel settings, cadence, auto-publish switch
  "complaints.view",
  "complaints.investigate", // record RCA, own a case
  "complaints.resolve", // close a case — needs a root cause and a done action
] as const;
export type Action = (typeof ACTIONS)[number];

const MANAGERS: Role[] = ["hotel_manager", "general_manager"];
const FRONT_OF_HOUSE: Role[] = ["reception", ...MANAGERS];

/** Exhaustive: every action lists exactly who may perform it. alta_admin
 *  is deliberately NOT a superset — §3 forbids the platform operator from
 *  guest-data access without authorisation, so guest-facing actions
 *  exclude it by default. */
const POLICY: Record<Action, Role[]> = {
  "conversations.view": [...FRONT_OF_HOUSE, "maintenance_manager"],
  "conversations.takeover": FRONT_OF_HOUSE,
  "conversations.resume_ai": MANAGERS,
  "conversations.reply": FRONT_OF_HOUSE,
  "tickets.view": [...FRONT_OF_HOUSE, "maintenance_manager", "technician"],
  "tickets.update": [...FRONT_OF_HOUSE, "maintenance_manager"],
  "reviews.decide": FRONT_OF_HOUSE,
  "credentials.manage": ["hotel_manager"],
  "audit.view": [...MANAGERS, "alta_admin"],
  "reports.view": [...MANAGERS, "marketing_manager"],
  "agents.view": [...FRONT_OF_HOUSE, "maintenance_manager", "marketing_manager"],
  "simulate.run": FRONT_OF_HOUSE,
  "workorders.view_all": [...MANAGERS, "maintenance_manager", "reception"],
  "workorders.view_own": ["technician"],
  "workorders.create": [...FRONT_OF_HOUSE, "maintenance_manager"],
  "workorders.assign": [...MANAGERS, "maintenance_manager"],
  "workorders.update_status": [...MANAGERS, "maintenance_manager", "technician"],
  "workorders.close": [...MANAGERS, "maintenance_manager", "technician"],
  "workorders.close_critical": [...MANAGERS, "maintenance_manager"],
  "knowledge.view": [...FRONT_OF_HOUSE, "maintenance_manager", "marketing_manager"],
  "knowledge.manage": MANAGERS,
  "agents.toggle": MANAGERS,
  "reputation.view": [...MANAGERS, "marketing_manager", "reception"],
  "reputation.reply": [...MANAGERS, "marketing_manager"],
  "reputation.link": MANAGERS,
  "content.view": [...MANAGERS, "marketing_manager", "reception"],
  "content.edit": [...MANAGERS, "marketing_manager"],
  "content.approve": [...MANAGERS, "marketing_manager"],
  "platform.manage": ["alta_admin"],
  "social.view": [...MANAGERS, "marketing_manager", "reception"],
  "social.manage": [...MANAGERS, "marketing_manager"],
  "complaints.view": [...MANAGERS, "marketing_manager", "reception", "maintenance_manager"],
  "complaints.investigate": [...MANAGERS, "marketing_manager", "maintenance_manager"],
  "complaints.resolve": MANAGERS,
};

export function can(role: string, action: Action): boolean {
  return (POLICY[action] as readonly string[]).includes(role);
}

/** Legacy role names → the brief's role model (§3). housekeeping and
 *  guest_service were departments mislabeled as login roles; their staff
 *  keep department assignment via StaffMember.role for ticket routing but
 *  map to reception-level dashboard access. */
export function normaliseRole(role: string): Role {
  switch (role) {
    case "manager":
      return "hotel_manager";
    case "maintenance":
      return "maintenance_manager";
    case "housekeeping":
    case "guest_service":
      return "reception";
    default:
      return (ROLES as readonly string[]).includes(role) ? (role as Role) : "reception";
  }
}
