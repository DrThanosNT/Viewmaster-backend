-- AlterTable
ALTER TABLE "Movement" ADD COLUMN     "isDamage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isTemporary" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "temporaryQuantity" INTEGER NOT NULL DEFAULT 0;
