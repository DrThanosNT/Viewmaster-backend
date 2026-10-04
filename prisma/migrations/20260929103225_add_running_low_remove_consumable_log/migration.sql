/*
  Warnings:

  - You are about to drop the `ConsumableStatusLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ConsumableStatusLog" DROP CONSTRAINT "ConsumableStatusLog_itemId_fkey";

-- DropForeignKey
ALTER TABLE "ConsumableStatusLog" DROP CONSTRAINT "ConsumableStatusLog_locationId_fkey";

-- DropForeignKey
ALTER TABLE "ConsumableStatusLog" DROP CONSTRAINT "ConsumableStatusLog_setById_fkey";

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "runningLow" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "ConsumableStatusLog";

-- DropEnum
DROP TYPE "ConsumableStatus";
