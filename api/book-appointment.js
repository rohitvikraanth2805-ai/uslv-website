
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "Use POST to submit an appointment.",
    });
  }

  if (!EMAIL_USER || !EMAIL_PASS || !OWNER_EMAIL) {
    console.error("Missing email environment variables.");
    return res.status(500).json({
      success: false,
      message: "Email service is not configured.",
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
      message: "Please enter your full name.",
    });
  }

  if (!/^[6-9]\d{9}$/.test(digits)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid Indian mobile number.",
    });
  }

  if (email && !validEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid email address.",
    });
  }

  if (!SERVICES.includes(service)) {
    return res.status(400).json({
      success: false,
      message: "Please select a valid service.",
    });
  }

  if (
    ageText &&
    (!Number.isInteger(age) || age < 1 || age > 120)
  ) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid age.",
    });
  }

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
    await transporter.sendMail({
      from: `"US & LV Website" <${EMAIL_USER}>`,
      to: OWNER_EMAIL,
      replyTo: email || undefined,
      subject: `New Booking: ${name} (${service})`.slice(0, 150),
      text: [
        "NEW APPOINTMENT REQUEST",
        "",
        `Name: ${name}`,
        `Phone: ${phone}`,
        `Email: ${email || "Not provided"}`,
        `Age: ${age ?? "Not provided"}`,
        `Service: ${service}`,
        `Message: ${message || "None"}`,
        `Booking time: ${timestamp} IST`,
      ].join("\n"),
    });

    console.log("Appointment notification email sent.");

    return res.status(200).json({
      success: true,
      message: "Your appointment request has been received successfully.",
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
