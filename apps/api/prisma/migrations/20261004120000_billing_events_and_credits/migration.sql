-- AlterTable
ALTER TABLE "WorkspaceBilling" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AiCreditLedger" ADD COLUMN "orderId" TEXT;

-- CreateTable
CREATE TABLE "BillingEvent" (
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiCreditLedger_orderId_key" ON "AiCreditLedger"("orderId");
