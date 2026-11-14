import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Applies Drizzle migrations only to the dev Neon branch in .env.
 * The old production endpoint is refused even if DATABASE_URL points at it.
 * Production is baselined by hand, outside this script.
 */
const BLOCKED_HOSTS = new Set([
  "ep-odd-cloud-agbhx1gu-pooler.c-2.eu-central-1.aws.neon.tech",
]);

const DEV_HOSTS = new Set([
  "ep-dark-dream-ag27hyw0-pooler.c-2.eu-central-1.aws.neon.tech",
]);

const MIGRATIONS_FOLDER = path.resolve("migrations");

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

function migrationEntries(): { hash: string; createdAt: number }[] {
  const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string; when: number }[];
  };

  return journal.entries.map((entry) => {
    const sqlText = fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`));
    return {
      hash: crypto.createHash("sha256").update(sqlText).digest("hex"),
      createdAt: entry.when,
    };
  });
}

async function tableExists(client: pg.PoolClient, table: string): Promise<boolean> {
  const result = await client.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
  return result.rows[0]?.name != null;
}

async function baseline(client: pg.PoolClient): Promise<void> {
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
  const lastCreatedAt = existing.rows[0]?.created_at;

  for (const entry of migrationEntries()) {
    if (lastCreatedAt != null && Number(lastCreatedAt) >= entry.createdAt) {
      continue;
    }
    await client.query(
      'INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)',
      [entry.hash, entry.createdAt],
    );
  }
}

async function main(): Promise<void> {
  const host = databaseHost();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
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

    if (present.length === APP_TABLES.length) {
      await baseline(client);
      console.log(`Baselined existing schema on dev host ${host}. SQL was not replayed.`);
      return;
    }

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log(`Applied migrations on empty dev host ${host}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Migration failed";
  console.error(message);
  process.exit(1);
});
