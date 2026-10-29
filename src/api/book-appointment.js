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
  "Corporate Training"
];

// Owner email: keep booking details in an aligned table.
function createBookingHtml(details) {
  const rows = details.map(([label, value]) => `
    <tr>
      <th scope="row" width="32%" align="left" valign="top"
        style="width:32%; padding:12px; border:1px solid #dddddd;
          background-color:#f5f5f5; font-weight:bold; text-align:left;
          vertical-align:top;">
        ${escapeHtml(label)}
      </th>
      <td align="left" valign="top"
        style="padding:12px; border:1px solid #dddddd;
          text-align:left; vertical-align:top; overflow-wrap:anywhere;
          word-wrap:break-word; word-break:break-word;">
        ${escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>")}
      </td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>New Appointment Request</title>
</head>
<body style="margin:0; padding:16px; background-color:#ffffff;
  font-family:Arial,Helvetica,sans-serif; color:#222222;">
  <div style="width:100%; max-width:640px; margin:0 auto;">
    <h2 style="margin:0 0 12px; font-size:22px; line-height:1.4;">
      New Appointment Request
    </h2>

    <p style="margin:0 0 20px; font-size:14px; line-height:1.6;">
      A customer has submitted an appointment request through
      the US &amp; LV website.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="width:100%; border-collapse:collapse; table-layout:fixed;
        font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6;">
      <tbody>${rows}</tbody>
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

// Customer email: green header and white card, matching Photo 1.
function createCustomerHtml({ name, service, phone, timestamp }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>We received your appointment request</title>
</head>

<body style="margin:0; padding:0; background-color:#f4f6f8;
  font-family:Arial,Helvetica,sans-serif; color:#243042;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    border="0" bgcolor="#f4f6f8"
    style="width:100%; background-color:#f4f6f8;">

    <tr>
      <td align="center" style="padding:24px 12px;">

        <table role="presentation" width="640" cellpadding="0" cellspacing="0"
          border="0" style="width:100%; max-width:640px;">

          <tr>
            <td align="center" bgcolor="#0f3d3e"
              style="padding:26px 20px; background-color:#0f3d3e;
                border-radius:8px 8px 0 0; color:#ffffff;">

              <h1 style="margin:0; font-family:Arial,Helvetica,sans-serif;
                font-size:23px; line-height:1.4; font-weight:bold;
                color:#ffffff;">
                We received your appointment request
              </h1>

            </td>
          </tr>

          <tr>
            <td align="left" bgcolor="#ffffff"
              style="padding:30px 24px; background-color:#ffffff;
                border:1px solid #e2e8f0; border-top:0;
                border-radius:0 0 8px 8px;
                font-family:Arial,Helvetica,sans-serif;
                font-size:16px; line-height:1.65; color:#243042;
                overflow-wrap:anywhere; word-wrap:break-word;">

              <p style="margin:0 0 20px;">
                Dear ${escapeHtml(name)},
              </p>

              <p style="margin:0 0 22px;">
                Thank you for booking with
                <strong>US &amp; LV India (OPC) Pvt Ltd.</strong>
                We have received your request for
                <strong>${escapeHtml(service)}</strong>
                and will contact you shortly on
                <a href="tel:${escapeHtml(phone)}"
                  style="color:#1765c1; font-weight:bold;
                    text-decoration:underline;">${escapeHtml(phone)}</a>
                to confirm your session.
              </p>

              <p style="margin:0 0 6px; font-weight:bold;">
                Your details
              </p>

              <p style="margin:0 0 24px;">
                <strong>Service:</strong> ${escapeHtml(service)}<br>

                <strong>Phone:</strong>
                <a href="tel:${escapeHtml(phone)}"
                  style="color:#1765c1;
                    text-decoration:underline;">${escapeHtml(phone)}</a><br>

                <strong>Requested on:</strong> ${escapeHtml(timestamp)} IST
              </p>

              <p style="margin:0 0 24px;">
                For anything urgent, call us on
                <a href="tel:+919380376767"
                  style="color:#9b742c;
                    text-decoration:underline;">+91 93803 76767</a>
                (Monday to Saturday, 9:00 AM to 6:00 PM).
              </p>

              <p style="margin:0 0 24px; font-size:14px; color:#536174;">
                This email acknowledges your request. Our team will confirm
                your appointment date and time separately.
              </p>

              <p style="margin:0;">
                Warm regards,<br>
                <strong>US &amp; LV India</strong><br>
                <em>The Growth Transformers</em>
              </p>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      message: "Use POST to submit an appointment."
    });
  }

  if (!EMAIL_USER || !EMAIL_PASS || !OWNER_EMAIL) {
    console.error("Missing email environment variables.");

    return res.status(500).json({
      success: false,
      message: "Email service is not configured."
    });
  }

  const body = req.body ?? {};

  const name = clean(body.name);
  const rawPhone = clean(body.phone).replace(/[\s-]/g, "");
  const digits = rawPhone.replace(/^(\+91|0)/, "");
  const email = clean(body.email).toLowerCase();
  const ageText = clean(body.age);
  const age = ageText ? Number(ageText) : null;
  const service = clean(body.service);
  const message = String(body.message ?? "").trim();

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({
      success: false,
      message: "Please enter your full name."
    });
  }

  if (!/^[6-9]\d{9}$/.test(digits)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid Indian mobile number."
    });
  }

  if (!email || email.length > 254 || !validEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid email address."
    });
  }

  if (!SERVICES.includes(service)) {
    return res.status(400).json({
      success: false,
      message: "Please select a valid service."
    });
  }

  if (
    ageText &&
    (!Number.isInteger(age) || age < 1 || age > 120)
  ) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid age."
    });
  }

  if (message.length > 1000) {
    return res.status(400).json({
      success: false,
      message: "Your message is too long."
    });
  }

  const phone = `+91${digits}`;

  const timestamp = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });

  const bookingDetails = [
    ["Name", name],
    ["Phone", phone],
    ["Email", email],
    ["Age", age ?? "Not provided"],
    ["Service", service],
    ["Message", message || "None"],
    ["Request received", `${timestamp} IST`]
  ];

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  try {
    // EMAIL 1: Owner receives the booking table.
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
        `Booking time: ${timestamp} IST`
      ].join("\n"),

      html: createBookingHtml(bookingDetails)
    });

    console.log("Owner notification email sent.");

    let customerEmailSent = false;

    try {
      // EMAIL 2: Customer receives the styled email.
      await transporter.sendMail({
        from: `"US & LV Website" <${EMAIL_USER}>`,
        to: email,
        replyTo: OWNER_EMAIL,
        subject: "We received your appointment request",

        text: [
          `Dear ${name},`,
          "",
          "Thank you for booking with US & LV India (OPC) Pvt Ltd.",
          `We have received your request for ${service} and will contact you shortly on ${phone} to confirm your session.`,
          "",
          "Your details",
          `Service: ${service}`,
          `Phone: ${phone}`,
          `Requested on: ${timestamp} IST`,
          "",
          "For anything urgent, call us on +91 93803 76767 (Monday to Saturday, 9:00 AM to 6:00 PM).",
          "",
          "This email acknowledges your request. Our team will confirm your appointment date and time separately.",
          "",
          "Warm regards,",
          "US & LV India",
          "The Growth Transformers"
        ].join("\n"),

        html: createCustomerHtml({
          name,
          service,
          phone,
          timestamp
        })
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

    // Keep the booking successful if only the customer email fails.
    return res.status(200).json({
      success: true,
      customerEmailSent,
      message: customerEmailSent
        ? "Appointment received. Confirmation email sent to the client."
        : "Appointment received, but the client confirmation email could not be sent."
    });
  } catch (error) {
    console.error(
      "Appointment email failed:",
      error?.code || "",
      error?.message || "Unknown email error"
    );

    return res.status(502).json({
      success: false,
      message: "We could not send your appointment request. Please try again."
    });
  }
}