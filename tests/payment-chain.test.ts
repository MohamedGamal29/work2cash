import test from "node:test";
import assert from "node:assert/strict";

import {
  appendToChain,
  extractInvoiceId,
  isInvoiceEvent,
  statusForEvent,
  verifyChain,
  CHAIN_GENESIS,
  type PaymentChainEntry,
} from "../app/lib/payment-chain";

const approval = "a".repeat(64);

const paid = {
  eventId: "WH-1",
  eventType: "INVOICING.INVOICE.PAID",
  status: "PAID",
  createTime: "2026-11-10T10:00:00Z",
  signatureVerified: true,
};

test("first link chains to the approval proofHash", () => {
  const { chain, duplicate } = appendToChain([], approval, paid);
  assert.equal(duplicate, false);
  assert.equal(chain[0].previousHash, approval);
  assert.ok(verifyChain(chain, approval));
});

test("falls back to GENESIS when there is no approval hash", () => {
  const { chain } = appendToChain([], null, paid);
  assert.equal(chain[0].previousHash, CHAIN_GENESIS);
  assert.ok(verifyChain(chain, null));
});

test("PayPal retries of the same event are ignored", () => {
  const first = appendToChain([], approval, paid).chain;
  const again = appendToChain(first, approval, paid);
  assert.equal(again.duplicate, true);
  assert.equal(again.chain.length, 1);
});

test("links form a chain across PAID then REFUNDED", () => {
  let chain: PaymentChainEntry[] = [];
  chain = appendToChain(chain, approval, paid).chain;
  chain = appendToChain(chain, approval, {
    ...paid,
    eventId: "WH-2",
    eventType: "INVOICING.INVOICE.REFUNDED",
    status: "REFUNDED",
    createTime: "2026-11-11T10:00:00Z",
  }).chain;
  assert.equal(chain[1].previousHash, chain[0].chainHash);
  assert.ok(verifyChain(chain, approval));
});

test("tampering with a past event is detected", () => {
  let chain: PaymentChainEntry[] = [];
  chain = appendToChain(chain, approval, paid).chain;
  chain = appendToChain(chain, approval, { ...paid, eventId: "WH-2", status: "REFUNDED", eventType: "INVOICING.INVOICE.REFUNDED" }).chain;
  const forged = chain.map((e, i) => (i === 0 ? { ...e, status: "UNPAID" } : e));
  assert.equal(verifyChain(forged, approval), false);
});

test("a chain cannot be re-pointed at a different approval", () => {
  const { chain } = appendToChain([], approval, paid);
  assert.equal(verifyChain(chain, "b".repeat(64)), false);
});

test("event helpers", () => {
  assert.equal(isInvoiceEvent("INVOICING.INVOICE.PAID"), true);
  assert.equal(isInvoiceEvent("PAYMENT.CAPTURE.COMPLETED"), false);
  assert.equal(isInvoiceEvent(42), false);
  assert.equal(statusForEvent("INVOICING.INVOICE.PAID", undefined), "PAID");
  assert.equal(statusForEvent("INVOICING.INVOICE.PAID", "MARKED_AS_PAID"), "MARKED_AS_PAID");
  assert.equal(statusForEvent("INVOICING.INVOICE.PAID", "<script>"), "PAID");
  assert.equal(extractInvoiceId({ invoice: { id: "INV2-AAA" } }), "INV2-AAA");
  assert.equal(extractInvoiceId({ id: "INV2-BBB" }), "INV2-BBB");
  assert.equal(extractInvoiceId({ id: "x".repeat(200) }), null);
  assert.equal(extractInvoiceId(null), null);
});
