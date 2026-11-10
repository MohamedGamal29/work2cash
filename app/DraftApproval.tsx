
"use client";

import { useRef, useState } from "react";

import {
  evaluatePricingIntegrity,
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

type CreatedInvoice = {
  invoiceId: string;
  status: string;
  total: string;
  currency: string;
  dueDate: string | null;
};

type StoredApproval = {
  requestId: string;
  draftJson: string;
};

const STORAGE_KEY = "work2cash:invoice-approval:v2";

// ============================================================
// 2. HELPERS
// ============================================================

function validateDraftForApproval(
  draft: InvoiceDraft,
  statedTotal: number | null,
  statedTotalEvidenceStatus: PricingEvidenceState
): string[] {
  const errors: string[] = [];

  const customerName =
    draft.customerName?.trim() ?? "";

  const customerEmail =
    draft.customerEmail?.trim() ?? "";

  const description =
    draft.description?.trim() ?? "";

  // Customer name.
  if (!customerName) {
    errors.push("Customer name is required.");
  } else if (customerName.length > 100) {
    errors.push("Customer name cannot exceed 100 characters.");
  }

  // Customer email.
  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!customerEmail) {
    errors.push("Customer email is required.");
  } else if (
    customerEmail.length > 254 ||
    !emailPattern.test(customerEmail)
  ) {
    errors.push("Enter a valid customer email.");
  }

  // Description.
  if (!description) {
    errors.push("Work description is required.");
  } else if (description.length > 200) {
    errors.push("Description cannot exceed 200 characters.");
  }

  // Quantity.
  const quantity = draft.quantity;

  if (
    quantity === null ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 100
  ) {
    errors.push(
      "Quantity must be a whole number between 1 and 100."
    );
  }

  // Unit price.
  const unitPrice = draft.unitPrice;

  if (
    unitPrice === null ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0 ||
    unitPrice > 10000
  ) {
    errors.push(
      "Unit price must be greater than zero and cannot exceed 10,000."
    );
  } else {
    const cents = unitPrice * 100;

    if (
      Math.abs(cents - Math.round(cents)) > 0.000001
    ) {
      errors.push(
        "Unit price cannot contain more than two decimal places."
      );
    }
  }

  // Currency.
  if (draft.currency?.trim().toUpperCase() !== "USD") {
    errors.push(
      "Only USD invoices are currently supported."
    );
  }

  // Payment deadline.
  const paymentDueDays = draft.paymentDueDays;

  if (
    paymentDueDays === null ||
    !Number.isInteger(paymentDueDays) ||
    paymentDueDays < 0 ||
    paymentDueDays > 365
  ) {
    errors.push(
      "Payment due days must be a whole number between 0 and 365."
    );
  }

  // Maximum invoice amount.
  if (
    typeof quantity === "number" &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    typeof unitPrice === "number" &&
    Number.isFinite(unitPrice) &&
    unitPrice > 0
  ) {
    const cents =
      quantity * Math.round(unitPrice * 100);

    if (!Number.isSafeInteger(cents) || cents > 1000000) {
      errors.push(
        "The invoice total cannot exceed 10,000 USD."
      );
    }
  }

  // Deterministic pricing integrity.
  const financialResult = evaluatePricingIntegrity({
    quantity,
    unitPrice,
    statedTotal,
    currency: draft.currency,

    quantityEvidenceStatus: "USER_CONFIRMED",
    unitPriceEvidenceStatus: "USER_CONFIRMED",

    statedTotalEvidenceStatus,
  });

  if (!financialResult.canApprove) {
    errors.push(financialResult.message);
  }

  return errors;
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

// ============================================================
// 3. APPROVAL COMPONENT
// ============================================================

export default function DraftApproval({
  draft,
  extractionReceipt,
  statedTotal,
  statedTotalEvidenceStatus,
  onBusyChange,
  onCreated,
}: {
  draft: InvoiceDraft;
  extractionReceipt: string | null;
  statedTotal: number | null;
  statedTotalEvidenceStatus: PricingEvidenceState;
  onBusyChange: (busy: boolean) => void;
  onCreated: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const [errors, setErrors] = useState<string[]>([]);

  const [created, setCreated] =
    useState<CreatedInvoice | null>(null);

  const requestStarted = useRef(false);

  const requestId = useRef<string | null>(null);

  const requestDraftJson = useRef<string | null>(null);

  // ==========================================================
  // 4. FINANCIAL INTEGRITY
  // ==========================================================

  const pricingIntegrity = evaluatePricingIntegrity({
    quantity: draft.quantity,
    unitPrice: draft.unitPrice,
    statedTotal,
    currency: draft.currency,

    quantityEvidenceStatus: "USER_CONFIRMED",
    unitPriceEvidenceStatus: "USER_CONFIRMED",

    statedTotalEvidenceStatus,
  });

  const readinessErrors = validateDraftForApproval(
    draft,
    statedTotal,
    statedTotalEvidenceStatus
  );

  const hasValidReceipt =
    typeof extractionReceipt === "string" &&
    extractionReceipt.length > 0;

  const isReady =
    readinessErrors.length === 0 &&
    hasValidReceipt;

  // ==========================================================
  // 5. REQUEST ID PERSISTENCE
  // ==========================================================

  function getRequestId(approvalJson: string): string {
    if (
      requestId.current &&
      requestDraftJson.current === approvalJson
    ) {
      return requestId.current;
    }

    try {
      const stored =
        sessionStorage.getItem(STORAGE_KEY);

      if (stored) {
        const parsed =
          JSON.parse(stored) as StoredApproval;

        if (
          parsed.draftJson === approvalJson &&
          typeof parsed.requestId === "string"
        ) {
          requestId.current = parsed.requestId;
          requestDraftJson.current = approvalJson;

          return parsed.requestId;
        }
      }
    } catch {
      // Continue with a new request ID.
    }

    const newRequestId = crypto.randomUUID();

    requestId.current = newRequestId;
    requestDraftJson.current = approvalJson;

    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          requestId: newRequestId,
          draftJson: approvalJson,
        })
      );
    } catch {
      // The component ref still protects the active session.
    }

    return newRequestId;
  }

  // ==========================================================
  // 6. CREATE PAYPAL SANDBOX INVOICE
  // ==========================================================

  async function createDraft() {
    if (
      !confirmed ||
      !isReady ||
      requestStarted.current ||
      busy ||
      attempted
    ) {
      return;
    }

    const proceed = window.confirm(
      "Create this reviewed PayPal Sandbox invoice draft? The invoice will NOT be sent."
    );

    if (!proceed) return;

    const approvalJson = JSON.stringify({
      draft,
      extractionReceipt,
    });

    const currentRequestId =
      getRequestId(approvalJson);

    requestStarted.current = true;

    setAttempted(true);
    setBusy(true);

    setErrors([]);
    setCreated(null);

    onBusyChange(true);

    try {
      const response = await fetch("/api/invoices", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          approved: true,
          requestId: currentRequestId,
          draft,
          extractionReceipt,
        }),
      });

      const data: unknown = await response.json();

      if (
        !response.ok ||
        !isObject(data) ||
        data.success !== true ||
        typeof data.invoiceId !== "string" ||
        typeof data.status !== "string"
      ) {
        const messages =
          isObject(data) &&
          Array.isArray(data.errors)
            ? data.errors.filter(
                (item): item is string =>
                  typeof item === "string"
              )
            : [];

        const message =
          isObject(data) &&
          typeof data.message === "string"
            ? data.message
            : "Could not confirm invoice creation.";

        setErrors(
          messages.length > 0
            ? messages
            : [message]
        );

        return;
      }

      const paypalTotal =
        isObject(data.paypalTotal)
          ? data.paypalTotal
          : null;

      const paymentTerm =
        isObject(data.paymentTerm)
          ? data.paymentTerm
          : null;

      setCreated({
        invoiceId: data.invoiceId,
        status: data.status,

        total:
          paypalTotal &&
          typeof paypalTotal.value === "string"
            ? paypalTotal.value
            : typeof data.submittedTotal === "string"
              ? data.submittedTotal
              : "Not returned",

        currency:
          paypalTotal &&
          typeof paypalTotal.currency_code === "string"
            ? paypalTotal.currency_code
            : draft.currency ?? "USD",

        dueDate:
          paymentTerm &&
          typeof paymentTerm.due_date === "string"
            ? paymentTerm.due_date
            : null,
      });

      onCreated();
    } catch (error) {
      console.error(
        "PayPal invoice creation error:",
        error
      );

      setErrors([
        "Could not confirm the result. PayPal may have created the invoice.",
        "Check PayPal Sandbox before making another attempt.",
      ]);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  // ==========================================================
  // 7. RENDER
  // ==========================================================

  return (
    <div className="mt-8 border-t border-[#E7ECE8] pt-8">

      {/* ============================================== */}
      {/* FINANCIAL INTEGRITY */}
      {/* ============================================== */}

      <div className="mb-7">

        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EAF3ED] text-[#26694A]">
            ◈
          </span>

          <div>
            <h3 className="text-base font-bold text-[#18382F]">
              Financial integrity
            </h3>

            <p className="text-xs text-slate-400">
              Independent arithmetic verification.
            </p>
          </div>
        </div>

        {pricingIntegrity.status === "CONFLICT" ||
        pricingIntegrity.status === "INVALID" ? (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">

              <h4 className="text-sm font-bold text-red-800">
                Financial discrepancy detected
              </h4>

              <span className="rounded-full border border-red-200 bg-white px-3 py-1 text-[10px] font-bold text-red-700">
                {pricingIntegrity.status}
              </span>

            </div>

            <p className="mt-3 text-sm leading-6 text-red-700">
              {pricingIntegrity.message}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">

              <div className="rounded-xl bg-white p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Calculated total
                </p>

                <p className="mt-2 text-xl font-bold text-[#18382F]">
                  {pricingIntegrity.calculatedTotal?.toFixed(2) ?? "--"}{" "}
                  {pricingIntegrity.currency ?? ""}
                </p>
              </div>

              <div className="rounded-xl bg-white p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Source stated total
                </p>

                <p className="mt-2 text-xl font-bold text-[#18382F]">
                  {pricingIntegrity.statedTotal?.toFixed(2) ?? "--"}{" "}
                  {pricingIntegrity.currency ?? ""}
                </p>
              </div>

            </div>

            <p className="mt-4 text-xs font-bold text-red-800">
              PayPal creation is blocked until this discrepancy is resolved.
            </p>

          </div>
        ) : pricingIntegrity.status === "CONSISTENT" ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">

            <div className="flex items-center gap-2">
              <span className="text-emerald-700">✓</span>

              <h4 className="text-sm font-bold text-emerald-800">
                Financial integrity verified
              </h4>
            </div>

            <p className="mt-2 text-xs leading-5 text-emerald-700">
              {pricingIntegrity.message}
            </p>

          </div>
        ) : pricingIntegrity.status === "DERIVED" ? (
          <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5">

            <h4 className="text-sm font-bold text-blue-800">
              Unit price derived successfully
            </h4>

            <p className="mt-2 text-xs leading-5 text-blue-700">
              {pricingIntegrity.message}
            </p>

          </div>
        ) : pricingIntegrity.status === "UNVERIFIED" ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">

            <h4 className="text-sm font-bold text-amber-800">
              Financial evidence needs review
            </h4>

            <p className="mt-2 text-xs leading-5 text-amber-700">
              {pricingIntegrity.message}
            </p>

          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">

            <h4 className="text-sm font-bold text-slate-700">
              No independent total comparison
            </h4>

            <p className="mt-2 text-xs leading-5 text-slate-500">
              No independently stated job total is available. The invoice total will be calculated from quantity and unit price.
            </p>

          </div>
        )}

      </div>

      {/* ============================================== */}
      {/* READINESS */}
      {/* ============================================== */}

      {!hasValidReceipt && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4"
        >
          <h4 className="text-sm font-bold text-red-800">
            Signed extraction receipt missing
          </h4>

          <p className="mt-2 text-xs leading-5 text-red-700">
            Generate a new AI draft. An authentic extraction receipt is required to create an auditable approval record.
          </p>
        </div>
      )}

      {isReady ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">

          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
              ✓
            </span>

            <h4 className="text-sm font-bold text-emerald-800">
              Invoice passed readiness checks
            </h4>
          </div>

          <p className="mt-2 text-xs leading-5 text-emerald-700">
            All required values passed the client-side checks. The server will independently validate the receipt, evidence, final draft and pricing integrity again before contacting PayPal.
          </p>

        </div>
      ) : (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-5"
        >

          <h4 className="text-sm font-bold text-amber-800">
            Invoice is not ready
          </h4>

          <p className="mt-2 text-xs text-amber-700">
            Resolve the following issues:
          </p>

          <ul className="mt-3 space-y-2">
            {readinessErrors.map((error, index) => (
              <li
                key={index}
                className="flex items-start gap-2 text-xs leading-5 text-amber-800"
              >
                <span>•</span>
                {error}
              </li>
            ))}

            {!hasValidReceipt && (
              <li className="text-xs text-amber-800">
                • Signed extraction receipt is missing.
              </li>
            )}
          </ul>

        </div>
      )}

      {/* ============================================== */}
      {/* HUMAN AUTHORIZATION */}
      {/* ============================================== */}

      <div className="mt-7 rounded-2xl border border-[#E5EBE6] bg-white p-5 sm:p-6">

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">
            Final authorization
          </p>

          <h3 className="mt-2 text-lg font-bold text-[#18382F]">
            You control the payment.
          </h3>

          <p className="mt-2 text-xs leading-5 text-slate-500">
            Review the customer, invoice amount, source evidence and payment terms. No invoice is sent without explicit authorization.
          </p>
        </div>

        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-[#E5EBE6] bg-[#FAFCFA] p-4">

          <input
            type="checkbox"
            checked={confirmed}
            disabled={!isReady || attempted || busy}
            onChange={(event) =>
              setConfirmed(event.target.checked)
            }
            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700 disabled:opacity-40"
          />

          <span className="text-xs leading-6 text-[#365747]">
            I have reviewed the customer, financial amounts, currency, source evidence and payment terms. I approve creating this PayPal Sandbox invoice draft.
          </span>

        </label>

        <button
          type="button"
          disabled={
            !isReady ||
            !confirmed ||
            attempted ||
            busy
          }
          onClick={() => void createDraft()}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl bg-[#173B32] px-6 py-4 text-sm font-bold text-white transition hover:bg-[#245747] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
              Creating PayPal draft...
            </>
          ) : attempted ? (
            "Request already submitted"
          ) : !isReady ? (
            "Resolve outstanding issues first"
          ) : !confirmed ? (
            "Review and confirm first"
          ) : (
            <>
              Create approved Sandbox invoice

              <span>→</span>
            </>
          )}
        </button>

        <p className="mt-3 text-center text-[10px] text-slate-400">
          PayPal Sandbox only · Invoice will not be sent automatically.
        </p>

      </div>

      {/* ============================================== */}
      {/* API ERRORS */}
      {/* ============================================== */}

      {errors.length > 0 && (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5"
        >
          <h4 className="text-sm font-bold text-red-800">
            Invoice creation was not confirmed
          </h4>

          <ul className="mt-3 space-y-2">
            {errors.map((error, index) => (
              <li
                key={index}
                className="text-xs leading-5 text-red-700"
              >
                • {error}
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[10px] leading-5 text-red-600">
            Check PayPal Sandbox and invoice history before attempting another creation. A failed response does not always prove that the remote operation failed.
          </p>
        </div>
      )}

      {/* ============================================== */}
      {/* SUCCESSFUL CREATION */}
      {/* ============================================== */}

      {created && (
        <div
          role="status"
          className="mt-7 rounded-2xl border border-emerald-200 bg-[#F1F8F3] p-6 sm:p-7"
        >

          <div className="flex flex-wrap items-center justify-between gap-3">

            <div>
              <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">
                <span>✓</span>
                Successful execution
              </span>

              <h3 className="mt-3 text-xl font-bold text-[#18382F]">
                PayPal Sandbox draft created.
              </h3>
            </div>

            <span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[10px] font-bold text-emerald-700">
              {created.status}
            </span>

          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">

            <div className="rounded-xl bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Invoice ID
              </p>

              <p className="mt-2 break-all font-mono text-xs font-semibold text-[#18382F]">
                {created.invoiceId}
              </p>
            </div>

            <div className="rounded-xl bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                PayPal total
              </p>

              <p className="mt-2 text-xl font-bold text-[#18382F]">
                {created.total} {created.currency}
              </p>
            </div>

            <div className="rounded-xl bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Payment deadline
              </p>

              <p className="mt-2 text-sm font-bold text-[#18382F]">
                {created.dueDate ?? "Due on receipt"}
              </p>
            </div>

            <div className="rounded-xl bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Execution environment
              </p>

              <p className="mt-2 text-sm font-bold text-[#18382F]">
                PayPal Sandbox
              </p>
            </div>

          </div>

          <div className="mt-5 rounded-xl border border-emerald-200 bg-white p-4">
            <p className="text-xs font-bold text-emerald-800">
              Approval record saved
            </p>

            <p className="mt-1 text-[10px] leading-5 text-emerald-700">
              The approved values and their evidence have been preserved in the local invoice database.
            </p>
          </div>

          <p className="mt-5 text-xs font-semibold text-emerald-800">
            Not sent. No real payment collected.
          </p>

        </div>
      )}

    </div>
  );
}
