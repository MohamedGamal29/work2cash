import { prisma } from "../../lib/prisma";

import {
  appendToChain,
  extractInvoiceId,
  isInvoiceEvent,
  statusForEvent,
  type PaymentChainEntry,
} from "../../lib/payment-chain";

// PayPal Sandbox webhook receiver.
//
// This path is excluded from demo Basic Auth in proxy.ts because PayPal
// cannot send those credentials. It is protected instead by PayPal's
// own signature verification (PAYPAL_WEBHOOK_ID).

const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
const MAX_BODY_CHARS = 256_000;

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${clientId}:${clientSecret}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { access_token?: unknown };

  return typeof data.access_token === "string"
    ? data.access_token
    : null;
}

async function verifySignature(
  headers: Headers,
  webhookId: string,
  event: unknown
): Promise<boolean> {
  const token = await getAccessToken();

  if (!token) return false;

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    }
  );

  if (!response.ok) return false;

  const data = (await response.json()) as {
    verification_status?: unknown;
  };

  return data.verification_status === "SUCCESS";
}

export async function POST(request: Request) {
  const raw = await request.text();

  if (raw.length > MAX_BODY_CHARS) {
    return Response.json({ received: false }, { status: 413 });
  }

  let event: Record<string, unknown>;

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("not an object");
    }

    event = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ received: false }, { status: 400 });
  }

  // ---- Authenticate the sender --------------------------------

  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  const skipVerification =
    process.env.NODE_ENV !== "production" &&
    process.env.PAYPAL_WEBHOOK_SKIP_VERIFY === "true";

  let signatureVerified = false;

  if (!skipVerification) {
    if (!webhookId) {
      // 503 makes PayPal retry later rather than drop the event.
      return Response.json(
        { received: false, message: "Webhook is not configured." },
        { status: 503 }
      );
    }

    try {
      signatureVerified = await verifySignature(
        request.headers,
        webhookId,
        event
      );
    } catch (error) {
      console.error("Webhook signature check failed:", error);

      return Response.json({ received: false }, { status: 503 });
    }

    if (!signatureVerified) {
      return Response.json({ received: false }, { status: 401 });
    }
  }

  // ---- Interpret the event ------------------------------------

  const eventId = event.id;
  const eventType = event.event_type;

  if (
    typeof eventId !== "string" ||
    eventId.length === 0 ||
    eventId.length > 128 ||
    !isInvoiceEvent(eventType)
  ) {
    return Response.json({ received: true, ignored: true });
  }

  const resource = event.resource;
  const invoiceId = extractInvoiceId(resource);

  if (!invoiceId) {
    return Response.json({ received: true, ignored: true });
  }

  const resourceStatus =
    typeof resource === "object" && resource !== null
      ? ((resource as { invoice?: { status?: unknown } }).invoice
          ?.status ?? (resource as { status?: unknown }).status)
      : undefined;

  const status = statusForEvent(eventType, resourceStatus);

  const createTime =
    typeof event.create_time === "string"
      ? event.create_time.slice(0, 40)
      : new Date().toISOString();

  // ---- Extend the proof chain ---------------------------------

  try {
    const saved = await prisma.invoiceRequest.findUnique({
      where: { paypalInvoiceId: invoiceId },
      select: {
        requestId: true,
        proofHash: true,
        resultJson: true,
      },
    });

    if (!saved) {
      // Not one of ours. Acknowledge so PayPal does not keep retrying.
      return Response.json({ received: true, ignored: true });
    }

    let result: Record<string, unknown> = {};

    try {
      const parsed: unknown = saved.resultJson
        ? JSON.parse(saved.resultJson)
        : {};

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        result = parsed as Record<string, unknown>;
      }
    } catch {
      result = {};
    }

    const existingChain = Array.isArray(result.paymentChain)
      ? (result.paymentChain as PaymentChainEntry[])
      : [];

    const { chain, duplicate } = appendToChain(
      existingChain,
      saved.proofHash,
      {
        eventId,
        eventType,
        status,
        createTime,
        signatureVerified,
      }
    );

    if (duplicate) {
      return Response.json({ received: true, duplicate: true });
    }

    await prisma.invoiceRequest.update({
      where: { requestId: saved.requestId },
      data: {
        paypalStatus: status,
        resultJson: JSON.stringify({ ...result, paymentChain: chain }),
      },
    });

    return Response.json({
      received: true,
      status,
      chainLength: chain.length,
    });
  } catch (error) {
    console.error("Webhook processing failed:", error);

    return Response.json({ received: false }, { status: 500 });
  }
}
