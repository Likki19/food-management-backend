require('dotenv').config();
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const transporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
    }
});

async function sendEmail(to, subject, text) {
    const msg = {
        to,
        from: 'badisalikithasri@gmail.com', // Your verified SendGrid sender email
        subject,
        text,
    };

    try {
        await sgMail.send(msg);
        console.log('Email sent successfully to:', to);
        return true;
    } catch (error) {
        console.error('SendGrid Error:', error);
        
        // Fallback to SMTP
        try {
            await transporter.sendMail({
                from: 'badisalikithasri@gmail.com',
                to,
                subject,
                text
            });
            console.log('Email sent successfully via SMTP to:', to);
            return true;
        } catch (smtpError) {
            console.error('SMTP Error:', smtpError);
            return false;
        }
    }
}

async function sendSMS(to, message) {
    // Placeholder for SMS functionality
    console.log(`SMS would be sent to ${to}: ${message}`);
    return true;
}

async function testEmail() {
    try {
        await sendEmail(
            'ashrith6974@gmail.com',
            'Test Email',
            'This is a test email from your food donation platform.'
        );
        console.log('Test email sent successfully');
    } catch (error) {
        console.error('Test email failed:', error);
    }
}

module.exports = { sendEmail, sendSMS, testEmail };