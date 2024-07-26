/*
  Warnings:

  - A unique constraint covering the columns `[inviteCode]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "groupProfile" TEXT,
ADD COLUMN     "inviteCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_inviteCode_key" ON "Conversation"("inviteCode");
