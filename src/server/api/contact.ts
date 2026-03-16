/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Request, type Response } from 'express';
import nodemailer from 'nodemailer';

export async function handleContactSubmission(req: Request, res: Response) {
  try {
    const { name, email, organization, inquiryType, message } = req.body;

    if (!email || !message) {
      return res.status(400).json({ error: 'Email and message are required' });
    }

    // Configure transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'eyalatiyawork@gmail.com',
        // In a real app, this would be an App Password or OAuth2
        // Since I don't have the user's password, I'll document that this needs an ENV variable.
        pass: process.env.EMAIL_PASS, 
      },
    });

    const mailOptions = {
      from: 'eyalatiyawork@gmail.com',
      to: 'eyalatiyawork@gmail.com',
      subject: `New Contact Submission: ${inquiryType} from ${name}`,
      text: `
        Name: ${name}
        Email: ${email}
        Organization: ${organization}
        Inquiry Type: ${inquiryType}
        
        Message:
        ${message}
      `,
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({ success: true, message: 'Message sent successfully' });
  } catch (error: any) {
    console.error('Contact API error:', error);
    return res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
}
