/*
  Warnings:

  - You are about to drop the column `config` on the `Endpoint` table. All the data in the column will be lost.
  - You are about to drop the `EndpointResourceType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EndpointSchema` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "EndpointResourceType" DROP CONSTRAINT "EndpointResourceType_endpointId_fkey";

-- DropForeignKey
ALTER TABLE "EndpointSchema" DROP CONSTRAINT "EndpointSchema_endpointId_fkey";

-- AlterTable
ALTER TABLE "Endpoint" DROP COLUMN "config",
ADD COLUMN     "profile" JSONB;

-- DropTable
DROP TABLE "EndpointResourceType";

-- DropTable
DROP TABLE "EndpointSchema";
