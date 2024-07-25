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
    try {
      const conversations = await prisma.conversation.findMany({
        where: {
          participants: {
            some: { userId },
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  profileImage: true,
                  presenceStatus: true,
                },
              },
            },
          },
          lastMessage: true,
        },
        orderBy: { updatedAt: "desc" },
      });
      res.json(conversations);
    } catch (error) {
      res.status(500).json({ error: "Error fetching conversations" });
    }
  }
);

router.post(
  "/",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const { name, participantIds, isGroup } = req.body;
    try {
      const conversation = await prisma.conversation.create({
        data: {
          name: isGroup ? name : undefined,
          isGroup,
          participants: {
            create: [
              { userId, isAdmin: true },
              ...participantIds.map((id: number) => ({ userId: id })),
            ],
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  profileImage: true,
                  presenceStatus: true,
                },
              },
            },
          },
        },
      });
      res.status(201).json(conversation);
    } catch (error) {
      res.status(500).json({ error: "Error creating conversation" });
    }
  }
);

router.get(
  "/:conversationId",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const conversationId = parseInt(req.params.conversationId);

    try {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          participants: {
            some: { userId },
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  profileImage: true,
                  presenceStatus: true,
                },
              },
            },
          },
          lastMessage: true,
        },
      });

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      res.json(conversation);
    } catch (error) {
      res.status(500).json({ error: "Error fetching conversation" });
    }
  }
);

export default router;
