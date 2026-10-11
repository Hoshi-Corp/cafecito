import nodemailer, { type Transporter } from "nodemailer";

// Email is optional: without SMTP settings the app works the same, minus sign-in links.
// CAFECITO_URL builds the links, never the request's Host header, which a client controls.
export const recoveryEnabled = () =>
  Boolean(process.env.SMTP_URL && process.env.SMTP_FROM && process.env.CAFECITO_URL);

let transport: Transporter | undefined;

export async function mailSignInLinks(to: string, links: { name: string; groupName: string; token: string }[]) {
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  const base = process.env.CAFECITO_URL!.replace(/\/+$/, "");
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Your Cafecito sign-in link",
    text: [
      "Someone asked to sign in to Cafecito with this email address. To sign in on that device, open a link within 30 minutes:",
      "",
      ...links.map((l) => `${l.groupName}, as ${l.name}:\n${base}/sign-in/${l.token}`),
      "",
      "If it was not you, ignore this email. Nothing changes until a link is used.",
    ].join("\n"),
  });
}
