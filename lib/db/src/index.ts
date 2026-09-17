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
export const client = postgres(connectionString, { max: 10 });
export const db = drizzle(client, { schema });

export * from "./schema";
