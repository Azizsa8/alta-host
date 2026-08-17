import jwt from "jsonwebtoken";

export interface StaffTokenPayload {
  staffId: string;
  propertyId: string;
  name: string;
  role: string;
}

// Every call reads process.env.JWT_SECRET fresh rather than caching it at
// module load — tests set it via vi.stubEnv/process.env before importing,
// and a module-level read would capture whatever was set first and never
// update.
function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    // Safe to fall back for local/demo use (docker-compose, dev) — but a
    // real deployment must set its own, otherwise every deployment shares
    // the same signing key and any token from one works on all of them.
    console.warn("JWT_SECRET is unset — using an insecure development default. Set JWT_SECRET for any real deployment.");
    return "alta-dev-insecure-jwt-secret-do-not-use-in-production";
  }
  return value;
}

export function signStaffToken(payload: StaffTokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: "12h" });
}

export function verifyStaffToken(token: string): StaffTokenPayload | null {
  try {
    return jwt.verify(token, secret()) as StaffTokenPayload;
  } catch {
    return null;
  }
}
