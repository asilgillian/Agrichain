import { Router, type IRouter } from "express";
import { eq, sql, and } from "drizzle-orm";
import { db, groupsTable, farmersTable, plotsTable } from "@workspace/db";
import { CreateGroupBody, ListGroupsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/groups", async (req, res): Promise<void> => {
  const parsed = ListGroupsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { regionId } = parsed.data;
  const groups = regionId
    ? await db.select().from(groupsTable).where(eq(groupsTable.regionId, regionId))
    : await db.select().from(groupsTable);

  const enriched = await Promise.all(groups.map(async (g) => {
    const [memberCount] = await db.select({ count: sql<number>`count(*)::int` }).from(farmersTable).where(eq(farmersTable.groupId, g.id));
    const [activePlots] = await db.select({ count: sql<number>`count(*)::int` }).from(plotsTable)
      .leftJoin(farmersTable, eq(plotsTable.farmerId, farmersTable.id))
      .where(and(eq(farmersTable.groupId, g.id), eq(plotsTable.status, "active")));
    return {
      ...g,
      memberCount: memberCount?.count ?? 0,
      complianceScore: 0.85,
      activePlots: activePlots?.count ?? 0,
    };
  }));
  res.json(enriched);
});

router.post("/groups", async (req, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [group] = await db.insert(groupsTable).values(parsed.data).returning();
  res.status(201).json({ ...group, memberCount: 0, complianceScore: 0, activePlots: 0 });
});

router.get("/groups/:groupId", async (req, res): Promise<void> => {
  const { groupId } = req.params;
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId as string));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const members = await db.select().from(farmersTable).where(eq(farmersTable.groupId, groupId as string));
  const [memberCount] = await db.select({ count: sql<number>`count(*)::int` }).from(farmersTable).where(eq(farmersTable.groupId, groupId as string));
  res.json({
    ...group,
    memberCount: memberCount?.count ?? 0,
    complianceScore: 0.85,
    activePlots: 0,
    members: members.map(m => ({ ...m, groupName: group.name })),
    leaders: [],
  });
});

export default router;
