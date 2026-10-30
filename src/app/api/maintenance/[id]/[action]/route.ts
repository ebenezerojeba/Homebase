import { errors } from "@/lib/errors";
import { authed, parseJson } from "@/server/http";
import {
  addMaintenanceComment,
  commentSchema,
  tenantConfirmCompletion,
  tenantConfirmSchema,
  updateMaintenanceRequest,
  updateRequestSchema,
} from "@/server/services/maintenance";

type P = { id: string; action: string };

export const POST = authed<P>({ roles: ["landlord", "tenant"] }, async ({ req, actor, params }) => {
  switch (params.action) {
    case "update":
      return updateMaintenanceRequest(actor, params.id, await parseJson(req, updateRequestSchema));
    case "comment": {
      const c = await addMaintenanceComment(actor, params.id, await parseJson(req, commentSchema));
      return { commentId: c._id.toString() };
    }
    case "confirm":
      await tenantConfirmCompletion(actor, params.id, await parseJson(req, tenantConfirmSchema));
      return { ok: true };
    default:
      throw errors.notFound();
  }
});
