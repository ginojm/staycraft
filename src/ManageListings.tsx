import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Home, Pencil, Pause, Play, Trash2 } from 'lucide-react'
import { apiRequest } from './api'
import { photoUrl, type Stay } from './data'

type ManagedStay = Stay & { status: string }
type HostOption = { id: string; name: string; email: string }

export default function ManageListings({ token, onClose, onCreate }: { token: string; onClose: () => void; onCreate: () => void }) {
  const [listings, setListings] = useState<ManagedStay[]>([])
  const [hosts, setHosts] = useState<HostOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<ManagedStay | null>(null)
  const [search, setSearch] = useState('')
  const load = async () => { const data = await apiRequest<{ listings: ManagedStay[] }>('/admin/listings', token); setListings(data.listings) }
  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest<{ listings: ManagedStay[] }>('/admin/listings', token),
      apiRequest<{ hosts: HostOption[] }>('/admin/hosts', token),
    ]).then(([listingData, hostData]) => {
      if (!active) return
      setListings(listingData.listings)
      setHosts(hostData.hosts)
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Chargement impossible.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])
  const change = async (listing: ManagedStay, action: 'pause' | 'resume' | 'delete') => {
    if (busy) return
    if (action === 'delete' && !window.confirm(`Supprimer l’annonce « ${listing.title} » ? Elle sera retirée du catalogue ; les réservations et échanges existants seront conservés.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await apiRequest(`/admin/listings/${listing.id}`, token, action === 'delete' ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify({ status: action === 'pause' ? 'paused' : 'published' }) })
      await load()
      setNotice(action === 'delete' ? 'Annonce supprimée du catalogue.' : action === 'pause' ? 'Annonce mise en pause.' : 'Annonce remise en ligne.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Opération impossible.') } finally { setBusy(false) }
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing || busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setError(''); setNotice('')
    try {
      await apiRequest(`/admin/listings/${editing.id}`, token, { method: 'PATCH', body: JSON.stringify({ title: form.get('title'), location: form.get('location'), description: form.get('description'), category: form.get('category'), image: form.get('image'), price: Number(form.get('price')), hostId: form.get('hostId'), amenities: editing.amenities }) })
      await load(); setEditing(null); setNotice('Annonce modifiée avec succès.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.') } finally { setBusy(false) }
  }
  return <div className="listing-wizard">
    <header className="listing-wizard-header"><span className="listing-wizard-brand"><Home size={25} /> Gérer les annonces</span><button className="wizard-exit" disabled={busy} onClick={onClose}>Retour au site</button></header>
    <main className="manage-listings-main">
      {error && <p className="wizard-error" role="alert">{error}</p>}{notice && <p className="manage-notice" role="status">{notice}</p>}
      {editing ? <section className="wizard-panel manage-edit" key={editing.id}><h1>Modifier l’annonce</h1><form onSubmit={save}>
        <label>Nom du logement<input name="title" defaultValue={editing.title} minLength={3} maxLength={120} required /></label>
        <label>Ville et pays<input name="location" defaultValue={editing.location} maxLength={180} required /></label>
        <label>Catégorie<input name="category" defaultValue={editing.category} maxLength={80} required /></label>
        <label>Hôte<select name="hostId" defaultValue={editing.hostId} required><option value="" disabled>Choisir un hôte</option>{hosts.map((host) => <option key={host.id} value={host.id}>{host.name} · {host.email}</option>)}</select></label>
        <label>Prix par nuit (€)<input name="price" type="number" defaultValue={editing.price} min={1} max={100000} step="0.01" required /></label>
        <label>Photo de couverture (URL)<input name="image" type="url" defaultValue={photoUrl(editing.image)} required /></label>
        <label>Description<textarea name="description" defaultValue={editing.description} rows={6} minLength={10} maxLength={5000} required /></label>
        <div className="manage-actions"><button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(null); setError('') }}>Annuler</button><button className="button-dark" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les modifications'} <ArrowRight size={16} /></button></div>
      </form></section> : <>
        <div className="manage-toolbar"><div><h1>Toutes les annonces</h1><p>{listings.length} logement{listings.length > 1 ? 's' : ''} · Espace superhôte</p></div><button className="button-dark" onClick={onCreate}>Créer une annonce <ArrowRight size={16} /></button></div>
        <input className="manage-search" type="search" aria-label="Rechercher une annonce" placeholder="Rechercher un logement ou une ville…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? <p role="status">Chargement des annonces…</p> : <div className="manage-listings-grid">{listings.filter((item) => `${item.title} ${item.location}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))).map((listing) => <article className="manage-listing-card" key={listing.id}>
          <img src={photoUrl(listing.image, 600)} alt={listing.title} /><div className="manage-listing-copy"><span className={`manage-status ${listing.status === 'published' ? 'published' : ''}`}>{listing.status === 'published' ? 'En ligne' : listing.status === 'paused' ? 'En pause' : 'Brouillon'}</span><h2>{listing.title}</h2><p>{listing.location}</p><p>Hôte : {listing.host}</p><strong>{listing.price.toLocaleString('fr-FR')} € / nuit</strong><div className="manage-actions"><button disabled={busy} onClick={() => { setEditing(listing); setError(''); setNotice('') }}><Pencil size={15} /> Modifier</button><button disabled={busy} onClick={() => void change(listing, listing.status === 'published' ? 'pause' : 'resume')}>{listing.status === 'published' ? <Pause size={15} /> : <Play size={15} />}{listing.status === 'published' ? 'Mettre en pause' : 'Remettre en ligne'}</button><button className="manage-delete" disabled={busy} onClick={() => void change(listing, 'delete')}><Trash2 size={15} /> Supprimer</button></div></div>
        </article>)}</div>}{!loading && !listings.length && <p>Aucune annonce. Créez votre premier logement.</p>}
      </>}
    </main>
  </div>
}
