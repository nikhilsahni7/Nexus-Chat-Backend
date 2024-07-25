import express from "express";
import { prisma } from "../server";
import { authenticateToken } from "../middleware/auth";
import type { AuthenticatedRequest } from "../types";
import { webpush } from "../server";

const router = express.Router();

router.post(
  "/subscribe",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    const subscription = req.body;
    const userId = req.user!.id;

    try {
      await prisma.pushSubscription.create({
        data: {
          userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      });

      res.status(201).json({ message: "Subscription added successfully" });
    } catch (error) {
      console.error("Error adding push subscription:", error);
      res.status(500).json({ error: "Error adding push subscription" });
    }
  }
);

export async function sendNotification(userId: number, payload: any) {
  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    const sendPromises = subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify(payload)
        );
      } catch (error: any) {
        console.error("Error sending push notification:", error);
        if (error.statusCode === 410) {
          await prisma.pushSubscription.delete({
            where: { id: subscription.id },
          });
        }
      }
    });

    await Promise.all(sendPromises);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
  }
}

export default router;
