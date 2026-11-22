import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baselineIfUntracked } from "../../script/db-migrate";
import { MIGRATIONS_FOLDER, readMigrationFiles } from "../../script/migration-files";

const PORT = 54330;
const PASSWORD = "postgres";
const DATABASE = "flowops_baseline";

let server: EmbeddedPostgres | undefined;
let dataDir: string | undefined;
let pool: pg.Pool | undefined;

async function applySql(client: pg.PoolClient, sql: string): Promise<void> {
  for (const part of sql.split("--> statement-breakpoint")) {
    const statement = part.trim();
    if (!statement) continue;
    await client.query(statement);
  }
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowops-baseline-"));
  server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: PASSWORD,
    port: PORT,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await server.initialise();
  await server.start();
  await server.createDatabase(DATABASE);
  pool = new pg.Pool({
    connectionString: `postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`,
  });
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (server) await server.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}, 60_000);

describe("baseline without drizzle history", () => {
  it("marks only 0000 and lets migrate apply the later files", async () => {
    const files = readMigrationFiles();
    expect(files[0]?.tag).toBe("0000_baseline");
    expect(files[0]?.createdAt).toBe(1794659956205);

    const client = await pool!.connect();
    try {
      const skipped = await baselineIfUntracked(client);
      expect(skipped).toBe(false);

      await applySql(client, files[0].sql);
      await client.query(`
        INSERT INTO equipment (name, status, establishment) VALUES
          ('Legacy fryer', 'OPERATIONAL', 'Bison Den'),
          ('Legacy fridge', 'MAINTENANCE', 'Bison Den'),
          ('Legacy grill', 'BROKEN', 'Bison Den'),
          ('Current oven', 'Working', 'Bison Den')
      `);

      const baselined = await baselineIfUntracked(client);
      expect(baselined).toBe(true);

      const recorded = await client.query(
        "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
      );
      expect(recorded.rows).toHaveLength(1);
      expect(recorded.rows[0].hash).toBe(files[0].hash);
      expect(Number(recorded.rows[0].created_at)).toBe(files[0].createdAt);
    } finally {
      client.release();
    }

    await migrate(drizzle(pool!), { migrationsFolder: MIGRATIONS_FOLDER });

    const applied = await pool!.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    expect(applied.rows).toHaveLength(files.length);
    applied.rows.forEach((row: { hash: string; created_at: string }, index: number) => {
      expect(row.hash).toBe(files[index]?.hash);
      expect(Number(row.created_at)).toBe(files[index]?.createdAt);
    });

    const location = await pool!.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'equipment' AND column_name = 'location'
    `);
    expect(location.rows).toHaveLength(1);

    const statuses = await pool!.query("SELECT name, status FROM equipment ORDER BY name");
    expect(statuses.rows).toEqual([
      { name: "Current oven", status: "Working" },
      { name: "Legacy fridge", status: "Attention" },
      { name: "Legacy fryer", status: "Working" },
      { name: "Legacy grill", status: "Broken" },
    ]);
  }, 60_000);
});
