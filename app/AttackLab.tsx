"use client";

import { useMemo, useState } from "react";

import {
  ATTACK_SCENARIOS,
  type AttackScenario,
} from "./lib/attack-scenarios";

import type { GateResult, GateVerdict } from "./lib/proof-gate";

import {
  HighlightedSource,
  LensChips,
  type LensMark,
} from "./EvidenceLens";

// ============================================================
// HELPERS
// ============================================================

const FIELD_LABELS: Record<string, string> = {
  customerName: "Customer name",
  customerEmail: "Customer email",
  description: "Work description",
  quantity: "Quantity",
  unitPrice: "Unit price",
  currency: "Currency",
  paymentDueDays: "Payment terms",
  statedTotal: "Stated total",
};

const VERDICT_STYLE: Record<GateVerdict, string> = {
  BLOCK: "border-red-200 bg-red-50 text-red-700",
  REVIEW: "border-amber-200 bg-amber-50 text-amber-700",
  ALLOW: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const VERDICT_COPY: Record<GateVerdict, string> = {
  BLOCK: "Blocked before PayPal",
  REVIEW: "Held for human review",
  ALLOW: "Cleared for approval",
};

async function evaluate(
  sourceText: string,
  claims: unknown
): Promise<GateResult> {
  const response = await fetch("/api/proof-gate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceText, claims }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    throw new Error(data?.message ?? "The gate request failed.");
  }

  return data as GateResult;
}

function marksFromResult(result: GateResult): LensMark[] {
  return Object.values(result.fields)
    .filter((field) => field.status !== "MISSING" || field.value)
    .map((field) => ({
      key: field.field,
      label: FIELD_LABELS[field.field] ?? field.field,
      status: field.status,
      quote: field.quote,
      detail: field.explanation,
      span: field.span,
    }));
}

// ============================================================
// RESULT PANEL
// ============================================================

function ResultPanel({
  source,
  result,
}: {
  source: string;
  result: GateResult;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const marks = useMemo(() => marksFromResult(result), [result]);

  const active = marks.find((mark) => mark.key === activeKey) ?? null;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${VERDICT_STYLE[result.verdict]}`}
        >
          {result.verdict} · {VERDICT_COPY[result.verdict]}
        </span>

        <span className="font-mono text-[10px] text-slate-400">
          proof {result.proofHash.slice(0, 16)}…
        </span>
      </div>

      {result.reasons.length > 0 && (
        <ul className="space-y-2">
          {result.reasons.map((reason, index) => (
            <li
              key={`${reason.code}-${index}`}
              className="flex gap-3 rounded-xl border border-[#E5EBE6] bg-white p-3 text-xs leading-5"
            >
              <span
                className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                  reason.severity === "BLOCK"
                    ? "bg-red-500"
                    : "bg-amber-500"
                }`}
              />

              <span>
                <span className="font-mono text-[10px] font-bold text-slate-500">
                  {reason.code}
                </span>

                <span className="mt-0.5 block text-[#365747]">
                  {reason.message}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
          What the notes actually support
        </p>

        <HighlightedSource
          source={source}
          marks={marks}
          activeKey={activeKey}
          onActivate={setActiveKey}
          dangerSpans={result.injectionSignals.map(
            (signal) => signal.span
          )}
        />

        <LensChips
          marks={marks}
          activeKey={activeKey}
          onActivate={setActiveKey}
        />

        {active && (
          <p className="mt-3 rounded-xl bg-[#F4F8F5] p-3 text-xs leading-5 text-slate-600">
            <span className="font-bold text-[#18382F]">
              {active.label}:
            </span>{" "}
            {active.quote ? `“${active.quote}” · ` : ""}
            {active.detail}
          </p>
        )}

        {result.injectionSignals.length > 0 && (
          <p className="mt-3 text-[11px] leading-5 text-red-600">
            Red wavy text is instruction-like content the gate
            refuses to treat as evidence.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SCENARIO CARD
// ============================================================

function ScenarioCard({
  scenario,
  result,
  error,
  busy,
  onRun,
}: {
  scenario: AttackScenario;
  result: GateResult | undefined;
  error: string | undefined;
  busy: boolean;
  onRun: () => void;
}) {
  const matched = result
    ? result.verdict === scenario.expected
    : null;

  return (
    <article className="rounded-2xl border border-[#E5EBE6] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[#18382F]">
              {scenario.title}
            </h3>

            {scenario.expected === "ALLOW" && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700">
                Control
              </span>
            )}
          </div>

          <p className="mt-1 text-xs leading-5 text-slate-500">
            {scenario.attack}
          </p>
        </div>

        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="rounded-xl border border-[#DCE6DE] px-4 py-2 text-xs font-semibold text-[#3D6651] transition hover:bg-[#F0F6F1] disabled:opacity-40"
        >
          {busy ? "Running…" : result ? "Run again" : "Run attack"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      {result && (
        <>
          <ResultPanel
            source={scenario.sourceText}
            result={result}
          />

          <p
            className={`mt-3 text-[11px] font-semibold ${
              matched ? "text-emerald-700" : "text-red-600"
            }`}
          >
            {matched
              ? `✓ Outcome matches the expected ${scenario.expected}.`
              : `✗ Expected ${scenario.expected} but the gate returned ${result.verdict}.`}
          </p>
        </>
      )}
    </article>
  );
}

// ============================================================
// CUSTOM ATTACK
// ============================================================

const DEFAULT_CUSTOM = ATTACK_SCENARIOS[1];

function CustomAttack() {
  const [source, setSource] = useState(DEFAULT_CUSTOM.sourceText);

  const [claimsText, setClaimsText] = useState(
    JSON.stringify(DEFAULT_CUSTOM.claims, null, 2)
  );

  const [result, setResult] = useState<GateResult | null>(null);
  const [resultSource, setResultSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setError("");
    setResult(null);

    let claims: unknown;

    try {
      claims = JSON.parse(claimsText);
    } catch {
      setError("The claims are not valid JSON.");
      return;
    }

    setBusy(true);

    try {
      const trimmed = source.trim();
      setResult(await evaluate(trimmed, claims));
      setResultSource(trimmed);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Request failed."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-2xl border border-dashed border-[#CFDCD2] bg-[#FAFCFA] p-5">
      <summary className="cursor-pointer text-sm font-bold text-[#18382F]">
        Write your own attack
      </summary>

      <p className="mt-3 text-xs leading-5 text-slate-500">
        Edit the notes and the claims an agent might submit. Each
        claim is a value plus the words it says support it. Try to
        sneak a number past the gate.
      </p>

      <label className="mt-4 block text-[11px] font-bold text-slate-500">
        Original notes
        <textarea
          dir="auto"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          rows={4}
          maxLength={3000}
          className="mt-1 w-full rounded-xl border border-[#DEE8E0] bg-white p-3 text-xs leading-6 text-[#203C33] outline-none focus:border-emerald-600"
        />
      </label>

      <label className="mt-4 block text-[11px] font-bold text-slate-500">
        Agent claims (JSON)
        <textarea
          value={claimsText}
          onChange={(event) => setClaimsText(event.target.value)}
          rows={10}
          spellCheck={false}
          className="mt-1 w-full rounded-xl border border-[#DEE8E0] bg-white p-3 font-mono text-[11px] leading-5 text-[#203C33] outline-none focus:border-emerald-600"
        />
      </label>

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !source.trim()}
        className="mt-4 rounded-xl bg-[#173B32] px-5 py-3 text-xs font-bold text-white transition hover:bg-[#245747] disabled:opacity-40"
      >
        {busy ? "Checking…" : "Send to the gate"}
      </button>

      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      {result && (
        <ResultPanel source={resultSource} result={result} />
      )}
    </details>
  );
}

// ============================================================
// ATTACK LAB
// ============================================================

export default function AttackLab() {
  const [results, setResults] = useState<Record<string, GateResult>>(
    {}
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());

  async function runOne(scenario: AttackScenario) {
    setRunning((current) => new Set(current).add(scenario.id));

    setErrors((current) => {
      const next = { ...current };
      delete next[scenario.id];
      return next;
    });

    try {
      const result = await evaluate(
        scenario.sourceText,
        scenario.claims
      );

      setResults((current) => ({
        ...current,
        [scenario.id]: result,
      }));
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [scenario.id]:
          caught instanceof Error ? caught.message : "Request failed.",
      }));
    } finally {
      setRunning((current) => {
        const next = new Set(current);
        next.delete(scenario.id);
        return next;
      });
    }
  }

  async function runAll() {
    await Promise.all(ATTACK_SCENARIOS.map(runOne));
  }

  const attacks = ATTACK_SCENARIOS.filter(
    (scenario) => scenario.expected === "BLOCK"
  );

  const stopped = attacks.filter(
    (scenario) => results[scenario.id]?.verdict === "BLOCK"
  ).length;

  const control = ATTACK_SCENARIOS.find(
    (scenario) => scenario.expected === "ALLOW"
  );

  const controlPassed =
    control && results[control.id]?.verdict === "ALLOW";

  const anyRun = Object.keys(results).length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#173B32] p-6 text-white">
        <div className="max-w-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200">
            No API key needed
          </p>

          <p className="mt-2 text-sm leading-6 text-emerald-50/80">
            These are the mistakes and attacks an AI agent could make
            with money. Each one is sent to the real Proof Gate, the
            same checkpoint our MCP server puts in front of
            PayPal&apos;s own tools.
          </p>
        </div>

        <div className="text-right">
          {anyRun ? (
            <>
              <p className="text-4xl font-semibold tabular-nums text-[#A7F3D0]">
                {stopped}/{attacks.length}
              </p>

              <p className="text-[11px] text-emerald-100/80">
                attacks stopped
                {controlPassed ? " · honest invoice cleared" : ""}
              </p>
            </>
          ) : (
            <p className="text-xs text-emerald-100/70">
              {attacks.length} attacks · 1 honest control
            </p>
          )}

          <button
            type="button"
            onClick={() => void runAll()}
            disabled={running.size > 0}
            className="mt-3 rounded-xl bg-[#B7F3D8] px-5 py-3 text-xs font-bold text-[#173B32] transition hover:bg-white disabled:opacity-50"
          >
            {running.size > 0 ? "Running…" : "Run all attacks"}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {ATTACK_SCENARIOS.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            result={results[scenario.id]}
            error={errors[scenario.id]}
            busy={running.has(scenario.id)}
            onRun={() => void runOne(scenario)}
          />
        ))}
      </div>

      <CustomAttack />

      <p className="text-[11px] leading-5 text-slate-400">
        The gate proves where a claim came from, not that it is
        true. A verified quote can still be wrong in the real world,
        which is why a human approval step always follows an ALLOW.
      </p>
    </div>
  );
}
