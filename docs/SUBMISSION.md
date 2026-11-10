# Devpost submission text (copy into the form)

## Tagline
An AI that is not allowed to guess about money: every invoice claim must be quoted from your own words, and a deterministic gate stands between any AI agent and PayPal.

## Inspiration
AI agents are about to create invoices and move money from free-text messages. They also hallucinate numbers, obey instructions hidden in pasted client emails, and quietly pick one of two contradictory totals. A model that is usually right is not good enough for payments. We wanted the missing safety layer: the thing that sits between "an AI decided" and "PayPal sent a payment request".

## What it does
InvoicePilot (Work2Cash) turns a messy work description, in English, Arabic or mixed, into a PayPal Sandbox invoice, with proof.

1. **Proof Ledger.** Gemini extracts the invoice, but must attach a verbatim quotation from the notes for every field. The server re-verifies each quotation, checks the quoted words really contain the amount, and recomputes totals in integer cents. Contradictory totals block approval.
2. **Evidence Lens.** Click any field and the exact words in your notes that support it light up. Unsupported claims are flagged amber.
3. **Proof Gate (new).** A deterministic ALLOW / REVIEW / BLOCK checkpoint for *any* agent that wants to create an invoice. It is available as an HTTP endpoint and as an MCP server designed to run next to PayPal's official MCP server.
4. **Attack Lab (new).** Seven adversarial scenarios, runnable with no API key: a hallucinated quotation, a real quotation with the wrong number, a contradictory total, a prompt injection hidden in a client message, a currency swap (400 EGP relabelled as 400 USD), a payment-redirect email swap, and an honest control that must pass. Judges can also write their own attack.
5. **Human approval and PayPal.** Approved invoices are created through the PayPal Invoicing API with idempotent request IDs and an immutable, hashed approval snapshot.
6. **Payment proof chain (new).** PayPal webhook events (paid, refunded, cancelled) are signature-verified and appended to the same hash chain, so one tamper-evident record runs from the original notes to the payment.

## How PayPal and AI are used
- **PayPal:** OAuth, Invoicing API v2 (create, send, status sync), Webhooks (`verify-webhook-signature`), and PayPal's MCP server as the target the Proof Gate protects.
- **AI:** Gemini for structured extraction with mandatory evidence quotations. The safety decisions themselves are deliberately *not* made by a model: they are deterministic code, so they can be tested and audited.

## How we built it
Next.js 16, TypeScript, Prisma with SQLite, Gemini via `@google/genai`, PayPal Sandbox REST APIs. The Proof Gate reuses the same verification primitives as the Proof Ledger, so the human path and the agent path cannot disagree about money. The MCP server is a dependency-free stdio JSON-RPC implementation that runs offline. 30 automated tests cover the gate, the attack scenarios, and the payment chain, and the UI was exercised end-to-end in a real browser.

## Challenges
- Making "the quote exists" meaningful. A quotation can be real and still not support the claimed number, so the gate checks that the quoted words actually contain the value.
- Treating instruction-like text in client messages as untrusted. Evidence that reads like an instruction to an AI is rejected as evidence.
- Arabic input: digit normalization (Arabic-Indic numerals), number words, and right-to-left rendering in the Evidence Lens.

## Accomplishments we are proud of
- Every attack in the lab is stopped for the *intended* reason, and the honest control passes.
- The safety layer needs no model, no key and no network, so judges can verify it in seconds.

## What we learned
String matching proves provenance, not truth. That is why a human approval step always follows an ALLOW, and we say so in the product.

## Known limits (honest)
- Sandbox only, USD only, SQLite for local development.
- With two separate MCP servers, the call order is enforced by agent instructions, not by PayPal. Truly enforced gating would need a gateway that proxies PayPal's tools. The enforced path today is InvoicePilot's own app.
- We have not benchmarked extraction accuracy on real-world data; the evaluation suite is a regression suite.

## What's next
A PayPal-tool proxy gateway so the gate cannot be bypassed, multi-currency support, line-item invoices, and a client-facing "verify this invoice" page.

## Built with
Next.js, TypeScript, React, Tailwind CSS, Prisma, SQLite, Gemini API, PayPal Invoicing API, PayPal Webhooks, Model Context Protocol (MCP)

## Prize categories to tick
Most Creative, Best Use of PayPal + AI, Best Use of Agentic Commerce, Most Impactful. Add Best Use of Render only if you actually deploy there.
