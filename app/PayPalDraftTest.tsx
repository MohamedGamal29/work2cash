"use client";

import { useState } from "react";

export default function PayPalDraftTest() {
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function createDraft() {
    if (attempted || busy) return;

    const approved = window.confirm(
      "Create one \$360 USD sandbox draft? This will not send the invoice."
    );

    if (!approved) return;

    setAttempted(true);
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(
          `Draft creation failed: ${data.message ?? "Unknown error"}. ` +
            "Share the result before retrying."
        );
        return;
      }

      setMessage(
        `Created ${data.invoiceId} — status: ${data.status}. Not sent.`
      );
    } catch {
      setMessage(
        "Could not confirm the result. A draft may have been created. " +
          "Check with me before retrying."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-900 p-6">
      <h2 className="text-xl font-semibold">PayPal sandbox test</h2>

      <p className="mt-3 text-slate-300">
        Website development: 8 hours × \$45 = \$360 USD.
        This test does not use the notes above.
      </p>

      <button
        type="button"
        onClick={createDraft}
        disabled={attempted}
        className="mt-4 rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Creating draft..." : "Create sandbox draft"}
      </button>

      <p aria-live="polite" className="mt-4 break-words text-slate-300">
        {message}
      </p>
    </section>
  );
}