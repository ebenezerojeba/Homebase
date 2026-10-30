import "server-only";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env, isLocalUrl } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: { email: string; name?: string };
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<{ id: string | null }>;
}

class BrevoEmail implements EmailProvider {
  readonly name = "brevo";
  constructor(private readonly apiKey: string) {}
  async send(msg: EmailMessage) {
    const e = env();
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: e.EMAIL_FROM_ADDRESS, name: e.EMAIL_FROM_NAME },
        to: [{ email: msg.to.email, name: msg.to.name }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Brevo send failed with HTTP ${res.status}`);
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { id: data.messageId ?? null };
  }
}

/**
 * Any SMTP server via Nodemailer (Gmail app password, Brevo SMTP, Zoho, Mailgun, etc.).
 * The transporter is reused across requests in a warm serverless instance.
 */
class SmtpEmail implements EmailProvider {
  readonly name = "smtp";
  private readonly transport: Transporter;
  constructor(url: string) {
    // Timeouts as URL options (Nodemailer reads query parameters into transport settings).
    const sep = url.includes("?") ? "&" : "?";
    this.transport = nodemailer.createTransport(`${url}${sep}connectionTimeout=10000&greetingTimeout=10000&socketTimeout=15000`);
  }
  async send(msg: EmailMessage) {
    const e = env();
    const info = await this.transport.sendMail({
      from: { name: e.EMAIL_FROM_NAME, address: e.EMAIL_FROM_ADDRESS },
      to: msg.to.name ? { name: msg.to.name, address: msg.to.email } : msg.to.email,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    if (info.rejected?.length) throw new Error("SMTP server rejected the recipient");
    return { id: info.messageId ?? null };
  }
}

/** Development: prints emails to the server log (links included so flows can be completed locally). */
class ConsoleEmail implements EmailProvider {
  readonly name = "console";
  static outbox: EmailMessage[] = [];
  async send(msg: EmailMessage) {
    ConsoleEmail.outbox.push(msg);
    if (ConsoleEmail.outbox.length > 200) ConsoleEmail.outbox.shift();
    // Optional file outbox so local end-to-end tests can read links (never used in production).
    const file = process.env.DEV_OUTBOX_FILE;
    if (file && (process.env.NODE_ENV !== "production" || isLocalUrl(env().APP_URL))) {
      mkdirSync(path.dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify({ to: msg.to.email, subject: msg.subject, text: msg.text, at: new Date().toISOString() }) + String.fromCharCode(10));
    }
    if (process.env.NODE_ENV !== "test") {
      console.log(`\n--- EMAIL to ${msg.to.email} ---\nSubject: ${msg.subject}\n\n${msg.text}\n--- END EMAIL ---\n`);
    }
    return { id: null };
  }
}

class DisabledEmail implements EmailProvider {
  readonly name = "disabled";
  async send() {
    logger.warn("email_disabled_skip");
    return { id: null };
  }
}

export const devOutbox = ConsoleEmail.outbox;

let provider: EmailProvider | null = null;
export function emailProvider(): EmailProvider {
  if (provider) return provider;
  const e = env();
  provider =
    e.EMAIL_PROVIDER === "smtp"
      ? new SmtpEmail(e.SMTP_URL!)
      : e.EMAIL_PROVIDER === "brevo"
        ? new BrevoEmail(e.BREVO_API_KEY!)
        : e.EMAIL_PROVIDER === "console"
          ? new ConsoleEmail()
          : new DisabledEmail();
  return provider;
}

export function setEmailProviderForTests(p: EmailProvider | null) {
  provider = p;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Plain, respectful transactional template. All dynamic text is escaped. */
export function renderEmail(opts: { heading: string; paragraphs: string[]; cta?: { label: string; url: string } }) {
  const app = env().APP_NAME;
  const text = [opts.heading, "", ...opts.paragraphs, ...(opts.cta ? ["", `${opts.cta.label}: ${opts.cta.url}`] : []), "", `— ${app}`].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F4F6F5;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0B1F3A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #DBE1DE;border-radius:16px">
<tr><td style="padding:28px 32px">
<p style="margin:0 0 20px;font-weight:800;color:#0B1F3A;font-size:20px;letter-spacing:-0.5px">${escapeHtml(app.toLowerCase())}<span style="display:inline-block;width:8px;height:8px;margin-left:3px;border-radius:2px;background:#12A58B"></span></p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(opts.heading)}</h1>
${opts.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${escapeHtml(p)}</p>`).join("")}
${opts.cta ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:#0B1F3A;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(opts.cta.label)}</a></p>` : ""}
</td></tr></table>
<p style="font-size:12px;color:#6b7280;margin:16px 0 0">You received this because you have an account on ${escapeHtml(app)}. Manage email preferences in your settings.</p>
</td></tr></table></body></html>`;
  return { text, html };
}
