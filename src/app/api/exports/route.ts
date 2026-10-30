import { RULES } from "@/server/auth/rate-limit";
import { authed, parseQuery } from "@/server/http";
import { buildExport, exportQuery } from "@/server/services/reports";

export const dynamic = "force-dynamic";

/** CSV exports, scoped by the same authorization rules as the underlying records. */
export const GET = authed({ roles: ["landlord", "tenant"], rateLimit: RULES.export }, async ({ req, actor }) => {
  const { filename, csv } = await buildExport(actor, parseQuery(req, exportQuery));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
