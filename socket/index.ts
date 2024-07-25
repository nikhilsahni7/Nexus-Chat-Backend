import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "../server";
import { PresenceStatus, MessageType } from "@prisma/client";

export default function setupSocketIO(io: Server) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error"));
    }
    jwt.verify(token, process.env.JWT_SECRET!, (err: any, decoded: any) => {
      if (err) return next(new Error("Authentication error"));
      socket.data.userId = decoded.id;
      next();
    });
  });

  io.on("connection", (socket) => {
    console.log("User connected:", socket.data.userId);

    socket.on("joinConversations", async (conversationIds: number[]) => {
      conversationIds.forEach((id) => {
        socket.join(`conversation:${id}`);
      });
    });

    socket.on("leaveConversation", (conversationId: number) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on("setPresence", async (status: PresenceStatus) => {
      try {
        await prisma.user.update({
          where: { id: socket.data.userId },
          data: { presenceStatus: status, lastSeen: new Date() },
        });
        socket.broadcast.emit("presenceUpdate", {
          userId: socket.data.userId,
          status,
        });
      } catch (error) {
        console.error("Error updating presence:", error);
      }
    });
    const typingUsers = new Map<number, Set<number>>();

    socket.on(
      "typing",
      async ({
        conversationId,
        isTyping,
      }: {
        conversationId: number;
        isTyping: boolean;
      }) => {
        try {
          if (!typingUsers.has(conversationId)) {
            typingUsers.set(conversationId, new Set());
          }

          const conversationTypers = typingUsers.get(conversationId)!;

          if (isTyping) {
            conversationTypers.add(socket.data.userId);
          } else {
            conversationTypers.delete(socket.data.userId);
          }

          const typingUserIds = Array.from(conversationTypers);

          const typingUsernames = await prisma.user.findMany({
            where: { id: { in: typingUserIds } },
            select: { id: true, username: true },
          });

          io.to(`conversation:${conversationId}`).emit("typingUpdate", {
            conversationId,
            typingUsers: typingUsernames,
          });
        } catch (error) {
          console.error("Error updating typing status:", error);
        }
      }
    );

    socket.on("disconnect", () => {
      // Remove user from all typing lists when they disconnect
      typingUsers.forEach((typers, conversationId) => {
        if (typers.delete(socket.data.userId)) {
          io.to(`conversation:${conversationId}`).emit("typingUpdate", {
            conversationId,
            typingUsers: Array.from(typers),
          });
        }
      });
    });

    socket.on(
      "sendMessage",
      async (messageData: {
        conversationId: number;
        content: string;
        contentType: string;
        replyToId?: number;
      }) => {
        try {
          const { conversationId, content, contentType, replyToId } =
            messageData;
          const message = await prisma.message.create({
            data: {
              senderId: socket.data.userId,
              conversationId,
              content,
              contentType: MessageType.TEXT,
              replyToId,
            },
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  profileImage: true,
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
          });

          await prisma.conversation.update({
            where: { id: conversationId },
            data: { lastMessageId: message.id },
          });

          const encryptedContent = content; // Replace with actual encryption

          io.to(`conversation:${conversationId}`).emit("newMessage", {
            ...message,
            content: encryptedContent,
          });

          await prisma.participant.updateMany({
            where: {
              conversationId,
              userId: { not: socket.data.userId },
            },
            data: {
              unreadCount: { increment: 1 },
            },
          });
        } catch (error) {
          console.error("Error sending message:", error);
        }
      }
    );

    socket.on(
      "reactToMessage",
      async ({
        messageId,
        reaction,
      }: {
        messageId: number;
        reaction: string;
      }) => {
        try {
          const existingReaction = await prisma.messageReaction.findUnique({
            where: {
              messageId_userId: {
                messageId,
                userId: socket.data.userId,
              },
            },
          });

          if (existingReaction) {
            if (existingReaction.reaction === reaction) {
              await prisma.messageReaction.delete({
                where: { id: existingReaction.id },
              });
            } else {
              await prisma.messageReaction.update({
                where: { id: existingReaction.id },
                data: { reaction },
              });
            }
          } else {
            await prisma.messageReaction.create({
              data: {
                messageId,
                userId: socket.data.userId,
                reaction,
              },
            });
          }

          const updatedMessage = await prisma.message.findUnique({
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

          if (updatedMessage) {
            io.to(`conversation:${updatedMessage.conversationId}`).emit(
              "messageReactionUpdate",
              updatedMessage
            );
          }
        } catch (error) {
          console.error("Error reacting to message:", error);
        }
      }
    );

    socket.on(
      "editMessage",
      async ({
        messageId,
        newContent,
      }: {
        messageId: number;
        newContent: string;
      }) => {
        try {
          const updatedMessage = await prisma.message.updateMany({
            where: {
              id: messageId,
              senderId: socket.data.userId, // Ensure only the sender can edit the message
            },
            data: {
              content: newContent,
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

            if (message) {
              io.to(`conversation:${message.conversationId}`).emit(
                "messageUpdated",
                message
              );
            }
          }
        } catch (error) {
          console.error("Error editing message:", error);
        }
      }
    );

    socket.on(
      "readMessages",
      async ({ conversationId }: { conversationId: number }) => {
        try {
          const unreadMessages = await prisma.message.findMany({
            where: {
              conversationId,
              senderId: { not: socket.data.userId },
              readBy: { none: { userId: socket.data.userId } },
            },
          });

          await prisma.readReceipt.createMany({
            data: unreadMessages.map((msg) => ({
              messageId: msg.id,
              userId: socket.data.userId,
            })),
            skipDuplicates: true,
          });

          await prisma.participant.updateMany({
            where: {
              conversationId,
              userId: socket.data.userId,
            },
            data: { unreadCount: 0 },
          });

          socket.to(`conversation:${conversationId}`).emit("messagesRead", {
            userId: socket.data.userId,
            conversationId,
          });
        } catch (error) {
          console.error("Error marking messages as read:", error);
        }
      }
    );

    socket.on(
      "sendThreadReply",
      async (messageData: {
        parentMessageId: number;
        content: string;
        contentType: string;
      }) => {
        try {
          const { parentMessageId, content, contentType } = messageData;

          const parentMessage = await prisma.message.findUnique({
            where: { id: parentMessageId },
            select: { conversationId: true },
          });

          if (!parentMessage) {
            throw new Error("Parent message not found");
          }

          const threadReply = await prisma.message.create({
            data: {
              senderId: socket.data.userId,
              conversationId: parentMessage.conversationId,
              content,
              contentType: MessageType.TEXT,
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

          io.to(`conversation:${parentMessage.conversationId}`).emit(
            "newThreadReply",
            threadReply
          );
        } catch (error) {
          console.error("Error sending thread reply:", error);
        }
      }
    );

    socket.on("disconnect", async () => {
      try {
        await prisma.user.update({
          where: { id: socket.data.userId },
          data: { presenceStatus: "OFFLINE", lastSeen: new Date() },
        });
        socket.broadcast.emit("presenceUpdate", {
          userId: socket.data.userId,
          status: "OFFLINE",
        });
        typingUsers.forEach((typers, conversationId) => {
          if (typers.delete(socket.data.userId)) {
            io.to(`conversation:${conversationId}`).emit("typingUpdate", {
              conversationId,
              typingUsers: Array.from(typers),
            });
          }
        });
      } catch (error) {
        console.error("Error updating presence on disconnect:", error);
      }
    });
  });
}
