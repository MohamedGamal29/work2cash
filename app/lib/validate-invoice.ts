type ValidatedDraft = {
  customerName: string;
  customerEmail: string;
  description: string;
  quantity: number;
  unitPrice: number;
  currency: "USD";
  paymentDueDays: number;
};

type ValidationResult =
  | {
      success: true;
      draft: ValidatedDraft;
      total: string;
    }
  | {
      success: false;
      errors: string[];
    };

export function validateInvoice(input: unknown): ValidationResult {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return {
      success: false,
      errors: ["Provide an invoice draft."],
    };
  }

  const draft = input as Record<string, unknown>;
  const errors: string[] = [];

  const customerName =
    typeof draft.customerName === "string"
      ? draft.customerName.trim()
      : "";

  const customerEmail =
    typeof draft.customerEmail === "string"
      ? draft.customerEmail.trim()
      : "";

  const description =
    typeof draft.description === "string"
      ? draft.description.trim()
      : "";

  const currency =
    typeof draft.currency === "string"
      ? draft.currency.trim().toUpperCase()
      : "";

  const quantity = draft.quantity;
  const unitPrice = draft.unitPrice;
  const paymentDueDays = draft.paymentDueDays;

  if (!customerName || customerName.length > 100) {
    errors.push("Customer name must contain 1–100 characters.");
  }

  if (
    customerEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)
  ) {
    errors.push("Enter a valid customer email address.");
  }

  if (!description || description.length > 200) {
    errors.push("Work description must contain 1–200 characters.");
  }

  if (currency !== "USD") {
    errors.push("This prototype supports USD only.");
  }

  const quantityValid =
    typeof quantity === "number" &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 100;

  if (!quantityValid) {
    errors.push("Quantity must be a whole number from 1 to 100.");
  }

  const priceValid =
    typeof unitPrice === "number" &&
    Number.isFinite(unitPrice) &&
    unitPrice > 0 &&
    unitPrice <= 10000 &&
    Math.abs(
      unitPrice * 100 - Math.round(unitPrice * 100)
    ) < 0.000001;

  if (!priceValid) {
    errors.push(
      "Unit price must be greater than zero, at most \$10,000, " +
        "and have no more than two decimal places."
    );
  }

  const dueDaysValid =
    typeof paymentDueDays === "number" &&
    Number.isInteger(paymentDueDays) &&
    paymentDueDays >= 0 &&
    paymentDueDays <= 365;

  if (!dueDaysValid) {
    errors.push(
      "Payment due days must be a whole number from 0 to 365."
    );
  }

  let totalCents = 0;

  if (quantityValid && priceValid) {
    totalCents = quantity * Math.round(unitPrice * 100);

    if (totalCents > 1000000) {
      errors.push("The total must not exceed \$10,000.");
    }
  }

  if (
    errors.length > 0 ||
    !quantityValid ||
    !priceValid ||
    !dueDaysValid
  ) {
    return { success: false, errors };
  }

  return {
    success: true,
    draft: {
      customerName,
      customerEmail,
      description,
      quantity,
      unitPrice,
      currency: "USD",
      paymentDueDays,
    },
    total: (totalCents / 100).toFixed(2),
  };
}