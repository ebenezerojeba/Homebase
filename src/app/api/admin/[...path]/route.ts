import { z } from "zod";
import { errors } from "@/lib/errors";
import { authed, parseJson } from "@/server/http";
import { adminSetUserStatus, resolveDataRequest, resolveRequestSchema } from "@/server/services/admin";

/** POST /api/admin/data-requests/:id  ·  POST /api/admin/users/:id/status */
export const POST = authed<{ path: string[] }>({ roles: ["admin"] }, async ({ req, actor, params }) => {
  const [section, id, sub] = params.path as unknown as string[];
  if (section === "data-requests" && id && !sub) {
    await resolveDataRequest(actor, id, await parseJson(req, resolveRequestSchema));
    return { ok: true };
  }
  if (section === "users" && id && sub === "status") {
    const input = await parseJson(req, z.object({ status: z.enum(["active", "deactivated"]), reason: z.string().trim().min(3).max(500) }));
    await adminSetUserStatus(actor, id, input.status, input.reason);
    return { ok: true };
  }
  throw errors.notFound();
});
