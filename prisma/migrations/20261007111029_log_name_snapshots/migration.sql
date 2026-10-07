/*
  Warnings:

  - Added the required column `itemName` to the `Movement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `toLocationName` to the `Movement` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Movement" DROP CONSTRAINT "Movement_itemId_fkey";

-- DropForeignKey
ALTER TABLE "Movement" DROP CONSTRAINT "Movement_toLocationId_fkey";

-- AlterTable
ALTER TABLE "Movement" ADD COLUMN     "eventName" TEXT,
ADD COLUMN     "fromLocationName" TEXT,
ADD COLUMN     "itemName" TEXT NOT NULL,
ADD COLUMN     "moverName" TEXT,
ADD COLUMN     "toLocationName" TEXT NOT NULL,
ALTER COLUMN "itemId" DROP NOT NULL,
ALTER COLUMN "toLocationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
