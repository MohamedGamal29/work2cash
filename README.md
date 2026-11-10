
# InvoicePilot

### AI-powered invoice drafting and PayPal Sandbox integration

InvoicePilot is an AI-assisted invoice workflow application designed to help freelancers and service providers turn natural-language work descriptions into structured invoice drafts, review the extracted information, and create invoices through PayPal Sandbox.

The project combines Gemini-powered information extraction, deterministic invoice validation, human approval, and PayPal API integration.

> **Project status:** Hackathon prototype in active development. This version uses PayPal Sandbox and is not intended for processing real payments.

## The Proof Gate: a checkpoint between AI agents and PayPal

AI agents are starting to create invoices and move money from free-text messages. They can hallucinate a number, be fooled by a hidden instruction in a pasted client email, or quietly pick one of two contradictory totals. A model that is *usually* right is not good enough for payments.

InvoicePilot's answer is that **an AI is never allowed to assert a financial fact it cannot quote.** The Proof Gate is a deterministic checkpoint (no model involved) that re-verifies every claim an agent makes before anything reaches PayPal:

```text
   Agent ──► verify_invoice_claims ──► ALLOW ──► human approval ──► PayPal Invoicing API
                   │  (Proof Gate)
                   ├─► REVIEW  a person must look
                   └─► BLOCK   nothing is sent
```

For every claim the gate checks that the quotation really exists in the original notes, that the quoted words actually contain the claimed number, amount, currency or email, that totals recompute exactly in integer cents, that hard limits hold, and that the "evidence" is not itself an instruction to an AI. The result carries a tamper-evident `proofHash`.

### What is new in this hackathon build

| Feature | What it does | Where |
|---|---|---|
| **Proof Gate** | Deterministic ALLOW / REVIEW / BLOCK verdict for agent-submitted invoice claims | `app/lib/proof-gate.ts`, `POST /api/proof-gate` |
| **MCP server** | Exposes the gate to any MCP agent, designed to run beside PayPal's official MCP server | `scripts/mcp-proof-gate.ts` |
| **Evidence Lens** | Click a field and the exact words in your notes that support it light up (Arabic and RTL supported) | `app/EvidenceLens.tsx` |
| **Attack Lab** | Seven adversarial scenarios plus a custom attack box, run against the real gate with no API key needed | `app/AttackLab.tsx` |
| **Payment proof chain** | PayPal webhook events (paid, refunded, cancelled) extend the approval hash into one tamper-evident chain | `app/api/paypal-webhook/route.ts`, `app/lib/payment-chain.ts` |

### Try it in 60 seconds (no API keys)

```bash
npm install
npm test             # 30 tests: gate, attack scenarios, payment chain
npm run dev          # open the app, scroll to "Try to break it", press "Run all attacks"
```

The Attack Lab and the tests need no keys and no database. Extraction and PayPal need the full setup in [Getting Started](#getting-started); [docs/RUNBOOK.md](docs/RUNBOOK.md) walks through it step by step, including a hosted deploy.

The Attack Lab covers: a hallucinated quotation, a real quotation with the wrong number, a contradictory total, a prompt injection inside a client message, a currency swap (400 EGP relabelled as 400 USD), a payment-redirect email swap, and an honest control that must pass.

### Use the gate from an AI agent (MCP)

Run the Proof Gate next to PayPal's official MCP server. Copy `mcp.example.json` into your MCP client configuration (for Claude Desktop, `claude_desktop_config.json`) and replace the two placeholders.

```json
{
  "mcpServers": {
    "paypal": {
      "command": "npx",
      "args": ["-y", "@paypal/mcp", "--tools=all"],
      "env": { "PAYPAL_ACCESS_TOKEN": "YOUR_TOKEN", "PAYPAL_ENVIRONMENT": "SANDBOX" }
    },
    "invoicepilot-proof-gate": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/invoicepilot/scripts/mcp-proof-gate.ts"]
    }
  }
}
```

The gate server tells the agent, through its MCP `instructions`, to call `verify_invoice_claims` before creating a PayPal invoice and to proceed only on `ALLOW`. The gate needs no API key and makes no network calls, so it also runs offline.

> **Honest scope:** with two separate MCP servers, the ordering is enforced by the agent following the instructions, not by PayPal. The strict, enforced path is InvoicePilot's own app, where the Proof Gate, pricing integrity check, signed receipt, and human approval all sit in front of the PayPal call. Making PayPal-side enforcement impossible to bypass would need a gateway that proxies PayPal's tools, which is future work.

### What the gate does and does not prove

String matching proves **provenance**, not **truth**. A verified quotation can still be wrong in the real world (the client may have meant 120, not 100). That is why a human approval step always follows an `ALLOW`, and why instruction-like text in a client message is never accepted as evidence.

### PayPal webhooks (optional)

Register `https://YOUR-HOST/api/paypal-webhook` as a Sandbox webhook for `INVOICING.INVOICE.*` events and set `PAYPAL_WEBHOOK_ID`. Each event is verified with PayPal's `verify-webhook-signature` API and appended to the invoice's hash chain, starting from the approval `proofHash`. For local testing without a public URL, set `PAYPAL_WEBHOOK_SKIP_VERIFY=true`; this is ignored when `NODE_ENV=production`.

## Features

### 1. AI-powered invoice extraction
- Extract structured invoice information from natural-language descriptions.
- Supports English, Arabic, and mixed-language test scenarios.
- Identifies pricing basis and distinguishes stated totals from derived unit prices.
- Flags ambiguous or missing information for clarification.

### 2. Invoice validation and human approval
- Allows users to review and edit extracted invoice information.
- Performs server-side invoice validation.
- Highlights incomplete or unsupported invoice information.
- Requires explicit user approval before creating a PayPal invoice.

### 3. PayPal Sandbox integration
- Creates invoices through the PayPal Invoicing API in Sandbox.
- Uses request identifiers to prevent duplicate creation for repeated requests.
- Synchronizes invoice status with PayPal.
- Keeps the PayPal operation status separate from the external PayPal invoice status.

### 4. Invoice history
- Persists invoice requests using Prisma and SQLite.
- Retrieves previously created invoice records.
- Supports invoice history refresh and status synchronization.

### 5. Extraction evaluation
- Includes a PowerShell-based regression evaluation script.
- Tests multilingual descriptions, missing information, ambiguous prices, and adversarial input scenarios.
- Exports evaluation results as CSV files.

The latest authored regression suite passed **12 out of 12 test cases on November 8, 2026**. This is a functional regression result, not a claim of 100% real-world AI accuracy.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| AI extraction | Google Gemini API |
| Backend | Next.js API Routes |
| Database | SQLite |
| ORM | Prisma 7 |
| Payments and invoicing | PayPal Invoicing API (Sandbox) |
| Evaluation | PowerShell regression tests |

## Application Workflow

1. The user provides an invoice description.
2. Gemini extracts the available invoice information.
3. The application returns a structured invoice draft and clarification information.
4. The user reviews and edits the draft.
5. The server validates the invoice.
6. The user explicitly approves the invoice.
7. The backend creates the invoice through PayPal Sandbox.
8. The application saves the request and retrieves invoice history.
9. The user can synchronize the invoice status with PayPal.

## Getting Started

### Prerequisites

- Node.js and npm.
- A Google Gemini API key.
- A PayPal Developer account with Sandbox credentials.

### 1. Clone the repository

```bash
git clone https://github.com/MohamedGamal29/work2cash.git
cd invoicepilot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create local environment files from the provided templates:

```powershell
Copy-Item .env.example .env
Copy-Item .env.local.example .env.local
```

Update `.env`:

```env
DATABASE_URL="file:./dev.db"
```

Update `.env.local` with your own credentials:

```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

PAYPAL_CLIENT_ID="YOUR_PAYPAL_SANDBOX_CLIENT_ID"
PAYPAL_CLIENT_SECRET="YOUR_PAYPAL_SANDBOX_CLIENT_SECRET"

PAYPAL_INVOICER_EMAIL="YOUR_SANDBOX_BUSINESS_EMAIL"
PAYPAL_TEST_CUSTOMER_EMAIL="YOUR_SANDBOX_PERSONAL_EMAIL"
```

Never commit actual credentials or private environment files.

### 4. Generate the Prisma client

```bash
npx prisma generate --config prisma7.config.ts
```

### 5. Apply database migrations

```bash
npx prisma migrate dev --config prisma7.config.ts
```

### 6. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

Run ESLint:

```bash
npm run lint
```

Run the unit tests (Proof Gate, attack scenarios, payment chain; no API keys needed):

```bash
npm test
```

Run TypeScript checks:

```bash
npx tsc --noEmit
```

Build the application:

```bash
npm run build
```

### Run the AI extraction regression suite

First, start the development server:

```bash
npm run dev
```

In a second PowerShell terminal, execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\evaluate-extraction.ps1
```

The script evaluates the configured extraction scenarios and exports a CSV report under `test-results/`.

## API Overview

| Endpoint | Purpose |
|---|---|
| `POST /api/gemini-test` | Extract structured invoice information using Gemini |
| `POST /api/invoices` | Create a PayPal Sandbox invoice |
| `GET /api/invoices` | Retrieve invoice history |
| `POST /api/invoices/[invoiceId]/sync` | Synchronize invoice status with PayPal |
| `/api/paypal-test` | PayPal integration test route |
| `POST /api/proof-gate` | Verify agent-submitted invoice claims: ALLOW, REVIEW or BLOCK |
| `GET /api/proof-gate` | Describe the gate policy |
| `POST /api/paypal-webhook` | Receive PayPal invoice events and extend the proof chain |

## Current Limitations and Security

This repository is an active hackathon prototype, not a production-ready financial application.

- **Sandbox only:** PayPal operations use Sandbox credentials, not live transactions.
- **Currency:** The current PayPal invoice creation workflow supports USD only.
- **Database:** SQLite is currently used for local development. A production deployment requires a persistent database.
- **Access control:** Some API routes are currently restricted to development mode. Production deployment requires a proper authentication and authorization design.
- **AI verification:** Extracted information must be reviewed by a human before invoice creation.
- **Reliability:** Duplicate-request protection does not guarantee exactly-once processing across every possible external API and database failure.

Do not use real customer financial data or deploy the current prototype as a public production invoicing service.

## Project Structure

```text
invoicepilot/
├── app/
│   ├── api/
│   │   ├── gemini-test/
│   │   ├── invoice-review/
│   │   ├── invoices/
│   │   ├── paypal-test/
│   │   ├── paypal-webhook/
│   │   └── proof-gate/
│   ├── lib/
│   │   ├── proof-gate.ts
│   │   ├── payment-chain.ts
│   │   ├── evidence-spans.ts
│   │   └── attack-scenarios.ts
│   ├── AttackLab.tsx
│   ├── DraftApproval.tsx
│   ├── EvidenceLens.tsx
│   ├── InvoiceHistory.tsx
│   └── page.tsx
├── prisma/
│   ├── migrations/
│   └── schema.prisma
├── scripts/
│   ├── evaluate-extraction.ps1
│   └── mcp-proof-gate.ts
├── tests/
├── test-results/
├── .env.example
├── .env.local.example
├── mcp.example.json
├── prisma7.config.ts
├── package.json
└── README.md
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
