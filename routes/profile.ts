import type { AuthenticatedRequest } from "../types";
import express from "express";
import { prisma } from "../server";

import { upload } from "../middleware/upload";

import { authenticateToken } from "../middleware/auth";

const router = express.Router();

router.get("/", async (req: AuthenticatedRequest, res: express.Response) => {
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
      lastLoginAt: true,
      lastLoginIP: true,
      totalLoginTime: true,
      loginCount: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ error: "User not found" });
  }
});

router.put(
  "/",
  upload.single("profileImage"),
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const { bio, username, email } = req.body;
    try {
      let profileImage = undefined;
      if (req.file) {
        profileImage = req.file.path;
      }
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          bio,
          username,
          email,
          ...(profileImage && { profileImage }),
        },
        select: {
          id: true,
          username: true,
          email: true,
          profileImage: true,
          bio: true,
          presenceStatus: true,
          lastLoginAt: true,
          lastLoginIP: true,
          totalLoginTime: true,
          loginCount: true,
          lastActiveAt: true,
          createdAt: true,
        },
      });
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating profile:", error);
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

router.get(
  "/online",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const onlineUsers = await prisma.user.findMany({
        where: {
          presenceStatus: {
            not: "OFFLINE",
          },
        },
        select: {
          id: true,
          username: true,
          profileImage: true,
          presenceStatus: true,
        },
      });
      res.json(onlineUsers);
    } catch (error) {
      res.status(500).json({ error: "Error fetching online users" });
    }
  }
);

router.get("/:id", async (req: AuthenticatedRequest, res: express.Response) => {
  const userId = req.params.id;
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      id: true,
      username: true,
      email: true,
      profileImage: true,
      bio: true,
      presenceStatus: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ error: "User not found" });
  }
});

export default router;
