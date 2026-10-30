import { describe, expect, it } from "vitest";
import { uploadAsset } from "@/server/services/assets";
import { claimSchema, reconciliationWorkspace, submitPaymentClaim } from "@/server/services/payments";
import { iso, makeJoinedTenancy, makeUser } from "../support/factories";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe("payment proof", () => {
  it("is attached to the claim and visible to the landlord for review", async () => {
    const landlord = await makeUser("landlord");
    const { tenant, tenancyId } = await makeJoinedTenancy(landlord, { startDate: iso(-3), endDate: iso(360) });
    const asset = await uploadAsset(tenant, { kind: "payment_proof", tenancyId, fileName: "proof.png", body: PNG });
    await submitPaymentClaim(tenant, claimSchema.parse({ tenancyId, amountKobo: 4000, paidOn: iso(0), method: "bank_transfer", reference: "PROOF1", proofAssetId: asset._id.toString() }));
    const w = await reconciliationWorkspace(landlord);
    expect(w.claims[0]?.proofAssetId?._id.toString()).toBe(asset._id.toString());
    expect(w.claims[0]?.hints).not.toContain("No supporting document attached");
  });
});
