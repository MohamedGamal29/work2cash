
import "server-only";

import { createHash } from "node:crypto";

import {
  revalidateReceiptEvidence,
  type ExtractionReceiptPayload,
  type InvoiceDraft,
} from "@/app/lib/approval-receipt";

import {
  evaluatePricingIntegrity,
  getPricingEvidenceState,
  type PricingIntegrityResult,
} from "@/app/lib/pricing-integrity";

// ============================================================
// APPROVAL SNAPSHOT TYPES
// ============================================================

const DRAFT_FIELDS = [
  "customerName",
  "customerEmail",
  "description",
  "quantity",
  "unitPrice",
  "currency",
  "paymentDueDays",
] as const;

type DraftField = (typeof DRAFT_FIELDS)[number];

type FieldChange = {
  field: DraftField;
  originalValue: string | number | null;
  approvedValue: string | number | null;
};

type ApprovalSnapshotCore = {
  version: 2;
  requestId: string;
  extractionReceiptId: string;
  modelUsed: string;
  issuedAt: number;
  approvedAt: string;
  sourceNotes: string;
  pricingBasis: ExtractionReceiptPayload["pricingBasis"];
  statedTotal: number | null;
  unitPriceDerived: boolean;
  originalDraft: InvoiceDraft;
  approvedDraft: InvoiceDraft;

  // Integrity of the original AI extraction.
  extractionIntegrity: PricingIntegrityResult;

  // Integrity after human review and correction.
  approvalIntegrity: PricingIntegrityResult;

  evidence: ReturnType<typeof revalidateReceiptEvidence>;
  changes: FieldChange[];
};

export type ApprovalSnapshotResult = {
  proofHash: string;
  approvedAt: Date;
  snapshotJson: string;
  changesJson: string;
  changeCount: number;
};

// ============================================================
// FINANCIAL APPROVAL BLOCK ERROR
// ============================================================

export class ApprovalPricingBlockedError extends Error {
  constructor(
    public readonly pricingIntegrity: PricingIntegrityResult
  ) {
    super(pricingIntegrity.message);
    this.name = "ApprovalPricingBlockedError";
  }
}

// ============================================================
// CREATE IMMUTABLE APPROVAL SNAPSHOT
// ============================================================

export function createApprovalSnapshot(
  requestId: string,
  receipt: ExtractionReceiptPayload,
  approvedDraft: InvoiceDraft
): ApprovalSnapshotResult {
  // ----------------------------------------------------------
  // 1. Revalidate source evidence.
  // ----------------------------------------------------------

  const evidence = revalidateReceiptEvidence(receipt);

  // ----------------------------------------------------------
  // 2. Recalculate original extraction integrity.
  // ----------------------------------------------------------

  const extractionIntegrity = evaluatePricingIntegrity({
    quantity: receipt.draft.quantity,
    unitPrice: receipt.draft.unitPrice,
    statedTotal: receipt.statedTotal,
    currency: receipt.draft.currency,

    quantityEvidenceStatus:
      getPricingEvidenceState(evidence.quantity),

    unitPriceEvidenceStatus:
      getPricingEvidenceState(evidence.unitPrice),

    statedTotalEvidenceStatus:
      getPricingEvidenceState(evidence.statedTotal),

    unitPriceDerived: receipt.unitPriceDerived,
  });

  // ----------------------------------------------------------
  // 3. Verify the human-approved financial values.
  //
  // The approval API is reached only after the user has
  // explicitly approved the invoice in the application.
  //
  // The independently stated total must still have verified
  // source evidence. The approved quantity and unit price
  // are the values explicitly accepted by the user.
  // ----------------------------------------------------------

  const approvalIntegrity = evaluatePricingIntegrity({
    quantity: approvedDraft.quantity,
    unitPrice: approvedDraft.unitPrice,
    statedTotal: receipt.statedTotal,
    currency: approvedDraft.currency,

    quantityEvidenceStatus: "USER_CONFIRMED",
    unitPriceEvidenceStatus: "USER_CONFIRMED",

    statedTotalEvidenceStatus:
      getPricingEvidenceState(evidence.statedTotal),

    // An edited price is now an explicitly user-approved value,
    // not an independently derived unit price.
    unitPriceDerived:
      receipt.unitPriceDerived &&
      approvedDraft.quantity === receipt.draft.quantity &&
      approvedDraft.unitPrice === receipt.draft.unitPrice,
  });

  // ----------------------------------------------------------
  // 4. Never authorize an unresolved pricing conflict.
  // ----------------------------------------------------------

  if (!approvalIntegrity.canApprove) {
    throw new ApprovalPricingBlockedError(
      approvalIntegrity
    );
  }

  // ----------------------------------------------------------
  // 5. Record every human edit.
  // ----------------------------------------------------------

  const changes: FieldChange[] = DRAFT_FIELDS
    .filter(
      (field) =>
        receipt.draft[field] !== approvedDraft[field]
    )
    .map((field) => ({
      field,
      originalValue: receipt.draft[field],
      approvedValue: approvedDraft[field],
    }));

  const approvedAt = new Date();

  // ----------------------------------------------------------
  // 6. Build the complete audit snapshot.
  // ----------------------------------------------------------

  const snapshotCore: ApprovalSnapshotCore = {
    version: 2,

    requestId,
    extractionReceiptId: receipt.receiptId,
    modelUsed: receipt.modelUsed,

    issuedAt: receipt.issuedAt,
    approvedAt: approvedAt.toISOString(),

    sourceNotes: receipt.sourceNotes,

    pricingBasis: receipt.pricingBasis,
    statedTotal: receipt.statedTotal,
    unitPriceDerived: receipt.unitPriceDerived,

    originalDraft: receipt.draft,
    approvedDraft,

    extractionIntegrity,
    approvalIntegrity,

    evidence,
    changes,
  };

  // ----------------------------------------------------------
  // 7. Hash the complete snapshot.
  //
  // The hash itself is excluded from its own calculation.
  // ----------------------------------------------------------

  const proofHash = createHash("sha256")
    .update(JSON.stringify(snapshotCore), "utf8")
    .digest("hex");

  const snapshot = {
    ...snapshotCore,
    proofHash,
  };

  // ----------------------------------------------------------
  // 8. Return values for persistent database storage.
  // ----------------------------------------------------------

  return {
    proofHash,
    approvedAt,
    snapshotJson: JSON.stringify(snapshot),
    changesJson: JSON.stringify(changes),
    changeCount: changes.length,
  };
}
