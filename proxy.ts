import { NextResponse, type NextRequest } from "next/server";
import { demoAuthFailure } from "./app/lib/demo-auth";

export function proxy(request: NextRequest) {
  const authFailure = demoAuthFailure(request);

  if (authFailure) {
    return authFailure;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // api/paypal-webhook is exempt from demo Basic Auth because PayPal cannot
    // send those credentials. The route authenticates senders itself by
    // verifying PayPal's webhook signature.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/paypal-webhook).*)",
  ],
};