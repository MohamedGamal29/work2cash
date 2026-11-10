
"use client";

import { useState } from "react";

import AttackLab from "./AttackLab";
import DraftApproval from "./DraftApproval";
import EvidenceLens from "./EvidenceLens";
import InvoiceHistory from "./InvoiceHistory";

import type {
  InvoiceEvidence,
  ProofEntry,
} from "./lib/proof-ledger";

import {
  isPricingIntegrityResult,
  type PricingIntegrityResult,
  type PricingEvidenceState,
} from "./lib/pricing-integrity";

// ============================================================
// 1. TYPES
// ============================================================

type InvoiceDraft = {
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  currency: string | null;
  paymentDueDays: number | null;
};

type PricingBasis = "PER_UNIT" | "TOTAL" | "UNKNOWN";

type EvidenceField = keyof InvoiceEvidence;

const draftFields = [
  ["customerName", "Customer name"],
  ["customerEmail", "Customer email"],
  ["description", "Work description"],
  ["quantity", "Quantity"],
  ["unitPrice", "Unit price"],
  ["currency", "Currency"],
  ["paymentDueDays", "Payment due in days"],
] as const;

const proofFields: {
  key: EvidenceField;
  label: string;
}[] = [
  { key: "customerName", label: "Customer name" },
  { key: "customerEmail", label: "Customer email" },
  { key: "description", label: "Work description" },
  { key: "quantity", label: "Quantity" },
  { key: "unitPrice", label: "Unit price" },
  { key: "currency", label: "Currency" },
  { key: "paymentDueDays", label: "Payment terms" },
  { key: "statedTotal", label: "Independently stated total" },
];

// ============================================================
// 2. VALIDATION HELPERS
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
  value: unknown,
  integer = false
): value is number | null {
  if (value === null) return true;

  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return false;
  }

  return !integer || Number.isInteger(value);
}

function isInvoiceDraft(
  value: unknown
): value is InvoiceDraft {
  if (!isObject(value)) return false;

  return (
    isNullableString(value.customerName) &&
    isNullableString(value.customerEmail) &&
    isNullableString(value.description) &&
    isNullableNumber(value.quantity, true) &&
    isNullableNumber(value.unitPrice) &&
    isNullableString(value.currency) &&
    isNullableNumber(value.paymentDueDays, true)
  );
}

// ============================================================
// 3. PROOF LEDGER VALIDATION
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

function isInvoiceEvidence(
  value: unknown
): value is InvoiceEvidence {
  if (!isObject(value)) return false;

  return proofFields.every(({ key }) =>
    isProofEntry(value[key])
  );
}

// ============================================================
// 4. UI HELPERS
// ============================================================

function evidenceStatus(entry: ProofEntry): string {
  if (entry.kind === "DERIVED") return "DERIVED";
  if (entry.kind === "MISSING") return "MISSING";

  return entry.status;
}

function evidenceBadge(entry: ProofEntry): string {
  if (entry.kind === "DERIVED") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (entry.kind === "MISSING") {
    return "border-slate-200 bg-slate-100 text-slate-500";
  }

  if (entry.status === "VERIFIED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (entry.status === "UNVERIFIED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-500";
}

function integrityBadge(status: string): string {
  switch (status) {
    case "CONSISTENT":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";

    case "DERIVED":
      return "border-blue-200 bg-blue-50 text-blue-700";

    case "CONFLICT":
    case "INVALID":
      return "border-red-200 bg-red-50 text-red-700";

    case "UNVERIFIED":
      return "border-amber-200 bg-amber-50 text-amber-700";

    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function displayValue(
  value: string | number | null
): string {
  if (value === null || value === "") {
    return "Not provided";
  }

  return String(value);
}

function fieldLabel(field: string): string {
  return (
    draftFields.find(([key]) => key === field)?.[1] ??
    field
  );
}

function getStatedTotalEvidenceStatus(
  entry: ProofEntry | undefined
): PricingEvidenceState {
  if (!entry) return "MISSING";

  if (entry.kind === "SOURCE") {
    return entry.status;
  }

  if (entry.kind === "DERIVED") {
    return "DERIVED";
  }

  return "MISSING";
}

// ============================================================
// 5. REUSABLE VISUAL COMPONENTS
// ============================================================

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#173C32] text-xl font-black text-[#B7F3D8] shadow-lg shadow-emerald-950/10">
        W
      </div>

      <div>
        <p className="text-base font-extrabold tracking-tight text-[#18382F]">
          WORK2CASH
        </p>

        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Financial intelligence
        </p>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">
        {eyebrow}
      </p>

      <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#18382F] sm:text-3xl">
        {title}
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

// ============================================================
// 6. MAIN APPLICATION
// ============================================================

export default function Home() {
  const [notes, setNotes] = useState("");

  const [draft, setDraft] =
    useState<InvoiceDraft | null>(null);

  const [originalDraft, setOriginalDraft] =
    useState<InvoiceDraft | null>(null);

  const [extractionReceipt, setExtractionReceipt] =
    useState<string | null>(null);

  const [statedTotal, setStatedTotal] =
    useState<number | null>(null);

  const [pricingIntegrity, setPricingIntegrity] =
    useState<PricingIntegrityResult | null>(null);

  const [proofLedger, setProofLedger] =
    useState<InvoiceEvidence | null>(null);

  const [pricingBasis, setPricingBasis] =
    useState<PricingBasis>("UNKNOWN");

  const [unitPriceDerived, setUnitPriceDerived] =
    useState(false);

  const [needsClarification, setNeedsClarification] =
    useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [historyRefreshKey, setHistoryRefreshKey] =
    useState(0);

  // ==========================================================
  // 7. CLEAR PREVIOUS EXTRACTION
  // ==========================================================

  function clearExtraction() {
    setDraft(null);
    setOriginalDraft(null);
    setExtractionReceipt(null);
    setStatedTotal(null);
    setPricingIntegrity(null);
    setProofLedger(null);

    setPricingBasis("UNKNOWN");
    setUnitPriceDerived(false);
    setNeedsClarification([]);

    setError("");
  }

  // ==========================================================
  // 8. LOAD CONTRADICTION DEMONSTRATION
  // ==========================================================

  function loadConflictExample() {
    clearExtraction();

    setNotes(
      "Worked with John. Completed 5 social media designs at 100 USD each. The agreed total for the entire job is 400 USD. Payment is due within 2 days."
    );
  }

  // ==========================================================
  // 9. GENERATE AI DRAFT
  // ==========================================================

  async function generateDraft() {
    if (busy || !notes.trim()) return;

    setBusy(true);
    clearExtraction();

    try {
      const response = await fetch("/api/gemini-test", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          notes: notes.trim(),
        }),
      });

      const data: unknown = await response.json();

      if (
        !response.ok ||
        !isObject(data) ||
        data.success !== true ||
        !isInvoiceDraft(data.draft)
      ) {
        const message =
          isObject(data) &&
          typeof data.message === "string"
            ? data.message
            : "Could not generate the invoice draft.";

        setError(message);
        return;
      }

      const extraction = data;

      // A signed receipt is mandatory for PayPal approval.
      if (
        typeof extraction.extractionReceipt !== "string" ||
        !extraction.extractionReceipt
      ) {
        setError(
          "Gemini generated the draft, but the signed extraction receipt is missing."
        );
        return;
      }

      const extractedDraft = extraction.draft as InvoiceDraft;

      setDraft({ ...extractedDraft });
      setOriginalDraft({ ...extractedDraft });

      setExtractionReceipt(
        extraction.extractionReceipt
      );

      setStatedTotal(
        typeof extraction.statedTotal === "number" &&
          Number.isFinite(extraction.statedTotal)
          ? extraction.statedTotal
          : null
      );

      setPricingIntegrity(
        isPricingIntegrityResult(extraction.pricingIntegrity)
          ? extraction.pricingIntegrity
          : null
      );

      setPricingBasis(
        extraction.pricingBasis === "PER_UNIT" ||
          extraction.pricingBasis === "TOTAL" ||
          extraction.pricingBasis === "UNKNOWN"
          ? extraction.pricingBasis
          : "UNKNOWN"
      );

      setUnitPriceDerived(
        extraction.unitPriceDerived === true
      );

      setNeedsClarification(
        Array.isArray(extraction.needsClarification)
          ? extraction.needsClarification.filter(
              (item): item is string =>
                typeof item === "string"
            )
          : []
      );

      if (isInvoiceEvidence(extraction.proofLedger)) {
        setProofLedger(extraction.proofLedger);
      } else {
        setError(
          "The draft was generated, but its evidence ledger is missing or invalid. Regenerate the draft before approval."
        );
      }
    } catch (requestError) {
      console.error(
        "Work2Cash extraction error:",
        requestError
      );

      setError(
        "Could not reach the AI service. Check the server and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  // ==========================================================
  // 10. UPDATE DRAFT FIELDS
  // ==========================================================

  function updateField(
    field: keyof InvoiceDraft,
    rawValue: string
  ) {
    setDraft((current) => {
      if (!current) return current;

      if (
        field === "quantity" ||
        field === "unitPrice" ||
        field === "paymentDueDays"
      ) {
        const value =
          rawValue === "" ? null : Number(rawValue);

        return {
          ...current,

          [field]:
            value === null || Number.isFinite(value)
              ? value
              : null,
        };
      }

      return {
        ...current,
        [field]: rawValue === "" ? null : rawValue,
      };
    });
  }

  // ==========================================================
  // 11. DERIVED DISPLAY VALUES
  // ==========================================================

  const changedFields =
    draft && originalDraft
      ? draftFields.filter(([field]) => {
          return originalDraft[field] !== draft[field];
        })
      : [];

  const validQuantity =
    draft?.quantity !== null &&
    typeof draft?.quantity === "number" &&
    Number.isInteger(draft.quantity) &&
    draft.quantity > 0;

  const validUnitPrice =
    draft?.unitPrice !== null &&
    typeof draft?.unitPrice === "number" &&
    Number.isFinite(draft.unitPrice) &&
    draft.unitPrice > 0;

  const totalCents =
    draft && validQuantity && validUnitPrice
      ? draft.quantity! * Math.round(draft.unitPrice! * 100)
      : null;

  const total =
    totalCents !== null && Number.isSafeInteger(totalCents)
      ? (totalCents / 100).toFixed(2)
      : null;

  const statedTotalEvidenceStatus =
    getStatedTotalEvidenceStatus(
      proofLedger?.statedTotal
    );



  // ==========================================================
  // 12. RENDER
  // ==========================================================

  return (
    <main className="min-h-screen bg-[#F5F7F4] text-[#18382F] selection:bg-emerald-100">

      {/* ================================================== */}
      {/* DESKTOP SIDEBAR */}
      {/* ================================================== */}

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[250px] flex-col border-r border-[#E6ECE7] bg-[#FCFDFC] px-5 py-7 lg:flex">

        <BrandMark />

        <div className="mt-12">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            WORKSPACE
          </p>

          <nav className="mt-4 space-y-1.5">

            <a
              href="#overview"
              className="flex items-center gap-3 rounded-xl bg-[#EAF3ED] px-3 py-3 text-sm font-semibold text-[#1A5A43]"
            >
              <span className="text-lg">◫</span>
              Overview
            </a>

            <a
              href="#workspace"
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#18382F]"
            >
              <span className="text-lg">＋</span>
              Create invoice
            </a>

            <a
              href={draft ? "#proof-ledger" : "#workspace"}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#18382F]"
            >
              <span className="text-lg">◈</span>
              Proof Ledger
            </a>

            <a
              href="#invoice-history"
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#18382F]"
            >
              <span className="text-lg">▤</span>
              Invoice history
            </a>

            <a
              href="#attack-lab"
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#18382F]"
            >
              <span className="text-lg">⛨</span>
              Attack Lab
            </a>
          </nav>
        </div>

        <div className="mt-12">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            FINANCIAL SAFETY
          </p>

          <div className="mt-4 rounded-2xl border border-[#E2EBE4] bg-[#F5F8F5] p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E0EEE5] text-lg text-[#246449]">
              ◈
            </div>

            <p className="mt-3 text-sm font-bold">
              Proof before payment
            </p>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Every extracted field has supporting evidence. Every approved amount is checked.
            </p>
          </div>
        </div>

        <div className="mt-auto rounded-xl border border-[#E7ECE8] bg-white p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />

            <p className="text-xs font-semibold text-slate-600">
              Development environment
            </p>
          </div>

          <p className="mt-2 text-[10px] text-slate-400">
            PayPal Sandbox · No real payments
          </p>
        </div>
      </aside>

      {/* ================================================== */}
      {/* MAIN CONTENT */}
      {/* ================================================== */}

      <div className="min-h-screen lg:ml-[250px]">

        {/* TOP NAVIGATION */}

        <header className="sticky top-0 z-30 border-b border-[#E8EDE9] bg-[#F9FBF9]/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 sm:px-8 lg:px-10">

            <div className="lg:hidden">
              <BrandMark />
            </div>

            <div className="hidden lg:block">
              <p className="text-sm font-semibold text-[#18382F]">
                Financial workspace
              </p>

              <p className="mt-0.5 text-xs text-slate-400">
                Your work, verified before payment.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 sm:inline-flex">
                PayPal Sandbox
              </span>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#DDEBE1] text-sm font-bold text-[#275D42]">
                W
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] space-y-8 px-5 py-8 sm:px-8 sm:py-10 lg:px-10">

          {/* ================================================== */}
          {/* HERO */}
          {/* ================================================== */}

          <section id="overview" className="relative overflow-hidden rounded-[28px] bg-[#173B32] p-7 text-white shadow-xl shadow-[#173B32]/10 sm:p-10 lg:p-12">

            <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full border border-white/10" />

            <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border border-white/10" />

            <div className="pointer-events-none absolute bottom-[-160px] right-[20%] h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />

            <div className="relative max-w-3xl">

              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#A7F3D0]" />

                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-100">
                  AI financial intelligence
                </span>
              </div>

              <h1 className="mt-7 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
                Your work.
                <br />

                <span className="text-[#A7F3D0]">
                  Verified.
                </span>

                <br />

                Your money. Moving.
              </h1>

              <p className="mt-6 max-w-xl text-sm leading-7 text-emerald-50/75 sm:text-base">
                Turn completed work into transparent, evidence-backed invoices. Detect financial inconsistencies before approving payments through PayPal.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">

                <a
                  href="#workspace"
                  className="inline-flex items-center gap-3 rounded-xl bg-[#B7F3D8] px-5 py-3.5 text-sm font-bold text-[#173B32] transition hover:bg-white"
                >
                  Create an invoice

                  <span>→</span>
                </a>

                <a
                  href={draft ? "#proof-ledger" : "#workspace"}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Explore Proof Ledger
                </a>

                <a
                  href="#attack-lab"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#A7F3D0]/40 px-5 py-3.5 text-sm font-semibold text-[#A7F3D0] transition hover:bg-white/10"
                >
                  Try to break it
                </a>

              </div>

              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/15 pt-6 text-xs text-emerald-100/75">
                <span>01 · AI extraction</span>
                <span>02 · Financial verification</span>
                <span>03 · Human approval</span>
                <span>04 · PayPal execution</span>
              </div>

            </div>
          </section>

          {/* ================================================== */}
          {/* FEATURE OVERVIEW */}
          {/* ================================================== */}

          <section className="grid gap-4 sm:grid-cols-3">

            <div className="rounded-2xl border border-[#E7ECE8] bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDF4EF] text-lg text-[#26694A]">
                  AI
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-400">
                    INTELLIGENCE
                  </p>

                  <p className="mt-0.5 text-sm font-bold">
                    Gemini extraction
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs leading-5 text-slate-500">
                Understands English, Arabic, and mixed-language work descriptions.
              </p>
            </div>

            <div className="rounded-2xl border border-[#E7ECE8] bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDF4EF] text-xl text-[#26694A]">
                  ◈
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-400">
                    INTEGRITY
                  </p>

                  <p className="mt-0.5 text-sm font-bold">
                    Proof Ledger
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs leading-5 text-slate-500">
                Links extracted values to source evidence and records approval changes.
              </p>
            </div>

            <div className="rounded-2xl border border-[#E7ECE8] bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDF4EF] text-xl text-[#26694A]">
                  ↗
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-400">
                    EXECUTION
                  </p>

                  <p className="mt-0.5 text-sm font-bold">
                    PayPal integration
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs leading-5 text-slate-500">
                Human-approved invoice drafts are created using PayPal Sandbox.
              </p>
            </div>

          </section>

          {/* ================================================== */}
          {/* WORKSPACE */}
          {/* ================================================== */}

          <section id="workspace" className="scroll-mt-24 space-y-5">

            <SectionHeading
              eyebrow="01 · Create"
              title="Turn completed work into an invoice."
              description="Describe what you delivered. Gemini extracts the details, and Work2Cash checks the financial claims."
            />

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.65fr)]">

              {/* INPUT CARD */}

              <div className="overflow-hidden rounded-[24px] border border-[#E5EBE6] bg-white shadow-sm">

                <div className="flex items-center justify-between border-b border-[#EDF1ED] px-6 py-5">
                  <div>
                    <p className="text-sm font-bold text-[#18382F]">
                      Describe completed work
                    </p>

                    <p className="mt-1 text-xs text-slate-400">
                      Your original notes become the evidence source.
                    </p>
                  </div>

                  <span className="rounded-lg bg-[#F1F6F2] px-3 py-2 text-xs font-semibold text-[#26694A]">
                    Step 01
                  </span>
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void generateDraft();
                  }}
                  className="p-6"
                >

                  <textarea
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      clearExtraction();
                    }}
                    disabled={busy}
                    rows={7}
                    maxLength={3000}
                    required
                    placeholder={"Example:\nاشتغلت مع أحمد على 5 تصميمات سوشيال ميديا، واتفقنا على 250 دولار إجمالي، والدفع خلال 14 يوم.\n\nOr describe your completed work in English..."}
                    className="w-full resize-y rounded-2xl border border-[#DEE8E0] bg-[#FAFCFA] p-5 text-sm leading-7 text-[#203C33] outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-50 disabled:opacity-60"
                  />

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] text-slate-400">
                      English · Arabic · Mixed language
                    </p>

                    <p className="text-[11px] font-medium text-slate-400">
                      {notes.length} / 3000
                    </p>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-3">

                    <button
                      type="submit"
                      disabled={busy || !notes.trim()}
                      className="inline-flex items-center justify-center gap-3 rounded-xl bg-[#173B32] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-[#245747] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          Analyzing work...
                        </>
                      ) : (
                        <>
                          Analyze financial information
                          <span>→</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={loadConflictExample}
                      disabled={busy}
                      className="rounded-xl border border-[#DCE6DE] px-4 py-3.5 text-xs font-semibold text-[#3D6651] transition hover:bg-[#F0F6F1] disabled:opacity-40"
                    >
                      Try conflict example
                    </button>

                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700"
                    >
                      {error}
                    </div>
                  )}

                </form>
              </div>

              {/* WORKFLOW PANEL */}

              <div className="rounded-[24px] border border-[#E5EBE6] bg-white p-6">

                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">
                  How it works
                </p>

                <div className="mt-6 space-y-6">

                  {[
                    {
                      number: "01",
                      title: "Understand",
                      text: "Gemini extracts customers, quantities, prices and payment terms.",
                    },
                    {
                      number: "02",
                      title: "Verify",
                      text: "Source quotations, financial calculations and inconsistencies are checked.",
                    },
                    {
                      number: "03",
                      title: "Authorize",
                      text: "The human reviews and approves an immutable financial record.",
                    },
                    {
                      number: "04",
                      title: "Execute",
                      text: "PayPal receives the validated invoice request.",
                    },
                  ].map((step) => (
                    <div
                      key={step.number}
                      className="flex gap-4"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF4EF] text-xs font-bold text-[#26694A]">
                        {step.number}
                      </div>

                      <div>
                        <p className="text-sm font-bold text-[#18382F]">
                          {step.title}
                        </p>

                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {step.text}
                        </p>
                      </div>
                    </div>
                  ))}

                </div>

                <div className="mt-7 rounded-xl bg-[#173B32] p-4 text-white">
                  <p className="text-xs font-bold text-[#B7F3D8]">
                    OUR PRINCIPLE
                  </p>

                  <p className="mt-2 text-sm font-semibold leading-6">
                    AI proposes. Evidence supports. Humans authorize.
                  </p>
                </div>

              </div>

            </div>
          </section>

          {/* ================================================== */}
          {/* ORIGINAL EXTRACTION INTEGRITY */}
          {/* ================================================== */}

          {draft && pricingIntegrity && (
            <section className="space-y-5">

              <SectionHeading
                eyebrow="02 · Financial intelligence"
                title="The financial integrity report."
                description="An independent evaluation of the original financial claims extracted from your source notes."
              />

              <div className="rounded-[24px] border border-[#E5EBE6] bg-white p-6 shadow-sm sm:p-8">

                <div className="flex flex-wrap items-start justify-between gap-4">

                  <div>
                    <p className="text-sm font-bold text-[#18382F]">
                      Original extraction assessment
                    </p>

                    <p className="mt-1 text-xs text-slate-400">
                      This result is preserved separately from later human corrections.
                    </p>
                    <p className="mt-2 text-xs font-semibold text-emerald-700">
                      Pricing basis: {
                        pricingBasis === "PER_UNIT"
                          ? "Per unit"
                          : pricingBasis === "TOTAL"
                            ? "Complete job total"
                            : "Unresolved"
                      }
                    </p>
                  </div>

                  <span
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-bold tracking-wider ${integrityBadge(pricingIntegrity.status)}`}
                  >
                    {pricingIntegrity.status.replaceAll("_", " ")}
                  </span>

                </div>

                <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

                  {[
                    {
                      label: "Quantity",
                      value: pricingIntegrity.quantity?.toString() ?? "--",
                    },
                    {
                      label: "Unit price",
                      value:
                        pricingIntegrity.unitPrice !== null
                          ? `${pricingIntegrity.unitPrice.toFixed(2)} ${pricingIntegrity.currency ?? ""}`
                          : "--",
                    },
                    {
                      label: "Stated total",
                      value:
                        pricingIntegrity.statedTotal !== null
                          ? `${pricingIntegrity.statedTotal.toFixed(2)} ${pricingIntegrity.currency ?? ""}`
                          : "--",
                    },
                    {
                      label: "Calculated total",
                      value:
                        pricingIntegrity.calculatedTotal !== null
                          ? `${pricingIntegrity.calculatedTotal.toFixed(2)} ${pricingIntegrity.currency ?? ""}`
                          : "--",
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl bg-[#F6F8F6] p-4"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {item.label}
                      </p>

                      <p className="mt-3 break-words text-xl font-bold tracking-tight text-[#18382F]">
                        {item.value}
                      </p>
                    </div>
                  ))}

                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#E9EEE9] p-4">

                  <div>
                    <p className="text-xs font-bold text-slate-600">
                      Financial assessment
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      {pricingIntegrity.message}
                    </p>
                  </div>

                  {pricingIntegrity.difference !== null && (
                    <div className="shrink-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Difference
                      </p>

                      <p
                        className={`mt-1 text-2xl font-bold ${
                          pricingIntegrity.difference === 0
                            ? "text-emerald-700"
                            : "text-red-600"
                        }`}
                      >
                        {pricingIntegrity.difference > 0 ? "+" : ""}
                        {pricingIntegrity.difference.toFixed(2)}
                      </p>
                    </div>
                  )}

                </div>

                {pricingIntegrity.status === "CONFLICT" && (
                  <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-bold text-red-800">
                      Correction required
                    </p>

                    <p className="mt-1 text-xs leading-5 text-red-700">
                      Review the invoice details below. You can correct the proposed invoice, but the original discrepancy will remain in its audit history.
                    </p>
                  </div>
                )}

                {unitPriceDerived && (
                  <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm font-bold text-blue-800">
                      Unit price calculated from stated total
                    </p>

                    <p className="mt-1 text-xs leading-5 text-blue-700">
                      The application derived the unit price using integer-cent arithmetic. Verify the source total and quantity before approval.
                    </p>
                  </div>
                )}

              </div>
            </section>
          )}

          {/* ================================================== */}
          {/* DRAFT REVIEW */}
          {/* ================================================== */}

          {draft && (
            <section className="space-y-5">

              <SectionHeading
                eyebrow="03 · Human review"
                title="Review every financial detail."
                description="Inspect original evidence, compare extracted values, make corrections, and authorize only the final invoice."
              />

              <div className="rounded-[24px] border border-[#E5EBE6] bg-white p-6 shadow-sm sm:p-8">

                {/* REVIEW HEADER */}

                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#EDF1ED] pb-6">

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />

                      <p className="text-sm font-bold text-[#18382F]">
                        AI invoice draft
                      </p>
                    </div>

                    <p className="mt-1 text-xs text-slate-400">
                      Not submitted to PayPal yet.
                    </p>
                  </div>

                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                    Human approval required
                  </span>

                </div>

                {/* CLARIFICATION */}

                {needsClarification.length > 0 && (
                  <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">

                    <p className="text-sm font-bold text-amber-800">
                      Additional information required
                    </p>

                    <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5 text-amber-800">
                      {needsClarification.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>

                  </div>
                )}

                {/* TWO COLUMN REVIEW */}

                <div className="mt-7 grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">

                  {/* INVOICE FIELDS */}

                  <div>

                    <div className="mb-5">
                      <h3 className="text-base font-bold text-[#18382F]">
                        Invoice details
                      </h3>

                      <p className="mt-1 text-xs text-slate-400">
                        Correct any field before approval.
                      </p>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">

                      {draftFields.map(([field, label]) => {
                        const isNumber =
                          field === "quantity" ||
                          field === "unitPrice" ||
                          field === "paymentDueDays";

                        return (
                          <label
                            key={field}
                            className="block"
                          >

                            <span className="text-xs font-semibold text-slate-600">
                              {label}
                            </span>

                            <input
                              type={
                                isNumber
                                  ? "number"
                                  : field === "customerEmail"
                                    ? "email"
                                    : "text"
                              }
                              value={draft[field] ?? ""}
                              disabled={busy}
                              min={isNumber ? 0 : undefined}
                              step={
                                field === "paymentDueDays"
                                  ? "1"
                                  : isNumber
                                    ? "any"
                                    : undefined
                              }
                              placeholder="Enter missing value"
                              onChange={(event) =>
                                updateField(
                                  field,
                                  event.target.value
                                )
                              }
                              className="mt-2 w-full rounded-xl border border-[#DFE8E0] bg-[#FAFCFA] px-4 py-3 text-sm text-[#18382F] outline-none transition placeholder:text-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-50 disabled:opacity-60"
                            />

                          </label>
                        );
                      })}

                    </div>

                    {/* CHANGE LOG */}

                    {originalDraft && (
                      <div className="mt-7 rounded-2xl border border-[#E5EBE6] bg-[#FAFCFA] p-5">

                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-bold text-[#18382F]">
                            Approval change log
                          </h3>

                          <span className="rounded-full bg-[#EAF2EC] px-3 py-1 text-xs font-bold text-[#296448]">
                            {changedFields.length} changes
                          </span>
                        </div>

                        {changedFields.length === 0 ? (
                          <p className="mt-3 text-xs leading-5 text-slate-500">
                            No edits made. The current invoice draft matches the original AI extraction.
                          </p>
                        ) : (
                          <div className="mt-4 space-y-3">

                            {changedFields.map(([field]) => (
                              <div
                                key={field}
                                className="rounded-xl border border-[#E6ECE7] bg-white p-3"
                              >

                                <p className="text-xs font-bold text-[#18382F]">
                                  {fieldLabel(field)}
                                </p>

                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-slate-400">
                                      Original AI value
                                    </p>

                                    <p className="mt-1 break-words text-xs text-slate-500">
                                      {displayValue(originalDraft[field])}
                                    </p>
                                  </div>

                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-emerald-700">
                                      Reviewed value
                                    </p>

                                    <p className="mt-1 break-words text-xs font-bold text-[#18382F]">
                                      {displayValue(draft[field])}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}

                          </div>
                        )}

                        <p className="mt-4 text-[10px] leading-5 text-slate-400">
                          Changes are included in the approval snapshot. The original signed extraction remains unchanged.
                        </p>

                      </div>
                    )}

                  </div>

                  {/* PROOF LEDGER */}

                  <div
                    id="proof-ledger"
                    className="scroll-mt-24"
                  >

                    <div className="rounded-2xl border border-[#DDEAE0] bg-[#F7FAF7] p-5">

                      <div className="flex items-start justify-between gap-3">

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xl text-[#29704B]">
                              ◈
                            </span>

                            <h3 className="text-base font-bold text-[#18382F]">
                              Proof Ledger
                            </h3>
                          </div>

                          <p className="mt-2 text-xs leading-5 text-slate-500">
                            Original source evidence for every extracted field.
                          </p>
                        </div>

                        <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                          Audit
                        </span>

                      </div>

                      {proofLedger ? (
                        <div className="mt-5 space-y-3">

                          <EvidenceLens
                            source={notes.trim()}
                            ledger={proofLedger}
                          />

                          {proofFields.map(({ key, label }) => {
                            const entry = proofLedger[key];

                            return (
                              <div
                                key={key}
                                className="rounded-xl border border-[#E5EBE6] bg-white p-4"
                              >

                                <div className="flex items-center justify-between gap-2">

                                  <p className="text-xs font-bold text-[#18382F]">
                                    {label}
                                  </p>

                                  <span
                                    className={`rounded-full border px-2 py-1 text-[9px] font-bold ${evidenceBadge(entry)}`}
                                  >
                                    {evidenceStatus(entry)}
                                  </span>

                                </div>

                                {entry.kind === "SOURCE" && (
                                  <>
                                    <p className="mt-3 break-words text-xs leading-5 text-[#365747]">
                                      {entry.quote
                                        ? `“${entry.quote}”`
                                        : "No source quotation supplied."}
                                    </p>

                                    <p className="mt-2 text-[10px] leading-5 text-slate-400">
                                      {entry.explanation}
                                    </p>
                                  </>
                                )}

                                {entry.kind === "DERIVED" && (
                                  <>
                                    <p className="mt-3 break-words text-xs font-semibold text-blue-700">
                                      {entry.formula}
                                    </p>

                                    <p className="mt-2 text-[10px] text-slate-400">
                                      Inputs: {entry.inputFields.join(", ")}
                                    </p>

                                    <p className="mt-2 text-[10px] leading-5 text-slate-400">
                                      {entry.explanation}
                                    </p>
                                  </>
                                )}

                                {entry.kind === "MISSING" && (
                                  <p className="mt-3 text-xs leading-5 text-slate-500">
                                    {entry.explanation}
                                  </p>
                                )}

                              </div>
                            );
                          })}

                        </div>
                      ) : (
                        <p className="mt-5 text-sm text-red-600">
                          Evidence ledger is unavailable. Regenerate the extraction.
                        </p>
                      )}

                      <p className="mt-5 border-t border-[#E4ECE5] pt-4 text-[10px] leading-5 text-slate-400">
                        Source matching proves quotation presence and numeric support where checked. It does not independently guarantee semantic correctness. Review all original claims before approval.
                      </p>

                    </div>

                  </div>

                </div>

                {/* TOTAL SUMMARY */}

                <div className="mt-8 rounded-2xl bg-[#173B32] p-6 text-white">

                  <div className="flex flex-wrap items-center justify-between gap-5">

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200/70">
                        Invoice calculation
                      </p>

                      <p className="mt-2 text-sm text-emerald-50/75">
                        {draft.quantity ?? "--"} units ×{" "}
                        {draft.unitPrice?.toFixed(2) ?? "--"}{" "}
                        {draft.currency ?? ""}
                      </p>
                    </div>

                    <div className="text-left sm:text-right">

                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200/70">
                        Current invoice total
                      </p>

                      <p className="mt-1 text-3xl font-bold tracking-tight text-[#B7F3D8] sm:text-4xl">
                        {total === null
                          ? "Incomplete"
                          : `${total} ${draft.currency ?? ""}`}
                      </p>

                    </div>

                  </div>

                </div>

                {/* PAYPAL APPROVAL */}

                <DraftApproval
                  key={JSON.stringify(draft)}
                  draft={draft}
                  extractionReceipt={extractionReceipt}
                  statedTotal={statedTotal}
                  statedTotalEvidenceStatus={
                    statedTotalEvidenceStatus
                  }
                  onBusyChange={setBusy}
                  onCreated={() => {
                    setHistoryRefreshKey(
                      (current) => current + 1
                    );
                  }}
                />

              </div>
            </section>
          )}

          {/* ================================================== */}
          {/* INVOICE HISTORY */}
          {/* ================================================== */}

          <section
            id="invoice-history"
            className="scroll-mt-24 space-y-5"
          >

            <SectionHeading
              eyebrow="04 · Operations"
              title="Invoice history."
              description="Review previously submitted PayPal Sandbox invoices and their latest synchronized statuses."
            />

            <div className="rounded-[24px] border border-[#E5EBE6] bg-white p-5 shadow-sm sm:p-7">
              <InvoiceHistory refreshKey={historyRefreshKey} />
            </div>

          </section>

          {/* ================================================== */}
          {/* ATTACK LAB */}
          {/* ================================================== */}

          <section
            id="attack-lab"
            className="scroll-mt-24 space-y-5"
          >

            <SectionHeading
              eyebrow="05 · Agent safety"
              title="Try to break it."
              description="AI agents are about to move money. Here is what stops them from moving the wrong amount, to the wrong person, because of a lie, a typo or a hidden instruction."
            />

            <AttackLab />

          </section>

          {/* ================================================== */}
          {/* FOOTER */}
          {/* ================================================== */}

          <footer className="border-t border-[#E5EBE6] pt-7">

            <div className="flex flex-wrap items-center justify-between gap-4">

              <BrandMark />

              <div className="text-right">
                <p className="text-xs font-semibold text-[#18382F]">
                  WORK2CASH
                </p>

                <p className="mt-1 text-[10px] text-slate-400">
                  AI financial integrity · PayPal Sandbox
                </p>
              </div>

            </div>

            <p className="mt-5 text-center text-[10px] leading-5 text-slate-400">
              Development and hackathon demonstration environment. No real payments are collected.
            </p>

          </footer>

        </div>
      </div>
    </main>
  );
}
