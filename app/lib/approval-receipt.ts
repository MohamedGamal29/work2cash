
import "server-only";

import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  verifySourceQuote,
  createDerivedProof,
  createMissingProof,
  type InvoiceEvidence,
  type ProofEntry,
  type SourceProof,
} from "@/app/lib/proof-ledger";

import {
  evaluatePricingIntegrity,
  getPricingEvidenceState,
  isPricingIntegrityResult,
  verifyMoneyQuote,
  type PricingIntegrityResult,
} from "@/app/lib/pricing-integrity";

// ============================================================
// RECEIPT CONFIGURATION
// ============================================================

const RECEIPT_VERSION = 2;
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_RECEIPT_LENGTH = 30_000;

// ============================================================
// RECEIPT TYPES
// ============================================================

export type InvoiceDraft = {
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  currency: string | null;
  paymentDueDays: number | null;
};

export type PricingBasis =
  | "PER_UNIT"
  | "TOTAL"
  | "UNKNOWN";

export type ExtractionReceiptPayload = {
  version: 2;
  receiptId: string;
  issuedAt: number;
  sourceNotes: string;
  draft: InvoiceDraft;
  pricingBasis: PricingBasis;
  statedTotal: number | null;
  unitPriceDerived: boolean;
  needsClarification: string[];
  proofLedger: InvoiceEvidence;
  pricingIntegrity: PricingIntegrityResult;
  modelUsed: string;
};

type ReceiptInput = Omit<
  ExtractionReceiptPayload,
  "version" | "receiptId" | "issuedAt" | "pricingIntegrity"
>;

export type ReceiptVerification =
  | {
      ok: true;
      payload: ExtractionReceiptPayload;
    }
  | {
      ok: false;
      message: string;
    };

// ============================================================
// SIGNING SECRET
// ============================================================

function getSigningSecret(): string {
  const secret = process.env.APPROVAL_SIGNING_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "APPROVAL_SIGNING_SECRET is missing or too short. Configure a secret containing at least 32 characters."
    );
  }

  return secret;
}

function createSignature(encodedPayload: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(encodedPayload)
    .digest("base64url");
}

// ============================================================
// GENERAL VALIDATION
// ============================================================

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNullableString(
  value: unknown
): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(
  value: unknown
): value is number | null {
  return (
    value === null ||
    (
      typeof value === "number" &&
      Number.isFinite(value)
    )
  );
}

function isValidDraft(
  value: unknown
): value is InvoiceDraft {
  if (!isObject(value)) return false;

  return (
    isNullableString(value.customerName) &&
    isNullableString(value.customerEmail) &&
    isNullableString(value.description) &&
    (
      value.quantity === null ||
      (
        typeof value.quantity === "number" &&
        Number.isInteger(value.quantity)
      )
    ) &&
    isNullableNumber(value.unitPrice) &&
    isNullableString(value.currency) &&
    (
      value.paymentDueDays === null ||
      (
        typeof value.paymentDueDays === "number" &&
        Number.isInteger(value.paymentDueDays)
      )
    )
  );
}

// ============================================================
// PROOF LEDGER VALIDATION
// ============================================================

function isProofEntry(
  value: unknown
): value is ProofEntry {
  if (
    !isObject(value) ||
    typeof value.kind !== "string"
  ) {
    return false;
  }

  if (value.kind === "SOURCE") {
    return (
      isNullableString(value.quote) &&
      ["VERIFIED", "UNVERIFIED", "MISSING"].includes(
        String(value.status)
      ) &&
      typeof value.explanation === "string"
    );
  }

  if (value.kind === "DERIVED") {
    return (
      typeof value.formula === "string" &&
      Array.isArray(value.inputFields) &&
      value.inputFields.every(
        (field) => typeof field === "string"
      ) &&
      typeof value.explanation === "string"
    );
  }

  if (value.kind === "MISSING") {
    return typeof value.explanation === "string";
  }

  return false;
}

function isValidProofLedger(
  value: unknown
): value is InvoiceEvidence {
  if (!isObject(value)) return false;

  const fields = [
    "customerName",
    "customerEmail",
    "description",
    "quantity",
    "unitPrice",
    "currency",
    "paymentDueDays",
    "statedTotal",
  ] as const;

  return fields.every((field) =>
    isProofEntry(value[field])
  );
}

// ============================================================
// RECEIPT PAYLOAD VALIDATION
// ============================================================

function isValidPayload(
  value: unknown
): value is ExtractionReceiptPayload {
  if (!isObject(value)) return false;

  return (
    value.version === RECEIPT_VERSION &&
    typeof value.receiptId === "string" &&
    typeof value.issuedAt === "number" &&
    Number.isFinite(value.issuedAt) &&
    typeof value.sourceNotes === "string" &&
    value.sourceNotes.length >= 1 &&
    value.sourceNotes.length <= 3000 &&
    isValidDraft(value.draft) &&
    ["PER_UNIT", "TOTAL", "UNKNOWN"].includes(
      String(value.pricingBasis)
    ) &&
    isNullableNumber(value.statedTotal) &&
    typeof value.unitPriceDerived === "boolean" &&
    Array.isArray(value.needsClarification) &&
    value.needsClarification.every(
      (item) => typeof item === "string"
    ) &&
    isValidProofLedger(value.proofLedger) &&
    isPricingIntegrityResult(value.pricingIntegrity) &&
    typeof value.modelUsed === "string"
  );
}

// ============================================================
// CREATE SIGNED EXTRACTION RECEIPT
// ============================================================

export function createExtractionReceipt(
  input: ReceiptInput
): string {
  const pricingIntegrity = evaluatePricingIntegrity({
    quantity: input.draft.quantity,
    unitPrice: input.draft.unitPrice,
    statedTotal: input.statedTotal,
    currency: input.draft.currency,

    quantityEvidenceStatus:
      getPricingEvidenceState(input.proofLedger.quantity),

    unitPriceEvidenceStatus:
      getPricingEvidenceState(input.proofLedger.unitPrice),

    statedTotalEvidenceStatus:
      getPricingEvidenceState(input.proofLedger.statedTotal),

    unitPriceDerived: input.unitPriceDerived,
  });

  const payload: ExtractionReceiptPayload = {
    version: RECEIPT_VERSION,
    receiptId: randomUUID(),
    issuedAt: Date.now(),

    sourceNotes: input.sourceNotes,
    draft: input.draft,

    pricingBasis: input.pricingBasis,
    statedTotal: input.statedTotal,
    unitPriceDerived: input.unitPriceDerived,

    needsClarification: input.needsClarification,
    proofLedger: input.proofLedger,
    pricingIntegrity,

    modelUsed: input.modelUsed,
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8"
  ).toString("base64url");

  const signature = createSignature(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

// ============================================================
// VERIFY SIGNED EXTRACTION RECEIPT
// ============================================================

export function verifyExtractionReceipt(
  token: unknown
): ReceiptVerification {
  if (
    typeof token !== "string" ||
    token.length === 0
  ) {
    return {
      ok: false,
      message: "An extraction receipt is required.",
    };
  }

  if (token.length > MAX_RECEIPT_LENGTH) {
    return {
      ok: false,
      message: "The extraction receipt is too large.",
    };
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return {
      ok: false,
      message: "The extraction receipt has an invalid format.",
    };
  }

  const [encodedPayload, suppliedSignature] = parts;

  if (!encodedPayload || !suppliedSignature) {
    return {
      ok: false,
      message: "The extraction receipt is incomplete.",
    };
  }

  let expectedSignature: string;

  try {
    expectedSignature = createSignature(encodedPayload);
  } catch {
    return {
      ok: false,
      message: "Server receipt signing is not configured.",
    };
  }

  const expectedBuffer = Buffer.from(
    expectedSignature,
    "utf8"
  );

  const suppliedBuffer = Buffer.from(
    suppliedSignature,
    "utf8"
  );

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    return {
      ok: false,
      message:
        "The extraction receipt signature is invalid or has been modified.",
    };
  }

  let decoded: unknown;

  try {
    const json = Buffer.from(
      encodedPayload,
      "base64url"
    ).toString("utf8");

    decoded = JSON.parse(json);
  } catch {
    return {
      ok: false,
      message: "The extraction receipt payload is invalid.",
    };
  }

  if (!isValidPayload(decoded)) {
    return {
      ok: false,
      message:
        "The extraction receipt contains invalid or outdated data. Generate a new invoice draft.",
    };
  }

  const now = Date.now();

  if (decoded.issuedAt > now + 60_000) {
    return {
      ok: false,
      message: "The extraction receipt has an invalid issue time.",
    };
  }

  if (
    now - decoded.issuedAt >
    RECEIPT_MAX_AGE_MS
  ) {
    return {
      ok: false,
      message:
        "The extraction receipt has expired. Generate a new invoice draft.",
    };
  }

  return {
    ok: true,
    payload: decoded,
  };
}

// ============================================================
// SERVER-SIDE REVALIDATION OF SOURCE EVIDENCE
// ============================================================

export function revalidateReceiptEvidence(
  payload: ExtractionReceiptPayload
): InvoiceEvidence {
  const sourceField = (
    entry: ProofEntry
  ): SourceProof => {
    if (entry.kind !== "SOURCE") {
      return {
        kind: "SOURCE",
        quote: null,
        status: "MISSING",
        explanation:
          "A source quotation is required for this field.",
      };
    }

    return verifySourceQuote(
      payload.sourceNotes,
      entry.quote
    );
  };

  // ----------------------------------------------------------
  // UNIT PRICE
  // ----------------------------------------------------------


  let unitPrice: ProofEntry;

  if (payload.unitPriceDerived) {
    const quantity = payload.draft.quantity;
    const statedTotal = payload.statedTotal;
    const derivedUnitPrice = payload.draft.unitPrice;

    if (
      payload.pricingBasis !== "TOTAL" ||
      quantity === null ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      statedTotal === null ||
      !Number.isFinite(statedTotal) ||
      statedTotal <= 0 ||
      derivedUnitPrice === null
    ) {
      throw new Error(
        "The derived unit price does not have valid source calculation inputs."
      );
    }

    const totalCents = Math.round(statedTotal * 100);

    const unitPriceCents = Math.round(
      derivedUnitPrice * 100
    );

    if (
      Math.abs(statedTotal * 100 - totalCents) > 0.000001 ||
      totalCents % quantity !== 0 ||
      totalCents / quantity !== unitPriceCents
    ) {
      throw new Error(
        "The derived unit price does not match the stated total and quantity."
      );
    }

    unitPrice = createDerivedProof(
      `${totalCents} cents / ${quantity} = ${unitPriceCents} cents`,
      ["statedTotal", "quantity"],
      "Recalculated on the server using integer cents from the signed stated total and quantity."
    );
  } else if (payload.draft.unitPrice !== null) {
    unitPrice = verifyMoneyQuote(
      payload.sourceNotes,
      payload.proofLedger.unitPrice.kind === "SOURCE"
        ? payload.proofLedger.unitPrice.quote
        : null,
      payload.draft.unitPrice
    );
  } else {
    unitPrice = createMissingProof(
      "No independently verifiable unit price is available."
    );
  }


  // ----------------------------------------------------------
  // STATED TOTAL
  // ----------------------------------------------------------

  const statedTotal: ProofEntry =
    payload.statedTotal !== null
      ? verifyMoneyQuote(
          payload.sourceNotes,
          payload.proofLedger.statedTotal.kind === "SOURCE"
            ? payload.proofLedger.statedTotal.quote
            : null,
          payload.statedTotal
        )
      : createMissingProof(
          "No independently stated total is available."
        );

  // ----------------------------------------------------------
  // REBUILD COMPLETE PROOF LEDGER
  // ----------------------------------------------------------

  return {
    customerName: sourceField(
      payload.proofLedger.customerName
    ),

    customerEmail: sourceField(
      payload.proofLedger.customerEmail
    ),

    description: sourceField(
      payload.proofLedger.description
    ),

    quantity: sourceField(
      payload.proofLedger.quantity
    ),

    unitPrice,

    currency: sourceField(
      payload.proofLedger.currency
    ),

    paymentDueDays: sourceField(
      payload.proofLedger.paymentDueDays
    ),

    statedTotal,
  };
}
