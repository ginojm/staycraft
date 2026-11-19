import { useEffect, useState } from 'react'
import { apiRequest } from './api'
import './payouts.css'
import { BarChart3, CalendarClock, CalendarCheck, FileText, ChevronLeft, ChevronRight, Plus, Upload, Download } from 'lucide-react'

type Payment = { listingId: string; date: string; amount: number; reference: string; note: string; status?: 'paid' | 'scheduled'; id?: string; title?: string }
type Listing = { id: string; title: string }
const money = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const empty = (): Payment => ({ listingId: '', date: new Date().toLocaleDateString('en-CA'), amount: 0, reference: '', note: '' })

function parseCsv(text: string): Payment[] {
  const source = text.replace(/^\uFEFF/, '')
  const separator = source.split(/\r?\n/)[0].includes(';') ? ';' : ','
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (!quoted && (c === separator || c === '\n')) { row.push(cell.trim()); cell = ''; if (c === '\n') { rows.push(row); row = [] } }
    else if (c !== '\r') cell += c
  }
  if (quoted) throw new Error('Guillemets non fermés dans le CSV.')
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row)
  const headers = rows.shift() ?? []
  const hasStatus = headers.join(';') === 'date;logement_id;montant;reference;note;statut'
  if (!hasStatus && headers.join(';') !== 'date;logement_id;montant;reference;note') throw new Error('Colonnes attendues : date;logement_id;montant;reference;note;statut')
  const result = rows.filter((r) => r.some(Boolean)).map((r, i) => {
    const amount = Number(r[2]?.replace(',', '.'))
    if (r.length !== (hasStatus ? 6 : 5) || !/^\d{4}-\d{2}-\d{2}$/.test(r[0]) || !r[1] || !Number.isFinite(amount) || amount <= 0 || !r[3] || (hasStatus && !['paid', 'scheduled'].includes(r[5]))) throw new Error(`Ligne ${i + 2} invalide (statut : paid ou scheduled).`)
    return { date: r[0], listingId: r[1], amount, reference: r[3], note: r[4], status: (hasStatus ? r[5] : 'paid') as 'paid' | 'scheduled' }
  })
  if (!result.length || result.length > 1000) throw new Error('Le fichier doit contenir entre 1 et 1 000 paiements.')
  return result
}

export default function Payouts({ token }: { token: string }) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [draft, setDraft] = useState<Payment>(empty)
  const [preview, setPreview] = useState<Payment[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [section, setSection] = useState<'performance' | 'upcoming' | 'paid' | 'reports'>('performance')
  const [listingFilter, setListingFilter] = useState('')
  const [editor, setEditor] = useState<'create' | 'import' | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = async () => {
    const data = await apiRequest<{ payments: Payment[]; listings: Listing[] }>('/admin/payouts', token)
    setPayments(data.payments); setListings(data.listings)
  }
  useEffect(() => { void load().catch((e) => setError(e.message)).finally(() => setLoading(false)) }, [token])
  const save = async (entries: Payment[]) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await apiRequest('/admin/payouts', token, { method: 'POST', body: JSON.stringify({ payments: entries }) })
      setPreview([]); setDraft(empty()); await load(); setNotice(`${entries.length} paiement(s) enregistré(s).`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.') } finally { setBusy(false) }
  }
  const annual = payments.filter((p) => p.date.startsWith(`${year}-`) && (!listingFilter || p.listingId === listingFilter))
  const period = annual.filter((p) => !month || p.date.slice(5, 7) === month)
  const visible = period.filter((p) => section === 'paid' ? p.status !== 'scheduled' : section === 'upcoming' ? p.status === 'scheduled' : true)
  const totals = Array.from({ length: 12 }, (_, i) => annual.filter((p) => Number(p.date.slice(5, 7)) === i + 1).reduce((sum, p) => sum + p.amount, 0))
  const sum = (rows: Payment[]) => rows.reduce((s, p) => s + p.amount, 0)
  const paidTotal = sum(period.filter((p) => p.status !== 'scheduled'))
  const upcomingTotal = sum(period.filter((p) => p.status === 'scheduled'))
  const max = Math.max(1, ...totals)
  const monthName = (i: number, short = false) => new Date(year, i, 1).toLocaleDateString('fr-FR', { month: short ? 'short' : 'long' })
  const title = { performance: 'Performances', upcoming: 'À venir', paid: 'Montant payé', reports: 'Rapports' }[section]
  const report = '\uFEFFdate;logement_id;montant;reference;note;statut\n' + visible.map((p) => [p.date, p.listingId, p.amount.toFixed(2), p.reference, p.note, p.status === 'scheduled' ? 'À venir' : 'Payé'].map((v) => '"' + String(v).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"').join(';')).join('\n')
  return <div className="revenue-layout"><nav className="revenue-navigation" aria-label="Revenus"><h2>Revenus</h2>{([
    ['performance', 'Performances', BarChart3], ['upcoming', 'À venir', CalendarClock], ['paid', 'Montant payé', CalendarCheck], ['reports', 'Rapports', FileText],
  ] as const).map(([key, label, Icon]) => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}><Icon size={20} />{label}</button>)}</nav><div className="payouts-panel revenue-content"><header className="revenue-heading"><h2>{title}</h2><div><button onClick={() => setEditor(editor === 'create' ? null : 'create')}><Plus size={16} />Créer</button><button onClick={() => setEditor(editor === 'import' ? null : 'import')}><Upload size={16} />Importer</button></div></header>
    {error && <p role="alert" className="wizard-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="revenue-toolbar"><h3>Récapitulatif</h3><select aria-label="Période" value={month ? 'month' : 'year'} onChange={(e) => setMonth(e.target.value === 'year' ? '' : String(new Date().getMonth() + 1).padStart(2, '0'))}><option value="month">Vue mensuelle</option><option value="year">Vue annuelle</option></select><div className="revenue-year"><button aria-label="Année précédente" onClick={() => setYear(year - 1)}><ChevronLeft size={18} /></button><strong>{year}</strong><button aria-label="Année suivante" onClick={() => setYear(year + 1)}><ChevronRight size={18} /></button></div></div>
    <label className="revenue-property">Logement <select value={listingFilter} onChange={(e) => setListingFilter(e.target.value)}><option value="">Tous les logements</option>{listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
    {loading && <p role="status">Chargement des revenus…</p>}
    {section === 'performance' && <><div className="revenue-chart" aria-label={`Revenus mensuels ${year}`}><div className="revenue-chart-grid">{[1, .75, .5, .25, 0].map((ratio) => <div key={ratio}><span>{money(max * ratio)}</span></div>)}</div><div className="revenue-bars">{totals.map((total, i) => {
      const entries = annual.filter((p) => Number(p.date.slice(5, 7)) === i + 1)
      const upcoming = sum(entries.filter((p) => p.status === 'scheduled'))
      const paid = total - upcoming
      return <button key={i} className={month === String(i + 1).padStart(2, '0') ? 'selected' : ''} onClick={() => setMonth(String(i + 1).padStart(2, '0'))} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)} aria-label={`${monthName(i)} : payé ${money(paid)}, à venir ${money(upcoming)}`}><span className="revenue-bar-space"><span className="revenue-bar" style={{ height: `${total / max * 100}%` }}><span className="revenue-bar-upcoming" style={{ height: `${total ? upcoming / total * 100 : 0}%` }} /></span></span><span className="revenue-month">{monthName(i, true)}</span>{hovered === i && <span className={`revenue-tooltip ${i > 7 ? 'align-right' : ''}`}><strong>{monthName(i)} {year}</strong><span>Montant payé <b>{money(paid)}</b></span><span>À venir <b>{money(upcoming)}</b></span><span>Total (EUR) <b>{money(total)}</b></span></span>}</button>
    })}</div></div>{!annual.length && !loading && <p className="revenue-empty">Aucun revenu enregistré pour {year}. Créez ou importez vos premiers paiements.</p>}</>}
    <section className="revenue-period"><h3>{month ? `${monthName(Number(month) - 1)} ${year}` : `Année ${year}`}</h3><div className="revenue-metrics"><div><strong>{money(paidTotal)}</strong><span><i />Montant payé</span></div><div><strong>{money(upcomingTotal)}</strong><span><i className="upcoming" />À venir</span></div><div><strong>{money(paidTotal + upcomingTotal)}</strong><span>Total (EUR)</span></div></div><footer>{period.length} paiement(s) · Total annuel : {money(sum(annual))}</footer></section>
    {section !== 'performance' && month && <label>Mois <select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">Toute l’année</option>{totals.map((_, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{monthName(i)}</option>)}</select></label>}
    {section === 'reports' && <section className="revenue-report"><h3>Exporter le rapport</h3><p>Les filtres de période et de logement s’appliquent au rapport.</p><a className="button-dark" download={`revenus-${year}${month ? '-' + month : ''}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(report)}`}><Download size={16} /> Télécharger le CSV</a></section>}
    {editor === 'create' && <section className="revenue-editor"><h3>Créer un paiement</h3><form className="payouts-form" onSubmit={(e) => { e.preventDefault(); void save([draft]) }}>
      <label>Logement<select required value={draft.listingId} onChange={(e) => setDraft({ ...draft, listingId: e.target.value })}><option value="">Choisir un logement</option>{listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
      <label>Date du paiement<input required type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
      <label>Montant (€)<input required type="number" min="0.01" step="0.01" value={draft.amount || ''} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} /></label>
      <label>Référence unique<input required maxLength={180} value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} /></label>
      <label>Statut<select value={draft.status ?? 'paid'} onChange={(e) => setDraft({ ...draft, status: e.target.value as 'paid' | 'scheduled' })}><option value="paid">Payé</option><option value="scheduled">À venir</option></select></label>
      <label>Note<input maxLength={2000} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label><button className="button-dark" disabled={busy || loading}>Enregistrer</button></form></section>}
    {editor === 'import' && <section className="revenue-editor">
    <h4>Importer des paiements</h4><p>CSV UTF-8, séparateur point-virgule ou virgule. Dates AAAA-MM-JJ. Les références doivent être uniques.</p>
    <p>Statut : <code>paid</code> pour payé, <code>scheduled</code> pour à venir. Les anciens CSV sans statut sont importés comme payés.</p>
    <a download="modele-versements.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent('date;logement_id;montant;reference;note;statut\n')}`}>Télécharger le modèle CSV</a>
    <details><summary>Identifiants des logements pour l’import</summary>{listings.map((l) => <p key={l.id}>{l.title} : <code>{l.id}</code></p>)}</details>
    <input aria-label="Fichier CSV des paiements" type="file" accept=".csv,text/csv" disabled={busy || loading} onChange={async (e) => { const file = e.target.files?.[0]; setPreview([]); setError(''); if (!file) return; try { if (file.size > 2000000) throw new Error('Fichier trop volumineux (2 Mo maximum).'); const entries = parseCsv(await file.text()); if (entries.some((p) => !listings.some((l) => l.id === p.listingId))) throw new Error('Un identifiant de logement est inconnu.'); if (new Set(entries.map((p) => p.reference)).size !== entries.length || entries.some((p) => payments.some((saved) => saved.reference === p.reference))) throw new Error('Des références de paiement sont en double.'); setPreview(entries) } catch (err) { setError(err instanceof Error ? err.message : 'Import impossible.') } e.target.value = '' }} />
    {!!preview.length && <section><h4>Aperçu : {preview.length} paiements · {money(preview.reduce((s, p) => s + p.amount, 0))}</h4><div className="payouts-table"><table><thead><tr><th>Date</th><th>Référence</th><th>Montant</th></tr></thead><tbody>{preview.map((p) => <tr key={p.reference}><td>{p.date}</td><td>{p.reference}</td><td>{money(p.amount)}</td></tr>)}</tbody></table></div><button className="button-dark" disabled={busy} onClick={() => void save(preview)}>Confirmer l’import</button><button disabled={busy} onClick={() => setPreview([])}>Annuler</button></section>}</section>}
    <h4>Récapitulatif des paiements</h4>{loading ? <p>Chargement…</p> : !visible.length ? <p>Aucun paiement pour cette période.</p> : <div className="payouts-table"><table><thead><tr><th>Date</th><th>Logement</th><th>Référence</th><th>Montant</th><th>Note</th></tr></thead><tbody>{visible.map((p) => <tr key={p.id}><td>{p.date}</td><td>{p.title}</td><td>{p.reference}</td><td>{money(p.amount)}</td><td>{p.note}</td></tr>)}</tbody></table></div>}
  </div></div>
}
