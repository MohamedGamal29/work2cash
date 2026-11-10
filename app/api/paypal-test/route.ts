
export async function GET() {
  // Keep this diagnostic endpoint available only during development.
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ message: "Not available." }, { status: 404 });
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return Response.json(
      {
        success: false,
        message:
          "Missing credentials. Check .env.local and restart the server.",
      },
      { status: 500 }
    );
  }

  try {
    const credentials = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");

    const response = await fetch(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
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

    if (!response.ok) {
      return Response.json(
        {
          success: false,
          message: "PayPal authentication failed.",
          paypalStatus: response.status,
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (!data.access_token) {
      return Response.json(
        {
          success: false,
          message: "PayPal did not return an access token.",
        },
        { status: 502 }
      );
    }

    return Response.json(
      {
        success: true,
        message: "Connected to PayPal Sandbox successfully!",
        scopes: data.scope ?? "No scope field returned",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      {
        success: false,
        message:
          "Could not reach PayPal. Check your connection and try again.",
      },
      { status: 502 }
    );
  }
}