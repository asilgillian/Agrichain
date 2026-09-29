import express, { type Express, type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  // Accept the web app's VITE_-prefixed key too, so the same publishable key
  // doesn't have to be entered twice on the hosting platform.
  app.use(
    clerkMiddleware({
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY,
    }),
  );
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

// Serve the built web app (artifacts/agri-web/dist/public) from this same
// server, so one hosted service provides both the website and the API and the
// browser can keep calling /api on its own origin. Only active once the web
// app has been built; WEB_DIST_DIR overrides the location if needed.
const webDistDir =
  process.env.WEB_DIST_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../agri-web/dist/public");

if (existsSync(path.join(webDistDir, "index.html"))) {
  app.use(express.static(webDistDir, { index: false, maxAge: "1h" }));
  // Single-page app fallback: any non-API GET that didn't match a file gets
  // index.html, so client-side routes like /farmers/123 load on refresh.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(webDistDir, "index.html"));
  });
  logger.info({ webDistDir }, "Serving web app");
}

export default app;
