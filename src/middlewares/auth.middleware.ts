import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?: string | jwt.JwtPayload;
    }
  }
}

export const authMiddleware: RequestHandler = (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    req.log.warn({ event: "auth.rejected", reason: "missing_bearer_token" }, "Authentication rejected");
    res.status(401).json({ message: "Bearer token required" });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    req.log.error({ event: "auth.error", reason: "missing_jwt_secret" }, "Authentication is not configured");
    res.status(500).json({ message: "Authentication is not configured" });
    return;
  }

  try {
    req.user = jwt.verify(token, secret);
    req.log.info({ event: "auth.succeeded" }, "Authentication succeeded");
    next();
  } catch {
    req.log.warn({ event: "auth.rejected", reason: "invalid_token" }, "Authentication rejected");
    res.status(401).json({ message: "Invalid token" });
  }
};
