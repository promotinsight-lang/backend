const { Resend } = require("resend");

const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
const resend = resendApiKey ? new Resend(resendApiKey) : null;

if (!resend) {
  console.warn("RESEND_API_KEY is not configured; emails will not be sent.");
}

/**
 * Sends an email using Resend.
 * @param {Object} options 
 * @param {string|string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Email subject
 * @param {string} options.html - Email HTML content
 * @returns {Promise<any>}
 */
const sendEmail = async ({ to, subject, html }) => {
  if (!resend) {
    console.warn("Skipping email send to:", to, "- RESEND_API_KEY is not configured.");
    return false;
  }

  try {
    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM || "Promotinsight <noreply@promotinsight.com>",
      to,
      subject,
      html,
    });
    return data;
  } catch (error) {
    console.error("Error sending email to", to, ":", error);
    return null;
  }
};

module.exports = { sendEmail, resend };
