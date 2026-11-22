import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// An idle client emits "error" with no request in flight. With no listener, Node exits.
pool.on("error", (err: Error) => {
  console.error("Unexpected error on idle database client", err);
});

export const db = drizzle(pool, { schema });
