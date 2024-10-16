import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import cors from "cors";
import webpush from "web-push";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth";
import profileRoutes from "./routes/profile";
import conversationRoutes from "./routes/conversations";
import messageRoutes from "./routes/messages";
import searchRoutes from "./routes/search";
import uploadRoutes from "./routes/upload";
import notificationRoutes from "./routes/notifications";
import setupSocketIO from "./socket";
import errorHandler from "./middleware/errorHandler";
import logger from "./utils/logger";
import { trackActivity } from "./middleware/trackActivity";
import { authenticateToken } from "./middleware/auth";

dotenv.config();

const app = express();
const server = createServer(app);
export const prisma = new PrismaClient();

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL ?? "http://localhost:3000",
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600, // limit each IP to 300 requests per windowMs
});
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Socket.IO setup
export const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    credentials: true,
  },
});

// Setup web push
webpush.setVapidDetails(
  `mailto:${process.env.WEBPUSH_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// Routes
app.use("/auth", authRoutes);
app.use("/profile", authenticateToken, trackActivity, profileRoutes);
app.use("/conversations", authenticateToken, trackActivity, conversationRoutes);
app.use("/messages", authenticateToken, trackActivity, messageRoutes);
app.use("/search", authenticateToken, trackActivity, searchRoutes);
app.use("/upload", authenticateToken, trackActivity, uploadRoutes);
app.use("/notifications", authenticateToken, trackActivity, notificationRoutes);

// Socket.IO event handlers
setupSocketIO(io);

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed");
    prisma.$disconnect();
  });
});

export { webpush };
