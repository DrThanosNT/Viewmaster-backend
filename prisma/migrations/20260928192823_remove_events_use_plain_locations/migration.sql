/*
  Warnings:

  - The values [EVENT] on the enum `LocationType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `eventId` on the `Location` table. All the data in the column will be lost.
  - You are about to drop the `Event` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EventCrew` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EventItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EventNote` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "LocationType_new" AS ENUM ('STORAGE', 'VEHICLE', 'OTHER');
ALTER TABLE "Location" ALTER COLUMN "type" TYPE "LocationType_new" USING ("type"::text::"LocationType_new");
ALTER TYPE "LocationType" RENAME TO "LocationType_old";
ALTER TYPE "LocationType_new" RENAME TO "LocationType";
DROP TYPE "LocationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "EventCrew" DROP CONSTRAINT "EventCrew_eventId_fkey";

-- DropForeignKey
ALTER TABLE "EventCrew" DROP CONSTRAINT "EventCrew_userId_fkey";

-- DropForeignKey
ALTER TABLE "EventItem" DROP CONSTRAINT "EventItem_eventId_fkey";

-- DropForeignKey
ALTER TABLE "EventItem" DROP CONSTRAINT "EventItem_itemId_fkey";

-- DropForeignKey
ALTER TABLE "EventNote" DROP CONSTRAINT "EventNote_eventId_fkey";

-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_eventId_fkey";

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "eventId",
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "Event";

-- DropTable
DROP TABLE "EventCrew";

-- DropTable
DROP TABLE "EventItem";

-- DropTable
DROP TABLE "EventNote";

-- DropEnum
DROP TYPE "EventItemStatus";

-- DropEnum
DROP TYPE "EventStatus";
