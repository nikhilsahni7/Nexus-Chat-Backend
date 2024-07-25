import express from "express";
import { prisma } from "../server";
import { authenticateToken } from "../middleware/auth";
import { io } from "../server";
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
          lastMessage: {
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                },
              },
              parent: {
                select: {
                  id: true,
                  content: true,
                },
              },
            },
          },
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

      // Notify all participants about the new conversation
      participantIds.forEach((participantId: number) => {
        io.to(`user:${participantId}`).emit("newConversation", conversation);
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
          lastMessage: {
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                },
              },
              parent: {
                select: {
                  id: true,
                  content: true,
                },
              },
            },
          },
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

router.post(
  "/:conversationId/leave",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const conversationId = parseInt(req.params.conversationId);

    try {
      await prisma.participant.delete({
        where: {
          userId_conversationId: {
            userId,
            conversationId,
          },
        },
      });

      // Notify other participants that the user left
      io.to(`conversation:${conversationId}`).emit("userLeftConversation", {
        userId,
        conversationId,
      });

      res.json({ message: "Successfully left the conversation" });
    } catch (error) {
      res.status(500).json({ error: "Error leaving conversation" });
    }
  }
);

export default router;
