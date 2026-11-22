/** Tests may open only a local Postgres. Neon and every other host are refused. */
const ALLOWED_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function assertTestDatabaseUrl(databaseUrl: string): string {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("Test database URL is not a valid URL");
  }

  if (!ALLOWED_DATABASE_HOSTS.has(host)) {
    throw new Error(`Refusing to run tests against ${host}. Tests only allow localhost and 127.0.0.1`);
  }

  return databaseUrl;
}
