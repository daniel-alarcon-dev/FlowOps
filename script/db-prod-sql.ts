import path from "node:path";
import { readMigrationFiles, type MigrationFile } from "./migration-files";

/**
 * Prints SQL for a human to run in production. This file never opens a connection.
 *
 *   npm run db:prod-sql -- --baseline
 *   npm run db:prod-sql -- --after 0000_baseline
 *
 * `--baseline` creates drizzle.__drizzle_migrations if needed and inserts only
 * the first journal entry. `--after <tag>` prints every later migration and
 * its history row, inside one transaction.
 */

function sqlHash(hash: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error("Migration hash is not a SHA-256 hex digest");
  }
  return `'${hash}'`;
}

function sqlTimestamp(createdAt: number): string {
  if (!Number.isSafeInteger(createdAt)) {
    throw new Error(`Migration created_at is not a safe integer: ${createdAt}`);
  }
  return String(createdAt);
}

function insertRow(file: MigrationFile): string {
  return `INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES (${sqlHash(file.hash)}, ${sqlTimestamp(file.createdAt)});`;
}

function renderBaseline(files: MigrationFile[]): string {
  const first = files[0];
  if (!first) {
    throw new Error("Migration journal is empty");
  }

  return [
    "BEGIN;",
    "",
    `-- Mark only ${first.tag} as applied. created_at=${first.createdAt}`,
    "CREATE SCHEMA IF NOT EXISTS drizzle;",
    "",
    "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (",
    "  id SERIAL PRIMARY KEY,",
    "  hash text NOT NULL,",
    "  created_at bigint",
    ");",
    "",
    insertRow(first),
    "",
    "COMMIT;",
    "",
  ].join("\n");
}

function renderAfter(files: MigrationFile[], tag: string): string {
  const index = files.findIndex((file) => file.tag === tag);
  if (index < 0) {
    const known = files.map((file) => file.tag).join(", ");
    throw new Error(`Unknown migration ${tag}. Known tags: ${known}`);
  }

  const pending = files.slice(index + 1);
  const lines = ["BEGIN;", ""];
  if (pending.length === 0) {
    lines.push(`-- No migrations after ${tag}.`, "", "COMMIT;", "");
    return lines.join("\n");
  }

  for (const file of pending) {
    lines.push(`-- ${file.tag}`);
    lines.push(file.sql.trimEnd());
    lines.push("");
    lines.push(insertRow(file));
    lines.push("");
  }
  lines.push("COMMIT;", "");
  return lines.join("\n");
}

export function renderProdSql(args: readonly string[]): string {
  const files = readMigrationFiles();
  if (args.length === 1 && args[0] === "--baseline") {
    return renderBaseline(files);
  }
  if (args.length === 2 && args[0] === "--after") {
    const tag = args[1];
    if (!tag) {
      throw new Error("Usage: npm run db:prod-sql -- --baseline | --after <migration-tag>");
    }
    return renderAfter(files, tag);
  }
  throw new Error("Usage: npm run db:prod-sql -- --baseline | --after <migration-tag>");
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry != null && path.basename(entry) === "db-prod-sql.ts";
}

if (isDirectRun()) {
  try {
    process.stdout.write(renderProdSql(process.argv.slice(2)));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not render production SQL";
    console.error(message);
    process.exit(1);
  }
}
