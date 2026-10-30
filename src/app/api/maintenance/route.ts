import { authed, parseJson, parseQuery } from "@/server/http";
import { createMaintenanceRequest, createRequestSchema, listMaintenance, maintenanceFilter } from "@/server/services/maintenance";

export const GET = authed({}, async ({ req, actor }) => listMaintenance(actor, parseQuery(req, maintenanceFilter)));
export const POST = authed({ roles: ["tenant", "landlord"] }, async ({ req, actor }) => {
  const r = await createMaintenanceRequest(actor, await parseJson(req, createRequestSchema));
  return { requestId: r._id.toString() };
});
