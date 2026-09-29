import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL (or SUPABASE_DB_URL) must be set. Did you forget to provision a database?",
  );
}

// Standard Postgres connection via postgres.js — works with any TCP-accessible
// Postgres host, including Supabase's connection pooler. Supersedes the prior
// @neondatabase/serverless WebSocket driver, which only worked with Neon's
// proxy protocol. Drizzle's full db.transaction() API is supported.
// prepare: false keeps this compatible with Supabase's connection poolers
// (the transaction pooler rejects prepared statements). Hosts without IPv6,
// such as Render, must use a pooler URL rather than Supabase's direct URL.
export const client = postgres(connectionString, { max: 10, prepare: false });
export const db = drizzle(client, { schema });

export * from "./schema";
