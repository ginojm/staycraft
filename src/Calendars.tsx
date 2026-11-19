import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Home, LayoutGrid, List, RefreshCw } from 'lucide-react'
import { apiRequest } from './api'
import { photoUrl, type Stay } from './data'

type CalendarReservation = { id: string; listingId: string; guestName: string; guestAvatarUrl?: string | null; checkIn: string; checkOut: string; status: string; total: number }
type CalendarListing = Stay & { status?: string }

const weekdays = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
const shortMonthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'short' })
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const startOfDay = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`)
const sameDay = (a: Date, b: Date) => dateKey(a) === dateKey(b)
const reservationDate = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', options).format(startOfDay(value))

function daysInMonth(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), index - offset + 1)
    return { date, key: dateKey(date), inMonth: date.getMonth() === month.getMonth() }
  })
}

function reservationForDay(day: Date, reservations: CalendarReservation[]) {
  return reservations.filter((reservation) => day >= startOfDay(reservation.checkIn) && day < startOfDay(reservation.checkOut))
}

function ReservationPill({ reservation, showGuest, roundStart = showGuest, roundEnd = false }: { reservation: CalendarReservation; showGuest: boolean; roundStart?: boolean; roundEnd?: boolean }) {
  return <span className={`host-calendar-reservation ${roundStart ? 'round-start' : ''} ${roundEnd ? 'round-end' : ''}`}><span className="host-calendar-avatar">{showGuest && (reservation.guestAvatarUrl ? <img src={reservation.guestAvatarUrl} alt="" /> : reservation.guestName.slice(0, 1).toUpperCase())}</span>{showGuest && <strong>{reservation.guestName}</strong>}</span>
}

function ReservationDetails({ reservation, listing, onClose }: { reservation: CalendarReservation; listing: CalendarListing; onClose: () => void }) {
  const nights = Math.max(1, Math.round((startOfDay(reservation.checkOut).getTime() - startOfDay(reservation.checkIn).getTime()) / 86400000))
  return <aside className="host-calendar-details"><button className="host-calendar-details-close" onClick={onClose} aria-label="Fermer">×</button><div className="host-calendar-details-hero"><span className="host-calendar-details-avatar">{reservation.guestAvatarUrl ? <img src={reservation.guestAvatarUrl} alt="" /> : reservation.guestName.slice(0, 1).toUpperCase()}</span><span className="host-calendar-plus">+1</span><h2>Groupe de 2<br />réservé par {reservation.guestName}</h2><p>{reservationDate(reservation.checkIn, { day: 'numeric', month: 'short' })} – {reservationDate(reservation.checkOut, { day: 'numeric', month: 'short' })} · {nights} nuit{nights > 1 ? 's' : ''}</p><small>{listing.title} · {listing.location}</small></div><section className="host-calendar-detail-card"><strong>Arrivée</strong><span>{reservationDate(reservation.checkIn, { weekday: 'short', day: 'numeric', month: 'short' })}</span><span>15:00</span><i /><strong>Départ</strong><span>{reservationDate(reservation.checkOut, { weekday: 'short', day: 'numeric', month: 'short' })}</span><span>11:00</span></section><section className="host-calendar-detail-card"><h3>Voyageurs</h3><div className="host-calendar-guest"><span className="host-calendar-guest-avatar">{reservation.guestAvatarUrl ? <img src={reservation.guestAvatarUrl} alt="" /> : reservation.guestName.slice(0, 1).toUpperCase()}</span><span><strong>{reservation.guestName}</strong><small>Centres d'intérêt · gastronomie</small></span></div><div className="host-calendar-guest"><span className="host-calendar-plus large">+1</span><span>1 adulte</span></div></section><section className="host-calendar-detail-card"><h3>Hôte</h3><div className="host-calendar-guest"><span className="host-calendar-host-avatar">{listing.hostAvatarUrl ? <img src={listing.hostAvatarUrl} alt="" /> : 'H'}</span><span><strong>{listing.host}</strong><small>Titulaire de l'annonce</small></span></div></section><section className="host-calendar-detail-card host-calendar-total"><strong>{reservation.total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</strong><span>Total pour {nights} nuit{nights > 1 ? 's' : ''}</span></section><button className="button-dark host-calendar-message">Envoyer un message</button></aside>
}

function MiniMonth({ month, reservations }: { month: Date; reservations: CalendarReservation[] }) {
  const cells = daysInMonth(month)
  return <article className="host-calendar-mini-month"><h3>{shortMonthFormatter.format(month)}</h3><div className="host-calendar-mini-weekdays">{weekdays.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}</div><div className="host-calendar-mini-grid">{cells.slice(0, 35).map(({ date, key, inMonth }) => { const booked = reservationForDay(date, reservations).length > 0; return <span className={`${!inMonth ? 'outside' : ''} ${booked ? 'booked' : ''}`} key={key}>{date.getDate()}</span> })}</div></article>
}

export default function Calendars({ token, onClose }: { token: string; onClose: () => void }) {
  const [listings, setListings] = useState<CalendarListing[]>([])
  const [reservations, setReservations] = useState<CalendarReservation[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [mode, setMode] = useState<'month' | 'year'>('month')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeReservation, setActiveReservation] = useState<CalendarReservation | null>(null)
  const load = async () => {
    setLoading(true); setError('')
    try {
      const data = await apiRequest<{ listings: CalendarListing[]; reservations: CalendarReservation[] }>('/calendars', token)
      setListings(data.listings); setReservations(data.reservations); setSelectedId((current) => current || data.listings[0]?.id || '')
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de charger les calendriers.') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [token])
  const selected = listings.find((listing) => listing.id === selectedId) ?? listings[0]
  const selectedReservations = useMemo(() => reservations.filter((reservation) => reservation.listingId === selected?.id && reservation.status !== 'cancelled'), [reservations, selected?.id])
  const cells = useMemo(() => daysInMonth(month), [month])
  const reservationBlocks = useMemo(() => selectedReservations.flatMap((reservation) => {
    const checkInKey = reservation.checkIn.slice(0, 10)
    const checkOutKey = reservation.checkOut.slice(0, 10)
    const occupiedIndexes = cells.map(({ key }, index) => key >= checkInKey && key <= checkOutKey ? index : -1).filter((index) => index >= 0)
    if (!occupiedIndexes.length) return []
    const blocks: Array<{ reservation: CalendarReservation; start: number; length: number; showGuest: boolean; startInset: number; endInset: number; roundStart: boolean; roundEnd: boolean }> = []
    let start = occupiedIndexes[0]
    let previous = start
    occupiedIndexes.slice(1).forEach((index) => {
      if (index !== previous + 1 || Math.floor(index / 7) !== Math.floor(previous / 7)) {
        const startInset = start === occupiedIndexes[0] ? 0.5 : 0
        blocks.push({ reservation, start: start + startInset, length: previous - start + 1 - startInset, showGuest: start === occupiedIndexes[0], startInset, endInset: 0, roundStart: start === occupiedIndexes[0], roundEnd: false })
        start = index
      }
      previous = index
    })
    const startInset = start === occupiedIndexes[0] ? 0.5 : 0
    const endInset = previous === occupiedIndexes.at(-1) ? 0.75 : 0
    blocks.push({ reservation, start: start + startInset, length: previous - start + 1 - startInset - endInset, showGuest: start === occupiedIndexes[0], startInset, endInset, roundStart: start === occupiedIndexes[0], roundEnd: previous === occupiedIndexes.at(-1) })
    return blocks
  }), [cells, selectedReservations])
  const yearMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => new Date(month.getFullYear(), index, 1)), [month])
  const shiftMonth = (offset: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  return <div className="host-calendar-page">
    <header className="host-calendar-header"><button className="wizard-exit" onClick={onClose}><ArrowLeft size={16} /> Retour au site</button><div><span className="results-kicker">ESPACE HÔTE</span><h1>Calendriers</h1></div><button className="host-calendar-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Actualiser</button></header>
    <main className="host-calendar-main">
      <aside className="host-calendar-sidebar"><div className="host-calendar-sidebar-title"><div><span className="results-kicker">VOS LOGEMENTS</span><h2>Choisir un logement</h2></div><Home size={20} /></div>{loading && <p>Chargement…</p>}{listings.map((listing) => <button className={`host-calendar-listing ${listing.id === selected?.id ? 'selected' : ''}`} key={listing.id} onClick={() => setSelectedId(listing.id)}><img src={photoUrl(listing.image, 180)} alt="" /><span><strong>{listing.title}</strong><small>{listing.location}</small></span><i>{listing.status === 'paused' ? 'En pause' : 'En ligne'}</i></button>)}{!loading && !listings.length && <p>Aucun logement disponible.</p>}</aside>
       <section className="host-calendar-content">{error && <p className="wizard-error" role="alert">{error}</p>}{selected ? <><div className="host-calendar-toolbar"><div><p className="results-kicker">CALENDRIER DES RÉSERVATIONS</p><h2>{selected.title}</h2><p>{selected.location} · {selectedReservations.length} réservation{selectedReservations.length > 1 ? 's' : ''}</p></div><div className="host-calendar-controls"><button aria-label="Mois précédent" onClick={() => shiftMonth(-1)}><ChevronLeft size={18} /></button><strong>{mode === 'month' ? monthFormatter.format(month) : month.getFullYear()}</strong><button aria-label="Mois suivant" onClick={() => shiftMonth(1)}><ChevronRight size={18} /></button><div className="host-calendar-view-switch"><button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}><List size={15} /> Mois</button><button className={mode === 'year' ? 'active' : ''} onClick={() => setMode('year')}><LayoutGrid size={15} /> Année</button></div></div></div><div className="host-calendar-workspace"><div className="host-calendar-schedule">{mode === 'month' ? <div className="host-calendar-month-view"><div className="host-calendar-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div><div className="host-calendar-grid">{cells.map(({ date, key, inMonth }) => { const isToday = sameDay(date, new Date()); return <div className={`host-calendar-day ${!inMonth ? 'outside' : ''} ${isToday ? 'today' : ''}`} key={key}><span className="host-calendar-day-number">{date.getDate()}</span><span className="host-calendar-price">{selected.price} €</span></div> })}<div className="host-calendar-reservation-layer">{reservationBlocks.map((block, index) => <button className="host-calendar-reservation-position" key={`${block.reservation.id}-${block.start}-${index}`} style={{ left: `${(block.start % 7) * (100 / 7)}%`, top: `${Math.floor(block.start / 7) * 117 + 69}px`, width: `${block.length * (100 / 7)}%` }} onClick={() => setActiveReservation(block.reservation)} aria-label={`Voir la réservation de ${block.reservation.guestName}`}><ReservationPill reservation={block.reservation} showGuest={block.showGuest} roundStart={block.roundStart} roundEnd={block.roundEnd} /></button>)}</div></div></div> : <div className="host-calendar-year-view">{yearMonths.map((yearMonth) => <MiniMonth key={yearMonth.getMonth()} month={yearMonth} reservations={selectedReservations} />)}</div>}<div className="host-calendar-legend"><span><i className="is-available" /> Disponible</span><span><i className="is-booked" /> Réservé</span><span><i className="is-today" /> Aujourd’hui</span></div></div>{activeReservation && <ReservationDetails reservation={activeReservation} listing={selected} onClose={() => setActiveReservation(null)} />}</div></> : <div className="empty-state"><span className="empty-icon">⌂</span><h3>Sélectionnez un logement</h3><p>Choisissez une annonce pour afficher ses disponibilités.</p></div>}</section>
    </main>
  </div>
}
