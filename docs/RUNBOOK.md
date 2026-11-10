# Runbook: run it, verify it, deploy it, submit it

Deadline: **Nov 12, 2026, 12:00 pm Pacific** (about 10:00 pm Cairo time). Plan to submit by the evening of **Nov 11**. Treat Nov 12 as buffer only.

Commands are PowerShell. Run them from the project root.

---

## Part 1. Run it locally

### 1. Apply the upgrade and install

> **Important:** `invoicepilot-upgrade.zip` is an **overlay**. It holds only the new and changed files, not the whole app. Running `npm run dev` inside the unzipped folder fails with errors like "Can't resolve ./app/lib/demo-auth" and "page.tsx doesn't have a root layout", because your existing files are not in it. It must be copied **onto your original project folder**, the one that already contains `app\layout.tsx` and `.git`.

Copy it over your real project. This command skips your secrets, database and build folders so nothing of yours is overwritten:

```powershell
$src = "D:\freelancing\files\invoicepilot-upgrade\invoicepilot"
$dst = "D:\PATH\TO\YOUR\ORIGINAL\invoicepilot"
robocopy $src $dst /E /XD node_modules .next .git /XF .env .env.local dev.db
```

`robocopy` exit codes 0 to 7 mean success (1 means files were copied). Then check and install:

```powershell
cd $dst
Test-Path app\layout.tsx, app\lib\demo-auth.ts, app\AttackLab.tsx    # all three must print True
npm install
npx prisma generate --config prisma7.config.ts
```

If you would rather not merge, use `invoicepilot-full.zip` instead: it is the whole project (original plus upgrade) with no secrets. Unzip it somewhere new, create `.env` and `.env.local` (step 3), then continue from step 3.

### 2. Check the safe part first (no keys, no database)

```powershell
npm test
```

Expect `# pass 30` and `# fail 0`. If this fails, stop and fix it before anything else.

### 3. Configure environment

```powershell
Copy-Item .env.example .env
Copy-Item .env.local.example .env.local
```

Generate a real signing secret and paste it as `APPROVAL_SIGNING_SECRET` in `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Do not skip this.** The placeholder in `.env.example` is long enough to pass the app's length check, but it is public. Anyone who knows it could forge approval receipts.

Fill in `.env.local`:

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | developer.paypal.com, Apps & Credentials, **Sandbox**, create or open an app |
| `PAYPAL_INVOICER_EMAIL` | The email of your **Sandbox business** account (Testing tools, Sandbox accounts) |
| `PAYPAL_TEST_CUSTOMER_EMAIL` | The email of a **Sandbox personal** account |

Keep `DATABASE_URL="file:./dev.db"` in `.env` (Prisma reads only `.env`).

### 4. Create the database

```powershell
npx prisma generate --config prisma7.config.ts
npx prisma migrate dev --config prisma7.config.ts
```

### 5. Preflight, then start

```powershell
npm run preflight
npm run dev
```

Open http://localhost:3000.

### 6. Smoke test (about 10 minutes)

Do these in order and tick each one.

- [ ] **Attack Lab:** scroll to "Try to break it", press **Run all attacks**. Expect **6/6 attacks stopped** and "honest invoice cleared".
- [ ] **Extraction:** paste the Arabic sample from the placeholder text and press Analyze. Fields appear.
- [ ] **Evidence Lens:** click Unit price and Stated total. The matching words highlight.
- [ ] **Conflict:** press "Try conflict example". Approval is blocked and a $100 discrepancy is shown.
- [ ] **PayPal:** analyze a clean note, approve, and confirm a **draft** invoice appears in your Sandbox business account.
- [ ] **History:** the invoice appears in history. Press sync and the status updates.
- [ ] **MCP:** run the following and expect a JSON reply listing `verify_invoice_claims`:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npm run --silent mcp
```

### 7. Things I could not verify from my side

I tested the new code with unit tests, a real browser, and mocks, but **not** `next build`, ESLint, live Gemini, or live PayPal. Run these and send me any errors:

```powershell
npx tsc --noEmit
npm run lint
npm run build
```

---

## Part 2. Hosted demo on Render

A hosted URL is the safest way to satisfy "judges must be able to run it", and PayPal webhooks need a public address.

1. Push the project to a **public** GitHub repo (see Part 4 first).
2. In Render: New, **Blueprint**, pick the repo. It reads `render.yaml`.
3. When prompted, enter `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_INVOICER_EMAIL`. Leave `PAYPAL_WEBHOOK_ID` empty for now.
4. After the first deploy, open the service's Environment tab and copy the generated `DEMO_PASSWORD`. The username is `judge`. **This is what judges will type** into the browser's login prompt.
5. Open the URL, sign in, and repeat the smoke test.

`render.yaml` is untested. If the build fails, read the log; the likely culprits are the Node version or Prisma generation.

**Know the limits:**
- The free plan sleeps when idle. Open the URL a minute before you record or submit so it is awake.
- SQLite is on an ephemeral disk. History disappears on restart, while the PayPal invoices stay. Say so in the submission (it already does).

### PayPal webhook (optional, adds depth)

1. PayPal Developer dashboard, your Sandbox app, **Webhooks**, add `https://YOUR-SERVICE.onrender.com/api/paypal-webhook`.
2. Subscribe to the invoice events.
3. Copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID` on Render and redeploy.
4. Create, send and pay a Sandbox invoice. Confirm its status updates.

If you skip this, remove the webhook claims you can't demo from your video.

---

## Part 3. Record the video

Follow `docs/DEMO-SCRIPT.md`.

- Under **3:00**, uploaded to **YouTube as public**.
- Show the real app, working end to end, on your machine or the hosted URL.
- No third-party logos beyond what appears naturally in the app, and **no music**.
- Rehearse once with your best Arabic sample so extraction is clean on the take.

---

## Part 4. Repository

```powershell
npm run preflight
git status
```

- [ ] Preflight says **Ready**.
- [ ] `git status` shows nothing you don't recognise.
- [ ] No `.env`, `.env.local` or `*.db` is tracked. (I scanned your existing history and found no credentials, only `package-lock.json` integrity hashes.)
- [ ] Repo is **public**.
- [ ] GitHub's **About** panel shows the license (it appears automatically from the `LICENSE` file).
- [ ] The README opens with what it is and how to run it.

If you ever pasted a real key into chat, an issue, or a commit, rotate it.

```powershell
git add -A
git commit -m "Proof Gate, MCP server, Attack Lab, Evidence Lens, payment chain"
git push
```

---

## Part 5. The Devpost form

Use `docs/SUBMISSION.md` as the text.

| Field | What to put |
|---|---|
| Project description | The sections from `SUBMISSION.md` |
| Tools used | Gemini (extraction), PayPal Invoicing API, PayPal Webhooks, MCP. Explain what each does. |
| Repo URL | Your public GitHub repo |
| Demo URL | Your Render URL |
| Testing instructions | URL, username `judge`, the `DEMO_PASSWORD`, and "scroll to Try to break it and press Run all attacks (no key needed)" |
| Video | The public YouTube link |
| Images | Real screenshots: the Evidence Lens, the Attack Lab at 6/6, a PayPal Sandbox invoice |

Only claim what you demonstrated. If the webhook or Render deploy isn't working, cut it from the description.

---

## Timeline

| When | Do |
|---|---|
| **Nov 10 (today)** | Part 1, including the build check in step 7. Get `npm run build` and the smoke test green. Commit. |
| **Nov 11 morning** | Render deploy, webhook, repeat the smoke test on the hosted URL. |
| **Nov 11 afternoon** | Record the video, upload, take screenshots. |
| **Nov 11 evening** | Fill in and **submit** on Devpost. Open the submitted project in a private window and check every link. |
| **Nov 12** | Buffer only. Edits are allowed until the deadline, but don't start anything new. |
