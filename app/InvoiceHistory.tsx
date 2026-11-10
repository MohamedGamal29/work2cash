
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
      return "border-emerald-700 bg-emerald-950/40 text-emerald-300";
    case "PENDING":
      return "border-amber-700 bg-amber-950/40 text-amber-300";
    case "UNKNOWN":
      return "border-orange-700 bg-orange-950/40 text-orange-300";
    case "FAILED":
      return "border-red-700 bg-red-950/40 text-red-300";
    default:
      return "border-slate-600 bg-slate-800 text-slate-300";
  }
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString();
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
  return (
    <section className="mt-10 border-t border-slate-700 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Invoice history
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Your locally recorded PayPal Sandbox invoice requests.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadInvoices()}
          disabled={loading}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh history"}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
          <p className="text-sm text-slate-400">Total requests</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {stats.total}
          </p>
        </div>

        <div className="rounded-xl border border-emerald-900 bg-slate-950 p-4">
          <p className="text-sm text-slate-400">Created</p>
          <p className="mt-2 text-2xl font-bold text-emerald-300">
            {stats.completed}
          </p>
        </div>

        <div className="rounded-xl border border-amber-900 bg-slate-950 p-4">
          <p className="text-sm text-slate-400">Needs checking</p>
          <p className="mt-2 text-2xl font-bold text-amber-300">
            {stats.pending}
          </p>
        </div>

        <div className="rounded-xl border border-red-900 bg-slate-950 p-4">
          <p className="text-sm text-slate-400">Failed</p>
          <p className="mt-2 text-2xl font-bold text-red-300">
            {stats.failed}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-[1fr_190px]">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customer, description, or invoice ID..."
          aria-label="Search invoice history"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400"
        />

        <select
          value={filter}
          onChange={(event) =>
            setFilter(event.target.value as StatusFilter)
          }
          aria-label="Filter invoice history by status"
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400"
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
                className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-300"
            >
                {syncError}
            </div>
            )}
      {error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {loading && invoices.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-400">
          Loading invoice history...
        </p>
      )}

      {!loading && !error && filteredInvoices.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-700 p-8 text-center">
          <h3 className="font-semibold text-white">
            {invoices.length === 0
              ? "No invoice requests yet"
              : "No matching invoices"}
          </h3>
          <p className="mt-2 text-sm text-slate-400">
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
            className="rounded-xl border border-slate-700 bg-slate-950 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-semibold text-white">
                  {invoice.customerName}
                </h3>

                <p className="mt-1 break-words text-sm text-slate-400">
                  {invoice.customerEmail ?? "No customer email"}
                </p>
              </div>

              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${statusStyle(invoice.operationStatus)}`}
              >
                {statusLabel(invoice)}
              </span>
            </div>

            <p className="mt-4 break-words text-sm text-slate-300">
              {invoice.description}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Total</p>
                <p className="mt-1 font-semibold text-white">
                  {invoice.total
                    ? `${invoice.total} ${invoice.currency}`
                    : "Not available"}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">Quantity</p>
                <p className="mt-1 text-sm text-white">
                  {invoice.quantity ?? "—"}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">Created</p>
                <p className="mt-1 text-sm text-white">
                  {formatDate(invoice.createdAt)}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-800 pt-4">
              <p className="text-xs text-slate-500">PayPal invoice ID</p>
              <p className="mt-1 break-all font-mono text-sm text-cyan-300">
                {invoice.invoiceId ?? "Not available"}
              </p>
               {invoice.invoiceId && (
                    <button
                        type="button"
                        onClick={() =>
                        void refreshPayPalStatus(invoice.invoiceId!)
                        }
                        disabled={syncingInvoiceId !== null}
                        className="mt-3 rounded-lg border border-cyan-700 px-4 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-950 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {syncingInvoiceId === invoice.invoiceId
                        ? "Refreshing PayPal status..."
                        : "Refresh PayPal status"}
                    </button>
                    )}
              {invoice.dueDate && (
                <p className="mt-3 text-sm text-slate-400">
                  Payment deadline: {invoice.dueDate}
                </p>
              )}

              {invoice.operationStatus === "UNKNOWN" && (
                <p className="mt-3 text-sm text-orange-300">
                  Creation result is uncertain. Check PayPal Sandbox
                  before attempting another creation.
                </p>
              )}

              {invoice.operationStatus === "PENDING" && (
                <p className="mt-3 text-sm text-amber-300">
                  This request is still recorded as processing.
                  Do not submit it again with a different request ID
                  until its PayPal result is reconciled.
                </p>
              )}

              {invoice.operationStatus === "FAILED" && (
                <p className="mt-3 text-sm text-red-300">
                  This request failed. A new approval attempt will
                  use a new request ID.
                </p>
              )}
            </div>
          </article>
        ))}
      </div>

      <p className="mt-5 text-xs text-slate-500">
        Showing up to 100 locally stored requests. This history
        reflects records saved by InvoicePilot; it is not yet a
        live synchronization of every invoice in your PayPal account.
      </p>
    </section>
  );
}
