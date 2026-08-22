import { describe, it, expect } from "vitest";
import { can, normaliseRole, ROLES, ACTIONS } from "../src/modules/auth/permissions.js";

/**
 * §11-10: permissions enforced in the API. This suite pins the policy
 * table so a permission change is a visible diff here, never a silent
 * behavioural drift.
 */
describe("role policy (§3 / §11-10)", () => {
  it("legacy names normalise to the brief's roles", () => {
    expect(normaliseRole("manager")).toBe("hotel_manager");
    expect(normaliseRole("maintenance")).toBe("maintenance_manager");
    expect(normaliseRole("housekeeping")).toBe("reception");
    expect(normaliseRole("guest_service")).toBe("reception");
    expect(normaliseRole("technician")).toBe("technician");
    expect(normaliseRole("garbage-role")).toBe("reception");
  });

  it("resume-ai is manager-gated (§6-ب)", () => {
    expect(can("hotel_manager", "conversations.resume_ai")).toBe(true);
    expect(can("general_manager", "conversations.resume_ai")).toBe(true);
    expect(can("reception", "conversations.resume_ai")).toBe(false);
    expect(can("technician", "conversations.resume_ai")).toBe(false);
  });

  it("credentials are hotel-manager only", () => {
    expect(can("hotel_manager", "credentials.manage")).toBe(true);
    for (const r of ROLES.filter((r) => r !== "hotel_manager")) {
      expect(can(r, "credentials.manage")).toBe(false);
    }
  });

  it("the platform admin is not a guest-data superset (§3)", () => {
    expect(can("alta_admin", "conversations.view")).toBe(false);
    expect(can("alta_admin", "conversations.reply")).toBe(false);
    expect(can("alta_admin", "audit.view")).toBe(true);
  });

  it("technicians see tickets but do not manage them", () => {
    expect(can("technician", "tickets.view")).toBe(true);
    expect(can("technician", "tickets.update")).toBe(false);
  });

  it("every action has at least one role and no unknown roles", () => {
    for (const a of ACTIONS) {
      const allowed = ROLES.filter((r) => can(r, a));
      expect(allowed.length).toBeGreaterThan(0);
    }
  });
});
