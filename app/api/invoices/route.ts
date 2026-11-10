import { demoAuthFailure } from "../../lib/demo-auth";
import { createHash } from "node:crypto";
import { validateInvoice } from "../../lib/validate-invoice";
import { prisma } from "../../lib/prisma";
import { verifyExtractionReceipt } from "../../lib/approval-receipt";
import { createApprovalSnapshot, ApprovalPricingBlockedError } from "../../lib/approval-snapshot";

type ExistingRequest = {
  payloadHash: string;
  status: string;
  resultJson: string | null;
};

function handleExistingRequest(
  existing: ExistingRequest,
  payloadHash: string
) {
  if (existing.payloadHash !== payloadHash) {
    return Response.json(
      {
        success: false,
        message:
          "This request ID was already used with different invoice details or approval evidence.",
      },
      { status: 409 }
    );
  }

  if (existing.status === "COMPLETED" && existing.resultJson) {
    return Response.json({
      ...JSON.parse(existing.resultJson),
      replayed: true,
    });
  }

  if (existing.status === "PENDING") {
    return Response.json(
      {
        success: false,
        message:
          "This request is already being processed. Do not retry it yet.",
      },
      { status: 409 }
    );
  }

  if (existing.status === "UNKNOWN") {
    return Response.json(
      {
        success: false,
        message:
          "The PayPal result is uncertain. Check PayPal Sandbox before attempting another creation.",
      },
      { status: 409 }
    );
  }

  return Response.json(
    {
      success: false,
      message:
        "This request previously failed before invoice creation. Start a new approval attempt to retry.",
    },
    { status: 409 }
  );
}

async function updateRequestStatus(
  requestId: string,
  status: "FAILED" | "UNKNOWN",
  lastError: string
) {
  try {
    await prisma.invoiceRequest.update({
      where: { requestId },
      data: { status, lastError },
    });
  } catch (error) {
    console.error("Could not update invoice request status:", error);
  }
}

export async function GET(request: Request) {
  const authFailure = demoAuthFailure(request);
  if (authFailure) return authFailure;

  try {
    const requests = await prisma.invoiceRequest.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    const invoices = requests.map((record) => {
      let draft: Record<string, unknown> = {};
      let result: {
        submittedTotal?: string;
        paymentTerm?: {
          due_date?: string;
        } | null;
      } | null = null;

      let changeCount = 0;

      try {
        draft = JSON.parse(record.draftJson);
      } catch {
        // Keep the history record visible even if stored JSON is invalid.
      }

      try {
        result = record.resultJson
          ? JSON.parse(record.resultJson)
          : null;
      } catch {
        result = null;
      }

      try {
        const changes = record.changesJson
          ? JSON.parse(record.changesJson)
          : [];

        changeCount = Array.isArray(changes) ? changes.length : 0;
      } catch {
        changeCount = 0;
      }

      const quantity =
        typeof draft.quantity === "number"
          ? draft.quantity
          : null;

      const unitPrice =
        typeof draft.unitPrice === "number"
          ? draft.unitPrice
          : null;

      const calculatedTotal =
        quantity !== null && unitPrice !== null
          ? (quantity * unitPrice).toFixed(2)
          : null;

      return {
        requestId: record.requestId,
        invoiceId: record.paypalInvoiceId,
        customerName:
          typeof draft.customerName === "string"
            ? draft.customerName
            : "Unknown customer",
        customerEmail:
          typeof draft.customerEmail === "string"
            ? draft.customerEmail
            : null,
        description:
          typeof draft.description === "string"
            ? draft.description
            : "No description",
        quantity,
        unitPrice,
        currency:
          typeof draft.currency === "string"
            ? draft.currency
            : "USD",
        total: result?.submittedTotal ?? calculatedTotal,
        operationStatus: record.status,
        paypalStatus: record.paypalStatus,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        dueDate: result?.paymentTerm?.due_date ?? null,
        lastError: record.lastError,

        // Proof Ledger metadata. Raw source notes and snapshots
        // are deliberately not exposed through the history endpoint.
        proofHash: record.proofHash,
        approvedAt: record.approvedAt?.toISOString() ?? null,
        hasProofSnapshot: Boolean(record.proofSnapshotJson),
        changeCount,
      };
    });

    return Response.json({
      success: true,
      count: invoices.length,
      invoices,
    });
  } catch (error) {
    console.error("Invoice history error:", error);

    return Response.json(
      {
        success: false,
        message: "Could not retrieve invoice history.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const authFailure = demoAuthFailure(request);
  if (authFailure) return authFailure;

  // ---------------------------------------------------------
  // 1. Parse and validate the request body.
  // ---------------------------------------------------------

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        success: false,
        errors: ["Request must contain valid JSON."],
      },
      { status: 400 }
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("approved" in body) ||
    body.approved !== true ||
    !("draft" in body)
  ) {
    return Response.json(
      {
        success: false,
        errors: ["Review and approve the draft before creating it."],
      },
      { status: 400 }
    );
  }

  const requestId =
    "requestId" in body && typeof body.requestId === "string"
      ? body.requestId
      : "";

  const validRequestId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId
    );

  if (!validRequestId) {
    return Response.json(
      {
        success: false,
        errors: ["Provide a valid creation request ID."],
      },
      { status: 400 }
    );
  }

  // ---------------------------------------------------------
  // 2. Verify the server-signed extraction receipt.
  // ---------------------------------------------------------

  const receiptToken =
    "extractionReceipt" in body
      ? body.extractionReceipt
      : undefined;

  const receiptVerification =
    verifyExtractionReceipt(receiptToken);

  if (!receiptVerification.ok) {
    return Response.json(
      {
        success: false,
        errors: [
          receiptVerification.message ||
            "The extraction receipt is invalid or has expired. Extract the invoice again.",
        ],
      },
      { status: 400 }
    );
  }

  const receipt = receiptVerification.payload;

  // ---------------------------------------------------------
  // 3. Validate the approved invoice draft on the server.
  // ---------------------------------------------------------

  const validation = validateInvoice(body.draft);

  if (!validation.success) {
    return Response.json(validation, { status: 400 });
  }

  const draft = validation.draft;

  // ---------------------------------------------------------
  // 4. Check PayPal configuration and sandbox recipient.
  // ---------------------------------------------------------

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const sellerEmail = process.env.PAYPAL_INVOICER_EMAIL;
  const testCustomerEmail = process.env.PAYPAL_TEST_CUSTOMER_EMAIL;

  if (
    !clientId ||
    !clientSecret ||
    !sellerEmail ||
    !testCustomerEmail
  ) {
    return Response.json(
      {
        success: false,
        message: "Missing PayPal configuration. Check .env.local.",
      },
      { status: 500 }
    );
  }

  if (
    draft.customerEmail.toLowerCase() !==
    testCustomerEmail.trim().toLowerCase()
  ) {
    return Response.json(
      {
        success: false,
        errors: [
          "Use the personal sandbox email configured in .env.local.",
        ],
      },
      { status: 400 }
    );
  }

  // ---------------------------------------------------------
  // 5. Build a stable idempotency hash.
  //
  // Do NOT hash proofSnapshotJson or proofHash here.
  // A new snapshot has a new approval timestamp, even when
  // the same approved request is retried.
  // ---------------------------------------------------------

  const payloadHash = createHash("sha256")
    .update(
      JSON.stringify({
        draft,
        extractionReceiptId: receipt.receiptId,
      })
    )
    .digest("hex");

  // Check whether this approval request has already been processed.
  const existing = await prisma.invoiceRequest.findUnique({
    where: { requestId },
  });

  if (existing) {
    return handleExistingRequest(existing, payloadHash);
  }

  // ---------------------------------------------------------
  // 6. Create the immutable approval snapshot.
  //
  // This revalidates the receipt evidence and records:
  // - Original extraction draft
  // - Approved draft
  // - User-edited fields
  // - Source notes and evidence
  // - Approval timestamp
  // - SHA-256 proof hash
  // ---------------------------------------------------------

  let approvalSnapshot: ReturnType<typeof createApprovalSnapshot>;

  try {
    approvalSnapshot = createApprovalSnapshot(
      requestId,
      receipt,
      draft
    );
  } catch (error) {
    if (error instanceof ApprovalPricingBlockedError) {
      return Response.json(
        {
          success: false,
          code: "PRICING_INTEGRITY_BLOCKED",
          errors: [error.message],
          pricingIntegrity: error.pricingIntegrity,
        },
        { status: 422 }
      );
    }

    console.error("Approval snapshot creation failed:", error);

    return Response.json(
      {
        success: false,
        message:
          "Could not validate the approval evidence. Extract the invoice again and review the draft.",
      },
      { status: 400 }
    );
  }

  // ---------------------------------------------------------
  // 7. Reserve the request and persist the proof BEFORE PayPal.
  // ---------------------------------------------------------

  try {
    await prisma.invoiceRequest.create({
      data: {
        requestId,
        payloadHash,
        draftJson: JSON.stringify(draft),
        status: "PENDING",

        // Proof Ledger persistence
        sourceNotes: receipt.sourceNotes,
        originalDraftJson: JSON.stringify(receipt.draft),
        proofSnapshotJson: approvalSnapshot.snapshotJson,
        changesJson: approvalSnapshot.changesJson,
        approvedAt: approvalSnapshot.approvedAt,
        proofHash: approvalSnapshot.proofHash,
        extractionReceiptId: receipt.receiptId,
      },
    });
  } catch (error) {
    // Another simultaneous request may have claimed the same ID.
    const duplicate = await prisma.invoiceRequest.findUnique({
      where: { requestId },
    });

    if (duplicate) {
      return handleExistingRequest(duplicate, payloadHash);
    }

    console.error("Could not reserve invoice request:", error);

    return Response.json(
      {
        success: false,
        message: "Could not reserve this invoice request.",
      },
      { status: 500 }
    );
  }

  // ---------------------------------------------------------
  // 8. Prepare invoice dates.
  // ---------------------------------------------------------

  const baseUrl = "https://api-m.sandbox.paypal.com";
  const invoiceDate = new Date().toISOString().slice(0, 10);

  const deadline = new Date(`${invoiceDate}T00:00:00.000Z`);

  deadline.setUTCDate(
    deadline.getUTCDate() + draft.paymentDueDays
  );

  const dueDate = deadline.toISOString().slice(0, 10);

  // ---------------------------------------------------------
  // 9. Authenticate with PayPal.
  // ---------------------------------------------------------

  let accessToken: string;

  try {
    const credentials = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");

    const tokenResponse = await fetch(
      `${baseUrl}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!tokenResponse.ok) {
      await updateRequestStatus(
        requestId,
        "FAILED",
        `PayPal authentication failed: HTTP ${tokenResponse.status}`
      );

      return Response.json(
        {
          success: false,
          message: "PayPal authentication failed.",
          paypalStatus: tokenResponse.status,
        },
        { status: 502 }
      );
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      await updateRequestStatus(
        requestId,
        "FAILED",
        "PayPal did not return an access token."
      );

      return Response.json(
        {
          success: false,
          message: "No PayPal access token received.",
        },
        { status: 502 }
      );
    }

    accessToken = tokenData.access_token;
  } catch (error) {
    console.error("PayPal authentication error:", error);

    await updateRequestStatus(
      requestId,
      "FAILED",
      "PayPal authentication request failed before invoice creation."
    );

    return Response.json(
      {
        success: false,
        message: "Could not authenticate with PayPal.",
      },
      { status: 502 }
    );
  }

  // ---------------------------------------------------------
  // 10. Submit the invoice to PayPal.
  //
  // From this point onward, a network failure may leave the
  // creation result uncertain. Never automatically retry it.
  // ---------------------------------------------------------

  let invoiceResponse: Response;

  try {
    invoiceResponse = await fetch(
      `${baseUrl}/v2/invoicing/invoices`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          "PayPal-Request-Id": requestId,
        },
        body: JSON.stringify({
          detail: {
            currency_code: draft.currency,
            invoice_date: invoiceDate,
            note:
              "Work2Cash sandbox demonstration. " +
              "No real payment requested.",
            payment_term:
              draft.paymentDueDays === 0
                ? { term_type: "DUE_ON_RECEIPT" }
                : { due_date: dueDate },
          },
          invoicer: {
            email_address: sellerEmail.trim(),
          },
          primary_recipients: [
            {
              billing_info: {
                email_address: draft.customerEmail,
              },
            },
          ],
          items: [
            {
              name: draft.description,
              quantity: String(draft.quantity),
              unit_amount: {
                currency_code: draft.currency,
                value: draft.unitPrice.toFixed(2),
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
  } catch (error) {
    console.error("PayPal invoice request error:", error);

    await updateRequestStatus(
      requestId,
      "UNKNOWN",
      "The PayPal invoice request failed or timed out. Creation may have succeeded."
    );

    return Response.json(
      {
        success: false,
        requestId,
        message:
          "The PayPal result is uncertain. Check PayPal Sandbox before retrying.",
      },
      { status: 502 }
    );
  }

  // ---------------------------------------------------------
  // 11. Read PayPal's response.
  // ---------------------------------------------------------

  type PayPalInvoiceResponse = {
    id?: string;
    status?: string;
    amount?: {
      value?: string;
      currency_code?: string;
    };
    detail?: {
      payment_term?: {
        term_type?: string;
        due_date?: string;
      };
    };
    name?: string;
    details?: Array<{
      issue?: string;
      field?: string;
    }>;
    debug_id?: string;
  };

  let invoice: PayPalInvoiceResponse;

  try {
    invoice =
      (await invoiceResponse.json()) as PayPalInvoiceResponse;
  } catch {
    await updateRequestStatus(
      requestId,
      "UNKNOWN",
      "Could not read PayPal's invoice response."
    );

    return Response.json(
      {
        success: false,
        requestId,
        message:
          "PayPal returned an unreadable response. Check Sandbox before retrying.",
      },
      { status: 502 }
    );
  }

  if (!invoiceResponse.ok) {
    const definiteRejection = [400, 401, 403, 422].includes(
      invoiceResponse.status
    );

    await updateRequestStatus(
      requestId,
      definiteRejection ? "FAILED" : "UNKNOWN",
      `PayPal invoice request returned HTTP ${invoiceResponse.status}.`
    );

    return Response.json(
      {
        success: false,
        message: definiteRejection
          ? "PayPal rejected the draft invoice."
          : "The PayPal result is uncertain. Check Sandbox before retrying.",
        requestId,
        paypalStatus: invoiceResponse.status,
        errorName: invoice.name,
        issues: invoice.details?.map((detail) => ({
          issue: detail.issue,
          field: detail.field,
        })),
        debugId: invoice.debug_id,
      },
      { status: 502 }
    );
  }

  if (!invoice.id) {
    await updateRequestStatus(
      requestId,
      "UNKNOWN",
      "PayPal returned success without an invoice ID."
    );

    return Response.json(
      {
        success: false,
        requestId,
        message:
          "PayPal responded without an invoice ID. Check Sandbox before retrying.",
      },
      { status: 502 }
    );
  }

  // ---------------------------------------------------------
  // 12. Save the successful PayPal result.
  // The approval snapshot was already persisted before PayPal.
  // ---------------------------------------------------------

  const result = {
    success: true,
    message: "Reviewed sandbox draft created. It has NOT been sent.",
    requestId,
    invoiceId: invoice.id,
    status: invoice.status,
    paypalTotal: invoice.amount ?? null,
    submittedTotal: validation.total,
    currency: draft.currency,
    paymentTerm: invoice.detail?.payment_term ?? null,
    proofHash: approvalSnapshot.proofHash,
    approvedAt: approvalSnapshot.approvedAt.toISOString(),
    changeCount: approvalSnapshot.changeCount,
    replayed: false,
  };

  try {
    await prisma.invoiceRequest.update({
      where: { requestId },
      data: {
        status: "COMPLETED",
        paypalInvoiceId: invoice.id,
        paypalStatus: invoice.status ?? null,
        resultJson: JSON.stringify(result),
        lastError: null,
      },
    });
  } catch (error) {
    console.error("Could not save completed PayPal invoice:", error);

    await updateRequestStatus(
      requestId,
      "UNKNOWN",
      "PayPal created an invoice, but the application could not save its result."
    );

    return Response.json(
      {
        success: false,
        requestId,
        message:
          "PayPal may have created the invoice, but saving its result failed. Check Sandbox before retrying.",
      },
      { status: 502 }
    );
  }

  return Response.json(result);
}