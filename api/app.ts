import path from "path";
import "dotenv/config";
import express, { type Express, type Request } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { catchAsyncRouteErrors, errorHandler } from "./errors";
import { registerRoutes } from "./routes";

const UPLOAD_IMAGE_EXTENSIONS = new Set([".jpg", ".png", ".webp"]);

/**
 * Builds the Express app without listening. Tests import this so Supertest
 * can call routes in-process. `api/index.ts` is the only place that listens.
 */
export async function createApp(): Promise<Express> {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set");
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:", "blob:", "https:"],
              connectSrc: ["'self'", "https://*.sentry.io", "https://*.ingest.sentry.io", "https://*.ingest.de.sentry.io"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
    }),
  );

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => {
      res.status(429).json({ message: "Too many attempts. Try again later." });
    },
  });
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/register", authLimiter);

  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({
        pool,
        tableName: "session",
        createTableIfMissing: true,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
      },
    }),
  );

  app.use(
    "/uploads",
    (req, res, next) => {
      const extension = path.extname(req.path).toLowerCase();
      if (!UPLOAD_IMAGE_EXTENSIONS.has(extension)) {
        res.sendStatus(404);
        return;
      }
      next();
    },
    express.static(path.join(process.cwd(), "uploads"), {
      setHeaders(res) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'");
      },
    }),
    (_req, res) => {
      res.sendStatus(404);
    },
  );

  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  if (process.env.NODE_ENV !== "test") {
    app.use((req, _res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  catchAsyncRouteErrors(app);
  await registerRoutes(app);
  app.use(errorHandler);

  return app;
}
