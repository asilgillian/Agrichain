import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, plotsTable } from "@workspace/db";
import { CreatePlotBody, ListPlotsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/plots", async (req, res): Promise<void> => {
  const parsed = ListPlotsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { farmerId } = parsed.data;
  const plots = farmerId
    ? await db.select().from(plotsTable).where(eq(plotsTable.farmerId, farmerId))
    : await db.select().from(plotsTable);
  res.json(plots.map(p => ({ ...p, areaHectares: parseFloat(p.areaHectares ?? "0") })));
});

router.post("/plots", async (req, res): Promise<void> => {
  const parsed = CreatePlotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [plot] = await db.insert(plotsTable).values(parsed.data).returning();
  res.status(201).json({ ...plot, areaHectares: parseFloat(plot.areaHectares ?? "0") });
});

router.get("/plots/:plotId", async (req, res): Promise<void> => {
  const { plotId } = req.params;
  const [plot] = await db.select().from(plotsTable).where(eq(plotsTable.id, plotId as string));
  if (!plot) {
    res.status(404).json({ error: "Plot not found" });
    return;
  }
  res.json({ ...plot, areaHectares: parseFloat(plot.areaHectares ?? "0") });
});

export default router;
