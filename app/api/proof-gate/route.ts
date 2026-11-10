import {
  GATE_POLICY_SUMMARY,
  parseGateInput,
  runProofGate,
} from "../../lib/proof-gate";

// The gate is pure computation: no database, no PayPal call, no model
// call. It is still protected by the demo authentication in proxy.ts.

const MAX_BODY_BYTES = 32_000;

export async function GET() {
  return Response.json({
    name: "InvoicePilot Proof Gate",
    policyVersion: 1,
    policy: GATE_POLICY_SUMMARY,
    usage:
      "POST { sourceText, claims: { field: { value, quote } } } and receive ALLOW, REVIEW or BLOCK.",
  });
}

export async function POST(request: Request) {
  const declaredLength = Number(
    request.headers.get("content-length") ?? 0
  );

  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json(
      { success: false, message: "Request body is too large." },
      { status: 413 }
    );
  }

  let body: unknown;

  try {
    const text = await request.text();

    if (text.length > MAX_BODY_BYTES) {
      return Response.json(
        { success: false, message: "Request body is too large." },
        { status: 413 }
      );
    }

    body = JSON.parse(text);
  } catch {
    return Response.json(
      { success: false, message: "Request must contain valid JSON." },
      { status: 400 }
    );
  }

  const parsed = parseGateInput(body);

  if (!parsed.ok) {
    return Response.json(
      { success: false, message: parsed.error },
      { status: 400 }
    );
  }

  return Response.json({
    success: true,
    ...runProofGate(parsed.input),
  });
}
