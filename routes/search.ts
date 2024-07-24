import express from "express";
import { prisma } from "../server";
import { authenticateToken } from "../middleware/auth";
import type { AuthenticatedRequest } from "../types";

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const query = req.query.q as string;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    try {
      const messages = await prisma.message.findMany({
        where: {
          content: {
            contains: query,
            mode: "insensitive",
          },
          conversation: {
            participants: {
              some: { userId },
            },
          },
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              profileImage: true,
            },
          },
          conversation: {
            select: {
              id: true,
              name: true,
              isGroup: true,
            },
          },
        },
        orderBy: { timestamp: "desc" },
        take: 50,
      });

      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Error searching messages" });
    }
  }
);

export default router;
