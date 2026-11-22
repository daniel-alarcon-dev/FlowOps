import bcrypt from "bcrypt";
import request from "supertest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../db";
import { users } from "@shared/schema";
import { createApp } from "../app";
import type { Express } from "express";

const PASSWORD = "test-password-1";
const BISON = "Bison Den";

let app: Express;

async function login() {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({
    usernameOrEmail: "editor",
    password: PASSWORD,
  });
  expect(response.status).toBe(200);
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
  await db.insert(users).values({
    name: "Editor",
    email: "editor@test.flowops",
    username: "editor",
    password,
    role: "manager",
    status: "active",
    establishment: BISON,
    isSystemAdmin: false,
  });

  app = await createApp();
});

afterAll(async () => {
  await pool.end();
});

describe("inventory icon and quantity log", () => {
  it("accepts a short emoji or an https or data:image icon, and logs one quantity change", async () => {
    const editor = await login();
    const created = await editor.post("/api/inventory").send({
      name: "Lettuce",
      emoji: "🥬",
      quantity: 2,
      unit: "units",
      status: "OK",
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const httpsIcon = "https://cdn.example.com/lettuce.png";
    const withUrl = await editor.patch(`/api/inventory/${id}`).send({ emoji: httpsIcon });
    expect(withUrl.status).toBe(200);
    expect(withUrl.body.emoji).toBe(httpsIcon);

    const dataIcon = "data:image/png;base64,iVBORw0KGgo=";
    const withData = await editor.patch(`/api/inventory/${id}`).send({ emoji: dataIcon });
    expect(withData.status).toBe(200);
    expect(withData.body.emoji).toBe(dataIcon);

    const shortIcon = await editor.patch(`/api/inventory/${id}`).send({ emoji: "x".repeat(16) });
    expect(shortIcon.status).toBe(200);

    const tooLong = await editor.patch(`/api/inventory/${id}`).send({ emoji: "x".repeat(17) });
    expect(tooLong.status).toBe(400);

    const httpIcon = await editor.patch(`/api/inventory/${id}`).send({
      emoji: "http://cdn.example.com/lettuce.png",
    });
    expect(httpIcon.status).toBe(400);

    const longHttps = `https://cdn.example.com/${"a".repeat(2048)}`;
    expect(longHttps.length).toBeGreaterThan(2048);
    const hugeUrl = await editor.patch(`/api/inventory/${id}`).send({ emoji: longHttps });
    expect(hugeUrl.status).toBe(400);

    const updated = await editor.patch(`/api/inventory/${id}`).send({ quantity: 7 });
    expect(updated.status).toBe(200);
    expect(updated.body.quantity).toBe(7);

    const logs = await editor.get("/api/inventory-logs").expect(200);
    const forItem = logs.body.filter((log: { itemName: string }) => log.itemName === "Lettuce");
    expect(forItem).toHaveLength(1);
    expect(forItem[0].change).toBe(5);
    expect(forItem[0].reason).toBe("Adjustment");
  });
});

describe("equipment status", () => {
  it("accepts Working, Attention, and Broken, and rejects the legacy names", async () => {
    const editor = await login();
    const created = await editor.post("/api/equipment").send({
      name: "Fryer",
      location: "Kitchen",
      status: "Working",
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    for (const status of ["OPERATIONAL", "MAINTENANCE", "BROKEN"]) {
      const rejected = await editor.patch(`/api/equipment/${id}`).send({ status });
      expect(rejected.status).toBe(400);
    }

    for (const status of ["Attention", "Broken", "Working"]) {
      const accepted = await editor.patch(`/api/equipment/${id}`).send({ status });
      expect(accepted.status).toBe(200);
      expect(accepted.body.status).toBe(status);
    }
  });
});
