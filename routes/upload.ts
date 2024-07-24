import express from "express";
import { authenticateToken } from "../middleware/auth";
import type { AuthenticatedRequest } from "../types";

const router = express.Router();

router.post(
  "/",
  authenticateToken,
  async (req: AuthenticatedRequest, res: express.Response) => {
    // file upload code will be here
    res.status(501).json({ message: "File upload not implemented" });
  }
);

export default router;
