
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

const SERVICES = [
  "Career Counselling",
  "Financial Advisory",
  "Educational Advisory",
  "Corporate Training",
];

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
    // EMAIL 1: Send the booking details to you.
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
    });

    console.log("Owner notification email sent.");

    // EMAIL 2: Send a confirmation email to the client.
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

    // The owner's notification succeeded even if the second
    // email fails, so do not invite a duplicate booking submission.
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
