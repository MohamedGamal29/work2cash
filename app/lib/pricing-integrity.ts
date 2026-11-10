
import {
  verifySourceQuote,
  type ProofEntry,
  type SourceProof,
} from "./proof-ledger";

// ============================================================
// PRICING INTEGRITY CONTRACT
// ============================================================

export type PricingEvidenceState =
  | "VERIFIED"
  | "UNVERIFIED"
  | "MISSING"
  | "DERIVED"
  | "USER_CONFIRMED";

export type PricingIntegrityStatus =
  | "CONSISTENT"
  | "CONFLICT"
  | "DERIVED"
  | "INSUFFICIENT_DATA"
  | "UNVERIFIED"
  | "INVALID";

export type PricingIntegrityResult = {
  version: 1;
  status: PricingIntegrityStatus;
  comparisonMode: "INDEPENDENT" | "DERIVED" | "INCOMPLETE";
  quantity: number | null;
  unitPrice: number | null;
  statedTotal: number | null;
  calculatedTotal: number | null;
  difference: number | null;
  currency: string | null;
  canApprove: boolean;
  message: string;
};

export type PricingIntegrityInput = {
  quantity: number | null;
  unitPrice: number | null;
  statedTotal: number | null;
  currency: string | null;

  quantityEvidenceStatus: PricingEvidenceState;
  unitPriceEvidenceStatus: PricingEvidenceState;
  statedTotalEvidenceStatus: PricingEvidenceState;

  unitPriceDerived?: boolean;
};

// ============================================================
// INTEGER MONEY
// ============================================================

export function moneyToCents(
  value: number
): number | null {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  const scaled = value * 100;
  const rounded = Math.round(scaled);

  if (
    Math.abs(scaled - rounded) > 0.000001 ||
    !Number.isSafeInteger(rounded)
  ) {
    return null;
  }

  return rounded;
}

function centsToMoney(cents: number): number {
  return cents / 100;
}

// ============================================================
// SOURCE QUOTATION NUMBER EXTRACTION
// ============================================================

function normalizeDigits(value: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

  return value
    .replace(/[٠-٩]/g, (digit) =>
      String(arabicDigits.indexOf(digit))
    )
    .replace(/[٫]/g, ".")
    .replace(/[٬]/g, ",");
}

function extractMoneyAmounts(
  quotation: string
): number[] {
  const normalized = normalizeDigits(
    quotation.normalize("NFKC")
  );

  const matches = normalized.match(
    /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g
  );

  if (!matches) {
    return [];
  }

  return matches
    .map((match) => Number(match.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

// ============================================================
// VERIFY THAT THE QUOTE CONTAINS THE EXTRACTED AMOUNT
// ============================================================

export function verifyMoneyQuote(
  sourceText: string,
  proposedQuote: string | null,
  expectedAmount: number
): SourceProof {
  const sourceProof = verifySourceQuote(
    sourceText,
    proposedQuote
  );

  if (sourceProof.status !== "VERIFIED") {
    return sourceProof;
  }

  const expectedCents = moneyToCents(expectedAmount);

  if (expectedCents === null) {
    return {
      ...sourceProof,
      status: "UNVERIFIED",
      explanation:
        "The extracted monetary amount is invalid.",
    };
  }

  const quotedAmounts = extractMoneyAmounts(
    sourceProof.quote ?? ""
  );

  const amountExists = quotedAmounts.some(
    (amount) => moneyToCents(amount) === expectedCents
  );

  if (!amountExists) {
    return {
      ...sourceProof,
      status: "UNVERIFIED",
      explanation:
        "The quotation exists in the original notes, but it does not contain the extracted monetary amount.",
    };
  }

  return {
    ...sourceProof,
    status: "VERIFIED",
    explanation:
      "The original quotation exists and contains the extracted monetary amount.",
  };
}

// ============================================================
// MAP PROOF LEDGER ENTRIES TO PRICING EVIDENCE STATES
// ============================================================

export function getPricingEvidenceState(
  entry: ProofEntry
): PricingEvidenceState {
  if (entry.kind === "DERIVED") {
    return "DERIVED";
  }

  if (entry.kind === "MISSING") {
    return "MISSING";
  }

  return entry.status;
}

function isTrustedEvidence(
  status: PricingEvidenceState
): boolean {
  return (
    status === "VERIFIED" ||
    status === "DERIVED" ||
    status === "USER_CONFIRMED"
  );
}

// ============================================================
// STANDARD RESULT BUILDER
// ============================================================

function result(
  input: PricingIntegrityInput,
  values: Omit<
    PricingIntegrityResult,
    "version" |
    "quantity" |
    "unitPrice" |
    "statedTotal" |
    "currency"
  >
): PricingIntegrityResult {
  return {
    version: 1,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    statedTotal: input.statedTotal,
    currency: input.currency,
    ...values,
  };
}

// ============================================================
// DETERMINISTIC FINANCIAL VERIFICATION
// ============================================================

export function evaluatePricingIntegrity(
  input: PricingIntegrityInput
): PricingIntegrityResult {
  const {
    quantity,
    unitPrice,
    statedTotal,
    currency,
    quantityEvidenceStatus,
    unitPriceEvidenceStatus,
    statedTotalEvidenceStatus,
    unitPriceDerived = false,
  } = input;

  // ----------------------------------------------------------
  // 1. Validate any supplied financial values.
  // ----------------------------------------------------------

  if (
    quantity !== null &&
    (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    )
  ) {
    return result(input, {
      status: "INVALID",
      comparisonMode: "INCOMPLETE",
      calculatedTotal: null,
      difference: null,
      canApprove: false,
      message: "Quantity is outside the supported range.",
    });
  }

  const unitCents =
    unitPrice === null
      ? null
      : moneyToCents(unitPrice);

  const totalCents =
    statedTotal === null
      ? null
      : moneyToCents(statedTotal);

  if (
    unitPrice !== null &&
    unitCents === null
  ) {
    return result(input, {
      status: "INVALID",
      comparisonMode: "INCOMPLETE",
      calculatedTotal: null,
      difference: null,
      canApprove: false,
      message:
        "Unit price must be positive and representable to two decimal places.",
    });
  }

  if (
    statedTotal !== null &&
    totalCents === null
  ) {
    return result(input, {
      status: "INVALID",
      comparisonMode: "INCOMPLETE",
      calculatedTotal: null,
      difference: null,
      canApprove: false,
      message:
        "Stated total must be positive and representable to two decimal places.",
    });
  }

  // ----------------------------------------------------------
  // 2. Calculate the expected total when possible.
  // ----------------------------------------------------------

  const calculatedCents =
    quantity !== null && unitCents !== null
      ? quantity * unitCents
      : null;

  if (
    calculatedCents !== null &&
    !Number.isSafeInteger(calculatedCents)
  ) {
    return result(input, {
      status: "INVALID",
      comparisonMode: "INCOMPLETE",
      calculatedTotal: null,
      difference: null,
      canApprove: false,
      message:
        "The calculated invoice total exceeds the safe financial calculation range.",
    });
  }

  // ----------------------------------------------------------
  // 3. Reject supplied financial claims with unverified evidence.
  // ----------------------------------------------------------

  const hasUnverifiedSuppliedClaim =
    (quantity !== null &&
      !isTrustedEvidence(quantityEvidenceStatus)) ||
    (unitPrice !== null &&
      !isTrustedEvidence(unitPriceEvidenceStatus)) ||
    (statedTotal !== null &&
      !isTrustedEvidence(statedTotalEvidenceStatus)) ||
    statedTotalEvidenceStatus === "UNVERIFIED";

  if (hasUnverifiedSuppliedClaim) {
    return result(input, {
      status: "UNVERIFIED",
      comparisonMode: "INCOMPLETE",
      calculatedTotal:
        calculatedCents === null
          ? null
          : centsToMoney(calculatedCents),
      difference: null,
      canApprove: false,
      message:
        "One or more supplied financial claims could not be verified against their original source evidence. Review or correct the affected values before approval.",
    });
  }

  // ----------------------------------------------------------
  // 4. There is no independently stated total to compare.
  // ----------------------------------------------------------

  if (
    quantity === null ||
    unitCents === null ||
    totalCents === null
  ) {
    return result(input, {
      status: "INSUFFICIENT_DATA",
      comparisonMode: "INCOMPLETE",
      calculatedTotal:
        calculatedCents === null
          ? null
          : centsToMoney(calculatedCents),
      difference: null,
      canApprove: true,
      message:
        "There is not enough independently stated pricing information to compare a unit price against a job total.",
    });
  }

  // ----------------------------------------------------------
  // 4. Require evidence for independent financial claims.
  // ----------------------------------------------------------

  const evidenceIsTrusted =
    isTrustedEvidence(quantityEvidenceStatus) &&
    isTrustedEvidence(unitPriceEvidenceStatus) &&
    isTrustedEvidence(statedTotalEvidenceStatus);

  if (!evidenceIsTrusted) {
    return result(input, {
      status: "UNVERIFIED",
      comparisonMode: "INCOMPLETE",
      calculatedTotal: centsToMoney(calculatedCents!),
      difference: null,
      canApprove: false,
      message:
        "The financial comparison contains claims that have not been sufficiently verified. Review or correct the affected information.",
    });
  }

  // ----------------------------------------------------------
  // 5. Compare exact integer cents.
  // ----------------------------------------------------------

  const differenceCents = calculatedCents! - totalCents;

  if (differenceCents !== 0) {
    const difference = centsToMoney(
      differenceCents
    );

    return result(input, {
      status: "CONFLICT",
      comparisonMode: "INDEPENDENT",
      calculatedTotal: centsToMoney(calculatedCents!),
      difference,
      canApprove: false,
      message:
        `The calculated total (${centsToMoney(calculatedCents!).toFixed(2)} ${currency ?? ""}) does not match the independently stated total (${centsToMoney(totalCents).toFixed(2)} ${currency ?? ""}). Resolve the ${Math.abs(difference).toFixed(2)} discrepancy before approval.`,
    });
  }

  // ----------------------------------------------------------
  // 6. Consistent independent claims or derived calculation.
  // ----------------------------------------------------------

  if (unitPriceDerived) {
    return result(input, {
      status: "DERIVED",
      comparisonMode: "DERIVED",
      calculatedTotal: centsToMoney(calculatedCents!),
      difference: 0,
      canApprove: true,
      message:
        "The unit price was derived from the independently stated total and quantity. The arithmetic is exact.",
    });
  }

  return result(input, {
    status: "CONSISTENT",
    comparisonMode: "INDEPENDENT",
    calculatedTotal: centsToMoney(calculatedCents!),
    difference: 0,
    canApprove: true,
    message:
      "The independently stated total agrees with quantity multiplied by unit price.",
  });
}

// ============================================================
// VALIDATE RECEIPT PRICING INTEGRITY STRUCTURE
// ============================================================

export function isPricingIntegrityResult(
  value: unknown
): value is PricingIntegrityResult {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    item.version === 1 &&
    [
      "CONSISTENT",
      "CONFLICT",
      "DERIVED",
      "INSUFFICIENT_DATA",
      "UNVERIFIED",
      "INVALID",
    ].includes(String(item.status)) &&
    [
      "INDEPENDENT",
      "DERIVED",
      "INCOMPLETE",
    ].includes(String(item.comparisonMode)) &&
    typeof item.canApprove === "boolean" &&
    typeof item.message === "string" &&
    (
      item.quantity === null ||
      typeof item.quantity === "number"
    ) &&
    (
      item.unitPrice === null ||
      typeof item.unitPrice === "number"
    ) &&
    (
      item.statedTotal === null ||
      typeof item.statedTotal === "number"
    ) &&
    (
      item.calculatedTotal === null ||
      typeof item.calculatedTotal === "number"
    ) &&
    (
      item.difference === null ||
      typeof item.difference === "number"
    ) &&
    (
      item.currency === null ||
      typeof item.currency === "string"
    )
  );
}
