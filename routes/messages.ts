import express from "express";
import { prisma } from "../server";
import { authenticateToken } from "../middleware/auth";
import { io } from "../server";
import type { AuthenticatedRequest } from "../types";
import { sendNotification } from "./notifications";
import { upload } from "../middleware/upload";

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
          parent: {
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

      // Mark messages as read
      const unreadMessages = messages.filter(
        (msg) =>
          msg.senderId !== userId &&
          !msg.readBy.some((rb) => rb.userId === userId)
      );

      if (unreadMessages.length > 0) {
        await prisma.readReceipt.createMany({
          data: unreadMessages.map((msg) => ({
            messageId: msg.id,
            userId,
          })),
          skipDuplicates: true,
        });

        // Notify other users that messages have been read
        io.to(`conversation:${conversationId}`).emit("messagesRead", {
          userId,
          messageIds: unreadMessages.map((msg) => msg.id),
        });
      }

      res.json(messages.reverse());
    } catch (error) {
      res.status(500).json({ error: "Error fetching messages" });
    }
  }
);

router.post(
  "/:conversationId",
  authenticateToken,
  upload.single("file"),
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const conversationId = parseInt(req.params.conversationId);
    let { content, contentType, parentId } = req.body;

    try {
      // Handle file upload
      if (req.file) {
        content = req.file.path; // Cloudinary URL
        if (req.file.mimetype.startsWith("image/")) {
          contentType = "IMAGE";
        } else if (req.file.mimetype.startsWith("video/")) {
          contentType = "VIDEO";
        } else {
          contentType = "FILE";
        }
      } else {
        // For text messages
        contentType = "TEXT";
      }

      const message = await prisma.message.create({
        data: {
          senderId: userId,
          conversationId,
          content,
          contentType,
          parentId: parentId ? parseInt(parentId) : undefined,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              profileImage: true,
            },
          },
          parent: {
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
      });

      const participants = await prisma.participant.findMany({
        where: { conversationId: parseInt(req.params.conversationId) },
        select: { userId: true },
      });

      participants.forEach(async (participant) => {
        if (participant.userId !== req.user!.id) {
          await sendNotification(participant.userId, {
            title: "New Message",
            body: `${req.user!.username}: ${message.content}`,
            icon: req.user!.profileImage || "/default-avatar.png",
            data: {
              conversationId: message.conversationId,
            },
          });
        }
      });

      // Update last message for the conversation
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageId: message.id },
      });

      // Emit the new message to all participants in the conversation
      io.to(`conversation:${conversationId}`).emit("newMessage", message);

      // If it's a reply, also emit to the thread
      if (message.parentId) {
        io.to(`thread:${message.parentId}`).emit("newThreadReply", message);
      }

      res.status(201).json(message);
    } catch (error) {
      res.status(500).json({ error: "Error sending message" });
    }
  }
);
// separate route to handle file uploads but we will not use it right now
router.post(
  "/:conversationId/upload",
  authenticateToken,
  (req: AuthenticatedRequest, res: express.Response) => {
    upload.single("file")(req, res, async (err: any) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const conversationId = parseInt(req.params.conversationId);
      const userId = req.user!.id;

      try {
        let contentType: "IMAGE" | "VIDEO" | "FILE";
        if (req.file.mimetype.startsWith("image/")) {
          contentType = "IMAGE";
        } else if (req.file.mimetype.startsWith("video/")) {
          contentType = "VIDEO";
        } else {
          contentType = "FILE";
        }

        const message = await prisma.message.create({
          data: {
            senderId: userId,
            conversationId,
            content: req.file.path,
            contentType,
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

        io.to(`conversation:${conversationId}`).emit("newMessage", message);

        // Send notifications to other participants
        const participants = await prisma.participant.findMany({
          where: { conversationId },
          select: { userId: true },
        });

        for (const participant of participants) {
          if (participant.userId !== userId) {
            await sendNotification(participant.userId, {
              title: "New File",
              body: `${req.user!.username} sent a file in the conversation`,
              icon: req.user!.profileImage || "/default-avatar.png",
              data: {
                conversationId,
              },
            });
          }
        }

        res.status(201).json(message);
      } catch (error) {
        console.error("Error uploading file:", error);
        res.status(500).json({ error: "Error uploading file" });
      }
    });
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

        // Emit the updated message to all participants in the conversation
        if (message) {
          io.to(`conversation:${message.conversationId}`).emit(
            "messageUpdated",
            message
          );
        }

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
  "/:messageId/react",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const messageId = parseInt(req.params.messageId);
    const { reaction } = req.body;

    try {
      const existingReaction = await prisma.messageReaction.findUnique({
        where: {
          messageId_userId: {
            messageId,
            userId,
          },
        },
      });

      let updatedReaction;

      if (existingReaction) {
        if (existingReaction.reaction === reaction) {
          // Remove the reaction if it's the same
          await prisma.messageReaction.delete({
            where: { id: existingReaction.id },
          });
        } else {
          // Update the reaction if it's different
          updatedReaction = await prisma.messageReaction.update({
            where: { id: existingReaction.id },
            data: { reaction },
          });
        }
      } else {
        // Create a new reaction
        updatedReaction = await prisma.messageReaction.create({
          data: {
            messageId,
            userId,
            reaction,
          },
        });
      }

      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
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
        },
      });

      // Emit the updated message reactions to all participants in the conversation
      if (message) {
        io.to(`conversation:${message.conversationId}`).emit(
          "messageReactionUpdate",
          {
            messageId,
            reactions: message.reactions,
          }
        );
      }

      res.json(updatedReaction || { removed: true });
    } catch (error) {
      res.status(500).json({ error: "Error updating message reaction" });
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

router.post(
  "/:messageId/read",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const messageId = parseInt(req.params.messageId);

    try {
      await prisma.readReceipt.create({
        data: {
          messageId,
          userId,
        },
      });

      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { readBy: true },
      });

      io.to(`conversation:${message!.conversationId}`).emit("messageRead", {
        messageId,
        userId,
      });

      res.sendStatus(200);
    } catch (error) {
      res.status(500).json({ error: "Error marking message as read" });
    }
  }
);

router.delete(
  "/:messageId",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const messageId = parseInt(req.params.messageId);

    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: { senderId: true },
      });

      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      if (message.senderId !== userId) {
        return res.status(403).json({ error: "You can't delete this message" });
      }

      await prisma.message.delete({
        where: { id: messageId },
      });

      io.to(`conversation:${message.senderId}`).emit("messageDeleted", {
        messageId,
        conversationId: message.senderId,
      });

      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ error: "Error deleting message" });
    }
  }
);

export default router;
