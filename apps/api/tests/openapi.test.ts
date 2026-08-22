import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OPERATIONS, buildOpenApiSpec } from "../src/modules/api/openapi.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Extract every (method, path) actually registered on apiRouter — the
 *  same truth the server mounts. Express :param → OpenAPI {param}. */
function routesFromSource(): Array<{ method: string; path: string }> {
  const src = readFileSync(join(here, "../src/modules/api/routes.ts"), "utf8");
  const out: Array<{ method: string; path: string }> = [];
  const re = /apiRouter\.(get|post|patch|put|delete)\(\s*\n?\s*"([^"]+)"/g;
  for (const m of src.matchAll(re)) {
    out.push({ method: m[1], path: m[2].replace(/:([A-Za-z]+)/g, "{$1}") });
  }
  return out;
}

/**
 * §14 drift gate: an endpoint added to routes.ts without a spec entry
 * fails CI. This is the contract promise — the spec cannot silently rot.
 */
describe("OpenAPI contract (§14)", () => {
  it("every registered route is documented", () => {
    const missing = routesFromSource().filter(({ method, path }) => {
      const entry = OPERATIONS[path] as Record<string, unknown> | undefined;
      return !entry || !entry[method];
    });
    expect(missing, `undocumented routes:\n${missing.map((r) => `${r.method.toUpperCase()} ${r.path}`).join("\n")}`).toEqual([]);
  });

  it("every documented route actually exists (no ghost docs)", () => {
    const real = new Set(routesFromSource().map((r) => `${r.method} ${r.path}`));
    const external = new Set(["post /auth/login", "get /auth/me", "get /events/stream"]); // other routers
    const ghosts: string[] = [];
    for (const [path, methods] of Object.entries(OPERATIONS)) {
      for (const method of Object.keys(methods)) {
        const key = `${method} ${path}`;
        if (!real.has(key) && !external.has(key)) ghosts.push(key);
      }
    }
    expect(ghosts, `documented but not registered:\n${ghosts.join("\n")}`).toEqual([]);
  });

  it("the spec builds and carries security + servers", () => {
    const spec = buildOpenApiSpec() as { paths: Record<string, unknown>; components: unknown };
    expect(Object.keys(spec.paths).length).toBeGreaterThan(40);
    expect(spec.components).toBeTruthy();
    // login must be the only unauthenticated operation besides docs
    const login = (spec.paths["/api/auth/login"] as Record<string, { security: unknown[] }>).post;
    expect(login.security).toEqual([]);
  });
});
