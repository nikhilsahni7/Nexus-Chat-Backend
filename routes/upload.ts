import express from "express";
import { authenticateToken } from "../middleware/auth";
import { upload } from "../middleware/upload";
import type { AuthenticatedRequest } from "../types";
import { prisma } from "../server";
import { io } from "../server";

const router = express.Router();

router.post(
  "/file",
  authenticateToken,
  upload.single("file"),
  async (req: AuthenticatedRequest, res: express.Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { conversationId } = req.body;

    try {
      const message = await prisma.message.create({
        data: {
          senderId: req.user!.id,
          conversationId: parseInt(conversationId),
          content: req.file.path,
          contentType: req.file.mimetype.startsWith("image/")
            ? "IMAGE"
            : "VIDEO",
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

      io.to(`conversation:${message.conversationId}`).emit(
        "newMessage",
        message
      );

      res.json(message);
    } catch (error) {
      res.status(500).json({ error: "Error uploading file" });
    }
  }
);

export default router;
