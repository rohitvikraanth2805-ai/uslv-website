import nodemailer from "nodemailer";

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const OWNER_EMAIL = process.env.OWNER_EMAIL || EMAIL_USER;

const clean = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim();

const validEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

// Safely display customer input inside the HTML email.
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const SERVICES = [
  "Career Counselling",
  "Financial Advisory",
  "Educational Advisory",
  "Corporate Training",
];

function createBookingHtml(details) {
  const rows = details
    .map(
      ([label, value]) => `
        <tr>
          <th
            scope="row"
            width="32%"
            align="left"
            valign="top"
            style="width:32%; padding:12px; border:1px solid #dddddd;
              background-color:#f5f5f5; font-weight:bold; text-align:left;
              vertical-align:top;"
          >
            ${escapeHtml(label)}
          </th>
          <td
            align="left"
            valign="top"
            style="padding:12px; border:1px solid #dddddd;
              text-align:left; vertical-align:top;
              overflow-wrap:anywhere; word-wrap:break-word;
              word-break:break-word;"
          >
            ${escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>")}
          </td>
        </tr>
      `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>New Appointment Request</title>
  </head>
  <body
    style="margin:0; padding:16px; background-color:#ffffff;
      font-family:Arial,Helvetica,sans-serif; color:#222222;"
  >
    <div style="width:100%; max-width:640px; margin:0 auto;">
      <h2 style="margin:0 0 12px; font-size:22px; line-height:1.4;">
        New Appointment Request
      </h2>

      <p style="margin:0 0 20px; font-size:14px; line-height:1.6;">
        A customer has submitted an appointment request through
        the US &amp; LV website.
      </p>

      <table
        width="100%"
        cellpadding="0"
        cellspacing="0"
        style="width:100%; border-collapse:collapse; table-layout:fixed;
          font-family:Arial,Helvetica,sans-serif;
          font-size:14px; line-height:1.6;"
      >
        <tbody>
          ${rows}
        </tbody>
      </table>

      <p style="margin:20px 0 0; font-size:14px; line-height:1.6;">
        Reply to this email to contact the customer directly.
      </p>

      <p style="margin:16px 0 0; font-size:14px; line-height:1.6;">
        Best regards,<br>
        <strong>US &amp; LV Website</strong>
      </p>
    </div>
  </body>
</html>`;
}

export default async function handler(req, res) {
  // Accept appointment submissions only.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      message: "Use POST to submit an appointment.",
    });
  }

  // Check Vercel email configuration.
  if (!EMAIL_USER || !EMAIL_PASS || !OWNER_EMAIL) {
    console.error("Missing email environment variables.");

    return res.status(500).json({
      success: false,
      message: "Email service is not configured.",
    });
  }

  // Read appointment details.
  const body = req.body ?? {};

  const name = clean(body.name);
  const rawPhone = clean(body.phone).replace(/[\s-]/g, "");
  const digits = rawPhone.replace(/^(\+91|0)/, "");
  const email = clean(body.email).toLowerCase();
  const ageText = clean(body.age);
  const age = ageText ? Number(ageText) : null;
  const service = clean(body.service);
  const message = String(body.message ?? "").trim();

  // Validate name.
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({
      success: false,
      message: "Please enter your full name.",
    });
  }

  // Validate Indian mobile number.
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid Indian mobile number.",
    });
  }

  // A valid client email is required to send confirmation.
  if (!email || email.length > 254 || !validEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid email address.",
    });
  }

  // Validate requested service.
  if (!SERVICES.includes(service)) {
    return res.status(400).json({
      success: false,
      message: "Please select a valid service.",
    });
  }

  // Validate age when supplied.
  if (
    ageText &&
    (!Number.isInteger(age) || age < 1 || age > 120)
  ) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid age.",
    });
  }

  // Limit message length.
  if (message.length > 1000) {
    return res.status(400).json({
      success: false,
      message: "Your message is too long.",
    });
  }

  const phone = `+91${digits}`;

  const timestamp = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });

  const bookingDetails = [
    ["Name", name],
    ["Phone", phone],
    ["Email", email],
    ["Age", age ?? "Not provided"],
    ["Service", service],
    ["Message", message || "None"],
    ["Request received", `${timestamp} IST`],
  ];

  // Connect to Gmail using your Vercel environment variables.
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  try {
    // EMAIL 1: Send booking details to the owner in a table.
    await transporter.sendMail({
      from: `"US & LV Website" <${EMAIL_USER}>`,
      to: OWNER_EMAIL,
      replyTo: email,
      subject: `New Booking: ${name} (${service})`.slice(0, 150),

      text: [
        "NEW APPOINTMENT REQUEST",
        "",
        `Name: ${name}`,
        `Phone: ${phone}`,
        `Email: ${email}`,
        `Age: ${age ?? "Not provided"}`,
        `Service: ${service}`,
        `Message: ${message || "None"}`,
        `Booking time: ${timestamp} IST`,
      ].join("\n"),

      html: createBookingHtml(bookingDetails),
    });

    console.log("Owner notification email sent.");

    // EMAIL 2: Send the original confirmation email to the client.
    let customerEmailSent = false;

    try {
      await transporter.sendMail({
        from: `"US & LV Website" <${EMAIL_USER}>`,
        to: email,
        replyTo: OWNER_EMAIL,
        subject: "We received your appointment request",

        text: [
          `Dear ${name},`,
          "",
          "Thank you for contacting US & LV!",
          "",
          "We have received your appointment request.",
          "",
          `Name: ${name}`,
          `Service requested: ${service}`,
          `Phone: ${phone}`,
          `Request received: ${timestamp} IST`,
          "",
          "Our team will contact you to confirm your appointment details.",
          "",
          "Please note that this email confirms receipt of your request,",
          "not a confirmed appointment date or time.",
          "",
          "Thank you for choosing US & LV.",
          "",
          "Best regards,",
          "US & LV Team",
        ].join("\n"),
      });

      customerEmailSent = true;
      console.log("Client confirmation email sent.");
    } catch (customerError) {
      console.error(
        "Client confirmation email failed:",
        customerError?.code || "",
        customerError?.message || "Unknown email error"
      );
    }

    // Avoid inviting duplicate bookings if only confirmation fails.
    return res.status(200).json({
      success: true,
      customerEmailSent,
      message: customerEmailSent
        ? "Appointment received. Confirmation email sent to the client."
        : "Appointment received, but the client confirmation email could not be sent.",
    });
  } catch (error) {
    console.error(
      "Appointment email failed:",
      error?.code || "",
      error?.message || "Unknown email error"
    );

    return res.status(502).json({
      success: false,
      message: "We could not send your appointment request. Please try again.",
    });
  }
}