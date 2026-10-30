import { errors } from "@/lib/errors";
import { authed, parseJson } from "@/server/http";
import { channelsSchema, removePhone, sendCodeSchema, sendPhoneCode, setTextChannels, verifyCodeSchema, verifyPhoneCode } from "@/server/services/phone";

/** POST /api/account/phone/{send-code|verify|channels|remove} */
export const POST = authed<{ action: string }>({ roles: ["landlord", "tenant"] }, async ({ req, actor, params }) => {
  switch (params.action) {
    case "send-code": {
      const input = await parseJson(req, sendCodeSchema);
      return sendPhoneCode(actor, { phone: input.phone, channel: input.channel });
    }
    case "verify":
      return verifyPhoneCode(actor, (await parseJson(req, verifyCodeSchema)).code);
    case "channels":
      return setTextChannels(actor, await parseJson(req, channelsSchema));
    case "remove":
      await removePhone(actor);
      return { ok: true };
    default:
      throw errors.notFound();
  }
});
