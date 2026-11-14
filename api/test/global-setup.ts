import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { assertTestDatabaseUrl } from "./guard";

const URL_FILE = path.resolve(".test-db-url");
const PORT = 54329;
const PASSWORD = "postgres";
const DATABASE = "flowops_test";

let server: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

export async function setup(): Promise<void> {
  if (process.env.TEST_DATABASE_URL?.trim()) {
    assertTestDatabaseUrl(process.env.TEST_DATABASE_URL.trim());
    return;
  }

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowops-pg-"));
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

  const url = `postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`;
  fs.writeFileSync(URL_FILE, assertTestDatabaseUrl(url), "utf8");
}

export async function teardown(): Promise<void> {
  if (server) {
    await server.stop();
  }
  if (dataDir) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  fs.rmSync(URL_FILE, { force: true });
}
