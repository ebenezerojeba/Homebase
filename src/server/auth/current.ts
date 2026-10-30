import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/server/models/_shared";
import type { Actor } from "./actor";
import { resolveSession } from "./session";

const isProd = process.env.NODE_ENV === "production";
/** __Host- prefix forces Secure, Path=/ and no Domain in browsers (production only, since it needs HTTPS). */
export const SESSION_COOKIE = isProd ? "__Host-hb_session" : "hb_session";

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Cached per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  return resolveSession(await readSessionToken());
});

export async function getUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

export function homeFor(role: Role): string {
  return role === "landlord" ? "/landlord" : role === "tenant" ? "/tenant" : "/admin";
}

/** For server components: redirect away when the role doesn't match. */
export async function requirePageActor(...roles: Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (roles.length && !roles.includes(actor.role)) redirect(homeFor(actor.role));
  return actor;
}
