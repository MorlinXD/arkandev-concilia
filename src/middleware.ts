import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function middleware(request: NextRequest) {
  const hasSession = !!getSessionCookie(request);
  const path = request.nextUrl.pathname;
  const isPrivate = path.startsWith("/dashboard") || path.startsWith("/onboarding") || path.startsWith("/bancos");
  if (!hasSession && isPrivate) return NextResponse.redirect(new URL("/login", request.url));
  if (hasSession && path === "/login") return NextResponse.redirect(new URL("/dashboard", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/bancos/:path*", "/onboarding", "/login"] };
