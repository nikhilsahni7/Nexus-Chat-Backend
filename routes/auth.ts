import { Prisma } from "@prisma/client";
import bcrypt from "bcrypt";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../server";
import { sendEmail } from "../utils/email";

const router = express.Router();

// Helper to generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post(
  "/register",
  async (req: express.Request, res: express.Response) => {
    try {
      const { username, email, password } = req.body;
      const hashedPassword = await bcrypt.hash(password, 12);
      const otp = generateOTP();
      const otpExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

      const user = await prisma.user.create({
        data: {
          username,
          email,
          password: hashedPassword,
          isEmailVerified: false,
          emailVerificationOTP: otp,
          emailVerificationOTPExpiresAt: otpExpires,
          settings: {
            create: {},
          },
        },
      });

      await sendEmail({
        to: email,
        subject: "Nexus Chat Email Verification",
        html: `<p>Your OTP is <b>${otp}</b>. It expires in 15 minutes.</p>`,
      });

      res
        .status(201)
        .json({ message: "User created. Please verify your email." });
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

// Verify Email OTP
router.post("/verify-email", async (req, res) => {
  const { email, otp } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (
    !user ||
    user.emailVerificationOTP !== otp ||
    !user.emailVerificationOTPExpiresAt ||
    user.emailVerificationOTPExpiresAt < new Date()
  ) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }
  await prisma.user.update({
    where: { email },
    data: {
      isEmailVerified: true,
      emailVerificationOTP: null,
      emailVerificationOTPExpiresAt: null,
    },
  });
  res.json({ message: "Email verified successfully" });
});

// Resend Email OTP
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: {
        emailVerificationOTP: otp,
        emailVerificationOTPExpiresAt: otpExpires,
      },
    });

    await sendEmail({
      to: email,
      subject: "Nexus Chat Email Verification (Resend)",
      html: `<p>Your OTP is <b>${otp}</b>. It expires in 15 minutes.</p>`,
    });

    res.json({ message: "OTP resent" });
  } catch (error) {
    res.status(500).json({ error: "Failed to resend OTP" });
  }
});

// Forgot Password (send OTP)
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: { passwordResetOTP: otp, passwordResetOTPExpiresAt: otpExpires },
    });

    await sendEmail({
      to: email,
      subject: "Nexus Chat Password Reset",
      html: `<p>Your password reset OTP is <b>${otp}</b>. It expires in 15 minutes.</p>`,
    });

    res.json({ message: "Password reset OTP sent" });
  } catch (error) {
    res.status(500).json({ error: "Failed to send password reset OTP" });
  }
});

// Reset Password (with OTP)
router.post("/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (
    !user ||
    user.passwordResetOTP !== otp ||
    !user.passwordResetOTPExpiresAt ||
    user.passwordResetOTPExpiresAt < new Date()
  ) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }
  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { email },
    data: {
      password: hashedPassword,
      passwordResetOTP: null,
      passwordResetOTPExpiresAt: null,
    },
  });
  res.json({ message: "Password reset successful" });
});

export default router;
