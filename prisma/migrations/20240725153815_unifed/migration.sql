/*
  Warnings:

  - You are about to drop the column `replyToId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the `_ReceivedMessages` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_replyToId_fkey";

-- DropForeignKey
ALTER TABLE "_ReceivedMessages" DROP CONSTRAINT "_ReceivedMessages_A_fkey";

-- DropForeignKey
ALTER TABLE "_ReceivedMessages" DROP CONSTRAINT "_ReceivedMessages_B_fkey";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "replyToId",
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DropTable
DROP TABLE "_ReceivedMessages";
