import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { CreateUserBody, UpdateUserBody, ListUsersQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/users", async (req, res): Promise<void> => {
  const parsed = ListUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { role, regionId, status } = parsed.data;
  const conditions: any[] = [];
  if (role) conditions.push(eq(usersTable.role, role));
  if (regionId) conditions.push(eq(usersTable.regionId, regionId));
  if (status) conditions.push(eq(usersTable.status, status));

  const users = conditions.length > 0
    ? await db.select().from(usersTable).where(and(...conditions)).orderBy(desc(usersTable.createdAt))
    : await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json(users);
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db.insert(usersTable).values(parsed.data).returning();
  res.status(201).json(user);
});

router.get("/users/:userId", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId as string));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.patch("/users/:userId", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db.update(usersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(usersTable.id, userId as string)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

export default router;
