import { describe, expect, it } from "vitest";
import { readMigrationFiles } from "../../script/migration-files";
import { renderProdSql } from "../../script/db-prod-sql";

describe("production SQL", () => {
  it("prints the baseline insert without a connection string", () => {
    const files = readMigrationFiles();
    const sql = renderProdSql(["--baseline"]);
    const databaseUrl = process.env.DATABASE_URL;

    expect(sql.startsWith("BEGIN;\n")).toBe(true);
    expect(sql.endsWith("COMMIT;\n")).toBe(true);
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS drizzle;");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations");
    expect(sql).toContain(files[0]?.hash);
    expect(sql).toContain("1794659956205");
    expect(sql.match(/INSERT INTO drizzle\.__drizzle_migrations/g)).toHaveLength(1);
    expect(sql).not.toContain("1794664593517");
    expect(sql).not.toContain("OPERATIONAL");
    if (databaseUrl) expect(sql).not.toContain(databaseUrl);
  });

  it("prints later migrations and their history rows in one transaction", () => {
    const files = readMigrationFiles();
    const sql = renderProdSql(["--after", "0000_baseline"]);

    expect(sql.startsWith("BEGIN;\n")).toBe(true);
    expect(sql.endsWith("COMMIT;\n")).toBe(true);
    expect(sql).toContain('-- 0001_f1_access');
    expect(sql).toContain('ADD COLUMN "location"');
    expect(sql).toContain(files[1]?.hash);
    expect(sql).toContain("1794664593517");
    expect(sql).toContain('-- 0002_equipment_status');
    expect(sql).toContain("OPERATIONAL");
    expect(sql).toContain("MAINTENANCE");
    expect(sql).toContain(files[2]?.hash);
    expect(sql).toContain(String(files[2]?.createdAt));
    expect(sql.match(/INSERT INTO drizzle\.__drizzle_migrations/g)).toHaveLength(2);
    expect(sql).not.toContain('CREATE TABLE "users"');

    const onlyStatus = renderProdSql(["--after", "0001_f1_access"]);
    expect(onlyStatus).toContain("OPERATIONAL");
    expect(onlyStatus).not.toContain('ADD COLUMN "location"');
    expect(onlyStatus.match(/INSERT INTO drizzle\.__drizzle_migrations/g)).toHaveLength(1);

    const none = renderProdSql(["--after", "0002_equipment_status"]);
    expect(none).toContain("No migrations after 0002_equipment_status");
    expect(none).not.toContain("INSERT INTO");
  });

  it("rejects unknown arguments", () => {
    expect(() => renderProdSql([])).toThrow(/Usage/);
    expect(() => renderProdSql(["--after"])).toThrow(/Usage/);
    expect(() => renderProdSql(["--baseline", "extra"])).toThrow(/Usage/);
    expect(() => renderProdSql(["--after", "not_a_migration"])).toThrow(/Unknown migration/);
  });
});
