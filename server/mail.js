import nodemailer from 'nodemailer'

const smtpHost = process.env.SMTP_HOST
const smtpPort = Number(process.env.SMTP_PORT || 1025)
const smtpUser = process.env.SMTP_USER
const smtpPassword = process.env.SMTP_PASSWORD
const mailFrom = process.env.SMTP_FROM || 'Foyaltoloman <noreply@foyaltoloman.local>'
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character]))

const transporter = smtpHost
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === 'true',
      auth: smtpUser ? { user: smtpUser, pass: smtpPassword || '' } : undefined,
    })
  : null

export async function sendBookingConfirmation({ to, guestName, title, checkIn, checkOut, total }) {
  if (!transporter) {
    console.warn('SMTP is not configured; booking confirmation email was not sent.')
    return false
  }

  await transporter.sendMail({
    from: mailFrom,
    to,
    subject: `Votre réservation Foyaltoloman — ${title}`,
    text: `Bonjour ${guestName},\n\nVotre réservation pour « ${title} » est confirmée.\nDates : ${checkIn} au ${checkOut}\nTotal : ${total.toFixed(2)} €\n\nMerci de votre confiance,\nFoyaltoloman`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#24352d"><h1>Réservation confirmée</h1><p>Bonjour ${escapeHtml(guestName)},</p><p>Votre réservation pour <strong>${escapeHtml(title)}</strong> est confirmée.</p><p>Dates : <strong>${escapeHtml(checkIn)}</strong> au <strong>${escapeHtml(checkOut)}</strong><br>Total : <strong>${total.toFixed(2)} €</strong></p><p>Merci de votre confiance,<br>Foyaltoloman</p></div>`,
  })
  return true
}
