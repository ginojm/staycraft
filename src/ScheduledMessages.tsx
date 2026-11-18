import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiRequest } from './api'
import DOMPurify from 'dompurify'
import { photoUrl } from './data'
import Attachments, { attachmentAccept, readAttachments, type Attachment } from './Attachments'

type Template = { id: string; name: string; body: string; event: string; hours_before: number; enabled: boolean; sent_count: number; listing_ids: string[]; attachments: Attachment[] }
type Listing = { id: string; title: string; image: string }
type Booking = { id: string; listing_id: string; title: string; full_name: string; check_in: string }
const events: Record<string,string> = { manual: 'Manuel uniquement', confirmed: 'Réservation confirmée', arrival: 'Avant l’arrivée', departure: 'Avant le départ' }

function ListingSelection({ listings, selected = [] }: { listings: Listing[]; selected?: string[] }) {
  const list = <ul className="scheduled-listing-list">{listings.map((l) => <li key={l.id}><label><input type="checkbox" name="listingIds" value={l.id} defaultChecked={selected.includes(l.id)} /><img src={photoUrl(l.image, 160)} alt="" loading="lazy" /><span title={l.title}>{l.title}</span></label></li>)}</ul>
  return listings.length > 1 ? <details className="scheduled-listing-dropdown"><summary>Choisir les logements <span>{listings.length} disponibles</span></summary>{list}</details> : list
}

export default function ScheduledMessages({ token }: { token: string }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [event, setEvent] = useState('manual')
  const [editing, setEditing] = useState<Template | null>(null)
  const editorRef = useRef<HTMLFormElement>(null)
  const [reservationId, setReservationId] = useState('')
  const load = async () => {
    const data = await apiRequest<{ templates: Template[]; bookings: Booking[]; listings: Listing[] }>('/admin/scheduled-messages', token)
    setTemplates(data.templates); setBookings(data.bookings); setListings(data.listings)
  }
  useEffect(() => { void load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)) }, [token])
  const action = async (operation: () => Promise<void>, success: string) => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await operation(); await load(); setNotice(success) } catch (e) { setError(e instanceof Error ? e.message : 'Opération impossible.') } finally { setBusy(false) }
  }
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    void action(async () => {
      const attachments=await readAttachments((data.getAll('attachments') as File[]).filter((f)=>f.size>0))
      if (!data.getAll('listingIds').length) throw new Error('Sélectionnez au moins un logement.')
      await apiRequest(editing ? `/admin/scheduled-messages/${editing.id}` : '/admin/scheduled-messages', token, { method:editing ? 'PATCH' : 'POST', body:JSON.stringify({ name:data.get('name'), body:data.get('body'), event, hours_before:Number(data.get('hours') ?? 24), enabled:data.get('enabled') === 'on', listingIds:data.getAll('listingIds'), attachments }) })
      form.reset(); setEvent('manual'); setEditing(null)
    }, editing ? 'Modèle modifié. Les messages déjà envoyés sont conservés.' : 'Modèle créé.')
  }
  return <section className="settings-section"><div className="settings-section-heading"><div><h2>Messages programmés</h2><p>Personnalisez vos échanges et automatisez les étapes du séjour.</p></div></div>
    {error && <p className="wizard-error" role="alert">{error}</p>}{notice && <p role="status" className="manage-notice">{notice}</p>}
    <form ref={editorRef} key={editing?.id ?? 'new'} className="dialog-form" onSubmit={create}><fieldset disabled={busy || loading} className="scheduled-fields"><legend>{editing ? 'Modifier le modèle' : 'Créer un modèle'}</legend>
      <label>Nom du modèle<input name="name" defaultValue={editing?.name ?? ''} required maxLength={120} placeholder="Bienvenue et instructions d’arrivée" /></label>
      <fieldset className="scheduled-listing-selection"><legend>Logements concernés (un ou plusieurs)</legend><ListingSelection listings={listings} selected={editing?.listing_ids} />{!listings.length && <p>Aucun logement disponible.</p>}</fieldset>
      <label>Message HTML<textarea name="body" defaultValue={editing?.body ?? ''} required rows={5} maxLength={editing ? 5000 : 4000} placeholder="<p>Bonjour {{voyageur}}, bienvenue à <strong>{{logement}}</strong> !</p>" /></label>
      <small>Tous les messages sont envoyés en HTML. Le texte simple est converti automatiquement en conservant les retours à la ligne.</small>
      {!editing && <label>Pièces jointes<input type="file" name="attachments" multiple accept={attachmentAccept} /><small>Images, PDF, TXT, CSV, Word, Excel et ZIP. Maximum 5 fichiers, 5 Mo par fichier et 10 Mo au total.</small></label>}
      {editing && <p>Les pièces jointes existantes sont conservées ; vous pouvez les gérer sous le modèle.</p>}
      <p>Variables : {'{{voyageur}}'}, {'{{logement}}'}, {'{{adresse}}'}, {'{{reseau}}'}, {'{{motdepasse}}'}, {'{{arrivee}}'}, {'{{depart}}'}. Renseignez l’adresse et les informations Wi-Fi dans « Gérer les annonces ».</p>
      <label>Déclencheur<select value={event} onChange={(e) => setEvent(e.target.value)}>{Object.entries(events).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      {(event === 'arrival' || event === 'departure') && <label>Nombre d’heures avant la date<input name="hours" type="number" min={0} max={720} defaultValue={editing?.hours_before ?? 24} required /><small>Dates à minuit, heure de Martinique. À 0 heure, l’envoi intervient à la date prévue.</small></label>}
      {event !== 'manual' && <label><span><input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? false} /> Activer l’envoi automatique</span></label>}
      <button className="button-dark">{editing ? 'Enregistrer les modifications' : 'Créer le modèle'}</button>
      {editing && <button type="button" className="text-button" onClick={()=>{setEditing(null);setEvent('manual')}}>Annuler</button>}
    </fieldset></form>
    <p>Un seul envoi par modèle et réservation. La confirmation s’applique aux nouvelles réservations créées après le modèle. Les envois automatiques nécessitent que le serveur soit démarré.</p>
    <label className="dialog-form">Réservation pour l’envoi manuel<select aria-label="Réservation pour l’envoi manuel" value={reservationId} onChange={(e) => setReservationId(e.target.value)}><option value="">Choisir une réservation confirmée</option>{bookings.map((b) => <option key={b.id} value={b.id}>{b.full_name} · {b.title} · {new Date(b.check_in).toLocaleDateString('fr-FR', {timeZone:'UTC'})}</option>)}</select></label>
    {loading ? <p role="status">Chargement des modèles…</p> : templates.length === 0 ? <p>Aucun modèle pour le moment.</p> : templates.map((t) => <article className="scheduled-template" key={t.id}><h3>{t.name}</h3><p>{events[t.event]}{['arrival','departure'].includes(t.event) ? ` · ${t.hours_before} h avant` : ''} · {t.enabled ? 'Automatique actif' : 'Automatique inactif'} · {t.sent_count} envoi(s)</p><div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t.body) }} /><div className="manage-actions">
      <button disabled={busy || !t.listing_ids.includes(bookings.find((b) => b.id === reservationId)?.listing_id ?? '')} title="La réservation doit concerner un logement associé au modèle" onClick={() => { if (window.confirm('Envoyer ce message au voyageur de la réservation sélectionnée ?')) void action(async () => { await apiRequest(`/admin/scheduled-messages/${t.id}/send`, token, {method:'POST', body:JSON.stringify({reservationId})}) }, 'Message envoyé dans la discussion.') }}>Envoyer maintenant</button>
      <button disabled={busy} onClick={()=>{setEditing(t);setEvent(t.event);setError('');setNotice('');editorRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}}>Modifier</button>
      {t.event !== 'manual' && <button disabled={busy} onClick={() => void action(async () => { await apiRequest(`/admin/scheduled-messages/${t.id}`, token, {method:'PATCH',body:JSON.stringify({enabled:!t.enabled})}) }, 'Programmation mise à jour.')}>{t.enabled ? 'Désactiver' : 'Activer'}</button>}
      <button disabled={busy} onClick={() => { if (window.confirm('Supprimer ce modèle et arrêter sa programmation ?')) void action(async () => { await apiRequest(`/admin/scheduled-messages/${t.id}`, token, {method:'DELETE'}) }, 'Modèle supprimé.') }}>Supprimer</button>
      <Attachments files={t.attachments ?? []} token={token} />
      {(t.attachments ?? []).map((a)=><button type="button" disabled={busy} key={a.id} onClick={()=>void action(async()=>{await apiRequest(`/admin/scheduled-messages/${t.id}/attachments/${a.id}`,token,{method:'DELETE'})},'Pièce jointe retirée du modèle.')}>Retirer {a.name}</button>)}
      <label>Ajouter des pièces jointes<input type="file" multiple accept={attachmentAccept} disabled={busy} onChange={(e)=>{const input=e.currentTarget;const files=Array.from(input.files??[]);if(files.length) void action(async()=>{await apiRequest(`/admin/scheduled-messages/${t.id}/attachments`,token,{method:'POST',body:JSON.stringify({attachments:await readAttachments(files)})});input.value=''},'Pièces jointes ajoutées.')}} /></label>
    </div><form key={t.listing_ids.join(',')} onSubmit={(e) => { e.preventDefault(); const ids = new FormData(e.currentTarget).getAll('listingIds'); void action(async () => { if (!ids.length) throw new Error('Sélectionnez au moins un logement.'); await apiRequest(`/admin/scheduled-messages/${t.id}`, token, { method:'PATCH', body:JSON.stringify({listingIds:ids}) }) }, 'Logements associés mis à jour.') }}><fieldset disabled={busy} className="scheduled-listing-selection"><legend>Logements associés</legend><ListingSelection listings={listings} selected={t.listing_ids} /><button className="settings-status-button" type="submit">Enregistrer les logements</button></fieldset></form></article>)}
  </section>
}
