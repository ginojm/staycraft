// Plain text is escaped before conversion; existing HTML is cleaned by the caller.
export function scheduledMessageHtml(value, sanitize) {
  const source = String(value ?? '').trim()
  const isHtml = /<\/?[a-z][^>]*>/i.test(source)
  const input = isHtml ? source : source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')
  const clean = sanitize(input).trim()
  if (!clean.replace(/<[^>]*>/g, '').replace(/&(nbsp|#160|#x0*a0);/gi, ' ').trim()) return ''
  return `<div>${clean}</div>`
}
