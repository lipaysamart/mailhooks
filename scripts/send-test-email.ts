// ABOUTME: Test email sender for mailhooks verification
// ABOUTME: Sends emails to Gmail account monitored by mailhooks

import nodemailer from 'nodemailer'

const SMTP_USER = process.env.SMTP_USER || 'lipaysamart@163.com'
const SMTP_PASS = process.env.SMTP_PASS || ''
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.163.com'
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465')

const TO_EMAIL = process.env.TO_EMAIL || 'lipaysamart@gmail.com'

async function sendTestEmail() {
  if (!SMTP_PASS) {
    console.error('[EMAIL] SMTP_PASS environment variable is required')
    console.error('[EMAIL] Usage: SMTP_PASS=your_password bun run scripts/send-test-email.ts')
    process.exit(1)
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  })

  const testEmail = {
    from: SMTP_USER,
    to: TO_EMAIL,
    subject: `[MailHooks Test] ${new Date().toISOString()}`,
    text: `这是一封测试邮件，用于验证 MailHooks 功能。

发送时间: ${new Date().toLocaleString('zh-CN')}
发送者: ${SMTP_USER}
接收者: ${TO_EMAIL}

MailHooks 应该自动同步此邮件并发送 webhook 到 Dify。`,
    html: `
      <h2>MailHooks 测试邮件</h2>
      <p>这是一封测试邮件，用于验证 MailHooks 功能。</p>
      <ul>
        <li><strong>发送时间:</strong> ${new Date().toLocaleString('zh-CN')}</li>
        <li><strong>发送者:</strong> ${SMTP_USER}</li>
        <li><strong>接收者:</strong> ${TO_EMAIL}</li>
      </ul>
      <p>MailHooks 应该自动同步此邮件并发送 webhook 到 Dify。</p>
    `
  }

  console.log('[EMAIL] Sending test email...')
  console.log('[EMAIL] From:', testEmail.from)
  console.log('[EMAIL] To:', testEmail.to)
  console.log('[EMAIL] Subject:', testEmail.subject)

  try {
    const info = await transporter.sendMail(testEmail)
    console.log('[EMAIL] Message sent successfully!')
    console.log('[EMAIL] Message ID:', info.messageId)
    console.log('[EMAIL] Response:', info.response)
  } catch (error) {
    console.error('[EMAIL] Failed to send email:', error)
    throw error
  }
}

sendTestEmail().catch(err => {
  console.error('[EMAIL] Fatal error:', err)
  process.exit(1)
})