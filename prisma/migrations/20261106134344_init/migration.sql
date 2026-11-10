-- CreateTable
CREATE TABLE "InvoiceRequest" (
    "requestId" TEXT NOT NULL PRIMARY KEY,
    "payloadHash" TEXT NOT NULL,
    "draftJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paypalInvoiceId" TEXT,
    "paypalStatus" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRequest_paypalInvoiceId_key" ON "InvoiceRequest"("paypalInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceRequest_status_idx" ON "InvoiceRequest"("status");

-- CreateIndex
CREATE INDEX "InvoiceRequest_createdAt_idx" ON "InvoiceRequest"("createdAt");
