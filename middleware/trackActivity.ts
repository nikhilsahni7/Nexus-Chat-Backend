import { prisma } from "../server";
import type { AuthenticatedRequest } from "../types";
import express from "express";

export const trackActivity = async (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  if (req.user) {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { lastActiveAt: new Date() },
    });
  }
  next();
};
