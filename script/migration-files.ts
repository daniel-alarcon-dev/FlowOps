import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIGRATIONS_FOLDER = path.join(root, "migrations");

export interface MigrationFile {
  tag: string;
  hash: string;
  createdAt: number;
  sql: string;
}

/**
 * Reads the Drizzle journal in order. The hash matches `drizzle-orm`'s migrator:
 * SHA-256 of the SQL file contents.
 */
export function readMigrationFiles(folder: string = MIGRATIONS_FOLDER): MigrationFile[] {
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string; when: number }[];
  };

  return journal.entries.map((entry) => {
    const sql = fs.readFileSync(path.join(folder, `${entry.tag}.sql`)).toString();
    return {
      tag: entry.tag,
      hash: crypto.createHash("sha256").update(sql).digest("hex"),
      createdAt: entry.when,
      sql,
    };
  });
}
