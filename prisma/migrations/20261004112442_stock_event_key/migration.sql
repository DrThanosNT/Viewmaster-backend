/*
  Warnings:

  - A unique constraint covering the columns `[itemId,locationId,eventKey]` on the table `Stock` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Stock_itemId_locationId_eventId_key";

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "eventKey" TEXT NOT NULL DEFAULT 'none';

-- CreateIndex
CREATE UNIQUE INDEX "Stock_itemId_locationId_eventKey_key" ON "Stock"("itemId", "locationId", "eventKey");
