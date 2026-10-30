import "server-only";
import { Schema } from "mongoose";
import { env } from "@/lib/env";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { defineModel } from "@/server/models/_shared";
import { hmac, safeEqualHex, sha256Hex } from "@/server/auth/crypto";

export type ProviderTxStatus = "success" | "failed" | "abandoned" | "pending" | "reversed";

export interface VerifiedTransaction {
  reference: string;
  status: ProviderTxStatus;
  amountKobo: number;
  currency: string;
  paidAt: Date | null;
  channel: string | null;
  gatewayResponse: string | null;
}

export interface ParsedWebhook {
  /** Idempotency key for this delivery's underlying event. */
  eventKey: string;
  eventType: string;
  kind: "charge_success" | "charge_failed" | "refund_processed" | "other";
  reference: string | null;
}

export interface PaymentProvider {
  readonly name: "paystack" | "mock";
  initialize(input: {
    reference: string;
    amountKobo: number;
    email: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<VerifiedTransaction>;
  verifySignature(rawBody: string, signature: string | null): boolean;
  parseWebhook(rawBody: string): ParsedWebhook;
}

function mapPaystackStatus(s: string): ProviderTxStatus {
  switch (s) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "abandoned":
      return "abandoned";
    case "reversed":
      return "reversed";
    default:
      return "pending"; // ongoing, pending, processing, queued
  }
}

/** Paystack (https://paystack.com/docs/api/). Amounts are in kobo for NGN. */
export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack" as const;
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.secretKey}`, "content-type": "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      logger.warn("paystack_network_error", { path, error: e });
      throw errors.provider("Could not reach the payment provider. Please try again.");
    }
    const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
    if (!res.ok || !body?.status) {
      logger.warn("paystack_error", { path, httpStatus: res.status, message: body?.message });
      throw errors.provider(res.status === 404 ? "Transaction not found at provider" : "The payment provider returned an error");
    }
    return body.data as T;
  }

  async initialize(input: Parameters<PaymentProvider["initialize"]>[0]) {
    const data = await this.call<{ authorization_url: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: input.amountKobo,
        currency: "NGN",
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    return { authorizationUrl: data.authorization_url };
  }

  async verify(reference: string): Promise<VerifiedTransaction> {
    const d = await this.call<{
      reference: string;
      status: string;
      amount: number;
      currency: string;
      paid_at?: string | null;
      channel?: string | null;
      gateway_response?: string | null;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      reference: d.reference,
      status: mapPaystackStatus(d.status),
      amountKobo: d.amount,
      currency: d.currency,
      paidAt: d.paid_at ? new Date(d.paid_at) : null,
      channel: d.channel ?? null,
      gatewayResponse: d.gateway_response?.slice(0, 200) ?? null,
    };
  }

  /** Paystack signs the raw body with HMAC-SHA512 using the secret key (x-paystack-signature). */
  verifySignature(rawBody: string, signature: string | null): boolean {
    if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
    return safeEqualHex(hmac(this.secretKey, rawBody, "sha512"), signature.toLowerCase());
  }

  parseWebhook(rawBody: string): ParsedWebhook {
    const body = JSON.parse(rawBody) as { event?: string; data?: Record<string, unknown> };
    const eventType = String(body.event ?? "unknown").slice(0, 80);
    const data = body.data ?? {};
    let reference: string | null = null;
    let kind: ParsedWebhook["kind"] = "other";
    if (eventType === "charge.success") {
      kind = "charge_success";
      reference = typeof data.reference === "string" ? data.reference : null;
    } else if (eventType === "charge.failed") {
      kind = "charge_failed";
      reference = typeof data.reference === "string" ? data.reference : null;
    } else if (eventType === "refund.processed") {
      kind = "refund_processed";
      const tx = data.transaction as { reference?: string } | undefined;
      reference = typeof data.transaction_reference === "string" ? data.transaction_reference : (tx?.reference ?? null);
    }
    // Paystack has no event id; identical re-deliveries have identical bodies.
    const eventKey = `${eventType}:${String(data.id ?? "")}:${sha256Hex(rawBody)}`;
    return { eventKey, eventType, kind, reference };
  }
}

/* ---------------- Mock sandbox (development / tests only) ---------------- */

interface IMockTx {
  reference: string;
  amountKobo: number;
  currency: string;
  status: ProviderTxStatus;
  updatedAt: Date;
}
const mockTxSchema = new Schema<IMockTx>({
  reference: { type: String, required: true, unique: true },
  amountKobo: { type: Number, required: true },
  currency: { type: String, default: "NGN" },
  status: { type: String, required: true },
  updatedAt: { type: Date, default: () => new Date() },
});
export const MockTransaction = defineModel<IMockTx>("MockTransaction", mockTxSchema);

/**
 * Simulates a provider end-to-end: a hosted checkout page, server-side verification against
 * its own store, and HMAC-signed webhooks. It never moves money and is refused in production.
 */
export class MockProvider implements PaymentProvider {
  readonly name = "mock" as const;
  constructor(private readonly secret: string) {}

  async initialize(input: Parameters<PaymentProvider["initialize"]>[0]) {
    await MockTransaction.create({ reference: input.reference, amountKobo: input.amountKobo, currency: "NGN", status: "pending" });
    return { authorizationUrl: `/dev/mock-checkout/${encodeURIComponent(input.reference)}` };
  }

  async verify(reference: string): Promise<VerifiedTransaction> {
    const tx = await MockTransaction.findOne({ reference }).lean();
    if (!tx) throw errors.provider("Transaction not found at provider");
    return {
      reference,
      status: tx.status,
      amountKobo: tx.amountKobo,
      currency: tx.currency,
      paidAt: tx.status === "success" ? tx.updatedAt : null,
      channel: "mock",
      gatewayResponse: `Mock ${tx.status}`,
    };
  }

  sign(rawBody: string) {
    return hmac(this.secret, rawBody, "sha512");
  }

  verifySignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    return safeEqualHex(this.sign(rawBody), signature);
  }

  parseWebhook(rawBody: string): ParsedWebhook {
    // Same wire format as Paystack.
    return PaystackProvider.prototype.parseWebhook.call(this, rawBody);
  }
}

let provider: PaymentProvider | null | undefined;

export function paymentProvider(): PaymentProvider {
  if (provider) return provider;
  const e = env();
  if (e.PAYMENT_PROVIDER === "paystack") provider = new PaystackProvider(e.PAYSTACK_SECRET_KEY!, e.PAYSTACK_BASE_URL);
  else if (e.PAYMENT_PROVIDER === "mock") provider = new MockProvider(hmac(e.APP_SECRET, "mock-payment-provider"));
  else throw errors.notConfigured("Online payments are not enabled. Pay by bank transfer and submit the details instead.");
  return provider;
}

export function onlinePaymentsEnabled(): boolean {
  return env().PAYMENT_PROVIDER !== "disabled";
}

export function setPaymentProviderForTests(p: PaymentProvider | null) {
  provider = p;
}
