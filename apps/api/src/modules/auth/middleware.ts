import type { NextFunction, Request, Response } from "express";
import { verifyStaffToken, type StaffTokenPayload } from "./tokens.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffTokenPayload;
    }
  }
}

/** Rejects any request without a valid staff bearer token; attaches the decoded staff to req.staff otherwise. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  // EventSource cannot set an Authorization header, so the SSE endpoint's
  // clients pass the same JWT as ?token= — TLS-protected in prod like any
  // header would be.
  const token =
    (header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined) ??
    (typeof req.query.token === "string" ? req.query.token : undefined);
  const staff = token ? verifyStaffToken(token) : null;
  if (!staff) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  req.staff = staff;
  next();
}
