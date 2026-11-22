import "dotenv/config";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { MIGRATIONS_FOLDER, readMigrationFiles } from "./migration-files";

/**
 * Applies Drizzle migrations only to the dev Neon branch in .env.
 * The old production endpoint is refused even if DATABASE_URL points at it.
 * A database that already has every app table but no drizzle history is
 * baselined with only the first journal entry. `migrate` then applies the rest.
 * Production is baselined by hand with `npm run db:prod-sql`, not this script.
 */
const BLOCKED_HOSTS = new Set([
  "ep-odd-cloud-agbhx1gu-pooler.c-2.eu-central-1.aws.neon.tech",
]);

const DEV_HOSTS = new Set([
  "ep-dark-dream-ag27hyw0-pooler.c-2.eu-central-1.aws.neon.tech",
]);

const APP_TABLES = [
  "users",
  "inventory",
  "equipment",
  "checklist_items",
  "weekly_tasks",
  "task_completions",
  "chat_messages",
  "timeline_events",
  "menu_items",
  "ingredients",
  "notifications",
  "sales",
  "inventory_logs",
];

function databaseHost(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set");
  }

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }

  if (BLOCKED_HOSTS.has(host)) {
    throw new Error(`Refusing to migrate production host ${host}`);
  }
  if (!DEV_HOSTS.has(host)) {
    throw new Error(`Refusing to migrate unexpected host ${host}`);
  }
  return host;
}

async function tableExists(client: pg.PoolClient, table: string): Promise<boolean> {
  const result = await client.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
  return result.rows[0]?.name != null;
}

/**
 * Inserts the first journal entry when drizzle has no history yet.
 * Later entries stay unapplied so `migrate` runs them.
 */
async function baselineFirstMigration(client: pg.PoolClient): Promise<void> {
  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const existing = await client.query(
    "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
  );
  if (existing.rows.length > 0) {
    return;
  }

  const [first] = readMigrationFiles();
  if (!first) {
    throw new Error("Migration journal is empty");
  }

  await client.query(
    'INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)',
    [first.hash, first.createdAt],
  );
}

/** Returns true when this call recorded the baseline row. */
export async function baselineIfUntracked(client: pg.PoolClient): Promise<boolean> {
  const present: string[] = [];
  const missing: string[] = [];
  for (const table of APP_TABLES) {
    if (await tableExists(client, table)) present.push(table);
    else missing.push(table);
  }

  if (present.length > 0 && missing.length > 0) {
    throw new Error(
      `Dev database is partial (missing ${missing.join(", ")}). Refusing to migrate or baseline.`,
    );
  }

  const recorded = await client.query(`
    SELECT to_regclass('drizzle.__drizzle_migrations') AS name
  `);
  let recordedCount = 0;
  if (recorded.rows[0]?.name) {
    const count = await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    recordedCount = count.rows[0]?.n ?? 0;
  }

  if (present.length === APP_TABLES.length && recordedCount === 0) {
    await baselineFirstMigration(client);
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  const host = databaseHost();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const baselined = await baselineIfUntracked(client);
    if (baselined) {
      const first = readMigrationFiles()[0];
      console.log(`Baselined existing schema on dev host ${host} with ${first?.tag ?? "the first migration"}.`);
    }

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log(`Migrations are up to date on dev host ${host}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry != null && path.basename(entry) === "db-migrate.ts";
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Migration failed";
    console.error(message);
    process.exit(1);
  });
}
