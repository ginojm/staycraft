import { z } from 'zod'

const types = { pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', txt:'text/plain', csv:'text/csv', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip:'application/zip' }
export const attachmentsSchema = z.array(z.object({ name:z.string().trim().min(1).max(180), base64:z.string().max(6990508).regex(/^[A-Za-z0-9+/]+={0,2}$/) })).max(5).default([])
export function prepareAttachments(files) {
  let total=0
  return files.map((file) => {
    const ext=file.name.split('.').at(-1).toLowerCase()
    const mime=types[ext]
    const data=Buffer.from(file.base64,'base64')
    if (!mime || !data.length || data.length>5*1024*1024 || data.toString('base64')!==file.base64) throw new Error('Format non pris en charge ou fichier supérieur à 5 Mo.')
    total+=data.length
    if (total>10*1024*1024) throw new Error('Les pièces jointes ne doivent pas dépasser 10 Mo au total.')
    const valid = ext==='pdf' ? data.subarray(0,5).toString()==='%PDF-' : ['jpg','jpeg'].includes(ext) ? data[0]===255 && data[1]===216 && data[2]===255 : ext==='png' ? data.subarray(0,8).toString('hex')==='89504e470d0a1a0a' : ext==='webp' ? data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP' : ['zip','docx','xlsx'].includes(ext) ? data.subarray(0,2).toString()==='PK' : !data.includes(0)
    if (!valid) throw new Error('Le contenu du fichier ne correspond pas à son format.')
    return { name:file.name.replace(/[\\/\r\n]/g,'_'), mime, size:data.length, base64:file.base64 }
  })
}
