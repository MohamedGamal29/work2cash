// ============================================================
// PAYMENT CHAIN
//
// Extends the approval proofHash with every PayPal invoice event, so
// the full life of an invoice is one tamper-evident chain:
//
//   source notes -> proofHash (approval) -> PAID -> REFUNDED ...
//
// Each link hashes the previous link, the PayPal event id, type,
// status and time. Altering or reordering history changes every
// later hash.
// ============================================================

import { createHash } from "node:crypto";

export type PaymentChainEntry = {
  eventId: string;
  eventType: string;
  status: string;
  createTime: string;
  previousHash: string;
  chainHash: string;
  receivedAt: string;
  signatureVerified: boolean;
};

export const CHAIN_GENESIS = "GENESIS";

const EVENT_STATUS: Record<string, string> = {
  "INVOICING.INVOICE.PAID": "PAID",
  "INVOICING.INVOICE.CANCELLED": "CANCELLED",
  "INVOICING.INVOICE.REFUNDED": "REFUNDED",
  "INVOICING.INVOICE.UPDATED": "UPDATED",
  "INVOICING.INVOICE.CREATED": "DRAFT",
};

export function isInvoiceEvent(eventType: unknown): eventType is string {
  return (
    typeof eventType === "string" &&
    eventType.startsWith("INVOICING.INVOICE.")
  );
}

export function statusForEvent(
  eventType: string,
  resourceStatus: unknown
): string {
  if (
    typeof resourceStatus === "string" &&
    /^[A-Z_]{2,40}$/.test(resourceStatus)
  ) {
    return resourceStatus;
  }

  return EVENT_STATUS[eventType] ?? "UNKNOWN";
}

export function extractInvoiceId(resource: unknown): string | null {
  if (typeof resource !== "object" || resource === null) return null;

  const record = resource as {
    id?: unknown;
    invoice?: { id?: unknown };
  };

  const id = record.invoice?.id ?? record.id;

  return typeof id === "string" && id.length > 0 && id.length <= 128
    ? id
    : null;
}

export function computeChainHash(parts: {
  previousHash: string;
  eventId: string;
  eventType: string;
  status: string;
  createTime: string;
}): string {
  return createHash("sha256")
    .update(
      [
        parts.previousHash,
        parts.eventId,
        parts.eventType,
        parts.status,
        parts.createTime,
      ].join("|"),
      "utf8"
    )
    .digest("hex");
}

export function appendToChain(
  chain: PaymentChainEntry[],
  approvalProofHash: string | null,
  event: {
    eventId: string;
    eventType: string;
    status: string;
    createTime: string;
    signatureVerified: boolean;
  },
  now: Date = new Date()
): { chain: PaymentChainEntry[]; duplicate: boolean } {
  // PayPal retries deliveries: the same event id must never be added twice.
  if (chain.some((entry) => entry.eventId === event.eventId)) {
    return { chain, duplicate: true };
  }

  const previousHash =
    chain.length > 0
      ? chain[chain.length - 1].chainHash
      : (approvalProofHash ?? CHAIN_GENESIS);

  const entry: PaymentChainEntry = {
    ...event,
    previousHash,
    chainHash: computeChainHash({ previousHash, ...event }),
    receivedAt: now.toISOString(),
  };

  return { chain: [...chain, entry], duplicate: false };
}

export function verifyChain(
  chain: PaymentChainEntry[],
  approvalProofHash: string | null
): boolean {
  let previous = approvalProofHash ?? CHAIN_GENESIS;

  for (const entry of chain) {
    if (entry.previousHash !== previous) return false;

    if (
      entry.chainHash !==
      computeChainHash({
        previousHash: entry.previousHash,
        eventId: entry.eventId,
        eventType: entry.eventType,
        status: entry.status,
        createTime: entry.createTime,
      })
    ) {
      return false;
    }

    previous = entry.chainHash;
  }

  return true;
}
