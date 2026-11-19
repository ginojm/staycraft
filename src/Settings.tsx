import { useEffect, useState } from 'react'
import { ArrowRight, Database, Home, RefreshCw, Users } from 'lucide-react'
import { apiRequest } from './api'
import ScheduledMessages from './ScheduledMessages'
import Payouts from './Payouts'
import { photoUrl, type Stay } from './data'

type ManagedStay = Stay & { status: string }
type ProjectUser = { id: string; name: string; email: string; avatarUrl: string; createdAt: string; listingCount: number; active: boolean }

export default function Settings({ token, onClose, onManageListings }: { token: string; onClose: () => void; onManageListings: () => void }) {
  const [users, setUsers] = useState<ProjectUser[]>([])
  const [listings, setListings] = useState<ManagedStay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState<'messages' | 'payouts' | 'admin' | 'listings'>('messages')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [userData, listingData] = await Promise.all([
        apiRequest<{ users: ProjectUser[] }>('/admin/users', token),
        apiRequest<{ listings: ManagedStay[] }>('/admin/listings', token),
      ])
      setUsers(userData.users); setListings(listingData.listings)
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de charger les paramètres.') } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [token])

  const toggleUser = async (user: ProjectUser) => {
    try {
      await apiRequest(`/admin/users/${user.id}/status`, token, { method: 'PATCH', body: JSON.stringify({ active: !user.active }) })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de modifier le statut du compte.') }
  }

  return <div className="listing-wizard">
    <header className="listing-wizard-header"><span className="listing-wizard-brand"><Database size={25} /> Paramètres</span><button className="wizard-exit" onClick={onClose}>Retour au site</button></header>
    <main className="settings-main settings-workspace">
      <nav className="messaging-settings-menu settings-sidebar" aria-label="Rubriques des paramètres">
        <ul className="settings-navigation-list">
          <li><button aria-current={page === 'messages' ? 'page' : undefined} onClick={() => setPage('messages')}>Messages programmés</button></li>
          <li><button aria-current={page === 'payouts' ? 'page' : undefined} onClick={() => setPage('payouts')}>Versements</button></li>
          <li><button aria-current={page === 'admin' ? 'page' : undefined} onClick={() => setPage('admin')}>Administration</button></li>
          <li><button aria-current={page === 'listings' ? 'page' : undefined} onClick={() => setPage('listings')}>Logements</button></li>
        </ul>
      </nav>
      <div className="settings-page-content">
      {page === 'messages' && <ScheduledMessages token={token} />}
      {page === 'payouts' && <Payouts token={token} />}
      {(page === 'admin' || page === 'listings') && <>
      <div className="settings-heading"><div><p className="settings-kicker">ADMINISTRATION DU PROJET</p><h1>{page === 'admin' ? 'Administration' : 'Logements'}</h1><p>{page === 'admin' ? 'Gérez les utilisateurs de votre projet.' : 'Consultez les logements, leurs hôtes et leur statut.'}</p></div><button className="settings-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Actualiser</button></div>
      {error && <p className="wizard-error" role="alert">{error}</p>}
      {loading ? <p role="status">Chargement des données…</p> : <>
        {page === 'admin' ? <section className="settings-stats" aria-label="Résumé des utilisateurs"><article><Users size={20} /><div><strong>{users.length}</strong><span>Utilisateurs</span></div></article></section> : <section className="settings-stats" aria-label="Résumé des logements"><article><Home size={20} /><div><strong>{listings.length}</strong><span>Logements</span></div></article><article><Database size={20} /><div><strong>{listings.filter((listing) => listing.status === 'published').length}</strong><span>Annonces en ligne</span></div></article></section>}
        {page === 'admin' && <section className="settings-section"><div className="settings-section-heading"><div><h2>Utilisateurs</h2><p>Comptes enregistrés et statut d’accès.</p></div><span>{users.length} compte{users.length > 1 ? 's' : ''}</span></div><div className="settings-table-wrap"><table className="settings-table"><thead><tr><th>Utilisateur</th><th>E-mail</th><th>Statut</th><th>Action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><span className="settings-user"><span className="settings-user-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>Inscrit le {new Date(user.createdAt).toLocaleDateString('fr-FR')}</small></span></span></td><td>{user.email}</td><td><span className={`account-status ${user.active ? 'active' : 'inactive'}`}>{user.active ? 'Actif' : 'Désactivé'}</span></td><td><button className="settings-status-button" onClick={() => void toggleUser(user)}>{user.active ? 'Désactiver' : 'Activer'}</button></td></tr>)}</tbody></table></div></section>}
        {page === 'listings' && <section className="settings-section"><div className="settings-section-heading"><div><h2>Logements</h2><p>Vue synthétique des annonces et de leur hôte.</p></div><button className="button-dark" onClick={onManageListings}>Gérer les annonces <ArrowRight size={16} /></button></div><div className="settings-listings">{listings.map((listing) => <article key={listing.id}><img src={photoUrl(listing.image, 160)} alt="" /><div><strong>{listing.title}</strong><span>{listing.location}</span><small>Hôte : {listing.host}</small></div><em className={listing.status === 'published' ? 'is-published' : ''}>{listing.status === 'published' ? 'En ligne' : listing.status === 'paused' ? 'En pause' : 'Brouillon'}</em></article>)}</div></section>}
      </>}
      </>}
      </div>
    </main>
  </div>
}
