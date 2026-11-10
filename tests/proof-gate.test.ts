import test from "node:test";
import assert from "node:assert/strict";

import {
  runProofGate,
  parseGateInput,
  findInjectionSignals,
} from "../app/lib/proof-gate";
import { ATTACK_SCENARIOS } from "../app/lib/attack-scenarios";
import {
  locateQuote,
  buildHighlightSegments,
} from "../app/lib/evidence-spans";

// ---------- every shipped scenario behaves as advertised --------

for (const scenario of ATTACK_SCENARIOS) {
  test(`scenario "${scenario.id}" -> ${scenario.expected}`, () => {
    const result = runProofGate({
      sourceText: scenario.sourceText,
      claims: scenario.claims,
    });

    assert.equal(
      result.verdict,
      scenario.expected,
      JSON.stringify(result.reasons, null, 2)
    );
  });
}

// ---------- specific attack mechanics ---------------------------

test("hallucinated quote is flagged on the unit price field", () => {
  const s = ATTACK_SCENARIOS.find((x) => x.id === "hallucinated-quote")!;
  const r = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  assert.ok(
    r.reasons.some((x) => x.code === "UNVERIFIED_CLAIM" && x.field === "unitPrice")
  );
});

test("real quote with a wrong number is caught by value-in-quote check", () => {
  const s = ATTACK_SCENARIOS.find((x) => x.id === "real-quote-wrong-number")!;
  const r = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  assert.equal(r.fields.unitPrice.status, "UNVERIFIED");
  assert.match(r.fields.unitPrice.explanation, /does not contain the extracted monetary amount/);
});

test("a real-but-unsupportive quote is still located so reviewers can see it", () => {
  const s = ATTACK_SCENARIOS.find((x) => x.id === "real-quote-wrong-number")!;
  const r = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  assert.equal(r.fields.unitPrice.status, "UNVERIFIED");
  assert.ok(r.fields.unitPrice.span, "span should exist for a verbatim quote");
  assert.equal(
    s.sourceText.slice(r.fields.unitPrice.span!.start, r.fields.unitPrice.span!.end),
    "120 USD each"
  );
});

test("a fabricated quote has no span", () => {
  const s = ATTACK_SCENARIOS.find((x) => x.id === "hallucinated-quote")!;
  const r = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  assert.equal(r.fields.unitPrice.span, null);
});

test("contradictory total is a price conflict of exactly $100", () => {
  const s = ATTACK_SCENARIOS.find((x) => x.id === "contradictory-total")!;
  const r = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  assert.equal(r.pricing.status, "CONFLICT");
  assert.equal(r.pricing.difference, 100);
  assert.ok(r.reasons.some((x) => x.code === "PRICE_CONFLICT"));
});

test("prompt injection trips three independent locks", () => {
  const s = ATTACK_SCENARIOS.find((x) => x.id === "prompt-injection")!;
  const r = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  const codes = new Set(r.reasons.map((x) => x.code));
  assert.ok(codes.has("PRICE_CONFLICT"));
  assert.ok(codes.has("POLICY_LIMIT"));
  assert.ok(codes.has("INSTRUCTION_AS_EVIDENCE"));
  assert.ok(r.injectionSignals.length >= 2);
});

test("currency swap is blocked on the currency field", () => {
  const s = ATTACK_SCENARIOS.find((x) => x.id === "currency-swap")!;
  const r = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  assert.equal(r.fields.currency.status, "UNVERIFIED");
  assert.equal(r.verdict, "BLOCK");
});

test("email redirect is blocked on the email field", () => {
  const s = ATTACK_SCENARIOS.find((x) => x.id === "email-redirect")!;
  const r = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  assert.equal(r.fields.customerEmail.status, "UNVERIFIED");
  assert.ok(r.reasons.some((x) => x.field === "customerEmail" && x.severity === "BLOCK"));
});

// ---------- holes I specifically want closed --------------------

test("a value with NO quotation is blocked, not treated as missing", () => {
  const r = runProofGate({
    sourceText: "5 designs at 100 USD each for Sam (sam@x.example), due within 3 days.",
    claims: {
      customerName: { value: "Sam", quote: "Sam" },
      customerEmail: { value: "sam@x.example", quote: "sam@x.example" },
      description: { value: "designs", quote: "designs" },
      quantity: { value: 5, quote: "5 designs" },
      unitPrice: { value: 9999, quote: null },
      currency: { value: "USD", quote: "100 USD each" },
      paymentDueDays: { value: 3, quote: "due within 3 days" },
    },
  });
  assert.equal(r.verdict, "BLOCK");
  assert.equal(r.fields.unitPrice.status, "UNVERIFIED");
});

test("total-only notes derive the unit price exactly", () => {
  const r = runProofGate({
    sourceText:
      "Worked with Ahmed (ahmed@x.example) on 5 designs, 250 USD total, due within 14 days.",
    claims: {
      customerName: { value: "Ahmed", quote: "Ahmed" },
      customerEmail: { value: "ahmed@x.example", quote: "ahmed@x.example" },
      description: { value: "designs", quote: "designs" },
      quantity: { value: 5, quote: "5 designs" },
      currency: { value: "USD", quote: "250 USD total" },
      paymentDueDays: { value: 14, quote: "due within 14 days" },
      statedTotal: { value: 250, quote: "250 USD total" },
    },
  });
  assert.equal(r.fields.unitPrice.status, "DERIVED");
  assert.equal(r.fields.unitPrice.value, 50);
  assert.equal(r.verdict, "ALLOW");
});

test("Arabic-Indic digits and Arabic number words are understood", () => {
  const r = runProofGate({
    sourceText:
      "اشتغلت مع أحمد (ahmed@x.example) على خمس تصميمات، ٥٠ USD لكل واحد، الدفع خلال ١٤ يوم.",
    claims: {
      customerName: { value: "أحمد", quote: "أحمد" },
      customerEmail: { value: "ahmed@x.example", quote: "ahmed@x.example" },
      description: { value: "تصميمات", quote: "تصميمات" },
      quantity: { value: 5, quote: "خمس تصميمات" },
      unitPrice: { value: 50, quote: "٥٠ USD" },
      currency: { value: "USD", quote: "٥٠ USD" },
      paymentDueDays: { value: 14, quote: "خلال ١٤ يوم" },
    },
  });
  assert.equal(r.verdict, "ALLOW", JSON.stringify(r.reasons, null, 2));
});

test("benign notes containing no instruction text raise no signals", () => {
  assert.equal(findInjectionSignals("Did 3 logos at 120 USD each.").length, 0);
});

test("proof hash is deterministic and sensitive to a one-cent change", () => {
  const s = ATTACK_SCENARIOS[0];
  const a = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  const b = runProofGate({ sourceText: s.sourceText, claims: s.claims });
  assert.equal(a.proofHash, b.proofHash);
  // The public entry point (parseGateInput) trims the source, so
  // surrounding whitespace must not change the receipt.
  const parsed = parseGateInput({
    sourceText: `  ${s.sourceText}\n`,
    claims: s.claims,
  });
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.equal(runProofGate(parsed.input).proofHash, a.proofHash);
  }
  const d = runProofGate({
    sourceText: s.sourceText.replace("500 USD", "501 USD"),
    claims: s.claims,
  });
  assert.notEqual(d.proofHash, a.proofHash);
});

// ---------- input parsing ---------------------------------------

test("parseGateInput rejects unknown fields and oversized text", () => {
  assert.equal(parseGateInput({ sourceText: "x", claims: { hax: { value: 1, quote: "x" } } }).ok, false);
  assert.equal(parseGateInput({ sourceText: "x".repeat(3001), claims: {} }).ok, false);
  assert.equal(parseGateInput(null).ok, false);
  assert.equal(parseGateInput({ sourceText: "ok", claims: {} }).ok, true);
});

// ---------- evidence spans --------------------------------------

test("locateQuote finds exact and whitespace/case-flexible matches", () => {
  const src = "Fixed 3 logo drafts\nat 120 USD each";
  assert.deepEqual(locateQuote(src, "3 logo drafts"), { start: 6, end: 19 });
  const flexible = locateQuote(src, "LOGO DRAFTS at 120");
  assert.ok(flexible);
  assert.equal(locateQuote(src, "not here"), null);
});

test("buildHighlightSegments splits overlaps and covers the whole text", () => {
  const src = "abcdefghij";
  const segs = buildHighlightSegments(src, [
    { key: "a", start: 0, end: 6 },
    { key: "b", start: 4, end: 9 },
  ]);
  assert.equal(segs.map((s) => s.text).join(""), src);
  const overlap = segs.find((s) => s.start === 4);
  assert.deepEqual(overlap?.keys.sort(), ["a", "b"]);
});
