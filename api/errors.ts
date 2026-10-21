import type { Express, NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

const ROUTE_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function isAsyncRoute(value: unknown): value is AsyncRouteHandler {
  return typeof value === "function" && value.constructor.name === "AsyncFunction";
}

function wrapRouteArg(arg: unknown): unknown {
  if (isAsyncRoute(arg)) {
    return asyncHandler(arg);
  }
  if (Array.isArray(arg)) {
    return arg.map(wrapRouteArg);
  }
  return arg;
}

/**
 * Express 4 does not forward a rejected promise from an async route to error
 * middleware. This wrapper does, until the app moves to Express 5.
 */
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** Wrap async handlers registered on `app` after this call. */
export function catchAsyncRouteErrors(app: Express): void {
  for (const method of ROUTE_METHODS) {
    const original = app[method].bind(app) as (...args: unknown[]) => Express;
    app[method] = ((...args: unknown[]) => {
      return original(...args.map(wrapRouteArg));
    }) as Express[typeof method];
  }
}

/**
 * Reads an HTTP status from a plain property. Drizzle 0.44+ changes its error
 * class, so this must not use `instanceof` on a library error.
 */
function httpStatusFrom(err: unknown): number {
  if (typeof err !== "object" || err === null) {
    return 500;
  }

  const record = err as { status?: unknown; statusCode?: unknown };
  const status = record.status ?? record.statusCode;
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }

  return 500;
}

function clientMessageFrom(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return "Request failed";
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = httpStatusFrom(err);
  if (status >= 500) {
    console.error("Unhandled request error", err);
    res.status(status).json({ message: "Internal Server Error" });
    return;
  }

  res.status(status).json({ message: clientMessageFrom(err) });
}
