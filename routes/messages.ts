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

export default router;
