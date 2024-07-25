import express from "express";
import { prisma } from "../server";
import { authenticateToken } from "../middleware/auth";
import type { AuthenticatedRequest } from "../types";

const router = express.Router();

router.get(
  "/:conversationId",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const conversationId = parseInt(req.params.conversationId);
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = 50;

    try {
      const messages = await prisma.message.findMany({
        where: { conversationId },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              profileImage: true,
            },
          },
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          readBy: {
            select: {
              userId: true,
              readAt: true,
            },
          },
          replyTo: {
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
        },
        orderBy: { timestamp: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

      await prisma.readReceipt.createMany({
        data: messages
          .filter(
            (msg) =>
              msg.senderId !== userId &&
              !msg.readBy.some((rb) => rb.userId === userId)
          )
          .map((msg) => ({ messageId: msg.id, userId })),
        skipDuplicates: true,
      });

      res.json(messages.reverse());
    } catch (error) {
      res.status(500).json({ error: "Error fetching messages" });
    }
  }
);

router.put(
  "/:messageId",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const messageId = parseInt(req.params.messageId);
    const { content } = req.body;

    try {
      const updatedMessage = await prisma.message.updateMany({
        where: {
          id: messageId,
          senderId: userId,
        },
        data: {
          content,
          updatedAt: new Date(),
        },
      });

      if (updatedMessage.count > 0) {
        const message = await prisma.message.findUnique({
          where: { id: messageId },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profileImage: true,
              },
            },
          },
        });
        res.json(message);
      } else {
        res.status(404).json({
          error: "Message not found or you don't have permission to edit it",
        });
      }
    } catch (error) {
      res.status(500).json({ error: "Error updating message" });
    }
  }
);

router.post(
  "/thread",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const { parentMessageId, content, contentType } = req.body;

    try {
      const parentMessage = await prisma.message.findUnique({
        where: { id: parentMessageId },
        select: { conversationId: true },
      });

      if (!parentMessage) {
        return res.status(404).json({ error: "Parent message not found" });
      }

      const threadReply = await prisma.message.create({
        data: {
          senderId: userId,
          conversationId: parentMessage.conversationId,
          content,
          contentType,
          parentId: parentMessageId,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              profileImage: true,
            },
          },
        },
      });

      res.status(201).json(threadReply);
    } catch (error) {
      res.status(500).json({ error: "Error creating thread reply" });
    }
  }
);

router.get(
  "/thread/:parentMessageId",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const parentMessageId = parseInt(req.params.parentMessageId);

    try {
      const threadReplies = await prisma.message.findMany({
        where: { parentId: parentMessageId },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              profileImage: true,
            },
          },
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          readBy: {
            select: {
              userId: true,
              readAt: true,
            },
          },
        },
        orderBy: { timestamp: "asc" },
      });

      res.json(threadReplies);
    } catch (error) {
      res.status(500).json({ error: "Error fetching thread replies" });
    }
  }
);

export default router;
