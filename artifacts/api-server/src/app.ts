import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import type { AuthedRequest } from "./middlewares/auth";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const hasClerkKey = Boolean(process.env.CLERK_SECRET_KEY);
const devBypass = !hasClerkKey && process.env.NODE_ENV === "development" && process.env.BOLT_DEV_AUTOLOGIN === "1";

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "75mb" }));
app.use(express.urlencoded({ extended: true, limit: "75mb" }));

if (hasClerkKey) {
  app.use(clerkMiddleware());
} else if (devBypass) {
  logger.warn("BOLT_DEV_AUTOLOGIN=1 and no CLERK_SECRET_KEY — injecting mock admin user. Never use in production.");
  app.use((req: AuthedRequest, _res: Response, next: NextFunction) => {
    req.authedUser = {
      id: "00000000-0000-0000-0000-000000000000",
      clerkUserId: "dev-admin",
      email: "dev-admin@mtandeo.local",
      role: "SystemAdministrator",
      roles: ["SystemAdministrator"],
      permissions: ["*"],
    };
    next();
  });
}

app.use("/api", router);

export default app;
