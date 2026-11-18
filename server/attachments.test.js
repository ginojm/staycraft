import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentsSchema, prepareAttachments } from './attachments.js'

test('accepts a PDF and preserves its bytes',()=>{
  const base64=Buffer.from('%PDF-1.4\nexample').toString('base64')
  const [file]=prepareAttachments([{name:'guide.pdf',base64}])
  assert.equal(file.mime,'application/pdf')
  assert.equal(file.base64,base64)
})
test('rejects disguised executables and invalid base64',()=>{
  assert.throws(()=>prepareAttachments([{name:'guide.pdf',base64:Buffer.from('MZ executable').toString('base64')}]))
  assert.throws(()=>prepareAttachments([{name:'script.html',base64:Buffer.from('<script>').toString('base64')}]))
  assert.equal(attachmentsSchema.safeParse([{name:'guide.pdf',base64:'!!!!'}]).success,false)
})
test('enforces file count and size limits',()=>{
  assert.equal(attachmentsSchema.safeParse(Array.from({length:6},()=>({name:'x.txt',base64:'YQ=='}))).success,false)
  assert.throws(()=>prepareAttachments([{name:'large.txt',base64:Buffer.alloc(5242881,65).toString('base64')}]))
})
