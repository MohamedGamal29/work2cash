import { validateInvoice } from "../../lib/validate-invoice";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { message: "Not available." },
      { status: 404 }
    );
  }

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

  const draft =
    typeof body === "object" &&
    body !== null &&
    "draft" in body
      ? body.draft
      : undefined;

  const result = validateInvoice(draft);

  if (!result.success) {
    return Response.json(result, { status: 400 });
  }

  return Response.json({
    ...result,
    message: "Draft passed validation. No invoice created or sent.",
  });
}