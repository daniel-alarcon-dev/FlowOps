import { randomBytes } from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import type { Express, NextFunction, Request, Response } from "express";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import { 
  registerUserSchema,
  adminCreateUserSchema,
  updateUserSchema,
  managerUpdateUserSchema,
  adminUpdateUserSchema,
  insertInventorySchema,
  insertEquipmentSchema,
  insertChecklistItemSchema,
  insertWeeklyTaskSchema,
  insertTaskCompletionSchema,
  insertChatMessageSchema,
  insertTimelineEventSchema,
  insertMenuItemSchema,
  insertIngredientSchema,
  sales,              
  insertSaleSchema,
  insertInventoryLogSchema,
  saleBatchSchema,
  inventoryLogs
} from "@shared/schema";
import { z } from "zod";
import { db } from "./db";
import { eq, and, asc, desc, gte, lte, inArray, sql } from "drizzle-orm";
import { canAccessEstablishment, convertQuantity, hasLowerRank, isGlobalUser } from "@shared/access";
import { asyncHandler } from "./errors";
import { users, inventory, equipment, checklistItems, weeklyTasks, taskCompletions, chatMessages, timelineEvents, menuItems, ingredients, notifications, type User } from "@shared/schema";

const SALT_ROUNDS = 10;

/** Express 5 types route params as `string | string[]`. These routes use a single `:id`. */
function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) return value[0];
  const error = new Error("Missing route parameter") as Error & { statusCode: number };
  error.statusCode = 400;
  throw error;
}

type PublicUser = Omit<User, "password">;

interface SessionUser {
  id: string;
  name: string;
  role: string;
  establishment: string;
  isSystemAdmin: boolean;
}

declare module 'express-session' {
  interface SessionData {
    user?: PublicUser;
  }
}

/** User shape safe for JSON responses and the session store. The password hash stays on the server. */
function toPublicUser(user: User): PublicUser {
  const { password: _password, ...publicUser } = user;
  return publicUser;
}

function isSystemAdminUser(user: SessionUser | undefined): boolean {
  return user?.isSystemAdmin === true;
}

function canManageUsers(user: SessionUser | undefined): boolean {
  return user?.role === 'manager' || isSystemAdminUser(user);
}

function isGlobalAdmin(user: SessionUser | undefined): boolean {
  return isGlobalUser(user);
}

function canAssignUserRole(user: SessionUser | undefined): boolean {
  return isGlobalAdmin(user) || user?.role === 'manager';
}

function canReviewUser(actor: SessionUser, target: { role: string; establishment: string; isSystemAdmin: boolean }): boolean {
  if (target.isSystemAdmin && !isSystemAdminUser(actor)) return false;
  if (!canAccessEstablishment(actor, target.establishment)) return false;
  if (isSystemAdminUser(actor)) return true;
  return hasLowerRank(actor.role, target.role);
}

function toVisibleUser(user: User, actor: SessionUser) {
  const publicUser = toPublicUser(user);
  if (actor.id === user.id || isGlobalUser(actor) || canManageUsers(actor)) return publicUser;
  const { email: _email, phoneNumber: _phone, ...rest } = publicUser;
  return rest;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  next();
}

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

type AllowedImageExtension = ".jpg" | ".png" | ".webp";

function hasSignature(buffer: Buffer, signature: Buffer): boolean {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

/** JPEG, PNG, or WebP from the file bytes. The client MIME type and name are ignored. */
function extensionFromImageSignature(buffer: Buffer): AllowedImageExtension | null {
  if (hasSignature(buffer, JPEG_SIGNATURE)) return ".jpg";
  if (hasSignature(buffer, PNG_SIGNATURE)) return ".png";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return ".webp";
  }
  return null;
}

export async function registerRoutes(app: Express): Promise<void> {
  app.use("/api", asyncHandler(async (req, res, next) => {
    if (req.path === "/auth/login" || req.path === "/auth/register" || req.path === "/api/auth/login" || req.path === "/api/auth/register") {
      next();
      return;
    }
    if (!req.session.user) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    const fresh = await storage.getUser(req.session.user.id);
    if (!fresh || fresh.status !== "active") {
      req.session.user = undefined;
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    req.session.user = toPublicUser(fresh);
    next();
  }));

  // ==================== AUTH ROUTES ====================
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const validatedData = registerUserSchema.parse(req.body);

      const existingUser = await storage.getUserByUsername(validatedData.username);
      const existingEmail = await storage.getUserByEmail(validatedData.email);

      if (existingUser) return res.status(400).json({ message: "Username already exists" });
      if (existingEmail) return res.status(400).json({ message: "Email already exists" });

      const hashedPassword = await bcrypt.hash(validatedData.password, SALT_ROUNDS);

      const user = await storage.createUser({
        name: validatedData.name,
        email: validatedData.email,
        username: validatedData.username,
        password: hashedPassword,
        establishment: validatedData.establishment,
        phoneNumber: validatedData.phoneNumber,
        status: 'pending',
        role: 'employee',
        isSystemAdmin: false,
      });

      try {
        const systemAdmins = await storage.getSystemAdmins();
        for (const admin of systemAdmins) {
          await storage.createNotification({
            recipientId: admin.id,
            type: 'user_registration',
            title: 'New User Registration',
            message: `${user.name} (${user.username}) requested access`,
            relatedUserId: user.id,
            isRead: false
          });
        }
      } catch {}

      res.status(201).json(toPublicUser(user));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { usernameOrEmail, password } = req.body;
      if (!usernameOrEmail || !password) return res.status(400).json({ message: "Username/email and password required" });

      let user = await storage.getUserByUsername(usernameOrEmail.trim());
      if (!user) user = await storage.getUserByEmail(usernameOrEmail.trim());
      if (!user) return res.status(401).json({ message: "Invalid credentials" });

      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) return res.status(401).json({ message: "Invalid credentials" });

      if (user.status === 'pending') return res.status(403).json({ message: "Account pending approval" });
      if (user.status === 'removed') return res.status(403).json({ message: "Account deactivated" });

      const publicUser = toPublicUser(user);
      req.session.user = publicUser;
      res.json(publicUser);
    } catch {
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ message: "Logged out successfully" }));
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(req.session.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(toPublicUser(user));
  });

  // ==================== USERS MANAGEMENT ====================
  // List all users
  app.get("/api/users", async (req, res) => {
    const actor = req.session.user;
    if (!actor) return res.sendStatus(401);
    let query = db.select().from(users);
    if (!isGlobalUser(actor)) {
      query.where(eq(users.establishment, actor.establishment));
    }
    const allUsers = await query;
    res.json(allUsers.map((user) => toVisibleUser(user, actor)));
  });

  // List pending users
  app.get("/api/users/pending", async (req, res) => {
    const actor = req.session.user;
    if (!actor) return res.sendStatus(401);

    const conditions = [eq(users.status, 'pending')];
    if (!isGlobalUser(actor)) {
      conditions.push(eq(users.establishment, actor.establishment));
    }

    const pendingUsers = await db.select().from(users).where(and(...conditions));
    const filteredUsers = pendingUsers.filter((user) => canReviewUser(actor, user));
    res.json(filteredUsers.map((user) => toVisibleUser(user, actor)));
  });

  // Approve user. The role already stored on the account is the one being approved.
  app.post("/api/users/:id/approve", async (req, res) => {
    const actor = req.session.user;
    if (!actor) return res.sendStatus(401);
    const [targetUser] = await db.select().from(users).where(eq(users.id, routeParam(req, "id"))).limit(1);
    if (!targetUser || !canReviewUser(actor, targetUser)) return res.status(404).json({ message: "User not found" });

    await db.update(users).set({ status: 'active' }).where(eq(users.id, targetUser.id));
    await storage.createTimelineEvent({
      text: `Approved ${targetUser.name} as ${targetUser.role}`,
      establishment: targetUser.establishment,
      author: actor.name,
      authorRole: actor.role,
      type: 'success'
    });

    res.json({ message: "User approved" });
  });

  // Reject user
  app.delete("/api/users/:id/reject", async (req, res) => {
    const actor = req.session.user;
    if (!actor) return res.sendStatus(401);
    const [targetUser] = await db.select().from(users).where(eq(users.id, routeParam(req, "id"))).limit(1);
    if (!targetUser || !canReviewUser(actor, targetUser)) return res.status(404).json({ message: "User not found" });

    await db.update(users).set({ status: 'removed' }).where(eq(users.id, targetUser.id));
    res.json({ message: "User rejected" });
  });

  app.patch("/api/users/:id", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });

    const actor = req.session.user;
    const targetId = routeParam(req, "id");

    try {
      const [existing] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!existing) return res.status(404).json({ message: "User not found" });

      if (existing.isSystemAdmin && !isSystemAdminUser(actor)) {
        return res.status(403).json({ message: "Only a system admin can edit a system admin" });
      }

      if (!isGlobalAdmin(actor)) {
        if (existing.establishment !== actor.establishment) {
          return res.status(403).json({ message: "Cannot update users from another establishment" });
        }
        if (!hasLowerRank(actor.role, existing.role)) {
          return res.status(403).json({ message: "You can only edit users of a lower rank" });
        }
      }

      const schema = isGlobalAdmin(actor)
        ? adminUpdateUserSchema
        : canAssignUserRole(actor)
          ? managerUpdateUserSchema
          : updateUserSchema;
      const updates = schema.parse(req.body);

      if ("role" in updates && updates.role !== undefined && actor.id === targetId) {
        return res.status(403).json({ message: "You cannot change your own role" });
      }

      if (updates.email && updates.email !== existing.email) {
        const existingEmail = await storage.getUserByEmail(updates.email);
        if (existingEmail) return res.status(400).json({ message: "Email already exists" });
      }

      const user = await storage.updateUser(targetId, updates);
      if (!user) return res.status(404).json({ message: "User not found" });

      res.json(toPublicUser(user));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      console.error("User update error:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", async (req, res) => {
    const actor = req.session.user;
    if (!actor) return res.status(401).json({ message: "Not authenticated" });
    const [existing] = await db.select().from(users).where(eq(users.id, routeParam(req, "id"))).limit(1);
    if (!existing || !canReviewUser(actor, existing) || existing.id === actor.id) {
      return res.status(404).json({ message: "User not found" });
    }
    await db.update(users).set({ status: "removed" }).where(eq(users.id, existing.id));
    res.json({ message: "User removed" });
  });

  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Keep the bytes in memory until the signature check passes, so a rejected
  // SVG or HTML file is never written under the uploads directory.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AVATAR_MAX_BYTES },
  });

  function receiveAvatar(req: Request, res: Response, next: NextFunction): void {
    upload.single("avatar")(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ message: "Image too large (max 5MB)" });
        return;
      }
      next(err);
    });
  }

  app.post("/api/user/avatar", requireAuth, receiveAvatar, async (req: Request, res: Response) => {
    const sessionUser = req.session.user;
    if (!sessionUser) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const extension = extensionFromImageSignature(req.file.buffer);
    if (!extension) {
      res.status(400).json({ message: "Only JPEG, PNG and WebP images are allowed" });
      return;
    }

    const filename = `avatar-${Date.now()}-${randomBytes(8).toString("hex")}${extension}`;
    const filePath = path.join(uploadDir, filename);
    const fileUrl = `/uploads/${filename}`;

    try {
      await fs.promises.writeFile(filePath, req.file.buffer);

      const [updatedUser] = await db.update(users)
        .set({ avatarUrl: fileUrl })
        .where(eq(users.id, sessionUser.id))
        .returning();

      if (!updatedUser) {
        await fs.promises.unlink(filePath).catch(() => undefined);
        res.status(404).json({ message: "User not found" });
        return;
      }

      const publicUser = toPublicUser(updatedUser);
      req.session.user = publicUser;

      res.json({ success: true, avatarUrl: fileUrl, user: publicUser });
    } catch (error) {
      await fs.promises.unlink(filePath).catch(() => undefined);
      console.error("Avatar upload error:", error);
      res.status(500).json({ message: "Error uploading avatar" });
    }
  });
  
  const inventoryPatchSchema = z.object({
    emoji: z.string().trim().min(1).max(16).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    category: z.string().trim().max(80).nullable().optional(),
    status: z.enum(["OK", "LOW", "OUT"]).optional(),
    quantity: z.number().nonnegative().max(1_000_000).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    costPerUnit: z.number().nonnegative().max(1_000_000).nullable().optional(),
    lowComment: z.string().trim().max(500).nullable().optional(),
  }).strict();

  // ==================== INVENTORY ====================
  app.get("/api/inventory", async (req, res) => {
    const actor = req.session.user;
    if (!actor) return res.sendStatus(401);
    let query = db.select().from(inventory);
    if (!isGlobalUser(actor)) {
      query.where(eq(inventory.establishment, actor.establishment));
    }
    query.orderBy(asc(inventory.name));
    res.json(await query);
  });

  app.post("/api/inventory", async (req, res) => {
    if (!req.session.user) return res.sendStatus(401);
    try {
      const establishment = isSystemAdminUser(req.session.user) && req.body.establishment
        ? req.body.establishment
        : req.session.user.establishment;

      const data = insertInventorySchema.parse({ ...req.body, establishment, updatedBy: req.session.user.name });
      const item = await storage.createInventoryItem(data);
      await storage.createTimelineEvent({ text: `Added new item: ${item.name}`, establishment: item.establishment, author: req.session.user.name, authorRole: req.session.user.role, type: 'info' });

      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Failed to create inventory item" });
    }
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    const actor = req.session.user;
    if (!actor) return res.sendStatus(401);
    try {
      const id = routeParam(req, "id");
      const [existing] = await db.select().from(inventory).where(eq(inventory.id, id)).limit(1);
      if (!existing || !canAccessEstablishment(actor, existing.establishment)) {
        return res.status(404).json({ message: "Item not found" });
      }
      const updates = inventoryPatchSchema.parse(req.body);
      const item = await storage.updateInventoryItem(id, {
        ...updates,
        lastUpdated: new Date(),
        updatedBy: actor.name,
      });
      if (!item) return res.status(404).json({ message: "Item not found" });

      if (updates.quantity !== undefined && updates.quantity !== existing.quantity) {
        await storage.createInventoryLog({
          itemName: item.name,
          change: updates.quantity - Number(existing.quantity ?? 0),
          reason: "Adjustment",
          user: actor.name,
          establishment: existing.establishment,
          inventoryItemId: item.id,
        });
      }

      if (updates.status === "LOW" || updates.status === "OUT") {
        await storage.createTimelineEvent({
          text: `${item.name} marked ${updates.status}`,
          establishment: existing.establishment,
          author: actor.name,
          authorRole: actor.role,
          type: updates.status === "OUT" ? "alert" : "warning",
          comment: updates.lowComment ?? undefined,
        });
      }

      res.json(item);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      console.error("Inventory update error:", error);
      res.status(500).json({ message: "Failed to update inventory item" });
    }
  });

  app.delete("/api/inventory/:id", async (req, res) => {
    const actor = req.session.user;
    if (!actor) return res.sendStatus(401);
    const id = routeParam(req, "id");
    const [existing] = await db.select().from(inventory).where(eq(inventory.id, id)).limit(1);
    if (!existing || !canAccessEstablishment(actor, existing.establishment)) {
      return res.status(404).json({ message: "Item not found" });
    }
    await storage.deleteInventoryItem(id);
    res.json({ message: "Inventory item deleted" });
  });

  // ==================== INVENTORY LOGS ====================
  app.get("/api/inventory-logs", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    
    // Solo mostramos los logs del establecimiento del usuario
    const logs = await storage.getInventoryLogsByEstablishment(req.session.user.establishment);
    res.json(logs);
  });

  app.post("/api/inventory-logs", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    
    try {
      // Forzamos el establishment del usuario logueado por seguridad
      const logData = insertInventoryLogSchema.parse({
        ...req.body,
        user: req.session.user.name,
        establishment: req.session.user.establishment,
      });
      
      const log = await storage.createInventoryLog(logData);
      res.status(201).json(log);
    } catch (error) {
      console.error("Error creating inventory log:", error);
      res.status(500).json({ message: "Failed to create log" });
    }
  });

  // ==================== EQUIPMENT ====================
  app.get("/api/equipment", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    let items;
    if (isSystemAdminUser(req.session.user)) {
      items = await storage.getAllEquipment();
    } else {
      items = await storage.getEquipmentByEstablishment(req.session.user.establishment);
    }
    res.json(items);
  });
  
  app.post("/api/equipment", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const establishment = isSystemAdminUser(req.session.user) && req.body.establishment 
        ? req.body.establishment 
        : req.session.user.establishment;
      
      const data = insertEquipmentSchema.parse({
        ...req.body,
        establishment
      });
      const item = await storage.createEquipmentItem(data);
      
      await storage.createTimelineEvent({
        text: `Added new equipment: ${item.name}`,
        establishment: item.establishment,
        author: req.session.user.name,
        authorRole: req.session.user.role,
        type: 'info'
      });
      
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Failed to create equipment item" });
    }
  });
  
  app.patch("/api/equipment/:id", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const equipmentId = routeParam(req, "id");
    const [existingEquipment] = await db.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
    if (!existingEquipment || !canAccessEstablishment(req.session.user, existingEquipment.establishment)) {
      return res.status(404).json({ message: "Item not found" });
    }
    const equipmentUpdates = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      category: z.string().trim().max(80).nullable().optional(),
      status: z.enum(["Working", "Attention", "Broken"]).optional(),
      lastIssue: z.string().trim().max(500).nullable().optional(),
      location: z.string().trim().max(120).nullable().optional(),
      notes: z.string().trim().max(500).nullable().optional(),
    }).strict().parse(req.body ?? {});
    const item = await storage.updateEquipmentItem(equipmentId, equipmentUpdates);
    if (!item) return res.status(404).json({ message: "Item not found" });
    
    // Log status changes
    if (req.body.status) {
      if (req.body.status === 'Broken') {
        await storage.createTimelineEvent({
          text: `${item.name} reported BROKEN`,
          establishment: req.session.user.establishment,
          author: req.session.user.name,
          authorRole: req.session.user.role,
          type: 'alert',
          comment: req.body.lastIssue
        });
      } else if (req.body.status === 'Attention') {
        await storage.createTimelineEvent({
          text: `${item.name} needs attention`,
          establishment: req.session.user.establishment,
          author: req.session.user.name,
          authorRole: req.session.user.role,
          type: 'warning'
        });
      } else if (req.body.status === 'Working') {
        await storage.createTimelineEvent({
          text: `${item.name} fixed/working`,
          establishment: req.session.user.establishment,
          author: req.session.user.name,
          authorRole: req.session.user.role,
          type: 'success'
        });
      }
    }
    
    res.json(item);
  });
  
  app.delete("/api/equipment/:id", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    await storage.deleteEquipmentItem(routeParam(req, "id"));
    res.json({ message: "Equipment item deleted" });
  });

  // ==================== CHECKLISTS ====================
  app.get("/api/checklists", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const listType = req.query.listType as string | undefined;
    let items;
    if (isSystemAdminUser(req.session.user)) {
      items = await storage.getAllChecklistItems(listType);
    } else {
      items = await storage.getChecklistItemsByEstablishment(req.session.user.establishment, listType);
    }
    res.json(items);
  });
  
  app.post("/api/checklists", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const establishment = isSystemAdminUser(req.session.user) && req.body.establishment 
        ? req.body.establishment 
        : req.session.user.establishment;
      
      const data = insertChecklistItemSchema.parse({
        ...req.body,
        establishment
      });
      const item = await storage.createChecklistItem(data);
      
      await storage.createTimelineEvent({
        text: `New ${data.listType} item: ${item.text} (Assigned to ${item.assignedTo})`,
        establishment: item.establishment,
        author: req.session.user.name,
        authorRole: req.session.user.role,
        type: 'info'
      });
      
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Failed to create checklist item" });
    }
  });
  
  app.patch("/api/checklists/:id", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const updates = { ...req.body };
    
    if (updates.completed === true && !updates.completedBy) {
      updates.completedBy = req.session.user.name;
      updates.completedAt = new Date();
    }
    
    const item = await storage.updateChecklistItem(routeParam(req, "id"), updates);
    if (!item) return res.status(404).json({ message: "Item not found" });
    
    if (updates.completed === true) {
      await storage.createTimelineEvent({
        text: `${item.listType} Checklist: ${item.text} completed`,
        establishment: req.session.user.establishment,
        author: req.session.user.name,
        authorRole: req.session.user.role,
        type: 'success'
      });
    }
    
    res.json(item);
  });
  
  app.delete("/api/checklists/:id", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    await storage.deleteChecklistItem(routeParam(req, "id"));
    res.json({ message: "Checklist item deleted" });
  });

  // ==================== WEEKLY TASKS ====================
  app.get("/api/tasks", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    
    let tasks;
    if (isSystemAdminUser(req.session.user)) {
      tasks = await storage.getAllWeeklyTasks();
    } else {
      tasks = await storage.getWeeklyTasksByEstablishment(req.session.user.establishment);
    }

    const taskIds = tasks.map((task) => task.id);
    const historyRows = taskIds.length === 0
      ? []
      : await db.select().from(taskCompletions).where(inArray(taskCompletions.taskId, taskIds)).orderBy(desc(taskCompletions.completedAt));
    const historyByTask = new Map<string, typeof historyRows>();
    for (const row of historyRows) {
      const list = historyByTask.get(row.taskId) ?? [];
      list.push(row);
      historyByTask.set(row.taskId, list);
    }
    const tasksWithHistory = tasks.map((task) => ({
      ...task,
      history: (historyByTask.get(task.id) ?? []).slice(0, 20),
    }));

    res.json(tasksWithHistory);
  });
  
  app.post("/api/tasks", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const establishment = isSystemAdminUser(req.session.user) && req.body.establishment 
        ? req.body.establishment 
        : req.session.user.establishment;
      
      const data = insertWeeklyTaskSchema.parse({
        ...req.body,
        establishment
      });
      const task = await storage.createWeeklyTask(data);
      
      await storage.createTimelineEvent({
        text: `New Weekly Task: ${task.text} (Assigned to ${task.assignedTo})`,
        establishment: task.establishment,
        author: req.session.user.name,
        authorRole: req.session.user.role,
        type: 'info'
      });
      
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Failed to create task" });
    }
  });
  
  app.patch("/api/tasks/:id", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const updates = { ...req.body };
    
    if (updates.completed === true) {
      updates.completedAt = new Date();
    }
    
    const task = await storage.updateWeeklyTask(routeParam(req, "id"), updates);
    if (!task) return res.status(404).json({ message: "Task not found" });
    
    res.json(task);
  });
  
  app.delete("/api/tasks/:id", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    await storage.deleteWeeklyTask(routeParam(req, "id"));
    res.json({ message: "Task deleted" });
  });

  // ==================== TASK COMPLETIONS ====================
  app.post("/api/tasks/:id/complete", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { photo } = req.body;
      if (typeof photo !== "string" || photo.length === 0 || photo.length > 2_000_000) {
        return res.status(400).json({ message: "Photo is required" });
      }
      const taskId = routeParam(req, "id");
      const [existingTask] = await db.select().from(weeklyTasks).where(eq(weeklyTasks.id, taskId)).limit(1);
      if (!existingTask || !canAccessEstablishment(req.session.user, existingTask.establishment)) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const completion = await storage.createTaskCompletion({
        taskId,
        completedBy: req.session.user.name,
        photo
      });
      
      const task = await storage.updateWeeklyTask(routeParam(req, "id"), { 
        completed: true,
        completedAt: new Date()
      });
      
      if (task) {
        await storage.createTimelineEvent({
          text: `Weekly task completed: ${task.text} by ${req.session.user.name}`,
          establishment: req.session.user.establishment,
          author: req.session.user.name,
          authorRole: req.session.user.role,
          type: 'success',
          comment: 'Photo proof attached',
          photo
        });
      }
      
      res.status(201).json(completion);
    } catch (error) {
      console.error("Task completion error:", error);
      res.status(500).json({ message: "Failed to complete task" });
    }
  });
  
  app.get("/api/tasks/:id/completions", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const completions = await storage.getTaskCompletions(routeParam(req, "id"));
    res.json(completions);
  });

  // ==================== CHAT ====================
  app.get("/api/chat", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    let messages;
    if (isSystemAdminUser(req.session.user)) {
      messages = await storage.getAllChatMessages();
    } else {
      messages = await storage.getChatMessagesByEstablishment(req.session.user.establishment);
    }
    res.json(messages);
  });
  
  app.post("/api/chat", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const establishment = isSystemAdminUser(req.session.user) && req.body.establishment 
        ? req.body.establishment 
        : req.session.user.establishment;
      
      const data = insertChatMessageSchema.parse({
        ...req.body,
        establishment,
        sender: req.session.user.name,
        senderRole: req.session.user.role
      });
      const message = await storage.createChatMessage(data);
      res.status(201).json(message);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // ==================== TIMELINE ====================
  app.get("/api/timeline", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    let events;
    if (isSystemAdminUser(req.session.user)) {
      events = await storage.getAllTimelineEvents();
    } else {
      events = await storage.getTimelineEventsByEstablishment(req.session.user.establishment);
    }
    res.json(events);
  });
  
  app.post("/api/timeline", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    try {
      const establishment = isSystemAdminUser(req.session.user) && req.body.establishment 
        ? req.body.establishment 
        : req.session.user.establishment;
      
      const data = insertTimelineEventSchema.parse({
        ...req.body,
        establishment,
        author: req.session.user.name,
        authorRole: req.session.user.role
      });
      const event = await storage.createTimelineEvent(data);
      res.status(201).json(event);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Failed to create timeline event" });
    }
  });

  // ==================== MENU ====================
  app.get("/api/menu", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    let items;
    if (isSystemAdminUser(req.session.user)) {
      items = await storage.getAllMenuItems();
    } else {
      items = await storage.getMenuItemsByEstablishment(req.session.user.establishment);
    }
    
    const itemsWithIngredients = await Promise.all(
      items.map(async (item) => {
        const ingredients = await storage.getIngredientsByMenuItem(item.id);
        return { ...item, ingredients };
      })
    );
    
    res.json(itemsWithIngredients);
  });
  
  app.post("/api/menu", async (req: Request, res: Response) => {
    if (!req.session.user || (!isSystemAdminUser(req.session.user) && req.session.user.role !== 'manager')) {
      return res.status(403).json({ message: "Only managers can add menu items" });
    }
    try {
      const establishment = isSystemAdminUser(req.session.user) && req.body.establishment 
        ? req.body.establishment 
        : req.session.user.establishment;
      
      const data = insertMenuItemSchema.parse({
        ...req.body,
        establishment
      });
      const item = await storage.createMenuItem(data);
      
      await storage.createTimelineEvent({
        text: `Menu Item Added: ${item.name}`,
        establishment: item.establishment,
        author: req.session.user.name,
        authorRole: req.session.user.role,
        type: 'info'
      });
      
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Failed to create menu item" });
    }
  });
  
  app.patch("/api/menu/:id", async (req: Request, res: Response) => {
    if (!req.session.user || (!isSystemAdminUser(req.session.user) && req.session.user.role !== 'manager')) {
      return res.status(403).json({ message: "Only managers can update menu items" });
    }
    const { name, category } = req.body;
    const updates: { name?: string; category?: string } = {};
    if (name) updates.name = name;
    if (category) updates.category = category;
    
    const item = await storage.updateMenuItem(routeParam(req, "id"), updates);
    if (!item) return res.status(404).json({ message: "Menu item not found" });
    res.json(item);
  });
  
  app.delete("/api/menu/:id", async (req: Request, res: Response) => {
    if (!req.session.user || (!isSystemAdminUser(req.session.user) && req.session.user.role !== 'manager')) {
      return res.status(403).json({ message: "Only managers can delete menu items" });
    }
    await storage.deleteMenuItem(routeParam(req, "id"));
    res.json({ message: "Menu item deleted" });
  });

  // ==================== INGREDIENTS ====================
  app.post("/api/menu/:menuItemId/ingredients", async (req: Request, res: Response) => {
    if (!req.session.user || (!isSystemAdminUser(req.session.user) && req.session.user.role !== 'manager')) {
      return res.status(403).json({ message: "Only managers can add ingredients" });
    }
    try {
      const data = insertIngredientSchema.parse({
        ...req.body,
        menuItemId: routeParam(req, "menuItemId")
      });
      const ingredient = await storage.createIngredient(data);
      res.status(201).json(ingredient);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      res.status(500).json({ message: "Failed to create ingredient" });
    }
  });
  
  app.patch("/api/ingredients/:id", async (req: Request, res: Response) => {
    if (!req.session.user || (!isSystemAdminUser(req.session.user) && req.session.user.role !== 'manager')) {
      return res.status(403).json({ message: "Only managers can update ingredients" });
    }
    const ingredient = await storage.updateIngredient(routeParam(req, "id"), req.body);
    if (!ingredient) return res.status(404).json({ message: "Ingredient not found" });
    res.json(ingredient);
  });
  
  app.delete("/api/ingredients/:id", async (req: Request, res: Response) => {
    if (!req.session.user || (!isSystemAdminUser(req.session.user) && req.session.user.role !== 'manager')) {
      return res.status(403).json({ message: "Only managers can delete ingredients" });
    }
    await storage.deleteIngredient(routeParam(req, "id"));
    res.json({ message: "Ingredient deleted" });
  });

  // ==================== NOTIFICATIONS ====================
  app.get("/api/notifications", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const notifications = await storage.getNotificationsByRecipient(req.session.user.id);
    res.json(notifications);
  });
  
  app.get("/api/notifications/count", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const count = await storage.getUnreadNotificationCount(req.session.user.id);
    res.json({ count });
  });
  
  app.post("/api/notifications/:id/read", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    const notification = await storage.markNotificationAsRead(routeParam(req, "id"));
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.json(notification);
  });
  
  app.post("/api/notifications/read-all", async (req: Request, res: Response) => {
    if (!req.session.user) return res.status(401).json({ message: "Not authenticated" });
    await storage.markAllNotificationsAsRead(req.session.user.id);
    res.json({ message: "All notifications marked as read" });
  });

  // ==================== ADMIN & DB STATUS ====================
  // Create user directly (Admin only)
  app.post("/api/users/create", async (req: Request, res: Response) => {
    if (!req.session.user || !isSystemAdminUser(req.session.user)) {
      return res.status(403).json({ message: "Only system admin can create users directly" });
    }
    
    try {
      const input = adminCreateUserSchema.parse(req.body);

      const existingUser = await storage.getUserByUsername(input.username);
      const existingEmail = await storage.getUserByEmail(input.email);
      
      if (existingUser) return res.status(400).json({ message: "Username already exists" });
      if (existingEmail) return res.status(400).json({ message: "Email already exists" });
      
      const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS);
      
      const user = await storage.createUser({
        username: input.username,
        email: input.email,
        name: input.name,
        password: hashedPassword,
        role: input.role,
        establishment: input.establishment,
        status: 'active',
        isSystemAdmin: false,
      });
      
      await storage.createTimelineEvent({
        text: `User created by Admin: ${user.name} as ${user.role}`,
        establishment: user.establishment,
        author: req.session.user.name,
        authorRole: 'admin',
        type: 'success'
      });
      
      res.status(201).json(toPublicUser(user));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      console.error("User creation error:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Admin Seed
  app.post("/api/admin/seed", async (req: Request, res: Response) => {
    const user = req.session.user;
    if (!user || !isSystemAdminUser(user)) {
      return res.status(403).json({ message: "Only system admins can trigger seeding" });
    }
    
    try {
      const { bootstrapSystemAdmin } = await import('./bootstrap');
      await bootstrapSystemAdmin();
      res.json({ message: "Seeding completed successfully" });
    } catch (error) {
      console.error("Seeding error:", error);
      res.status(500).json({ message: "Failed to seed data" });
    }
  });

  // DB Status
  app.get("/api/admin/db-status", async (req: Request, res: Response) => {
    const user = req.session.user;
    if (!user || !isSystemAdminUser(user)) {
      return res.status(403).json({ message: "Only system admins can check database status" });
    }
    
    try {
      const inventoryCount = (await storage.getAllInventory()).length;
      const equipmentCount = (await storage.getAllEquipment()).length;
      const usersCount = (await storage.getAllUsers()).length;
      const checklistsCount = (await storage.getAllChecklistItems()).length;
      const tasksCount = (await storage.getAllWeeklyTasks()).length;
      const menuCount = (await storage.getAllMenuItems()).length;
      
      res.json({
        inventory: inventoryCount,
        equipment: equipmentCount,
        users: usersCount,
        checklists: checklistsCount,
        tasks: tasksCount,
        menu: menuCount,
        environment: process.env.NODE_ENV || 'development'
      });
    } catch (error) {
      console.error("DB status error:", error);
      res.status(500).json({ message: "Failed to get database status" });
    }
  });
 
 
  // ==================== SALES & STOCK DEDUCTION ====================
  app.get("/api/sales", async (req: Request, res: Response) => {
    const actor = req.session.user;
    if (!actor) return res.status(401).json({ message: "Not authenticated" });

    const conditions = [];
    if (!isGlobalUser(actor)) conditions.push(eq(sales.establishment, actor.establishment));
    if (typeof req.query.from === "string" && !Number.isNaN(Date.parse(req.query.from))) {
      conditions.push(gte(sales.date, new Date(req.query.from)));
    }
    if (typeof req.query.to === "string" && !Number.isNaN(Date.parse(req.query.to))) {
      conditions.push(lte(sales.date, new Date(req.query.to)));
    }

    const salesHistory = await db.select().from(sales)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sales.date))
      .limit(500);

    const totals = new Map<string, number>();
    for (const sale of salesHistory) {
      const day = sale.date.toISOString().slice(0, 10);
      totals.set(day, (totals.get(day) ?? 0) + sale.quantitySold);
    }

    res.json({
      sales: salesHistory,
      daily: Array.from(totals.entries()).map(([date, quantity]) => ({ date, quantity })),
    });
  });

  app.post("/api/sales", async (req: Request, res: Response) => {
    const actor = req.session.user;
    if (!actor) return res.status(401).json({ message: "Not authenticated" });

    try {
      const body = req.body ?? {};
      const lines = Array.isArray(body.lines)
        ? saleBatchSchema.parse(body).lines
        : saleBatchSchema.parse({
            lines: [{ menuItemId: body.menuItemId, quantitySold: body.quantitySold }],
          }).lines;

      const created = await db.transaction(async (tx) => {
        const recorded = [];
        for (const line of lines) {
          const [menu] = await tx.select().from(menuItems).where(eq(menuItems.id, line.menuItemId)).limit(1);
          if (!menu || !canAccessEstablishment(actor, menu.establishment)) {
            const error = new Error("Menu item not found") as Error & { statusCode: number };
            error.statusCode = 404;
            throw error;
          }

          const recipe = await tx.select().from(ingredients).where(eq(ingredients.menuItemId, menu.id));
          for (const ingredient of recipe) {
            if (!ingredient.inventoryItemId) continue;
            const [item] = await tx.select().from(inventory).where(eq(inventory.id, ingredient.inventoryItemId)).limit(1);
            if (!item) {
              const error = new Error(`Missing inventory for ${ingredient.name}`) as Error & { statusCode: number };
              error.statusCode = 400;
              throw error;
            }
            const used = convertQuantity(ingredient.quantity * line.quantitySold, ingredient.unit, item.unit ?? "units");
            if (used === undefined) {
              const error = new Error(`Cannot convert ${ingredient.unit} to ${item.unit ?? "units"}`) as Error & { statusCode: number };
              error.statusCode = 400;
              throw error;
            }
            const nextQuantity = Number(item.quantity ?? 0) - used;
            if (nextQuantity < 0) {
              const error = new Error(`Not enough ${item.name}`) as Error & { statusCode: number };
              error.statusCode = 409;
              throw error;
            }
            await tx.update(inventory).set({
              quantity: nextQuantity,
              lastUpdated: new Date(),
              updatedBy: actor.name,
            }).where(eq(inventory.id, item.id));
            await tx.insert(inventoryLogs).values({
              itemName: item.name,
              change: -used,
              reason: "Sale",
              user: actor.name,
              establishment: item.establishment,
              inventoryItemId: item.id,
            });
          }

          const [sale] = await tx.insert(sales).values({
            menuItemId: menu.id,
            quantitySold: line.quantitySold,
            establishment: menu.establishment,
          }).returning();
          recorded.push(sale);
        }
        return recorded;
      });

      res.status(201).json({ sales: created });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
      if (statusCode >= 400 && statusCode < 500) {
        const message = error instanceof Error ? error.message : "Failed to record sale";
        return res.status(statusCode).json({ message });
      }
      console.error(error);
      res.status(500).json({ message: "Failed to record sale" });
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Not found" });
  });
}