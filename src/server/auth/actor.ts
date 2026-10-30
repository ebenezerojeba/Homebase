import type { Role } from "@/server/models/_shared";
import { errors } from "@/lib/errors";

/** The authenticated principal. Derived only from the server-side session, never from client input. */
export interface Actor {
  userId: string;
  role: Role;
  name: string;
  email: string;
  emailVerified: boolean;
  sessionId?: string;
}

export function requireRole(actor: Actor | null, ...roles: Role[]): Actor {
  if (!actor) throw errors.unauthenticated();
  if (roles.length > 0 && !roles.includes(actor.role)) throw errors.forbidden();
  return actor;
}

export const systemActor = { userId: null, role: "system" as const };
