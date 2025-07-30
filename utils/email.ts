// utils/email.ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }

    const result = await resend.emails.send({
      from: "Nexus Chat <hello@nikhilsahni.xyz>",
      to,
      subject,
      html,
    });

    return result;
  } catch (error: any) {
    console.error("Failed to send email:", error.message);
    throw error;
  }
}
