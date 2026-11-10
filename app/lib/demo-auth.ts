import { timingSafeEqual } from "node:crypto";

const BASIC_AUTH_REALM =
  'Basic realm="Work2Cash Demo", charset="UTF-8"';

function secureCompare(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function unauthorizedResponse(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": BASIC_AUTH_REALM,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function parseBasicCredentials(
  request: Request
): { username: string; password: string } | null {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const separator = authorization.indexOf(" ");

  if (separator <= 0) {
    return null;
  }

  const scheme = authorization.slice(0, separator);
  const encoded = authorization.slice(separator + 1).trim();

  if (
    scheme.toLowerCase() !== "basic" ||
    !encoded ||
    encoded.length > 4096 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    return null;
  }

  try {
    const decodedBuffer = Buffer.from(encoded, "base64");
    const canonicalBase64 = decodedBuffer.toString("base64");

    if (
      canonicalBase64.replace(/=+$/, "") !==
      encoded.replace(/=+$/, "")
    ) {
      return null;
    }

    const decoded = decodedBuffer.toString("utf8");
    const credentialSeparator = decoded.indexOf(":");

    if (credentialSeparator <= 0) {
      return null;
    }

    return {
      username: decoded.slice(0, credentialSeparator),
      password: decoded.slice(credentialSeparator + 1),
    };
  } catch {
    return null;
  }
}

export function demoAuthFailure(
  request: Request
): Response | null {
  // Local development remains unchanged.
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const expectedUsername = process.env.DEMO_USERNAME;
  const expectedPassword = process.env.DEMO_PASSWORD;

  // Fail closed if production credentials are not configured.
  if (
    !expectedUsername ||
    expectedUsername.length > 128 ||
    !expectedPassword ||
    expectedPassword.length < 24 ||
    expectedPassword.length > 256
  ) {
    return Response.json(
      {
        success: false,
        code: "DEMO_AUTH_NOT_CONFIGURED",
        message: "Demo access is not configured on the server.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const credentials = parseBasicCredentials(request);

  const usernameMatches = credentials
    ? secureCompare(credentials.username, expectedUsername)
    : false;

  const passwordMatches = credentials
    ? secureCompare(credentials.password, expectedPassword)
    : false;

  if (!(usernameMatches && passwordMatches)) {
    return unauthorizedResponse();
  }

  // Protect state-changing API requests against cross-origin submissions.
  const method = request.method.toUpperCase();

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const origin = request.headers.get("origin");
    let requestOrigin: string;

    try {
      requestOrigin = new URL(request.url).origin;
    } catch {
      return Response.json(
        {
          success: false,
          message: "Could not validate the request origin.",
        },
        { status: 403 }
      );
    }

    if (!origin || origin !== requestOrigin) {
      return Response.json(
        {
          success: false,
          message: "Cross-origin request rejected.",
        },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }
  }

  return null;
}