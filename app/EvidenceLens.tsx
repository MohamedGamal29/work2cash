"use client";

import { useMemo, useState } from "react";

import {
  buildHighlightSegments,
  locateQuote,
  type QuoteSpan,
} from "./lib/evidence-spans";

import type { InvoiceEvidence } from "./lib/proof-ledger";

// ============================================================
// TYPES
// ============================================================

export type LensStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "MISSING"
  | "DERIVED";

export type LensMark = {
  key: string;
  label: string;
  status: LensStatus;
  quote: string | null;
  detail: string;
  span: QuoteSpan | null;
};

const FIELD_LABELS: Record<keyof InvoiceEvidence, string> = {
  customerName: "Customer name",
  customerEmail: "Customer email",
  description: "Work description",
  quantity: "Quantity",
  unitPrice: "Unit price",
  currency: "Currency",
  paymentDueDays: "Payment terms",
  statedTotal: "Stated total",
};

const STATUS_DOT: Record<LensStatus, string> = {
  VERIFIED: "bg-emerald-500",
  UNVERIFIED: "bg-amber-500",
  DERIVED: "bg-blue-500",
  MISSING: "bg-slate-300",
};

const STATUS_TEXT: Record<LensStatus, string> = {
  VERIFIED: "Verified in your words",
  UNVERIFIED: "Not supported by your notes",
  DERIVED: "Calculated, not quoted",
  MISSING: "Not provided",
};

// ============================================================
// HIGHLIGHTED SOURCE (shared with the Attack Lab)
// ============================================================

export function HighlightedSource({
  source,
  marks,
  activeKey,
  onActivate,
  dangerSpans = [],
}: {
  source: string;
  marks: LensMark[];
  activeKey: string | null;
  onActivate: (key: string | null) => void;
  dangerSpans?: QuoteSpan[];
}) {
  const segments = useMemo(
    () =>
      buildHighlightSegments(
        source,
        marks
          .filter((mark) => mark.span !== null)
          .map((mark) => ({
            key: mark.key,
            start: mark.span!.start,
            end: mark.span!.end,
          }))
      ),
    [source, marks]
  );

  const statusByKey = useMemo(
    () =>
      Object.fromEntries(marks.map((mark) => [mark.key, mark.status])),
    [marks]
  );

  const isDanger = (start: number, end: number) =>
    dangerSpans.some(
      (span) => span.start < end && start < span.end
    );

  return (
    <p
      dir="auto"
      className="whitespace-pre-wrap break-words rounded-2xl border border-[#DEE8E0] bg-[#FAFCFA] p-5 text-sm leading-8 text-[#203C33]"
    >
      {segments.map((segment) => {
        const covered = segment.keys.length > 0;
        const active =
          activeKey !== null && segment.keys.includes(activeKey);
        const danger = isDanger(segment.start, segment.end);

        if (!covered && !danger) {
          return (
            <span
              key={segment.start}
              className={
                activeKey ? "text-slate-400 transition" : "transition"
              }
            >
              {segment.text}
            </span>
          );
        }

        const unsupported = segment.keys.some(
          (key) => statusByKey[key] === "UNVERIFIED"
        );

        const tone = danger
          ? "bg-red-100 text-red-900 underline decoration-red-400 decoration-wavy"
          : active
            ? unsupported
              ? "bg-amber-300 text-amber-950 ring-2 ring-amber-500"
              : "bg-emerald-300 text-emerald-950 ring-2 ring-emerald-500"
            : unsupported
              ? "bg-amber-100 text-amber-900 underline decoration-amber-500 decoration-dotted"
              : activeKey
                ? "bg-emerald-50 text-slate-500"
                : "bg-emerald-100 text-emerald-950";

        return (
          <mark
            key={segment.start}
            onClick={() =>
              onActivate(
                active ? null : (segment.keys[0] ?? null)
              )
            }
            className={`cursor-pointer rounded-sm transition ${tone}`}
          >
            {segment.text}
          </mark>
        );
      })}
    </p>
  );
}

// ============================================================
// CHIP ROW
// ============================================================

export function LensChips({
  marks,
  activeKey,
  onActivate,
}: {
  marks: LensMark[];
  activeKey: string | null;
  onActivate: (key: string | null) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {marks.map((mark) => {
        const active = activeKey === mark.key;

        return (
          <button
            key={mark.key}
            type="button"
            aria-pressed={active}
            onClick={() => onActivate(active ? null : mark.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
              active
                ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200"
                : "border-[#DCE6DE] bg-white text-slate-600 hover:bg-[#F0F6F1]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${STATUS_DOT[mark.status]}`}
            />
            {mark.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// EVIDENCE LENS
// ============================================================

export default function EvidenceLens({
  source,
  ledger,
}: {
  source: string;
  ledger: InvoiceEvidence;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const marks = useMemo<LensMark[]>(
    () =>
      (Object.keys(FIELD_LABELS) as (keyof InvoiceEvidence)[]).map(
        (key) => {
          const entry = ledger[key];

          if (entry.kind === "SOURCE") {
            return {
              key,
              label: FIELD_LABELS[key],
              status: entry.status,
              quote: entry.quote,
              detail: entry.explanation,
              span: locateQuote(source, entry.quote),
            };
          }

          if (entry.kind === "DERIVED") {
            return {
              key,
              label: FIELD_LABELS[key],
              status: "DERIVED" as const,
              quote: null,
              detail: `${entry.formula}. ${entry.explanation}`,
              span: null,
            };
          }

          return {
            key,
            label: FIELD_LABELS[key],
            status: "MISSING" as const,
            quote: null,
            detail: entry.explanation,
            span: null,
          };
        }
      ),
    [ledger, source]
  );

  const counts = useMemo(
    () => ({
      traced: marks.filter((m) => m.status === "VERIFIED").length,
      derived: marks.filter((m) => m.status === "DERIVED").length,
      unsupported: marks.filter((m) => m.status === "UNVERIFIED")
        .length,
      missing: marks.filter((m) => m.status === "MISSING").length,
    }),
    [marks]
  );

  const active = marks.find((mark) => mark.key === activeKey) ?? null;

  return (
    <div className="rounded-2xl border border-[#DDEAE0] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl text-[#29704B]">◎</span>

            <h3 className="text-base font-bold text-[#18382F]">
              Evidence Lens
            </h3>
          </div>

          <p className="mt-2 text-xs leading-5 text-slate-500">
            Select a field to see the exact words in your notes that
            support it.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-[10px] font-bold">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
            {counts.traced} traced
          </span>

          {counts.derived > 0 && (
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700">
              {counts.derived} calculated
            </span>
          )}

          <span
            className={`rounded-full border px-2.5 py-1 ${
              counts.unsupported > 0
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            {counts.unsupported} unsupported
          </span>
        </div>
      </div>

      <div className="mt-5">
        <HighlightedSource
          source={source}
          marks={marks}
          activeKey={activeKey}
          onActivate={setActiveKey}
        />
      </div>

      <LensChips
        marks={marks}
        activeKey={activeKey}
        onActivate={setActiveKey}
      />

      <div
        aria-live="polite"
        className="mt-4 min-h-[64px] rounded-xl bg-[#F4F8F5] p-4 text-xs leading-5"
      >
        {active ? (
          <>
            <p className="font-bold text-[#18382F]">
              {active.label}{" "}
              <span className="font-medium text-slate-500">
                · {STATUS_TEXT[active.status]}
              </span>
            </p>

            {active.quote && (
              <p dir="auto" className="mt-1 text-[#365747]">
                “{active.quote}”
              </p>
            )}

            <p className="mt-1 text-slate-500">{active.detail}</p>

            {active.status === "VERIFIED" && !active.span && (
              <p className="mt-1 text-slate-400">
                Verified, but its exact position cannot be
                highlighted.
              </p>
            )}

            {active.status === "UNVERIFIED" && active.span && (
              <p className="mt-1 text-amber-700">
                This sentence exists in your notes, but it does not
                support the claimed value.
              </p>
            )}
          </>
        ) : (
          <p className="text-slate-500">
            Greyed text was not used as evidence for any field.
            Anything the AI claimed that your words do not support
            appears as “unsupported”.
          </p>
        )}
      </div>
    </div>
  );
}
