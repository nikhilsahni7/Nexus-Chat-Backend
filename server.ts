// server.ts

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import {
  PrismaClient,
  Prisma,
  PresenceStatus,
  MessageType,
} from "@prisma/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const server = createServer(app);
// const io = new Server(server);
const prisma = new PrismaClient();

app.use(
  cors({
    origin: "http://127.0.0.1:5500", // testing here with index.html
    credentials: true,
  })
);

// For the Socket.IO server
const io = new Server(server, {
  cors: {
    origin: "http://127.0.0.1:5500", // testing here with index.html
    credentials: true,
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: "application/octet-stream", limit: "10mb" }));

// Types
interface AuthenticatedRequest extends express.Request {
  user?: {
    id: number;
    username: string;
  };
}

// Authentication middleware
const authenticateToken = (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET!, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Register route
app.post("/register", async (req: express.Request, res: express.Response) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        settings: {
          create: {}, // Create default settings
        },
      },
    });
    res.status(201).json({ message: "User created", userId: user.id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        res.status(400).json({ error: "Username or email already exists" });
      } else {
        res.status(500).json({ error: "Error creating user" });
      }
    } else {
      res.status(500).json({ error: "Error creating user" });
    }
  }
});

// Login route
app.post("/login", async (req: express.Request, res: express.Response) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });

  if (user && (await bcrypt.compare(password, user.password))) {
    const accessToken = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET!
    );
    res.json({ accessToken });
  } else {
    res.status(400).json({ error: "Invalid credentials" });
  }
});

// Get user profile
app.get(
  "/profile",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user!.id;
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
      },
    });
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  }
);

// Update user profile
app.put(
  "/profile",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const userId = req.user!.id;
    const { bio, profileImage } = req.body;
    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { bio, profileImage },
        select: {
          id: true,
          username: true,
          email: true,
          profileImage: true,
          bio: true,
          presenceStatus: true,
        },
      });
      res.json(updatedUser);
    } catch (error) {
      res.status(500).json({ error: "Error updating profile" });
    }
  }
);

// Update user settings
app.put(
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

// Get conversations
app.get(
  "/conversations",
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

// Create a new conversation
app.post(
  "/conversations",
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

// Get messages for a conversation
app.get(
  "/conversations/:conversationId/messages",
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

      // Mark messages as read
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

// Search messages
app.get(
  "/search",
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

// Socket.IO connection
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
        await prisma.typingStatus.upsert({
          where: {
            userId_conversationId: {
              userId: socket.data.userId,
              conversationId,
            },
          },
          update: { isTyping, timestamp: new Date() },
          create: { userId: socket.data.userId, conversationId, isTyping },
        });
        socket.to(`conversation:${conversationId}`).emit("typingUpdate", {
          userId: socket.data.userId,
          conversationId,
          isTyping,
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
      contentType: string;
      replyToId?: number;
    }) => {
      try {
        const { conversationId, content, contentType, replyToId } = messageData;
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

        // Update last message for the conversation
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageId: message.id },
        });

        // Encrypt message content for E2EE (placeholder)
        const encryptedContent = content; // Replace with actual encryption

        io.to(`conversation:${conversationId}`).emit("newMessage", {
          ...message,
          content: encryptedContent,
        });

        // Update unread count for other participants
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
            // Remove reaction if it's the same
            await prisma.messageReaction.delete({
              where: { id: existingReaction.id },
            });
          } else {
            // Update reaction if it's different
            await prisma.messageReaction.update({
              where: { id: existingReaction.id },
              data: { reaction },
            });
          }
        } else {
          // Create new reaction
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
    } catch (error) {
      console.error("Error updating presence on disconnect:", error);
    }
  });
});

// File upload route (placeholder)
app.post(
  "/upload",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    // file uplaod code will be here
    res.status(501).json({ message: "File upload not implemented" });
  }
);

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).send("Something broke!");
  }
);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
