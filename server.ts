import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import cors from "cors";
import webpush from "web-push";
import authRoutes from "./routes/auth";
import profileRoutes from "./routes/profile";
import conversationRoutes from "./routes/conversations";
import messageRoutes from "./routes/messages";
import searchRoutes from "./routes/search";
import uploadRoutes from "./routes/upload";
import setupSocketIO from "./socket";

dotenv.config();

const app = express();
const server = createServer(app);
export const prisma = new PrismaClient();

app.use(
  cors({
    origin: "http://127.0.0.1:5500",
    credentials: true,
  })
);

export const io = new Server(server, {
  cors: {
    origin: "http://127.0.0.1:5500",
    credentials: true,
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup web push
webpush.setVapidDetails(
  "mailto:nikhil.sahni321@gmail.com",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

app.use("/auth", authRoutes);
app.use("/profile", profileRoutes);
app.use("/conversations", conversationRoutes);
app.use("/messages", messageRoutes);
app.use("/search", searchRoutes);
app.use("/upload", uploadRoutes);

setupSocketIO(io);

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

export { webpush };
