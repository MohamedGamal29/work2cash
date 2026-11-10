
import { prisma } from "../../../../lib/prisma";
import { demoAuthFailure } from "../../../../lib/demo-auth";

type RouteContext = {
  params: Promise<{
    invoiceId: string;
  }>;
};

export async function POST(
  request: Request,
  context: RouteContext
) {
  // Production access is protected by demo authentication.
  const authFailure = demoAuthFailure(request);

  if (authFailure) {
    return authFailure;
  }

  const { invoiceId } = await context.params;

  // ==========================================================
  // 1. VALIDATE INVOICE ID
  // ==========================================================

  if (
    typeof invoiceId !== "string" ||
    !invoiceId.trim() ||
    invoiceId.length > 128
  ) {
    return Response.json(
      {
        success: false,
        message: "A valid PayPal invoice ID is required.",
      },
      { status: 400 }
    );
  }

  // ==========================================================
  // 2. VALIDATE PAYPAL CONFIGURATION
  // ==========================================================

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return Response.json(
      {
        success: false,
        message: "Missing PayPal API configuration.",
      },
      { status: 500 }
    );
  }

  // ==========================================================
  // 3. FIND LOCAL INVOICE
  // ==========================================================

  let savedRequest;

  try {
    savedRequest = await prisma.invoiceRequest.findUnique({
      where: {
        paypalInvoiceId: invoiceId,
      },
      select: {
        requestId: true,
        paypalInvoiceId: true,
        paypalStatus: true,
      },
    });
  } catch (error) {
    console.error("Invoice lookup failed:", error);

    return Response.json(
      {
        success: false,
        message: "Could not look up the local invoice record.",
      },
      { status: 500 }
    );
  }

  if (!savedRequest || !savedRequest.paypalInvoiceId) {
    return Response.json(
      {
        success: false,
        message:
          "This PayPal invoice is not recorded in Work2Cash.",
      },
      { status: 404 }
    );
  }

  const baseUrl = "https://api-m.sandbox.paypal.com";

  // ==========================================================
  // 4. OBTAIN PAYPAL OAUTH ACCESS TOKEN
  // ==========================================================

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

    if (typeof tokenData.access_token !== "string") {
      return Response.json(
        {
          success: false,
          message: "PayPal did not return an access token.",
        },
        { status: 502 }
      );
    }

    accessToken = tokenData.access_token;
  } catch (error) {
    console.error("PayPal authentication error:", error);

    return Response.json(
      {
        success: false,
        message: "Could not authenticate with PayPal.",
      },
      { status: 502 }
    );
  }

  // ==========================================================
  // 5. RETRIEVE CURRENT PAYPAL INVOICE
  // ==========================================================

  let paypalInvoice: {
    id?: string;
    status?: string;
    amount?: {
      value?: string;
      currency_code?: string;
    };
  };

  try {
    const paypalResponse = await fetch(
      `${baseUrl}/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      }
    );

    let responseData: unknown;

    try {
      responseData = await paypalResponse.json();
    } catch {
      return Response.json(
        {
          success: false,
          message: "Could not read PayPal's invoice response.",
        },
        { status: 502 }
      );
    }

    if (!paypalResponse.ok) {
      return Response.json(
        {
          success: false,
          message:
            paypalResponse.status === 404
              ? "PayPal could not find this invoice."
              : "PayPal could not retrieve the invoice details.",
          paypalStatus: paypalResponse.status,
        },
        {
          status:
            paypalResponse.status === 404 ? 404 : 502,
        }
      );
    }

    if (
      typeof responseData !== "object" ||
      responseData === null
    ) {
      return Response.json(
        {
          success: false,
          message: "PayPal returned an invalid invoice response.",
        },
        { status: 502 }
      );
    }

    paypalInvoice = responseData;

    if (
      paypalInvoice.id !== invoiceId ||
      typeof paypalInvoice.status !== "string"
    ) {
      return Response.json(
        {
          success: false,
          message:
            "PayPal returned invoice details that could not be verified.",
        },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("PayPal invoice retrieval error:", error);

    return Response.json(
      {
        success: false,
        message:
          "Could not retrieve the current PayPal invoice status.",
      },
      { status: 502 }
    );
  }

  // ==========================================================
  // 6. UPDATE LOCAL PAYPAL STATUS
  // ==========================================================

  let updatedRequest;

  try {
    updatedRequest = await prisma.invoiceRequest.update({
      where: {
        requestId: savedRequest.requestId,
      },
      data: {
        paypalStatus: paypalInvoice.status,
      },
      select: {
        requestId: true,
        paypalInvoiceId: true,
        paypalStatus: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    console.error("Could not save PayPal status:", error);

    return Response.json(
      {
        success: false,
        message:
          "PayPal returned the latest status, but saving it locally failed.",
      },
      { status: 500 }
    );
  }

  // ==========================================================
  // 7. RETURN SYNCHRONIZATION RESULT
  // ==========================================================

  return Response.json(
    {
      success: true,
      message:
        "PayPal invoice status synchronized successfully.",
      invoiceId: updatedRequest.paypalInvoiceId,
      paypalStatus: updatedRequest.paypalStatus,
      synchronizedAt: updatedRequest.updatedAt.toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
