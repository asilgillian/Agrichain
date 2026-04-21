import { Router, type IRouter, type Response } from "express";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/me", requireAuth, (req: AuthedRequest, res: Response): void => {
  res.json(req.authedUser);
});

export default router;
