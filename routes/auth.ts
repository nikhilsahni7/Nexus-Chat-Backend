import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Prisma } from "@prisma/client";

const router = express.Router();

router.post(
  "/register",
  async (req: express.Request, res: express.Response) => {
    try {
      const { username, email, password } = req.body;
      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
          username,
          email,
          password: hashedPassword,
          settings: {
            create: {},
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
  }
);

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (user && (await bcrypt.compare(password, user.password))) {
    const accessToken = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET!
    );

    // Update user login information
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIP: req.ip,
        loginCount: { increment: 1 },
        lastActiveAt: new Date(),
      },
    });

    // Send both user and accessToken
    res.json({
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        lastLoginAt: updatedUser.lastLoginAt,
        loginCount: updatedUser.loginCount,
        lastActiveAt: updatedUser.lastActiveAt,
        createdAt: updatedUser.createdAt,
      },
      accessToken,
    });
  } else {
    res.status(400).json({ error: "Invalid credentials" });
  }
});

export default router;
