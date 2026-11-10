// ============================================================
// PROOF LEDGER TYPES
// ============================================================

export type EvidenceStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "MISSING";

export type SourceProof = {
  kind: "SOURCE";
  quote: string | null;
  status: EvidenceStatus;
  explanation: string;
};

export type DerivedProof = {
  kind: "DERIVED";
  formula: string;
  inputFields: string[];
  explanation: string;
};

export type MissingProof = {
  kind: "MISSING";
  explanation: string;
};

export type ProofEntry =
  | SourceProof
  | DerivedProof
  | MissingProof;

export type InvoiceEvidence = {
  customerName: SourceProof;
  customerEmail: SourceProof;
  description: SourceProof;
  quantity: SourceProof;
  unitPrice: ProofEntry;
  currency: SourceProof;
  paymentDueDays: SourceProof;
  statedTotal: ProofEntry;
};

// ============================================================
// TEXT NORMALIZATION
// ============================================================

function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// VERIFY A QUOTATION AGAINST ORIGINAL NOTES
// ============================================================

export function verifySourceQuote(
  sourceText: string,
  proposedQuote: string | null
): SourceProof {
  if (
    proposedQuote === null ||
    proposedQuote.trim().length === 0
  ) {
    return {
      kind: "SOURCE",
      quote: null,
      status: "MISSING",
      explanation: "No source quotation was provided.",
    };
  }

  const quote = proposedQuote.trim();

  if (quote.length > 500) {
    return {
      kind: "SOURCE",
      quote,
      status: "UNVERIFIED",
      explanation:
        "The proposed quotation exceeds the allowed length.",
    };
  }

  const normalizedSource =
    normalizeForComparison(sourceText);

  const normalizedQuote =
    normalizeForComparison(quote);

  if (normalizedSource.includes(normalizedQuote)) {
    return {
      kind: "SOURCE",
      quote,
      status: "VERIFIED",
      explanation:
        "The quotation was found in the original work notes.",
    };
  }

  return {
    kind: "SOURCE",
    quote,
    status: "UNVERIFIED",
    explanation:
      "The quotation could not be matched against the original work notes.",
  };
}

// ============================================================
// DERIVED EVIDENCE
// ============================================================

export function createDerivedProof(
  formula: string,
  inputFields: string[],
  explanation: string
): DerivedProof {
  return {
    kind: "DERIVED",
    formula,
    inputFields,
    explanation,
  };
}

// ============================================================
// MISSING EVIDENCE
// ============================================================

export function createMissingProof(
  explanation: string
): MissingProof {
  return {
    kind: "MISSING",
    explanation,
  };
}