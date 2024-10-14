// routes/conversations.ts

import express from "express";
import { prisma } from "../server";
import { authenticateToken } from "../middleware/auth";
import { io } from "../server";
import type { AuthenticatedRequest } from "../types";
import { upload } from "../middleware/upload";
import { profile } from "winston";

const router = express.Router();

// 1. Get all conversations for the authenticated user
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
          isGroup: true,
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

// 2. Create a new group conversation
router.post(
  "/",
  authenticateToken,
  upload.single("groupProfile"),
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const { name, participantIds } = req.body;

    try {
      // Parse participantIds from string to array of numbers
      const parsedParticipantIds = participantIds
        .split(",")
        .map((id: string) => parseInt(id.trim(), 10))
        .filter((id: number) => !isNaN(id));

      // Add the creator to the participants if not already included
      if (!parsedParticipantIds.includes(userId)) {
        parsedParticipantIds.push(userId);
      }

      const groupProfile = req.file ? req.file.path : undefined;
      const inviteCode = generateInviteCode();

      const conversation = await prisma.conversation.create({
        data: {
          name,
          isGroup: true,
          inviteCode,
          groupProfile,
          participants: {
            create: parsedParticipantIds.map((id: number) => ({
              userId: id,
              isAdmin: id === userId, // Set the creator as admin
            })),
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
      parsedParticipantIds.forEach((participantId: number) => {
        io.to(`user:${participantId}`).emit("newConversation", conversation);
      });

      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Error creating conversation" });
    }
  }
);

// 3. Get a specific conversation
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
          isGroup: true,
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

// 4. Add a participant to a conversation
router.post(
  "/:conversationId/participants",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const conversationId = parseInt(req.params.conversationId);
    const { participantId } = req.body;

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: true },
      });

      if (!conversation || !conversation.isGroup) {
        return res.status(404).json({ error: "Group conversation not found" });
      }

      const newParticipant = await prisma.participant.create({
        data: {
          userId: participantId,
          conversationId,
        },
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
      });

      io.to(`conversation:${conversationId}`).emit(
        "participantAdded",
        newParticipant
      );

      res.status(201).json(newParticipant);
    } catch (error) {
      res.status(500).json({ error: "Error adding participant" });
    }
  }
);

// 5. Remove a participant
router.delete(
  "/:conversationId/participants/:participantId",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const conversationId = parseInt(req.params.conversationId);
    const participantId = parseInt(req.params.participantId);

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: true },
      });

      if (!conversation || !conversation.isGroup) {
        return res.status(404).json({ error: "Group conversation not found" });
      }

      await prisma.participant.delete({
        where: {
          userId_conversationId: {
            userId: participantId,
            conversationId,
          },
        },
      });

      io.to(`conversation:${conversationId}`).emit("participantRemoved", {
        conversationId,
        userId: participantId,
      });

      res.json({ message: "Participant removed successfully" });
    } catch (error) {
      res.status(500).json({ error: "Error removing participant" });
    }
  }
);

// 6. Leave a conversation
router.post(
  "/:conversationId/leave",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const conversationId = parseInt(req.params.conversationId);

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: true },
      });

      if (!conversation || !conversation.isGroup) {
        return res.status(404).json({ error: "Group conversation not found" });
      }

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

// 7. Join a conversation by invite code
router.post(
  "/join-by-invite",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const { inviteCode } = req.body;

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { inviteCode },
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

      if (!conversation || !conversation.isGroup) {
        return res.status(404).json({ error: "Group conversation not found" });
      }

      const existingParticipant = conversation.participants.find(
        (p) => p.userId === userId
      );

      if (existingParticipant) {
        return res
          .status(400)
          .json({ error: "You're already a participant in this conversation" });
      }

      const updatedConversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          participants: {
            create: { userId },
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

      // Emit socket events
      io.to(`user:${userId}`).emit("joinedConversation", updatedConversation);
      io.to(`conversation:${conversation.id}`).emit("participantAdded", {
        conversationId: conversation.id,
        participant: updatedConversation.participants.find(
          (p) => p.userId === userId
        ),
      });

      res.status(200).json(updatedConversation);
    } catch (error) {
      res.status(500).json({ error: "Error joining conversation" });
    }
  }
);

// 8. Update group profile (name and picture)
router.put(
  "/:conversationId/profile",
  authenticateToken,
  upload.single("groupProfile"),
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const conversationId = parseInt(req.params.conversationId);
    const { name } = req.body;

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: true },
      });

      if (!conversation || !conversation.isGroup) {
        return res.status(404).json({ error: "Group conversation not found" });
      }

      let groupProfile = undefined;
      if (req.file) {
        groupProfile = req.file.path; // Cloudinary URL
      }

      const updatedConversation = await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          name,
          ...(groupProfile && { groupProfile }),
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

      io.to(`conversation:${conversationId}`).emit(
        "conversationProfileUpdated",
        updatedConversation
      );

      res.json(updatedConversation);
    } catch (error) {
      res.status(500).json({ error: "Error updating group profile" });
    }
  }
);

// Helper function to generate invite code
function generateInviteCode() {
  return Math.random().toString(36).substring(2, 10);
}

export default router;
