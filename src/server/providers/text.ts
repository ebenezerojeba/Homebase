import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/** SMS and WhatsApp share one interface. Phone numbers are E.164 (+234…). */
export type TextChannel = "sms" | "whatsapp";

export interface TextMessage {
  title: string;
  body: string;
  /** Absolute URL to open in the app. */
  url?: string;
}

export interface TextProvider {
  readonly channel: TextChannel;
  readonly name: string;
  sendNotification(toE164: string, msg: TextMessage): Promise<{ id: string | null }>;
  sendCode(toE164: string, code: string): Promise<{ id: string | null }>;
}

export class ProviderSendError extends Error {
  constructor(
    message: string,
    /** false = retrying won't help (bad number, rejected template, insufficient permissions). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** WhatsApp template parameters can't contain newlines, tabs or 4+ consecutive spaces. */
export function cleanParam(s: string, max: number): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max) || "-";
}

export function smsText(appName: string, msg: TextMessage): string {
  const text = `${appName}: ${msg.title}. ${msg.body}`.replace(/\s+/g, " ").trim();
  const link = msg.url ? ` ${msg.url}` : "";
  // Keep within ~2 SMS segments.
  const max = 300 - link.length;
  return (text.length > max ? `${text.slice(0, max - 1)}…` : text) + link;
}

/* ---------------- Termii (SMS) ---------------- */

export class TermiiSms implements TextProvider {
  readonly channel = "sms" as const;
  readonly name = "termii";
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
    private readonly route: "dnd" | "generic",
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async send(to: string, sms: string) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/sms/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: this.apiKey, to: to.replace(/^\+/, ""), from: this.senderId, sms, type: "plain", channel: this.route }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProviderSendError("Could not reach Termii", true);
    }
    const data = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string; code?: string };
    if (!res.ok || !data.message_id) {
      // 4xx (bad number, unapproved sender, no balance) won't succeed on retry; 5xx might.
      throw new ProviderSendError(`Termii rejected the SMS (HTTP ${res.status}${data.message ? `: ${data.message.slice(0, 120)}` : ""})`, res.status >= 500);
    }
    return { id: data.message_id };
  }

  sendNotification(to: string, msg: TextMessage) {
    return this.send(to, smsText(env().APP_NAME, msg));
  }

  sendCode(to: string, code: string) {
    return this.send(to, `Your ${env().APP_NAME} verification code is ${code}. It expires in 10 minutes. Don't share it with anyone.`);
  }
}

/* ---------------- Meta WhatsApp Cloud API ---------------- */

export class MetaWhatsApp implements TextProvider {
  readonly channel = "whatsapp" as const;
  readonly name = "meta";
  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly version: string,
    private readonly templates: { notification: string; otp: string; lang: string },
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async send(to: string, template: Record<string, unknown>) {
    let res: Response;
    try {
      res = await this.fetchImpl(`https://graph.facebook.com/${this.version}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "template", template }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProviderSendError("Could not reach WhatsApp", true);
    }
    const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok || !data.messages?.[0]?.id) {
      const retryable = res.status >= 500 || res.status === 429 || data.error?.code === 4 || data.error?.code === 80007;
      throw new ProviderSendError(`WhatsApp rejected the message (HTTP ${res.status}${data.error?.message ? `: ${data.error.message.slice(0, 120)}` : ""})`, retryable);
    }
    return { id: data.messages[0].id };
  }

  sendNotification(to: string, msg: TextMessage) {
    const details = msg.url ? `${msg.body} ${msg.url}` : msg.body;
    return this.send(to, {
      name: this.templates.notification,
      language: { code: this.templates.lang },
      components: [{ type: "body", parameters: [{ type: "text", text: cleanParam(msg.title, 60) }, { type: "text", text: cleanParam(details, 900) }] }],
    });
  }

  /** Authentication template with a copy-code button: the code goes in the body and the button. */
  sendCode(to: string, code: string) {
    return this.send(to, {
      name: this.templates.otp,
      language: { code: this.templates.lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    });
  }
}

/* ---------------- Console (development) ---------------- */

export class ConsoleText implements TextProvider {
  readonly name = "console";
  static sent: { channel: TextChannel; to: string; text: string }[] = [];
  constructor(readonly channel: TextChannel) {}
  private log(to: string, text: string) {
    ConsoleText.sent.push({ channel: this.channel, to, text });
    if (ConsoleText.sent.length > 200) ConsoleText.sent.shift();
    if (process.env.NODE_ENV !== "test") console.log(`\n--- ${this.channel.toUpperCase()} to ${to} ---\n${text}\n---\n`);
    return Promise.resolve({ id: null });
  }
  sendNotification(to: string, msg: TextMessage) {
    return this.log(to, smsText(env().APP_NAME, msg));
  }
  sendCode(to: string, code: string) {
    return this.log(to, `Verification code: ${code}`);
  }
}

const cache: Partial<Record<TextChannel, TextProvider | null>> = {};
const overrides: Partial<Record<TextChannel, TextProvider | null>> = {};

/** The configured provider for a channel, or null when the channel is switched off. */
export function textProvider(channel: TextChannel): TextProvider | null {
  if (channel in overrides) return overrides[channel] ?? null;
  if (channel in cache) return cache[channel] ?? null;
  const e = env();
  let p: TextProvider | null = null;
  if (channel === "sms") {
    if (e.SMS_PROVIDER === "termii") p = new TermiiSms(e.TERMII_API_KEY!, e.TERMII_SENDER_ID!, e.TERMII_CHANNEL, e.TERMII_BASE_URL);
    else if (e.SMS_PROVIDER === "console") p = new ConsoleText("sms");
  } else {
    if (e.WHATSAPP_PROVIDER === "meta")
      p = new MetaWhatsApp(e.WHATSAPP_ACCESS_TOKEN!, e.WHATSAPP_PHONE_NUMBER_ID!, e.WHATSAPP_API_VERSION, {
        notification: e.WHATSAPP_NOTIFICATION_TEMPLATE,
        otp: e.WHATSAPP_OTP_TEMPLATE,
        lang: e.WHATSAPP_TEMPLATE_LANG,
      });
    else if (e.WHATSAPP_PROVIDER === "console") p = new ConsoleText("whatsapp");
  }
  cache[channel] = p;
  if (!p) logger.debug("text_channel_disabled", { channel });
  return p;
}

export function enabledTextChannels(): TextChannel[] {
  return (["whatsapp", "sms"] as const).filter((c) => textProvider(c) !== null);
}

export function setTextProviderForTests(channel: TextChannel, p: TextProvider | null | undefined) {
  if (p === undefined) delete overrides[channel];
  else overrides[channel] = p;
}

export const consoleTextOutbox = ConsoleText.sent;
