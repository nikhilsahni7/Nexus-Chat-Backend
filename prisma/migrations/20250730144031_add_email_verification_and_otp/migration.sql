-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationOTP" TEXT,
ADD COLUMN     "emailVerificationOTPExpiresAt" TIMESTAMP(3),
ADD COLUMN     "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordResetOTP" TEXT,
ADD COLUMN     "passwordResetOTPExpiresAt" TIMESTAMP(3);
