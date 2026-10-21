import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, phone, age, service, message } = req.body;

    const { data, error } = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'rohitvikraanth2805@gmail.com', // Must be your registered Resend email
      subject: `New Booking Request from ${name || 'Website'}`,
      html: `
        <h3>New Appointment Booking</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Age:</strong> ${age}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Message:</strong> ${message}</p>
      `
    });

    if (error) {
      return res.status(400).json({ error });
    }

    return res.status(200).json({ success: true, message: 'Booking confirmed!', data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send email' });
  }
}