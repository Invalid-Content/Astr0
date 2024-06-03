const nodemailer = require('nodemailer');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed',
        };
    }

    const { name, email, message } = JSON.parse(event.body);

    // Configure your SMTP server credentials
    const transporter = nodemailer.createTransport({
        host: 'smtp.example.com',
        port: 587,
        auth: {
            user: 'your-email@example.com',
            pass: 'your-email-password',
        },
    });

    const mailOptions = {
        from: email,
        to: 'your-email@example.com',
        subject: 'New Form Submission',
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
    };

    try {
        await transporter.sendMail(mailOptions);
        return {
            statusCode: 200,
            body: 'Email successfully sent!',
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: `Email sending failed: ${error.message}`,
        };
    }
};