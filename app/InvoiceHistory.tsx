
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type InvoiceRecord = {
  requestId: string;
  invoiceId: string | null;
  customerName: string;
  customerEmail: string | null;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  currency: string;
  total: string | null;
  operationStatus: string;
  paypalStatus: string | null;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  lastError: string | null;
  proofHash: string | null;
  approvedAt: string | null;
  hasProofSnapshot: boolean;
  changeCount: number;
};

type StatusFilter =
  | "ALL"
  | "COMPLETED"
  | "PENDING"
  | "UNKNOWN"
  | "FAILED";

function statusLabel(invoice: InvoiceRecord) {
  switch (invoice.operationStatus) {
    case "COMPLETED":
      return `PayPal ${invoice.paypalStatus ?? "Created"}`;
    case "PENDING":
      return "Processing";
    case "UNKNOWN":
      return "Needs checking";
    case "FAILED":
      return "Failed";
    default:
      return invoice.operationStatus;
  }
}

function statusStyle(status: string) {
  switch (status) {
    case "COMPLETED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "PENDING":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "UNKNOWN":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "FAILED":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString();
}

function shortHash(hash: string) {
  return hash.length > 20
    ? `${hash.slice(0, 10)}…${hash.slice(-6)}`
    : hash;
}

function isPaid(invoice: InvoiceRecord) {
  return (
    invoice.paypalStatus === "PAID" ||
    invoice.paypalStatus === "MARKED_AS_PAID"
  );
}

type StatTone = "neutral" | "good" | "proof" | "warn" | "bad";

const STAT_STYLE: Record<StatTone, { card: string; value: string; label: string }> = {
  neutral: {
    card: "border-[#E5EBE6] bg-white",
    value: "text-[#18382F]",
    label: "text-slate-500",
  },
  good: {
    card: "border-emerald-200 bg-emerald-50/60",
    value: "text-emerald-700",
    label: "text-emerald-800/70",
  },
  proof: {
    card: "border-[#173B32] bg-[#173B32]",
    value: "text-[#A7F3D0]",
    label: "text-emerald-100/70",
  },
  warn: {
    card: "border-amber-200 bg-amber-50/60",
    value: "text-amber-700",
    label: "text-amber-800/70",
  },
  bad: {
    card: "border-red-200 bg-red-50/60",
    value: "text-red-700",
    label: "text-red-800/70",
  },
};

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone: StatTone;
}) {
  const style = STAT_STYLE[tone];

  return (
    <div className={`rounded-2xl border p-4 ${style.card}`}>
      <p className={`text-xs font-medium ${style.label}`}>{label}</p>

      <p className={`mt-2 text-3xl font-semibold tabular-nums ${style.value}`}>
        {value}
      </p>

      {hint && (
        <p className={`mt-1 text-[11px] ${style.label}`}>{hint}</p>
      )}
    </div>
  );
}

function LifecycleStepper({ invoice }: { invoice: InvoiceRecord }) {
  const failed = invoice.operationStatus === "FAILED";

  const steps = [
    {
      label: "Evidence verified",
      done: invoice.hasProofSnapshot,
      bad: false,
    },
    {
      label: "Human approved",
      done: Boolean(invoice.approvedAt),
      bad: false,
    },
    {
      label: failed ? "PayPal failed" : "PayPal invoice",
      done:
        invoice.operationStatus === "COMPLETED" &&
        Boolean(invoice.invoiceId),
      bad: failed,
    },
    {
      label: "Paid",
      done: isPaid(invoice),
      bad: false,
    },
  ];

  return (
    <ol
      aria-label="Invoice lifecycle"
      className="mt-5 grid grid-cols-4 gap-2"
    >
      {steps.map((step) => (
        <li key={step.label}>
          <div
            className={`h-1.5 rounded-full ${
              step.bad
                ? "bg-red-400"
                : step.done
                  ? "bg-emerald-500"
                  : "bg-slate-200"
            }`}
          />

          <p
            className={`mt-2 text-[11px] font-semibold ${
              step.bad
                ? "text-red-600"
                : step.done
                  ? "text-emerald-700"
                  : "text-slate-400"
            }`}
          >
            {step.done ? "✓ " : ""}
            {step.label}
          </p>
        </li>
      ))}
    </ol>
  );
}

export default function InvoiceHistory({
  refreshKey,
}: {
  refreshKey: number;
}) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [syncingInvoiceId, setSyncingInvoiceId] =useState<string | null>(null);
  const [syncError, setSyncError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/invoices", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ?? "Could not load invoice history."
        );
      }

      setInvoices(
        Array.isArray(data.invoices) ? data.invoices : []
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong while loading history."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function fetchHistory() {
      try {
        const response = await fetch("/api/invoices", {
          method: "GET",
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ?? "Could not load invoice history."
          );
        }

        if (active) {
          setInvoices(
            Array.isArray(data.invoices)
              ? data.invoices
              : []
          );
          setError("");
        }
      } catch (error) {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not load invoice history."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void fetchHistory();

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const stats = useMemo(() => {
    return {
      total: invoices.length,
      completed: invoices.filter(
        (item) => item.operationStatus === "COMPLETED"
      ).length,
      pending: invoices.filter(
        (item) =>
          item.operationStatus === "PENDING" ||
          item.operationStatus === "UNKNOWN"
      ).length,
      failed: invoices.filter(
        (item) => item.operationStatus === "FAILED"
      ).length,
      proofBacked: invoices.filter((item) => item.proofHash).length,
    };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();

    return invoices.filter((invoice) => {
      const matchesFilter =
        filter === "ALL" ||
        invoice.operationStatus === filter;

      const searchableText = [
        invoice.customerName,
        invoice.customerEmail ?? "",
        invoice.description,
        invoice.invoiceId ?? "",
        invoice.requestId,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query || searchableText.includes(query);

      return matchesFilter && matchesSearch;
    });
  }, [invoices, search, filter]);
  async function refreshPayPalStatus(invoiceId: string) {
  setSyncingInvoiceId(invoiceId);
  setSyncError("");

  try {
    const response = await fetch(
      `/api/invoices/${encodeURIComponent(invoiceId)}/sync`,
      {
        method: "POST",
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.message ?? "Could not synchronize PayPal status."
      );
    }

    // Reload the history from SQLite after synchronization.
    await loadInvoices();
  } catch (error) {
    setSyncError(
      error instanceof Error
        ? error.message
        : "Could not refresh PayPal invoice status."
    );
  } finally {
    setSyncingInvoiceId(null);
  }
}
  async function copyHash(requestId: string, hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedId(requestId);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard access can be denied; the hash stays visible to copy by hand.
    }
  }

  const inputStyle =
    "w-full rounded-xl border border-[#DEE8E0] bg-white px-4 py-3 text-sm text-[#18382F] outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

  return (
    <section aria-label="Invoice request ledger">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-[#18382F]">
            Request ledger
          </h3>

          <p className="mt-1 text-sm text-slate-500">
            Every PayPal Sandbox request recorded here, with the proof
            behind it.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadInvoices()}
          disabled={loading}
          className="rounded-xl border border-[#DCE6DE] bg-white px-4 py-2.5 text-sm font-semibold text-[#3D6651] transition hover:bg-[#F0F6F1] disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh history"}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Total requests"
          value={stats.total}
          tone="neutral"
        />

        <StatCard
          label="PayPal created"
          value={stats.completed}
          tone="good"
        />

        <StatCard
          label="Proof-backed"
          value={`${stats.proofBacked}/${stats.total}`}
          hint="Evidence verified before approval"
          tone="proof"
        />

        <StatCard
          label="Needs checking"
          value={stats.pending}
          tone="warn"
        />

        <StatCard
          label="Failed"
          value={stats.failed}
          tone="bad"
        />
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-[1fr_190px]">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customer, description, or invoice ID..."
          aria-label="Search invoice history"
          className={inputStyle}
        />

        <select
          value={filter}
          onChange={(event) =>
            setFilter(event.target.value as StatusFilter)
          }
          aria-label="Filter invoice history by status"
          className={inputStyle}
        >
          <option value="ALL">All requests</option>
          <option value="COMPLETED">Created</option>
          <option value="PENDING">Processing</option>
          <option value="UNKNOWN">Needs checking</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {syncError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {syncError}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading && invoices.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-500">
          Loading invoice history...
        </p>
      )}

      {!loading && !error && filteredInvoices.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-[#CFDCD2] bg-[#FAFCFA] p-8 text-center">
          <h3 className="font-semibold text-[#18382F]">
            {invoices.length === 0
              ? "No invoice requests yet"
              : "No matching invoices"}
          </h3>

          <p className="mt-2 text-sm text-slate-500">
            {invoices.length === 0
              ? "Create your first approved sandbox draft to see it here."
              : "Try a different search term or status filter."}
          </p>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {filteredInvoices.map((invoice) => (
          <article
            key={invoice.requestId}
            className="rounded-2xl border border-[#E5EBE6] bg-white p-5 shadow-[0_1px_2px_rgba(24,56,47,0.04)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-semibold text-[#18382F]">
                  {invoice.customerName}
                </h3>

                <p className="mt-1 break-words text-sm text-slate-500">
                  {invoice.customerEmail ?? "No customer email"}
                </p>
              </div>

              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle(invoice.operationStatus)}`}
              >
                {statusLabel(invoice)}
              </span>
            </div>

            <p className="mt-4 break-words text-sm text-[#365747]">
              {invoice.description}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-slate-400">Total</p>

                <p className="mt-1 text-lg font-semibold text-[#18382F]">
                  {invoice.total
                    ? `${invoice.total} ${invoice.currency}`
                    : "Not available"}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-400">Quantity</p>

                <p className="mt-1 text-sm text-[#18382F]">
                  {invoice.quantity ?? "—"}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-400">Unit price</p>

                <p className="mt-1 text-sm text-[#18382F]">
                  {invoice.unitPrice !== null
                    ? `${invoice.unitPrice.toFixed(2)} ${invoice.currency}`
                    : "—"}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-400">Created</p>

                <p className="mt-1 text-sm text-[#18382F]">
                  {formatDate(invoice.createdAt)}
                </p>
              </div>
            </div>

            <LifecycleStepper invoice={invoice} />

            {invoice.proofHash ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F4F8F5] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#3D6651]">
                    Proof receipt
                  </p>

                  <p
                    title={invoice.proofHash}
                    className="mt-1 break-all font-mono text-xs text-[#18382F]"
                  >
                    {shortHash(invoice.proofHash)}
                  </p>

                  <p className="mt-1 text-[11px] text-slate-500">
                    {invoice.approvedAt
                      ? `Approved ${formatDate(invoice.approvedAt)}`
                      : "Approval time not recorded"}
                    {" · "}
                    {invoice.changeCount === 0
                      ? "AI draft approved unchanged"
                      : `${invoice.changeCount} edit${invoice.changeCount === 1 ? "" : "s"} recorded between AI draft and approval`}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void copyHash(invoice.requestId, invoice.proofHash!)
                  }
                  className="rounded-lg border border-[#DCE6DE] bg-white px-3 py-1.5 text-xs font-semibold text-[#3D6651] transition hover:bg-[#F0F6F1]"
                >
                  {copiedId === invoice.requestId
                    ? "Copied"
                    : "Copy hash"}
                </button>
              </div>
            ) : (
              <p className="mt-5 text-xs text-slate-400">
                No proof receipt is stored for this request.
              </p>
            )}

            <div className="mt-5 border-t border-[#EDF2EE] pt-4">
              <p className="text-xs text-slate-400">PayPal invoice ID</p>

              <p className="mt-1 break-all font-mono text-sm font-medium text-emerald-700">
                {invoice.invoiceId ?? "Not available"}
              </p>

              {invoice.invoiceId && (
                <button
                  type="button"
                  onClick={() =>
                    void refreshPayPalStatus(invoice.invoiceId!)
                  }
                  disabled={syncingInvoiceId !== null}
                  className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncingInvoiceId === invoice.invoiceId
                    ? "Refreshing PayPal status..."
                    : "Refresh PayPal status"}
                </button>
              )}

              {invoice.dueDate && (
                <p className="mt-3 text-sm text-slate-500">
                  Payment deadline: {invoice.dueDate}
                </p>
              )}

              {invoice.operationStatus === "UNKNOWN" && (
                <p className="mt-3 rounded-lg bg-orange-50 p-3 text-sm text-orange-700">
                  Creation result is uncertain. Check PayPal Sandbox
                  before attempting another creation.
                </p>
              )}

              {invoice.operationStatus === "PENDING" && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                  This request is still recorded as processing. Do not
                  submit it again with a different request ID until its
                  PayPal result is reconciled.
                </p>
              )}

              {invoice.operationStatus === "FAILED" && (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  This request failed. A new approval attempt will use a
                  new request ID.
                </p>
              )}
            </div>
          </article>
        ))}
      </div>

      <p className="mt-5 text-xs text-slate-400">
        Showing up to 100 locally stored requests. This history reflects
        records saved by InvoicePilot; it is not yet a live
        synchronization of every invoice in your PayPal account.
      </p>
    </section>
  );
}
