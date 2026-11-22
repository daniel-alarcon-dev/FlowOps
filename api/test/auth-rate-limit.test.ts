import bcrypt from "bcrypt";
import request from "supertest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../db";
import { users } from "@shared/schema";
import { createApp } from "../app";
import type { Express } from "express";

const PASSWORD = "test-password-1";

let app: Express;

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "migrations" });
  await pool.query(`TRUNCATE TABLE users RESTART IDENTITY CASCADE`);

  const password = await bcrypt.hash(PASSWORD, 4);
  await db.insert(users).values({
    name: "Rate User",
    email: "rate-user@test.flowops",
    username: "rate-user",
    password,
    role: "employee",
    status: "active",
    establishment: "Bison Den",
    isSystemAdmin: false,
  });

  app = await createApp();
});

afterAll(async () => {
  await pool.end();
});

describe("auth rate limit", () => {
  it("does not count successful logins and returns 429 after 20 wrong passwords", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(app).post("/api/auth/login").send({
        usernameOrEmail: "rate-user",
        password: PASSWORD,
      });
      expect(response.status).toBe(200);
      await settle();
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(app).post("/api/auth/login").send({
        usernameOrEmail: "rate-user",
        password: "wrong-password",
      });
      expect(response.status).toBe(401);
      await settle();
    }

    const blocked = await request(app).post("/api/auth/login").send({
      usernameOrEmail: "rate-user",
      password: "wrong-password",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe("Too many attempts. Try again later.");
  });
});
