/** Dev and the old production endpoint. Tests must never open either one. */
const BLOCKED_DATABASE_HOSTS = new Set([
  "ep-odd-cloud-agbhx1gu-pooler.c-2.eu-central-1.aws.neon.tech",
  "ep-dark-dream-ag27hyw0-pooler.c-2.eu-central-1.aws.neon.tech",
]);

export function assertTestDatabaseUrl(databaseUrl: string): string {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("Test database URL is not a valid URL");
  }

  if (BLOCKED_DATABASE_HOSTS.has(host)) {
    throw new Error(`Refusing to run tests against ${host}`);
  }

  return databaseUrl;
}
