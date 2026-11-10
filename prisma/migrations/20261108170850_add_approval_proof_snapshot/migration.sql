-- AlterTable
ALTER TABLE "InvoiceRequest" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "InvoiceRequest" ADD COLUMN "changesJson" TEXT;
ALTER TABLE "InvoiceRequest" ADD COLUMN "extractionReceiptId" TEXT;
ALTER TABLE "InvoiceRequest" ADD COLUMN "originalDraftJson" TEXT;
ALTER TABLE "InvoiceRequest" ADD COLUMN "proofHash" TEXT;
ALTER TABLE "InvoiceRequest" ADD COLUMN "proofSnapshotJson" TEXT;
ALTER TABLE "InvoiceRequest" ADD COLUMN "sourceNotes" TEXT;

-- CreateIndex
CREATE INDEX "InvoiceRequest_proofHash_idx" ON "InvoiceRequest"("proofHash");
