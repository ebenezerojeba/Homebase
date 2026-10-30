import { authed, parseJson } from "@/server/http";
import { createProperty, listProperties, propertySchema } from "@/server/services/properties";

export const GET = authed({ roles: ["landlord"] }, async ({ actor }) => ({ items: await listProperties(actor) }));
export const POST = authed({ roles: ["landlord"] }, async ({ req, actor }) => ({ property: await createProperty(actor, await parseJson(req, propertySchema)) }));
