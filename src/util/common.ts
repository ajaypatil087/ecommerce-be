import { Request } from "express";

export const getAuthenticatedUserId = (req: Request): string | undefined => {
  const user = req.user;
  if (typeof user === "string") return user;
  if (user && typeof user === "object" && "id" in user && typeof user.id === "string") return user.id;
  return undefined;
};
