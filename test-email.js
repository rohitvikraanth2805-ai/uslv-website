import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendTest() {
    try {
        console.log("Sending test email using pass:", process.env.EMAIL_PASS);
        const info = await transporter.sendMail({
            from: `"US & LV Website" <${process.env.EMAIL_USER}>`,
            to: process.env.OWNER_EMAIL,
            subject: `🚨 DIRECT TEST: Booking Received`,
            text: `This is a direct test email sent at ${new Date().toLocaleString()}. If you see this, instant booking emails are working!`
        });
        console.log("✅ SUCCESS! Message ID:", info.messageId);
    } catch (err) {
        console.error("❌ FAILED TO SEND EMAIL:", err.message);
    }
}

sendTest();