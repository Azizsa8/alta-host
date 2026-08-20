import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../db.js";
import { signStaffToken } from "./tokens.js";
import { requireAuth } from "./middleware.js";
import { recordAudit } from "../audit/service.js";

export const authRouter = Router();

const LoginPayload = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/auth/login", async (req, res) => {
  const parsed = LoginPayload.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  const staff = await prisma.staffMember.findUnique({ where: { username: parsed.data.username } });
  // Same generic error whether the username doesn't exist or the password
  // is wrong — never reveal which one to an unauthenticated caller.
  if (!staff?.passwordHash || !(await bcrypt.compare(parsed.data.password, staff.passwordHash))) {
    // Failed attempts are audited too — a run of these against one account
    // is the signal a security review expects this trail to surface.
    await recordAudit({
      action: "auth.login",
      outcome: "failure",
      actorId: staff?.id ?? null,
      actorName: parsed.data.username,
      propertyId: staff?.propertyId ?? null,
      ip: req.ip,
      userAgent: req.header("user-agent") ?? undefined,
      metadata: { reason: staff ? "bad password" : "unknown username" },
    });
    res.status(401).json({ error: "invalid username or password" });
    return;
  }

  const token = signStaffToken({ staffId: staff.id, propertyId: staff.propertyId, name: staff.name, role: staff.role });
  await recordAudit({
    action: "auth.login",
    actorId: staff.id,
    actorName: staff.name,
    propertyId: staff.propertyId,
    ip: req.ip,
    userAgent: req.header("user-agent") ?? undefined,
    metadata: { role: staff.role },
  });
  res.json({ token, staff: { id: staff.id, name: staff.name, role: staff.role, propertyId: staff.propertyId } });
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json({ staff: req.staff });
});
