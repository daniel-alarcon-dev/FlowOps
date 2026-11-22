import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "./guard";

describe("test database guard", () => {
  it("allows localhost and 127.0.0.1", () => {
    const loopback = "postgresql://postgres:postgres@127.0.0.1:5432/flowops_test";
    const local = "postgresql://postgres:postgres@localhost:5432/flowops_test";
    expect(assertTestDatabaseUrl(loopback)).toBe(loopback);
    expect(assertTestDatabaseUrl(local)).toBe(local);
  });

  it("refuses Neon, other hosts, and IPv6 localhost", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://user:password@ep-dark-dream-ag27hyw0-pooler.c-2.eu-central-1.aws.neon.tech/neondb",
      ),
    ).toThrow(/127\.0\.0\.1/);
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://user:password@ep-odd-cloud-agbhx1gu-pooler.c-2.eu-central-1.aws.neon.tech/neondb",
      ),
    ).toThrow(/Refusing/);
    expect(() => assertTestDatabaseUrl("postgresql://user:password@example.com/flowops")).toThrow(/Refusing/);
    expect(() => assertTestDatabaseUrl("postgresql://postgres:postgres@[::1]:5432/flowops_test")).toThrow(/Refusing/);
  });

  it("refuses a value that is not a URL", () => {
    expect(() => assertTestDatabaseUrl("not a url")).toThrow(/not a valid URL/);
  });
});
