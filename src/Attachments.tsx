import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileText, Image as ImageIcon, X } from 'lucide-react'
export type Attachment = { id:string; name:string; mime:string; size:number }
export const attachmentAccept='.jpg,.jpeg,.png,.webp,.pdf,.txt,.csv,.docx,.xlsx,.zip'
export async function readAttachments(files:File[]) {
  if(files.length>5 || files.some((f)=>f.size>5242880) || files.reduce((sum,f)=>sum+f.size,0)>10485760) throw new Error('Maximum 5 fichiers, 5 Mo par fichier et 10 Mo au total.')
  return Promise.all(files.map((file)=>new Promise<{name:string;base64:string}>((resolve,reject)=>{
    const reader=new FileReader()
    reader.onerror=()=>reject(new Error('Lecture du fichier impossible.'))
    reader.onload=()=>resolve({name:file.name,base64:String(reader.result).split(',')[1]})
    reader.readAsDataURL(file)
  })))
}
function AttachmentCard({file,token}:{file:Attachment;token:string}) {
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [preview,setPreview]=useState('')
  const [loading,setLoading]=useState(false)
  const [open,setOpen]=useState(false)
  const dialogRef=useRef<HTMLDialogElement>(null)
  useEffect(()=>{
    const dialog=dialogRef.current
    if(open&&!dialog?.open) dialog?.showModal()
    if(!open&&dialog?.open) dialog.close()
  },[open])
  const image=['image/jpeg','image/png','image/webp'].includes(file.mime)
  const pdf=file.mime==='application/pdf'
  useEffect(()=>{
    if(!image&&!pdf) return
    const controller=new AbortController()
    let objectUrl=''
    setPreview('');setError('');setLoading(true)
    void fetch(`/api/attachments/${file.id}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal})
      .then(async(response)=>{
        if(!response.ok) throw new Error('Aperçu indisponible.')
        const blob=await response.blob()
        if(controller.signal.aborted) return
        objectUrl=URL.createObjectURL(new Blob([blob],{type:file.mime}));setPreview(objectUrl)
      }).catch((e:Error)=>{if(!controller.signal.aborted)setError(e.message)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[file.id,file.mime,image,pdf,token])
  const download=async()=>{
    setBusy(true);setError('')
    try {
      const response=await fetch(`/api/attachments/${file.id}`,{headers:{Authorization:`Bearer ${token}`}})
      if(!response.ok) throw new Error('Téléchargement impossible.')
      const url=URL.createObjectURL(await response.blob())
      const link=document.createElement('a');link.href=url;link.download=file.name;link.click()
      setTimeout(()=>URL.revokeObjectURL(url),30000)
    }catch(e){setError(e instanceof Error?e.message:'Erreur de téléchargement.')}finally{setBusy(false)}
  }
  return <article className="attachment-card"><button type="button" className="attachment-preview attachment-preview-trigger" aria-label={`Ouvrir l’aperçu de ${file.name}`} aria-haspopup="dialog" onClick={()=>setOpen(true)}>
    {preview&&image?<img src={preview} alt="" onError={()=>{setPreview('');setError('Aperçu indisponible.')}} />:preview&&pdf?<iframe tabIndex={-1} aria-hidden="true" src={`${preview}#toolbar=0&navpanes=0&view=FitH`} title={`Vignette de ${file.name}`} />:<span className="attachment-placeholder">{image?<ImageIcon size={36}/>:<FileText size={36}/>}<span>{loading?'Chargement…':file.name.split('.').at(-1)?.toUpperCase()}</span></span>}
    </button><div className="attachment-caption"><strong title={file.name}>{file.name}</strong><span>{Math.ceil(file.size/1024)} Ko</span><button type="button" disabled={busy} onClick={()=>void download()} aria-label={`Télécharger ${file.name}`}><Download size={15}/> {busy?'Téléchargement…':'Télécharger'}</button>{error&&<p role="status">{error}</p>}</div>
    {createPortal(<dialog ref={dialogRef} className="attachment-preview-modal" aria-label={`Aperçu de ${file.name}`} onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} onClick={(e)=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="attachment-preview-panel"><header><h2>{file.name}</h2><button type="button" onClick={()=>setOpen(false)} aria-label="Fermer l’aperçu" autoFocus><X size={22}/></button></header><div className="attachment-preview-content">{open&&(preview&&image?<img src={preview} alt={file.name}/>:preview&&pdf?<iframe src={`${preview}#view=FitH`} title={`Document ${file.name}`}/>:<div className="attachment-placeholder"><FileText size={48}/><p>{loading?'Chargement de l’aperçu…':'Aperçu indisponible pour ce fichier. Vous pouvez le télécharger.'}</p></div>)}</div><footer>{error&&<p role="status">{error}</p>}<button type="button" className="button-dark" disabled={busy} onClick={()=>void download()}><Download size={16}/> Télécharger</button></footer></section></dialog>,document.body)}
    </article>
}

export default function Attachments({files,token}:{files:Attachment[];token:string}) {
  return files.length?<div className="attachment-list">{files.map((file)=><AttachmentCard file={file} token={token} key={file.id}/>)}</div>:null
}
