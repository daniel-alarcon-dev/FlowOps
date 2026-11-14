import fs from "node:fs";
import path from "node:path";
import { assertTestDatabaseUrl } from "./guard";

const fromEnv = process.env.TEST_DATABASE_URL?.trim();
const urlFile = path.resolve(".test-db-url");
const databaseUrl = fromEnv || (fs.existsSync(urlFile) ? fs.readFileSync(urlFile, "utf8").trim() : "");

if (!databaseUrl) {
  throw new Error(
    "No test database. Set TEST_DATABASE_URL to a Neon test branch, or run npm test so a local Postgres starts.",
  );
}

process.env.DATABASE_URL = assertTestDatabaseUrl(databaseUrl);
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-session-secret";
}
process.env.NODE_ENV = "test";
process.env.SEED_DEMO = "false";
