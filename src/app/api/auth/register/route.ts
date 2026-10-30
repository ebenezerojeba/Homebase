import { RULES } from "@/server/auth/rate-limit";
import { open, parseJson } from "@/server/http";
import { register, registerSchema } from "@/server/services/auth";

export const POST = open({ rateLimit: RULES.register }, async ({ req }) => register(await parseJson(req, registerSchema)));
