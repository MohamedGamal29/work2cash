// ============================================================
// PROOF GATE
//
// A deterministic checkpoint that any AI agent must pass before it
// is allowed to create a PayPal invoice. The agent submits CLAIMS,
// each with a verbatim quotation from the original work notes. The
// gate never trusts the agent: it re-verifies every quotation, checks
// that the quoted words actually contain the claimed value, recomputes
// the money in integer cents, and refuses evidence that reads like an
// instruction to an AI.
//
// Verdicts
//   ALLOW   every required claim is traced to the notes, money agrees.
//   REVIEW  a human must look (missing or weakly supported details).
//   BLOCK   a money- or routing-bearing claim failed. Nothing may be
//           sent to PayPal.
//
// This module reuses the same primitives as the Proof Ledger
// (verifySourceQuote, verifyMoneyQuote, evaluatePricingIntegrity), so
// the agent path and the human path can never disagree about money.
// ============================================================

import { createHash } from "node:crypto";

import {
  verifySourceQuote,
  type EvidenceStatus,
} from "./proof-ledger";

import {
  evaluatePricingIntegrity,
  moneyToCents,
  verifyMoneyQuote,
  type PricingEvidenceState,
  type PricingIntegrityResult,
} from "./pricing-integrity";

import {
  locateQuote,
  spansOverlap,
  type QuoteSpan,
} from "./evidence-spans";

// ============================================================
// TYPES
// ============================================================

export const POLICY_VERSION = 1;

export const GATE_FIELDS = [
  "customerName",
  "customerEmail",
  "description",
  "quantity",
  "unitPrice",
  "currency",
  "paymentDueDays",
  "statedTotal",
] as const;

export type GateField = (typeof GATE_FIELDS)[number];

export type GateClaim = {
  value: string | number | null;
  quote: string | null;
};

export type GateInput = {
  sourceText: string;
  claims: Partial<Record<GateField, GateClaim>>;
};

export type GateVerdict = "ALLOW" | "REVIEW" | "BLOCK";

export type GateFieldStatus = EvidenceStatus | "DERIVED";

export type GateFieldResult = {
  field: GateField;
  value: string | number | null;
  quote: string | null;
  status: GateFieldStatus;
  explanation: string;
  span: QuoteSpan | null;
  critical: boolean;
};

export type GateReason = {
  code:
    | "UNVERIFIED_CLAIM"
    | "PRICE_CONFLICT"
    | "PRICE_INVALID"
    | "POLICY_LIMIT"
    | "POLICY_CURRENCY"
    | "INSTRUCTION_AS_EVIDENCE"
    | "INJECTION_SIGNAL"
    | "MISSING_FIELD"
    | "WEAK_EVIDENCE";
  severity: "BLOCK" | "REVIEW";
  field?: GateField;
  message: string;
};

export type InjectionSignal = {
  id: string;
  text: string;
  span: QuoteSpan;
};

export type GateResult = {
  policyVersion: typeof POLICY_VERSION;
  verdict: GateVerdict;
  reasons: GateReason[];
  fields: Record<GateField, GateFieldResult>;
  pricing: PricingIntegrityResult;
  calculatedTotal: number | null;
  injectionSignals: InjectionSignal[];
  sourceSha256: string;
  proofHash: string;
};

// ============================================================
// POLICY CONSTANTS
// These mirror validate-invoice.ts so the gate is never looser than
// the approval pipeline it protects.
// ============================================================

const MAX_SOURCE_LENGTH = 3000;
const MAX_QUOTE_LENGTH = 500;
const MAX_UNIT_PRICE = 10_000;
const MAX_TOTAL_CENTS = 1_000_000;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 100;

// Fields whose failure can redirect or inflate a payment demand.
const CRITICAL_FIELDS: ReadonlySet<GateField> = new Set([
  "quantity",
  "unitPrice",
  "statedTotal",
  "currency",
  "customerEmail",
]);

const REQUIRED_FIELDS: readonly GateField[] = [
  "customerName",
  "customerEmail",
  "description",
  "quantity",
  "unitPrice",
  "currency",
  "paymentDueDays",
];

const FIELD_LABELS: Record<GateField, string> = {
  customerName: "Customer name",
  customerEmail: "Customer email",
  description: "Work description",
  quantity: "Quantity",
  unitPrice: "Unit price",
  currency: "Currency",
  paymentDueDays: "Payment terms",
  statedTotal: "Stated total",
};

// ============================================================
// INPUT PARSING
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function parseGateInput(
  raw: unknown
):
  | { ok: true; input: GateInput }
  | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const sourceText = raw.sourceText;

  if (
    typeof sourceText !== "string" ||
    sourceText.trim().length === 0 ||
    sourceText.length > MAX_SOURCE_LENGTH
  ) {
    return {
      ok: false,
      error: `sourceText must be a string of 1–${MAX_SOURCE_LENGTH} characters.`,
    };
  }

  if (!isRecord(raw.claims)) {
    return { ok: false, error: "claims must be an object." };
  }

  const claims: Partial<Record<GateField, GateClaim>> = {};

  for (const [key, value] of Object.entries(raw.claims)) {
    if (!(GATE_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `Unknown claim field: ${key}.` };
    }

    if (!isRecord(value)) {
      return {
        ok: false,
        error: `Claim ${key} must be an object with value and quote.`,
      };
    }

    const claimValue = value.value;
    const claimQuote = value.quote;

    const validValue =
      claimValue === null ||
      typeof claimValue === "string" ||
      (typeof claimValue === "number" && Number.isFinite(claimValue));

    const validQuote =
      claimQuote === null ||
      claimQuote === undefined ||
      (typeof claimQuote === "string" &&
        claimQuote.length <= MAX_QUOTE_LENGTH);

    if (!validValue || !validQuote) {
      return {
        ok: false,
        error: `Claim ${key} has an invalid value or quote.`,
      };
    }

    claims[key as GateField] = {
      value: claimValue as string | number | null,
      quote: typeof claimQuote === "string" ? claimQuote : null,
    };
  }

  return { ok: true, input: { sourceText: sourceText.trim(), claims } };
}

// ============================================================
// NUMBER READING (digits, Arabic-Indic digits, small number words)
// ============================================================

const EN_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

const AR_WORDS: Record<string, number> = {
  "واحد": 1, "واحدة": 1, "اثنين": 2, "اثنان": 2, "اثنتين": 2,
  "ثلاث": 3, "ثلاثة": 3, "اربع": 4, "أربع": 4, "اربعة": 4,
  "أربعة": 4, "خمس": 5, "خمسة": 5, "ست": 6, "ستة": 6, "سبع": 7,
  "سبعة": 7, "ثماني": 8, "ثمان": 8, "ثمانية": 8, "تسع": 9,
  "تسعة": 9, "عشر": 10, "عشرة": 10,
};

function normalizeDigits(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٫]/g, ".")
    .replace(/[٬]/g, ",");
}

function extractNumbers(text: string): number[] {
  const normalized = normalizeDigits(text);
  const found: number[] = [];

  const digitMatches = normalized.match(
    /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g
  );

  for (const match of digitMatches ?? []) {
    const parsed = Number(match.replace(/,/g, ""));

    if (Number.isFinite(parsed)) found.push(parsed);
  }

  for (const token of normalized.toLowerCase().split(/[^\p{L}]+/u)) {
    if (token in EN_WORDS) found.push(EN_WORDS[token]);
    else if (token in AR_WORDS) found.push(AR_WORDS[token]);
  }

  return found;
}

// ============================================================
// PER-FIELD VERIFICATION
// ============================================================

type Verification = {
  status: GateFieldStatus;
  explanation: string;
};

function fromProof(proof: {
  status: EvidenceStatus;
  explanation: string;
}): Verification {
  return { status: proof.status, explanation: proof.explanation };
}

function verifyField(
  field: GateField,
  claim: GateClaim | undefined,
  sourceText: string
): Verification {
  if (
    !claim ||
    claim.value === null ||
    (typeof claim.value === "string" && claim.value.trim() === "")
  ) {
    return {
      status: "MISSING",
      explanation: "No value was claimed for this field.",
    };
  }

  const { value, quote } = claim;

  // A value without a quotation is an unsupported claim, not an
  // absent one. It must never be treated as harmlessly "missing".
  if (!quote || quote.trim().length === 0) {
    return {
      status: "UNVERIFIED",
      explanation:
        "A value was claimed without a source quotation from the notes.",
    };
  }

  switch (field) {
    case "unitPrice":
    case "statedTotal": {
      if (typeof value !== "number") {
        return {
          status: "UNVERIFIED",
          explanation: "A monetary claim must be a number.",
        };
      }

      return fromProof(verifyMoneyQuote(sourceText, quote, value));
    }

    case "quantity":
    case "paymentDueDays": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return {
          status: "UNVERIFIED",
          explanation: "This claim must be a whole number.",
        };
      }

      const base = verifySourceQuote(sourceText, quote);

      if (base.status !== "VERIFIED") return fromProof(base);

      if (field === "paymentDueDays" && value === 0) {
        return /receipt|immediate|upfront|now|فور|الاستلام/i.test(
          base.quote ?? ""
        )
          ? {
              status: "VERIFIED",
              explanation:
                "The quotation states payment on receipt.",
            }
          : {
              status: "UNVERIFIED",
              explanation:
                "A due-in-0-days claim needs a quotation stating payment on receipt.",
            };
      }

      return extractNumbers(base.quote ?? "").includes(value)
        ? {
            status: "VERIFIED",
            explanation: `The quotation exists and contains the number ${value}.`,
          }
        : {
            status: "UNVERIFIED",
            explanation: `The quotation exists in the notes, but it does not contain the number ${value}.`,
          };
    }

    case "currency": {
      const base = verifySourceQuote(sourceText, quote);

      if (base.status !== "VERIFIED") return fromProof(base);

      const code = String(value).trim().toUpperCase();
      const tokens: Record<string, RegExp> = {
        USD: /\bUSD\b|\$|US\s+dollars?|dollars?|دولار/i,
        EGP: /\bEGP\b|egyptian\s+pounds?|جنيه/i,
        EUR: /\bEUR\b|€|euros?|يورو/i,
        GBP: /\bGBP\b|£|pounds?\s+sterling|استرليني/i,
      };

      const matcher =
        tokens[code] ??
        new RegExp(`\\b${code.replace(/[^A-Z]/g, "")}\\b`, "i");

      return matcher.test(base.quote ?? "")
        ? {
            status: "VERIFIED",
            explanation: `The quotation exists and names the currency ${code}.`,
          }
        : {
            status: "UNVERIFIED",
            explanation: `The quotation exists in the notes, but it does not name the currency ${code}.`,
          };
    }

    case "customerEmail":
    case "customerName": {
      const base = verifySourceQuote(sourceText, quote);

      if (base.status !== "VERIFIED") return fromProof(base);

      return (base.quote ?? "")
        .toLocaleLowerCase()
        .includes(String(value).trim().toLocaleLowerCase())
        ? {
            status: "VERIFIED",
            explanation:
              "The quotation exists and contains the claimed value.",
          }
        : {
            status: "UNVERIFIED",
            explanation:
              "The quotation exists in the notes, but it does not contain the claimed value.",
          };
    }

    default:
      return fromProof(verifySourceQuote(sourceText, quote));
  }
}

// ============================================================
// PROMPT-INJECTION SIGNALS
// ============================================================

const INJECTION_PATTERNS: { id: string; re: RegExp }[] = [
  {
    id: "override-instructions",
    re: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|the)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?)\b/giu,
  },
  {
    id: "system-prompt",
    re: /\b(?:system\s+prompt|developer\s+mode|jailbreak)\b/giu,
  },
  {
    id: "role-hijack",
    re: /\byou\s+are\s+now\b/giu,
  },
  {
    id: "force-amount",
    re: /\b(?:set|change|make|update)\s+(?:the\s+)?(?:invoice\s+)?(?:total|amount|price)\s+(?:to|as|=)\b/giu,
  },
  {
    id: "arabic-override",
    re: /(?:تجاهل|تجاهلي|انس|انسَ)\s+(?:كل\s+)?(?:التعليمات|القواعد|الأوامر)/gu,
  },
];

export function findInjectionSignals(
  sourceText: string
): InjectionSignal[] {
  const signals: InjectionSignal[] = [];

  for (const { id, re } of INJECTION_PATTERNS) {
    for (const match of sourceText.matchAll(re)) {
      const start = match.index ?? 0;

      signals.push({
        id,
        text: match[0],
        span: { start, end: start + match[0].length },
      });
    }
  }

  return signals;
}

// ============================================================
// HASHING
// ============================================================

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;

  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(record[key])}`
    )
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ============================================================
// THE GATE
// ============================================================

function toPricingState(
  status: GateFieldStatus
): PricingEvidenceState {
  return status;
}

export function runProofGate(input: GateInput): GateResult {
  const { sourceText, claims } = input;

  // ---- 1. Verify every field independently -------------------

  const fields = {} as Record<GateField, GateFieldResult>;

  for (const field of GATE_FIELDS) {
    const claim = claims[field];
    const verification = verifyField(field, claim, sourceText);

    fields[field] = {
      field,
      value: claim?.value ?? null,
      quote: claim?.quote ?? null,
      status: verification.status,
      explanation: verification.explanation,
      // Located even when unverified: a quotation that genuinely exists
      // but does not support the claim is exactly what a reviewer
      // needs to see, and it must count for instruction-as-evidence.
      span: locateQuote(sourceText, claim?.quote),
      critical: CRITICAL_FIELDS.has(field),
    };
  }

  // ---- 2. Derive a unit price from a verified total ----------

  const numeric = (field: GateField): number | null => {
    const value = fields[field].value;

    return typeof value === "number" ? value : null;
  };

  if (
    fields.unitPrice.status === "MISSING" &&
    fields.quantity.status === "VERIFIED" &&
    fields.statedTotal.status === "VERIFIED"
  ) {
    const quantity = numeric("quantity");
    const totalCents = moneyToCents(numeric("statedTotal") ?? NaN);

    if (
      quantity !== null &&
      quantity > 0 &&
      totalCents !== null &&
      totalCents % quantity === 0
    ) {
      const derived = totalCents / quantity / 100;

      fields.unitPrice = {
        ...fields.unitPrice,
        value: derived,
        status: "DERIVED",
        explanation: `Derived exactly: ${(totalCents / 100).toFixed(2)} / ${quantity} = ${derived.toFixed(2)}.`,
      };
    }
  }

  // ---- 3. Recompute money in integer cents -------------------

  const unitPriceDerived = fields.unitPrice.status === "DERIVED";

  const pricing = evaluatePricingIntegrity({
    quantity: numeric("quantity"),
    unitPrice: numeric("unitPrice"),
    statedTotal: numeric("statedTotal"),
    currency:
      typeof fields.currency.value === "string"
        ? fields.currency.value.trim().toUpperCase()
        : null,
    quantityEvidenceStatus: toPricingState(fields.quantity.status),
    unitPriceEvidenceStatus: toPricingState(fields.unitPrice.status),
    statedTotalEvidenceStatus: toPricingState(
      fields.statedTotal.status
    ),
    unitPriceDerived,
  });

  // ---- 4. Collect reasons ------------------------------------

  const reasons: GateReason[] = [];
  const injectionSignals = findInjectionSignals(sourceText);

  for (const field of GATE_FIELDS) {
    const result = fields[field];

    if (result.status !== "UNVERIFIED") continue;

    reasons.push({
      code: result.critical ? "UNVERIFIED_CLAIM" : "WEAK_EVIDENCE",
      severity: result.critical ? "BLOCK" : "REVIEW",
      field,
      message: `${FIELD_LABELS[field]}: ${result.explanation}`,
    });
  }

  if (pricing.status === "CONFLICT") {
    reasons.push({
      code: "PRICE_CONFLICT",
      severity: "BLOCK",
      message: pricing.message,
    });
  }

  if (pricing.status === "INVALID") {
    reasons.push({
      code: "PRICE_INVALID",
      severity: "BLOCK",
      message: pricing.message,
    });
  }

  // Safety net: if the pricing engine refuses to approve for a reason
  // not already listed, the gate must still block.
  if (
    !pricing.canApprove &&
    !reasons.some((reason) => reason.severity === "BLOCK")
  ) {
    reasons.push({
      code: "UNVERIFIED_CLAIM",
      severity: "BLOCK",
      message: pricing.message,
    });
  }

  const quantity = numeric("quantity");
  const unitPrice = numeric("unitPrice");
  const statedTotal = numeric("statedTotal");

  const limitProblems: string[] = [];

  if (
    quantity !== null &&
    (quantity < MIN_QUANTITY || quantity > MAX_QUANTITY)
  ) {
    limitProblems.push(
      `Quantity ${quantity} is outside ${MIN_QUANTITY}–${MAX_QUANTITY}.`
    );
  }

  if (unitPrice !== null && unitPrice > MAX_UNIT_PRICE) {
    limitProblems.push(
      `Unit price ${unitPrice} exceeds the $${MAX_UNIT_PRICE.toLocaleString("en-US")} limit.`
    );
  }

  if (
    statedTotal !== null &&
    statedTotal * 100 > MAX_TOTAL_CENTS
  ) {
    limitProblems.push(
      `Stated total ${statedTotal} exceeds the $${(MAX_TOTAL_CENTS / 100).toLocaleString("en-US")} limit.`
    );
  }

  if (
    pricing.calculatedTotal !== null &&
    pricing.calculatedTotal * 100 > MAX_TOTAL_CENTS
  ) {
    limitProblems.push(
      `Calculated total ${pricing.calculatedTotal} exceeds the $${(MAX_TOTAL_CENTS / 100).toLocaleString("en-US")} limit.`
    );
  }

  for (const message of limitProblems) {
    reasons.push({ code: "POLICY_LIMIT", severity: "BLOCK", message });
  }

  if (
    typeof fields.currency.value === "string" &&
    fields.currency.value.trim().toUpperCase() !== "USD"
  ) {
    reasons.push({
      code: "POLICY_CURRENCY",
      severity: "BLOCK",
      field: "currency",
      message: "This deployment supports USD invoices only.",
    });
  }

  // Evidence that is itself an instruction to an AI is not evidence.
  for (const field of GATE_FIELDS) {
    const result = fields[field];

    if (!result.critical || result.status === "MISSING") continue;

    const quote = result.quote?.toLocaleLowerCase() ?? "";

    const hijacked = injectionSignals.find(
      (signal) =>
        (result.span && spansOverlap(result.span, signal.span)) ||
        (quote.length > 0 &&
          quote.includes(signal.text.toLocaleLowerCase()))
    );

    if (hijacked) {
      reasons.push({
        code: "INSTRUCTION_AS_EVIDENCE",
        severity: "BLOCK",
        field,
        message: `${FIELD_LABELS[field]} is backed by text that reads like an instruction to an AI (“${hijacked.text}”). Instructions inside client messages are never evidence.`,
      });
    }
  }

  if (
    injectionSignals.length > 0 &&
    !reasons.some((reason) => reason.code === "INSTRUCTION_AS_EVIDENCE")
  ) {
    reasons.push({
      code: "INJECTION_SIGNAL",
      severity: "REVIEW",
      message: `The notes contain instruction-like text (“${injectionSignals[0].text}”). A human must confirm the invoice.`,
    });
  }

  for (const field of REQUIRED_FIELDS) {
    if (fields[field].status === "MISSING") {
      reasons.push({
        code: "MISSING_FIELD",
        severity: "REVIEW",
        field,
        message: `${FIELD_LABELS[field]} was not provided.`,
      });
    }
  }

  // ---- 5. Verdict --------------------------------------------

  const verdict: GateVerdict = reasons.some(
    (reason) => reason.severity === "BLOCK"
  )
    ? "BLOCK"
    : reasons.length > 0
      ? "REVIEW"
      : "ALLOW";

  // ---- 6. Tamper-evident receipt -----------------------------

  const sourceSha256 = sha256(sourceText);

  const proofHash = sha256(
    stableStringify({
      policyVersion: POLICY_VERSION,
      sourceSha256,
      verdict,
      reasons: reasons.map((r) => [r.code, r.field ?? null]),
      fields: Object.fromEntries(
        GATE_FIELDS.map((field) => [
          field,
          {
            value: fields[field].value,
            quote: fields[field].quote,
            status: fields[field].status,
          },
        ])
      ),
      pricing: {
        status: pricing.status,
        calculatedTotal: pricing.calculatedTotal,
      },
    })
  );

  return {
    policyVersion: POLICY_VERSION,
    verdict,
    reasons,
    fields,
    pricing,
    calculatedTotal: pricing.calculatedTotal,
    injectionSignals,
    sourceSha256,
    proofHash,
  };
}

export const GATE_POLICY_SUMMARY = [
  "Every claim must carry a verbatim quotation from the original notes.",
  "A quotation must actually contain the claimed number, amount, currency, name or email.",
  "Totals are recomputed in integer cents; a stated total that disagrees with quantity × unit price is a conflict.",
  `Hard limits: quantity ${MIN_QUANTITY}–${MAX_QUANTITY}, unit price ≤ $${MAX_UNIT_PRICE.toLocaleString("en-US")}, total ≤ $${(MAX_TOTAL_CENTS / 100).toLocaleString("en-US")}, USD only.`,
  "Evidence that reads like an instruction to an AI is rejected as evidence.",
  "Quantity, unit price, total, currency and customer email are critical: any failure is a BLOCK. Weakly supported name, description or terms are a REVIEW.",
  "String matching proves provenance, not truth. A human approval step still follows an ALLOW.",
];
