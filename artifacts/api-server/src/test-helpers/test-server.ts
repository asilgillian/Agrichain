import express, { type IRouter } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { AuthedRequest } from "../middlewares/auth";

// Minimal authed-user shape the route handlers read off req.authedUser.
export interface TestUser {
  id: string;
  clerkUserId: string;
  email: string;
  role: string;
  roles: string[];
  permissions: string[];
}

// A wildcard admin — passes every requirePermission(...) gate and every
// assignment-scope check (perms include "*").
export function adminUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: overrides.id ?? "00000000-0000-0000-0000-000000000000",
    clerkUserId: overrides.clerkUserId ?? "test_clerk_user",
    email: overrides.email ?? "test-admin@example.com",
    role: overrides.role ?? "SystemAdministrator",
    roles: overrides.roles ?? ["SystemAdministrator"],
    permissions: overrides.permissions ?? ["*"],
  };
}

export interface TestServer {
  baseUrl: string;
  // Swap the authenticated user used for subsequent requests.
  setUser: (u: TestUser | null) => void;
  close: () => Promise<void>;
}

// Boot a real Express app that mounts the given production routers behind a
// fake auth middleware. This exercises the actual route handlers (validation,
// status codes, DB writes) without pulling in Clerk. Routers are mounted under
// "/api" exactly as the production index.ts does.
export async function startTestServer(routers: IRouter[]): Promise<TestServer> {
  const state: { user: TestUser | null } = { user: adminUser() };

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  // Stub req.log so handlers that call req.log.* (e.g. the mobile-money error
  // path) don't crash — pino-http isn't mounted in tests.
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    next();
  });
  app.use((req: AuthedRequest, _res, next) => {
    if (state.user) req.authedUser = state.user;
    next();
  });
  for (const r of routers) app.use("/api", r);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    setUser: (u) => {
      state.user = u;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// Small JSON fetch helper returning both status and parsed body.
export async function jsonRequest(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}
