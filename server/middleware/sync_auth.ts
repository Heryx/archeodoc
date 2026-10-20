import type { Request, Response, NextFunction } from "express";

const SYNC_AUTH_TOKEN = process.env.SYNC_AUTH_TOKEN || "archeodoc-sync-2024";

export function syncAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-auth-token"];
  if (token !== SYNC_AUTH_TOKEN) {
    return res.status(401).json({ error: "Non autorizzato" });
  }
  next();
}
