import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { createRequire } from "module";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Neon's serverless driver talks to Postgres over WebSockets instead of a raw
// TCP socket — Neon's own changelog calls out StackBlitz compatibility by
// name, and this is what makes it work inside browser-sandboxed runtimes
// like Bolt/StackBlitz's WebContainers, which can't open raw TCP sockets (the
// previous `pg`-based Pool here could not connect from inside one). Unlike
// Neon's plain HTTP driver, the WebSocket Pool still supports Drizzle's full
// interactive db.transaction() API — this codebase depends on that in ~20
// places (retry-on-collision batch numbering, read-then-conditionally-write
// signoff logic, etc.), which the HTTP driver's request-batched transactions
// can't run.
//
// A plain Node.js process (your own machine, CI, most non-WebContainer
// hosts) has no native WebSocket global, so it needs the `ws` package
// supplied explicitly. Environments that already provide one (Bolt/
// StackBlitz among them) skip this branch entirely.
if (typeof WebSocket === "undefined") {
  const require = createRequire(import.meta.url);
  neonConfig.webSocketConstructor = require("ws");
}

// DATABASE_URL works the same as before — any standard Postgres connection
// string. Get one from the Neon console (or point at any other Postgres host
// that accepts WebSocket connections via Neon's proxy protocol).
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
