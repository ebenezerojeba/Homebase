import { authed, parseJson, parseQuery } from "@/server/http";
import { expenseFilter, expenseSchema, listExpenses, recordExpense } from "@/server/services/records";

export const GET = authed({ roles: ["landlord"] }, async ({ req, actor }) => listExpenses(actor, parseQuery(req, expenseFilter)));
export const POST = authed({ roles: ["landlord"] }, async ({ req, actor }) => {
  const e = await recordExpense(actor, await parseJson(req, expenseSchema));
  return { expenseId: e._id.toString() };
});
