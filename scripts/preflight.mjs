// ============================================================
// SUBMISSION PREFLIGHT
//
//   npm run preflight              full check, including the tests
//   npm run preflight -- --skip-tests
//   npm run preflight -- --production   also require demo-auth settings
//
// Dependency-free and offline. It never prints secret values: only
// variable names, lengths and file names.
// ============================================================

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const production = args.has("--production");

const results = [];

const pass = (label, detail = "") => results.push({ level: "pass", label, detail });
const fail = (label, detail = "") => results.push({ level: "fail", label, detail });
const warn = (label, detail = "") => results.push({ level: "warn", label, detail });

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function parseEnvFile(file) {
  const values = {};

  if (!existsSync(file)) return values;

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

    if (!match) continue;

    let value = match[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[match[1]] = value;
  }

  return values;
}

const isPlaceholder = (value) =>
  !value ||
  /^(your|replace|change|example|xxx|todo)/i.test(value) ||
  /YOUR_|replace-with|changeme|<.*>/i.test(value);

function git(...gitArgs) {
  const run = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });

  return run.status === 0 ? run.stdout : null;
}

// ------------------------------------------------------------
// 1. RUNTIME
// ------------------------------------------------------------

const [major, minor] = process.versions.node.split(".").map(Number);

if (major > 20 || (major === 20 && minor >= 9)) {
  pass("Node.js version", `v${process.versions.node}`);
} else {
  fail("Node.js version", `v${process.versions.node}; Next.js 16 needs 20.9 or newer`);
}

// ------------------------------------------------------------
// 2. REQUIRED REPOSITORY FILES
// ------------------------------------------------------------

for (const file of ["LICENSE", "README.md", "package.json", "docs/SUBMISSION.md"]) {
  existsSync(path.join(root, file))
    ? pass(`File present: ${file}`)
    : fail(`File missing: ${file}`);
}

if (existsSync(path.join(root, "LICENSE"))) {
  const text = readFileSync(path.join(root, "LICENSE"), "utf8");

  /MIT|Apache|BSD|GNU|ISC|Mozilla/i.test(text)
    ? pass("LICENSE looks like an open-source license")
    : warn("LICENSE not recognised", "Devpost requires an open-source license visible on the repo");
}

// ------------------------------------------------------------
// 3. ENVIRONMENT (names and lengths only, never values)
// ------------------------------------------------------------

const env = {
  ...parseEnvFile(path.join(root, ".env")),
  ...parseEnvFile(path.join(root, ".env.local")),
  ...Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined)
  ),
};

const required = [
  "DATABASE_URL",
  "APPROVAL_SIGNING_SECRET",
  "GEMINI_API_KEY",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_INVOICER_EMAIL",
];

for (const name of required) {
  const value = env[name];

  if (!value) {
    fail(`Env ${name}`, "not set (.env or .env.local)");
  } else if (isPlaceholder(value)) {
    fail(`Env ${name}`, "still a placeholder value");
  } else {
    pass(`Env ${name}`, `set (${value.length} chars)`);
  }
}

if (env.APPROVAL_SIGNING_SECRET && !isPlaceholder(env.APPROVAL_SIGNING_SECRET)) {
  env.APPROVAL_SIGNING_SECRET.length >= 32
    ? pass("APPROVAL_SIGNING_SECRET length", "32+ characters")
    : fail("APPROVAL_SIGNING_SECRET length", "must be at least 32 characters");
}

const demoRequired = production;

for (const name of ["DEMO_USERNAME", "DEMO_PASSWORD"]) {
  const value = env[name];

  if (!value || isPlaceholder(value)) {
    (demoRequired ? fail : warn)(
      `Env ${name}`,
      "not set or placeholder; production mode fails closed without it"
    );
  } else if (name === "DEMO_PASSWORD" && value.length < 16) {
    warn("Env DEMO_PASSWORD", "short; use 16+ random characters for a public demo");
  } else {
    pass(`Env ${name}`, "set");
  }
}

env.PAYPAL_WEBHOOK_ID
  ? pass("Env PAYPAL_WEBHOOK_ID", "set (payment events will be verified)")
  : warn("Env PAYPAL_WEBHOOK_ID", "optional; needed only for the webhook payment chain");

// ------------------------------------------------------------
// 4. REPOSITORY HYGIENE
// ------------------------------------------------------------

const gitignorePath = path.join(root, ".gitignore");
const gitignore = existsSync(gitignorePath)
  ? readFileSync(gitignorePath, "utf8")
  : "";

for (const pattern of [".env", "*.db"]) {
  gitignore.split(/\r?\n/).some((line) => line.trim() === pattern)
    ? pass(`.gitignore covers ${pattern}`)
    : fail(`.gitignore does not cover ${pattern}`);
}

const tracked = git("ls-files");

if (tracked === null) {
  warn("Git repository", "not a git repo here; hygiene checks on tracked files skipped");
} else {
  const files = tracked.split(/\r?\n/).filter(Boolean);

  const sensitive = files.filter(
    (file) =>
      /(^|\/)\.env(\.local)?$/.test(file) ||
      /\.(db|sqlite3?)(-journal)?$/.test(file) ||
      /\.pem$/.test(file)
  );

  sensitive.length === 0
    ? pass("No secret or database files are tracked")
    : fail("Sensitive files are tracked by git", sensitive.join(", "));

  const leaks = [];

  for (const file of files) {
    if (/package-lock\.json$|\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(file)) continue;

    const full = path.join(root, file);

    if (!existsSync(full) || statSync(full).size > 1_000_000) continue;

    const text = readFileSync(full, "utf8");

    if (/AIza[0-9A-Za-z_-]{35}/.test(text)) leaks.push(`${file} (Google API key shape)`);

    for (const match of text.matchAll(
      /(SECRET|API_KEY|PASSWORD|TOKEN)\s*=\s*["']?([A-Za-z0-9_\-+/]{24,})["']?/g
    )) {
      if (!isPlaceholder(match[2])) {
        leaks.push(`${file} (${match[1]} assignment, ${match[2].length} chars)`);
      }
    }
  }

  leaks.length === 0
    ? pass("No secret-shaped values in tracked files")
    : fail("Possible secrets in tracked files", leaks.join("; "));

  const status = git("status", "--porcelain") ?? "";

  for (const dir of [".claude", ".windsurf", ".agents"]) {
    if (status.split(/\r?\n/).some((line) => line.slice(3).startsWith(`${dir}/`))) {
      warn(`${dir}/ would be committed`, "add it to .gitignore to keep the public repo clean");
    }
  }

  const dirty = status.split(/\r?\n/).filter(Boolean).length;

  dirty === 0
    ? pass("Working tree is clean")
    : warn("Uncommitted changes", `${dirty} path(s); commit and push before submitting`);
}

// ------------------------------------------------------------
// 5. TESTS
// ------------------------------------------------------------

if (args.has("--skip-tests")) {
  warn("Tests skipped", "run without --skip-tests before you submit");
} else {
  const run = spawnSync("npm", ["test"], {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });

  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const passed = output.match(/# pass (\d+)/)?.[1];
  const failed = output.match(/# fail (\d+)/)?.[1];

  run.status === 0
    ? pass("npm test", `${passed ?? "?"} passed, ${failed ?? "0"} failed`)
    : fail("npm test", "tests failed; run `npm test` to see why");
}

// ------------------------------------------------------------
// REPORT
// ------------------------------------------------------------

const icon = { pass: "PASS", fail: "FAIL", warn: "WARN" };

console.log("\nInvoicePilot submission preflight\n");

for (const { level, label, detail } of results) {
  console.log(`  ${icon[level]}  ${label}${detail ? `  -  ${detail}` : ""}`);
}

const failures = results.filter((r) => r.level === "fail").length;
const warnings = results.filter((r) => r.level === "warn").length;

console.log(
  `\n${failures === 0 ? "Ready" : "Not ready"}: ${failures} failure(s), ${warnings} warning(s).\n`
);

process.exit(failures === 0 ? 0 : 1);
