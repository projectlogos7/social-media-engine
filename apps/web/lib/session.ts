import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@sme/db";
import { getSession, type SessionInfo } from "@sme/engine";

export const COOKIE = "sme_session";

export const currentSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  return getSession(getDb(), token);
});

export async function requireSession(): Promise<SessionInfo> {
  const s = await currentSession();
  if (!s) redirect("/login");
  return s;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.startsWith("http://"),
    path: "/",
    expires: expiresAt,
  });
}
