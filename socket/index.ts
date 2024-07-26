import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "../server";
import { PresenceStatus, MessageType } from "@prisma/client";

interface AuthenticatedSocket extends Socket {
  data: {
    userId: number;
  };
}

export default function setupSocketIO(io: Server) {
  io.use((socket: AuthenticatedSocket, next) => {
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

  const typingUsers = new Map<number, Set<number>>();

  io.on("connection", async (socket: AuthenticatedSocket) => {
    console.log("User connected:", socket.data.userId);

    // Update user's presence status to ONLINE
    await prisma.user.update({
      where: { id: socket.data.userId },
      data: { presenceStatus: PresenceStatus.ONLINE },
    });

    socket.on(
      "uploadProgress",
      (data: { conversationId: number; progress: number }) => {
        socket
          .to(`conversation:${data.conversationId}`)
          .emit("fileUploadProgress", data);
      }
    );

    // Broadcast the user's online status to all connected clients
    socket.broadcast.emit("presenceUpdate", {
      userId: socket.data.userId,
      status: PresenceStatus.ONLINE,
    });

    socket.on("joinConversations", async (conversationIds: number[]) => {
      conversationIds.forEach((id) => {
        socket.join(`conversation:${id}`);
      });
    });

    socket.on("leaveConversation", (conversationId: number) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on(
      "participantAdded",
      (data: { conversationId: number; participant: any }) => {
        socket
          .to(`conversation:${data.conversationId}`)
          .emit("participantAdded", data.participant);
      }
    );

    socket.on(
      "participantRemoved",
      (data: { conversationId: number; userId: number }) => {
        socket
          .to(`conversation:${data.conversationId}`)
          .emit("participantRemoved", data);
      }
    );

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

    socket.on(
      "sendMessage",
      async (messageData: {
        conversationId: number;
        content: string;
        contentType: MessageType;
        parentId?: number;
      }) => {
        try {
          const { conversationId, content, contentType, parentId } =
            messageData;
          const message = await prisma.message.create({
            data: {
              senderId: socket.data.userId,
              conversationId,
              content,
              contentType,
              parentId,
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

          await prisma.conversation.update({
            where: { id: conversationId },
            data: { lastMessageId: message.id },
          });

          io.to(`conversation:${conversationId}`).emit("newMessage", message);

          if (message.parentId) {
            io.to(`thread:${message.parentId}`).emit("newThreadReply", message);
          }

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

    socket.on("joinConversationByName", async (conversationName: string) => {
      try {
        const conversation = await prisma.conversation.findFirst({
          where: {
            name: conversationName,
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
          },
        });

        if (!conversation) {
          socket.emit("joinConversationError", "Conversation not found");
          return;
        }

        const existingParticipant = conversation.participants.find(
          (p) => p.userId === socket.data.userId
        );

        if (existingParticipant) {
          socket.emit("joinConversationError", "Already a participant");
          return;
        }

        const updatedConversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            participants: {
              create: { userId: socket.data.userId },
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

        socket.join(`conversation:${conversation.id}`);
        socket.emit("joinedConversation", updatedConversation);
        socket.to(`conversation:${conversation.id}`).emit("participantAdded", {
          conversationId: conversation.id,
          participant: updatedConversation.participants.find(
            (p) => p.userId === socket.data.userId
          ),
        });
      } catch (error) {
        console.error("Error joining conversation:", error);
        socket.emit("joinConversationError", "Error joining conversation");
      }
    });

    socket.on("startPrivateChat", async (username: string) => {
      try {
        const otherUser = await prisma.user.findUnique({
          where: { username },
        });

        if (!otherUser) {
          socket.emit("startPrivateChatError", "User not found");
          return;
        }

        const existingConversation = await prisma.conversation.findFirst({
          where: {
            isGroup: false,
            participants: {
              every: {
                userId: {
                  in: [socket.data.userId, otherUser.id],
                },
              },
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

        if (existingConversation) {
          socket.emit("privateChatStarted", existingConversation);
          return;
        }

        const newConversation = await prisma.conversation.create({
          data: {
            isGroup: false,
            participants: {
              create: [
                { userId: socket.data.userId },
                { userId: otherUser.id },
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

        socket.join(`conversation:${newConversation.id}`);
        socket.emit("privateChatStarted", newConversation);
        io.to(`user:${otherUser.id}`).emit("newConversation", newConversation);
      } catch (error) {
        console.error("Error starting private chat:", error);
        socket.emit("startPrivateChatError", "Error starting private chat");
      }
    });

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
              senderId: socket.data.userId,
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
      "getThreadReplies",
      async ({ parentMessageId }: { parentMessageId: number }) => {
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
            },
            orderBy: { timestamp: "asc" },
          });

          socket.emit("threadReplies", {
            parentMessageId,
            replies: threadReplies,
          });
        } catch (error) {
          console.error("Error fetching thread replies:", error);
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
      "joinConversationByInvite",
      async ({ inviteCode }: { inviteCode: string }) => {
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

          if (!conversation) {
            socket.emit("joinConversationError", "Conversation not found");
            return;
          }

          const existingParticipant = conversation.participants.find(
            (p) => p.userId === socket.data.userId
          );

          if (existingParticipant) {
            socket.emit("joinConversationError", "Already a participant");
            return;
          }

          const updatedConversation = await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              participants: {
                create: { userId: socket.data.userId },
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

          socket.join(`conversation:${conversation.id}`);
          socket.emit("joinedConversation", updatedConversation);
          socket
            .to(`conversation:${conversation.id}`)
            .emit("participantAdded", {
              conversationId: conversation.id,
              participant: updatedConversation.participants.find(
                (p) => p.userId === socket.data.userId
              ),
            });
        } catch (error) {
          console.error("Error joining conversation by invite:", error);
          socket.emit("joinConversationError", "Error joining conversation");
        }
      }
    );

    socket.on(
      "updateGroupProfile",
      async ({
        conversationId,
        name,
        groupProfile,
      }: {
        conversationId: number;
        name: string;
        groupProfile: string;
      }) => {
        try {
          const participant = await prisma.participant.findFirst({
            where: {
              userId: socket.data.userId,
              conversationId,
              isAdmin: true,
            },
          });

          if (!participant) {
            socket.emit("updateGroupProfileError", "Not authorized");
            return;
          }

          const updatedConversation = await prisma.conversation.update({
            where: { id: conversationId },
            data: {
              name,
              groupProfile,
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
        } catch (error) {
          console.error("Error updating group profile:", error);
          socket.emit(
            "updateGroupProfileError",
            "Error updating group profile"
          );
        }
      }
    );

    socket.on("getOnlineUsers", async () => {
      try {
        const onlineUsers = await prisma.user.findMany({
          where: {
            presenceStatus: {
              not: PresenceStatus.OFFLINE,
            },
          },
          select: {
            id: true,
            username: true,
            profileImage: true,
            presenceStatus: true,
          },
        });

        socket.emit("onlineUsers", onlineUsers);
      } catch (error) {
        console.error("Error fetching online users:", error);
      }
    });
    socket.on("disconnect", async () => {
      console.log("User disconnected:", socket.data.userId);

      try {
        await prisma.user.update({
          where: { id: socket.data.userId },
          data: {
            presenceStatus: PresenceStatus.OFFLINE,
            lastSeen: new Date(),
          },
        });

        socket.broadcast.emit("presenceUpdate", {
          userId: socket.data.userId,
          status: PresenceStatus.OFFLINE,
        });

        // Remove user from all typing lists when they disconnect
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
