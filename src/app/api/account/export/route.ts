import { RULES } from "@/server/auth/rate-limit";
import { authed } from "@/server/http";
import { exportMyData } from "@/server/services/admin";

export const GET = authed({ rateLimit: RULES.export }, async ({ actor }) => {
  const data = await exportMyData(actor);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="my-homebase-data.json"',
      "cache-control": "no-store",
    },
  });
});
