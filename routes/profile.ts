import express from "express";
import { prisma } from "../server";
import { authenticateToken } from "../middleware/auth";
import type { AuthenticatedRequest } from "../types";

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        profileImage: true,
        bio: true,
        presenceStatus: true,
        settings: true,
      },
    });
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  }
);

router.put(
  "/",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const { bio, profileImage } = req.body;
    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { bio, profileImage },
        select: {
          id: true,
          username: true,
          email: true,
          profileImage: true,
          bio: true,
          presenceStatus: true,
        },
      });
      res.json(updatedUser);
    } catch (error) {
      res.status(500).json({ error: "Error updating profile" });
    }
  }
);

router.put(
  "/settings",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const { notificationsEnabled, darkModeEnabled, language } = req.body;
    try {
      const updatedSettings = await prisma.userSettings.update({
        where: { userId },
        data: { notificationsEnabled, darkModeEnabled, language },
      });
      res.json(updatedSettings);
    } catch (error) {
      res.status(500).json({ error: "Error updating settings" });
    }
  }
);

export default router;
