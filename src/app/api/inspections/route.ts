import { authed, parseJson } from "@/server/http";
import { inspectionSchema, recordInspection } from "@/server/services/records";

export const POST = authed({ roles: ["landlord"] }, async ({ req, actor }) => {
  const i = await recordInspection(actor, await parseJson(req, inspectionSchema));
  return { inspectionId: i._id.toString() };
});
