import bcrypt from "bcrypt";
import request from "supertest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../db";
import { inventory, users } from "@shared/schema";
import { createApp } from "../app";
import type { Express } from "express";

const PASSWORD = "test-password-1";
const BISON = "Bison Den";
const TRAIL = "Trailblazer Café";

let app: Express;

async function login(username: string) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({
    usernameOrEmail: username,
    password: PASSWORD,
  });
  expect(response.status).toBe(200);
  expect(response.body).not.toHaveProperty("password");
  return agent;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "migrations" });
  await pool.query(`
    TRUNCATE TABLE
      notifications,
      task_completions,
      ingredients,
      sales,
      inventory_logs,
      chat_messages,
      checklist_items,
      weekly_tasks,
      timeline_events,
      menu_items,
      inventory,
      equipment,
      users
    RESTART IDENTITY CASCADE
  `);

  const password = await bcrypt.hash(PASSWORD, 4);
  await db.insert(users).values([
    {
      name: "Employee A",
      email: "employee-a@test.flowops",
      username: "employee-a",
      password,
      role: "employee",
      status: "active",
      establishment: BISON,
      isSystemAdmin: false,
    },
    {
      name: "Employee B",
      email: "employee-b@test.flowops",
      username: "employee-b",
      password,
      role: "employee",
      status: "active",
      establishment: TRAIL,
      isSystemAdmin: false,
    },
    {
      name: "Admin",
      email: "admin@test.flowops",
      username: "admin-user",
      password,
      role: "admin",
      status: "active",
      establishment: "Global",
      isSystemAdmin: false,
    },
  ]);

  await db.insert(inventory).values([
    {
      emoji: "box",
      name: "Lettuce",
      status: "OK",
      establishment: BISON,
      updatedBy: "Test",
    },
    {
      emoji: "tomato",
      name: "Tomato",
      status: "OK",
      establishment: TRAIL,
      updatedBy: "Test",
    },
  ]);

  app = await createApp();
});

afterAll(async () => {
  await pool.end();
});

describe("establishment filters", () => {
  it("returns 401 for inventory and users when there is no session", async () => {
    await request(app).get("/api/inventory").expect(401);
    await request(app).get("/api/users").expect(401);
  });

  it("limits an employee to their own establishment", async () => {
    const employee = await login("employee-a");

    const inventoryResponse = await employee.get("/api/inventory").expect(200);
    expect(inventoryResponse.body).toHaveLength(1);
    expect(inventoryResponse.body[0].establishment).toBe(BISON);
    expect(inventoryResponse.body[0].name).toBe("Lettuce");

    const usersResponse = await employee.get("/api/users").expect(200);
    const establishments = usersResponse.body.map((user: { establishment: string }) => user.establishment);
    expect(establishments).toContain(BISON);
    expect(establishments).not.toContain(TRAIL);
    for (const user of usersResponse.body) {
      expect(user).not.toHaveProperty("password");
    }
  });

  it("does not let an employee delete inventory from another establishment", async () => {
    const owner = await login("employee-a");
    const items = await owner.get("/api/inventory").expect(200);
    const id = items.body[0].id as string;

    const other = await login("employee-b");
    await other.delete(`/api/inventory/${id}`).expect(404);

    const again = await owner.get("/api/inventory").expect(200);
    expect(again.body).toHaveLength(1);
    await owner.get("/api/does-not-exist").expect(404);
  });

  it("lets an admin see every establishment", async () => {
    const admin = await login("admin-user");

    const inventoryResponse = await admin.get("/api/inventory").expect(200);
    const names = inventoryResponse.body.map((item: { name: string }) => item.name).sort();
    expect(names).toEqual(["Lettuce", "Tomato"]);

    const usersResponse = await admin.get("/api/users").expect(200);
    const usernames = usersResponse.body.map((user: { username: string }) => user.username).sort();
    expect(usernames).toEqual(["admin-user", "employee-a", "employee-b"]);
  });
});

describe("registration allowlist", () => {
  it("rejects a client that tries to set role, status, or isSystemAdmin", async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "Hacker",
      email: "hacker@test.flowops",
      username: "hacker",
      password: PASSWORD,
      establishment: BISON,
      role: "admin",
      status: "active",
      isSystemAdmin: true,
    });

    expect(response.status).toBe(400);
  });
});
