import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scheduledMessageHtml } from './message-html.js'

const clean = (s) => s.replace(/<\/?div>/g, '')
test('converts plain text and preserves line breaks', () => {
  assert.equal(scheduledMessageHtml('Bonjour\nA & B', clean), '<div>Bonjour<br>A &amp; B</div>')
})
test('preserves HTML and template variables', () => {
  assert.equal(scheduledMessageHtml('<p>Bonjour <strong>{{voyageur}}</strong></p>', clean), '<div><p>Bonjour <strong>{{voyageur}}</strong></p></div>')
})
test('rejects empty HTML and normalizes existing wrappers', () => {
  assert.equal(scheduledMessageHtml('<p>&nbsp;</p>', clean), '')
  assert.equal(scheduledMessageHtml('<div>Bonjour</div>', clean), '<div>Bonjour</div>')
})
