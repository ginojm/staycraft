import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Bath,
  BedDouble,
  CalendarDays,
  Check,
  Compass,
  Heart,
  Home,
  MessageCircle,
  Menu,
  Mountain,
  Paperclip,
  Search,
  Settings as SettingsIcon,
  Send,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trees,
  Users,
  Waves,
  X,
} from 'lucide-react'
import { apiRequest } from './api'
import DOMPurify from 'dompurify'
import ListingWizard from './ListingWizard'
import ManageListings from './ManageListings'
import Settings from './Settings'
import MessagingSettings from './MessagingSettings'
import Attachments, { type Attachment } from './Attachments'
import AccountSettings, { type AccountProfile } from './AccountSettings'
import { photoUrl, type Stay } from './data'

type Booking = {
  id: string
  stayId: string
  title: string
  location: string
  image: string
  checkIn: string
  checkOut: string
  guests: number
  total: number
  status: string
  addons: { name: string; price: number; quantity: number; unitType: 'fixed' | 'hour' }[]
}

type BookingAddon = {
  id: string
  code: string
  name: string
  description: string
  price: number
  category: string
  imageUrl: string
  priceUnit: 'fixed' | 'hour'
}
type BookingRange = { checkIn: string; checkOut: string }
type Profile = AccountProfile
type PendingGoogleAction = { stayId?: string; favoriteId?: string; host: boolean }
type ConversationMessage = { id: string; text: string; author: 'traveler' | 'host'; time: string; read?: boolean; attachments?: Attachment[] }
type ReservationSummary = { id: string; title: string; location: string; image: string; checkIn: string; checkOut: string; guests: number; total: number; status: string }
type Conversation = {
  id: string
  guestName: string
  guestInitials: string
  property: string
  propertyImage: string
  dates: string
  location: string
  preview: string
  time: string
  unread: number
  avatar: string
  avatarUrl?: string
  messages: ConversationMessage[]
  reservation?: ReservationSummary
}
type ApiConversation = {
  id: string
  reservation_id: string
  title: string
  city: string
  cover_image_url: string
  check_in: string
  check_out: string
  contact_name: string
  contact_avatar_url: string | null
  guests: number
  total_amount: number
  status: string
  last_message: string | null
  last_message_at: string | null
  unread_count: number
}
type ApiMessage = { id: string; sender_id: string; body: string; status: 'sent' | 'read'; created_at: string; attachments?: Attachment[] }
type Category = { label: string; icon: typeof Home }
type EmbeddedCheckout = { mount: (element: HTMLElement) => void; unmount: () => void }
type StripeClient = { initEmbeddedCheckout: (options: { fetchClientSecret: () => Promise<string> }) => Promise<EmbeddedCheckout> }

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeClient
  }
}

const categories: Category[] = [
  { label: 'Tout', icon: Sparkles },
  { label: 'Cabane', icon: Trees },
  { label: 'Bord de mer', icon: Waves },
  { label: 'Montagne', icon: Mountain },
  { label: 'Villa', icon: Home },
  { label: 'Ville', icon: Compass },
  { label: 'Nature', icon: Trees },
]

const addonCategories = [
  'Petits plaisirs',
  'Moments d’exception',
  'Confort & praticité',
  'Transport & transferts',
  'Pour un séjour sans contrainte',
]
const euroFormatter = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch (error) {
    console.error(`Impossible de lire les données locales « ${key} ».`, error)
    return fallback
  }
}

function formatEuro(amount: number) {
  return `${euroFormatter.format(amount)} €`
}

function dateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDate(date: string) {
  if (!date) return 'Ajouter une date'
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return 'Date à confirmer'
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(parsed)
}

function formatMessageTime(date: string | null) {
  if (!date) return ''
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(parsed)
}

function messagePreview(value: string) {
  const container = document.createElement('div')
  container.innerHTML = messageHtml(value)
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function messageHtml(value: string) {
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['a', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'div', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'span'],
    ALLOWED_ATTR: ['href', 'title'],
  })
}

function conversationFromApi(conversation: ApiConversation): Conversation {
  const initials = conversation.contact_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return {
    id: conversation.id,
    guestName: conversation.contact_name,
    guestInitials: initials || '?',
    property: conversation.title,
    propertyImage: conversation.cover_image_url,
    dates: `${formatDate(conversation.check_in)} – ${formatDate(conversation.check_out)}`,
    location: conversation.city,
    preview: messagePreview(conversation.last_message ?? 'Aucun message pour le moment.'),
    time: formatMessageTime(conversation.last_message_at),
    unread: conversation.unread_count,
    avatar: 'linear-gradient(145deg, #b28a37, #50402a)',
    avatarUrl: conversation.contact_avatar_url ?? undefined,
    messages: [],
    reservation: {
      id: conversation.reservation_id,
      title: conversation.title,
      location: conversation.city,
      image: conversation.cover_image_url,
      checkIn: conversation.check_in,
      checkOut: conversation.check_out,
      guests: Number(conversation.guests),
      total: Number(conversation.total_amount),
      status: conversation.status,
    },
  }
}

function nightCount(checkIn: string, checkOut: string) {
  const nights = Math.ceil((new Date(`${checkOut}T12:00:00`).getTime() - new Date(`${checkIn}T12:00:00`).getTime()) / 86400000)
  return Math.max(1, nights)
}

function isBlockedDate(date: string, ranges: BookingRange[]) {
  return ranges.some((range) => date >= range.checkIn && date < range.checkOut)
}

function canCancelBooking(booking: Booking) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Martinique', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return ['pending', 'confirmed'].includes(booking.status) && booking.checkIn.slice(0, 10) > today
}

function isBlockedRange(checkIn: string, checkOut: string, ranges: BookingRange[]) {
  return ranges.some((range) => checkIn < range.checkOut && checkOut > range.checkIn)
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function CalendarPicker({ start, end, blockedRanges, onChange }: { start: string; end: string; blockedRanges: BookingRange[]; onChange: (checkIn: string, checkOut: string) => void }) {
  const initialDate = start ? new Date(`${start}T12:00:00`) : new Date()
  const [month, setMonth] = useState(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1))
  const [calendarError, setCalendarError] = useState('')
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), index - mondayOffset + 1)
    return { date, key: dateKey(date), inMonth: date.getMonth() === month.getMonth() }
  })
  const today = dateOffset(0)
  const selectDate = (key: string) => {
    const departureMode = Boolean(start && key > start && !isBlockedRange(start, key, blockedRanges))
    const isExistingArrival = blockedRanges.some((range) => key === range.checkIn)
    const isSharedBoundary = isExistingArrival && blockedRanges.some((range) => key === range.checkOut)
    const blockedForSelection = isBlockedDate(key, blockedRanges) && !isExistingArrival
    if (key < today || blockedForSelection || isSharedBoundary) return
    setCalendarError('')
    if (isExistingArrival) {
      onChange(departureMode ? start : '', key)
      return
    }
    if (!start && end && key < end && !isBlockedRange(key, end, blockedRanges)) {
      onChange(key, end)
      return
    }
    if (!start || end) {
      onChange(key, '')
      return
    }
    if (key <= start) {
      onChange(key, '')
      return
    }
    if (isBlockedRange(start, key, blockedRanges)) {
      setCalendarError('Cette période inclut un jour déjà réservé.')
      return
    }
    onChange(start, key)
  }
  const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(month)
  return <div className="booking-calendar">
    <div className="booking-calendar-heading"><strong>Disponibilités</strong><div className="booking-calendar-nav"><button type="button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="Mois précédent">‹</button><span>{monthLabel}</span><button type="button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="Mois suivant">›</button></div></div>
    <div className="booking-calendar-weekdays">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
    <div className="booking-calendar-grid">{cells.map(({ date, key, inMonth }) => {
      const blocked = isBlockedDate(key, blockedRanges)
      const blockedRange = blockedRanges.find((range) => key >= range.checkIn && key < range.checkOut)
      const blockedStart = Boolean(blockedRange && key === blockedRange.checkIn)
      const blockedEnd = blockedRanges.some((range) => key === range.checkOut)
      const departureBoundaryAvailable = blockedStart && !blockedEnd
      const past = key < today
      const selected = key === start || key === end
      const between = Boolean(start && end && key > start && key < end)
      return <button key={key} type="button" className={`booking-calendar-day ${!inMonth ? 'is-outside' : ''} ${blocked ? 'is-blocked' : ''} ${blockedStart ? 'is-blocked-start' : ''} ${blockedEnd ? 'is-blocked-end' : ''} ${selected ? 'is-selected' : ''} ${between ? 'is-between' : ''}`} disabled={past || (blocked && !departureBoundaryAvailable) || !inMonth} onClick={() => selectDate(key)} title={blockedStart ? 'Disponible pour un départ uniquement' : blockedEnd ? 'Disponible pour une arrivée' : blocked ? 'Déjà réservé' : 'Disponible'} aria-label={`${key}${blockedStart ? ', départ uniquement' : blockedEnd ? ', arrivée disponible' : blocked ? ', déjà réservé' : ''}`}><span className="calendar-day-number">{date.getDate()}</span>{inMonth && (blocked || blockedEnd) && <span aria-hidden="true" className={`calendar-reservation-band ${blockedStart ? 'band-start' : ''} ${blockedEnd ? 'band-end' : ''}`} />}</button>
    })}</div>
    <div className="booking-calendar-legend"><span><i className="booking-calendar-dot is-free" /> Disponible</span><span><i className="booking-calendar-dot is-occupied" /> Réservé</span></div>
    {calendarError && <p className="booking-calendar-error">{calendarError}</p>}
  </div>
}

function App() {
  const [stays, setStays] = useState<Stay[]>([])
  const [bookingAddons, setBookingAddons] = useState<BookingAddon[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [cancellingBookingId, setCancellingBookingId] = useState('')
  const [stripeClientSecret, setStripeClientSecret] = useState('')
  const [stripeModalOpen, setStripeModalOpen] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(() => readStorage('foyaltoloman:profile', null))
  const [token, setToken] = useState(() => localStorage.getItem('foyaltoloman:token') ?? '')
  const [category, setCategory] = useState('Tout')
  const [destination, setDestination] = useState('')
  const [query, setQuery] = useState('')
  const [maxPrice, setMaxPrice] = useState(300)
  const [filtered, setFiltered] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [view, setView] = useState<'stays' | 'trips' | 'messages'>('stays')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState('')
  const [inboxRevision, setInboxRevision] = useState(0)
  const lastUnreadTotal = useRef<number | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [messageFilter, setMessageFilter] = useState<'all' | 'unread'>('all')
  const [messageSearch, setMessageSearch] = useState('')
  const [selectedStay, setSelectedStay] = useState<Stay | null>(null)
  const [selectedReservation, setSelectedReservation] = useState<ReservationSummary | null>(null)
  const [bookingStay, setBookingStay] = useState<Stay | null>(null)
  const [blockedRanges, setBlockedRanges] = useState<BookingRange[]>([])
  const [previewAddon, setPreviewAddon] = useState<BookingAddon | null>(null)
  const [pendingStay, setPendingStay] = useState<Stay | null>(null)
  const [pendingFavorite, setPendingFavorite] = useState<Stay | null>(null)
  const [pendingHost, setPendingHost] = useState(false)
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register')
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [hostOpen, setHostOpen] = useState(false)
  const [manageListingsOpen, setManageListingsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [checkIn, setCheckIn] = useState(dateOffset(14))
  const [checkOut, setCheckOut] = useState(dateOffset(17))
  const [guests, setGuests] = useState(2)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  const visibleStays = useMemo(() => {
    const searchTerm = (filtered ? query : '').trim().toLocaleLowerCase('fr')
    return stays.filter((stay) => {
      const matchesCategory = category === 'Tout' || stay.category === category
      const matchesSearch = !searchTerm || `${stay.location} ${stay.title} ${stay.region}`.toLocaleLowerCase('fr').includes(searchTerm)
      const matchesPrice = stay.price <= maxPrice
      const matchesFavorite = !favoritesOnly || favorites.includes(stay.id)
      return matchesCategory && matchesSearch && matchesPrice && matchesFavorite
    })
  }, [stays, category, favorites, favoritesOnly, filtered, maxPrice, query])

  useEffect(() => {
    let active = true
    apiRequest<{ listings: Stay[] }>('/listings')
      .then(({ listings }) => { if (active) setStays(listings) })
      .catch((error: unknown) => {
        if (active) setToast(error instanceof Error ? error.message : 'Impossible de charger les logements.')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const payment = params.get('payment')
    if (!payment || !token) return
    const sessionId = params.get('session_id')
    window.history.replaceState(null, '', window.location.pathname)
    const failure = 'Un incident est survenu lors du paiement de votre réservation, veuillez réessayer de nouveau. Votre réservation n’a pas été confirmée.'
    if (payment !== 'success' || !sessionId) { setToast(failure); return }
    void apiRequest('/payments/verify', token, { method: 'POST', body: JSON.stringify({ sessionId }) })
      .then(async () => {
        const [trips, inbox] = await Promise.all([
          apiRequest<{ bookings: Booking[] }>('/bookings', token),
          apiRequest<{ conversations: ApiConversation[] }>('/conversations', token),
        ])
        setBookings(trips.bookings)
        setConversations(inbox.conversations.map(conversationFromApi))
        setView('trips')
        setConfirmationOpen(true)
      })
      .catch(() => setToast(failure))
  }, [token])

  useEffect(() => {
    let active = true
    apiRequest<{ googleEnabled: boolean }>('/auth/providers')
      .then(({ googleEnabled: enabled }) => { if (active) setGoogleEnabled(enabled) })
      .catch((error: unknown) => console.error('Impossible de charger les méthodes de connexion.', error))
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    apiRequest<{ addons: BookingAddon[] }>('/booking-addons')
      .then(({ addons }) => { if (active) setBookingAddons(addons) })
      .catch((error: unknown) => {
        if (active) setToast(error instanceof Error ? error.message : 'Impossible de charger les options du séjour.')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const code = fragment.get('google_code')
    const authError = fragment.get('auth_error')
    if (!code && !authError) return

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    if (authError) {
      const messages: Record<string, string> = {
        google_cancelled: 'Connexion Google annulée.',
        google_invalid_state: 'La vérification Google a échoué. Réessayez.',
        google_unverified_email: 'Google doit confirmer votre adresse e-mail.',
        google_account_conflict: 'Ce compte Google est déjà associé à un autre compte.',
        google_not_configured: 'La connexion Google n’est pas encore configurée.',
      }
      setToast(messages[authError] ?? 'La connexion Google a échoué. Réessayez.')
      return
    }

    let active = true
    apiRequest<{ user: Profile; token: string }>('/auth/google/exchange', undefined, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }).then(async ({ user, token: sessionToken }) => {
      if (!active) return
      let actionError = ''
      try {
        const savedAction = sessionStorage.getItem('foyaltoloman:pending-google-action')
        sessionStorage.removeItem('foyaltoloman:pending-google-action')
        const pending = savedAction ? JSON.parse(savedAction) as PendingGoogleAction : null
        if (pending?.favoriteId) {
          await apiRequest<void>(`/favorites/${pending.favoriteId}`, sessionToken, { method: 'PUT' })
        }
        if (pending?.stayId) {
          const { listings } = await apiRequest<{ listings: Stay[] }>('/listings')
          setStays(listings)
          const stay = listings.find((listing) => listing.id === pending.stayId)
          if (stay) setBookingStay(stay)
          else actionError = 'Ce logement n’est plus disponible.'
        }
        if (pending?.host) setHostOpen(true)
      } catch (error) {
        actionError = error instanceof Error ? error.message : 'Votre action n’a pas pu être reprise.'
      }
      setProfile(user)
      setToken(sessionToken)
      setLoginOpen(false)
      setToast(actionError || `Bienvenue, ${user.name.split(' ')[0]} !`)
    }).catch((error: unknown) => {
      if (active) setToast(error instanceof Error ? error.message : 'La connexion Google a échoué.')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    try {
      if (profile) localStorage.setItem('foyaltoloman:profile', JSON.stringify(profile))
      else localStorage.removeItem('foyaltoloman:profile')
      if (token) localStorage.setItem('foyaltoloman:token', token)
      else localStorage.removeItem('foyaltoloman:token')
    } catch (error) {
      console.error('Impossible de conserver la session sur cet appareil.', error)
    }
  }, [profile, token])

  useEffect(() => {
    if (!token) {
      setFavorites([])
      setBookings([])
      setConversations([])
      setActiveConversationId('')
      return
    }
    let active = true
    Promise.all([
      apiRequest<{ user: Profile }>('/auth/me', token),
      apiRequest<{ listingIds: string[] }>('/favorites', token),
      apiRequest<{ bookings: Booking[] }>('/bookings', token),
      apiRequest<{ conversations: ApiConversation[] }>('/conversations', token),
    ]).then(([account, favoriteData, bookingData, conversationData]) => {
      if (!active) return
      setProfile(account.user)
      setFavorites(favoriteData.listingIds)
      setBookings(bookingData.bookings)
      const nextConversations = conversationData.conversations.map(conversationFromApi)
      setConversations(nextConversations)
      setActiveConversationId((current) => nextConversations.some((conversation) => conversation.id === current) ? current : nextConversations[0]?.id ?? '')
    }).catch((error: unknown) => {
      if (!active) return
      setProfile(null)
      setToken('')
      setFavorites([])
      setBookings([])
      setConversations([])
      setActiveConversationId('')
      setToast(error instanceof Error ? error.message : 'Impossible de charger votre compte.')
    })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!bookingStay) {
      setBlockedRanges([])
      return
    }
    let active = true
    apiRequest<{ blocked: BookingRange[] }>(`/listings/${bookingStay.id}/availability`)
      .then(({ blocked }) => { if (active) setBlockedRanges(blocked) })
      .catch((error: unknown) => { if (active) setToast(error instanceof Error ? error.message : 'Impossible de vérifier les disponibilités.') })
    return () => { active = false }
  }, [bookingStay])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    if (!token || !activeConversationId || view !== 'messages') return
    let active = true
    apiRequest<{ messages: ApiMessage[] }>(`/conversations/${activeConversationId}/messages`, token)
      .then(({ messages }) => {
        if (!active) return
        setConversations((current) => current.map((conversation) => {
          if (conversation.id !== activeConversationId) return conversation
          const nextMessages = messages.map((message) => ({
            id: message.id,
            text: message.body,
            author: message.sender_id === profile?.id ? 'host' as const : 'traveler' as const,
            time: formatMessageTime(message.created_at),
            read: message.status === 'read',
            attachments: message.attachments ?? [],
          }))
          const lastMessage = nextMessages[nextMessages.length - 1]
          return { ...conversation, messages: nextMessages, preview: lastMessage?.text ?? conversation.preview, time: lastMessage?.time ?? conversation.time, unread: 0 }
        }))
      })
      .catch((error: unknown) => { if (active) setToast(error instanceof Error ? error.message : 'Impossible de charger cette conversation.') })
    return () => { active = false }
  }, [token, activeConversationId, profile?.id, view, inboxRevision])

  useEffect(() => {
    lastUnreadTotal.current = null
    if (!token) return
    let active = true
    let busy = false
    const refresh = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const { conversations: inbox } = await apiRequest<{ conversations: ApiConversation[] }>('/conversations', token)
        if (!active) return
        const total = inbox.reduce((sum, item) => sum + Number(item.unread_count), 0)
        if (lastUnreadTotal.current !== null && total > lastUnreadTotal.current) setToast('Vous avez reçu un nouveau message. Consultez votre messagerie.')
        lastUnreadTotal.current = total
        setConversations((current) => inbox.map((item) => ({ ...conversationFromApi(item), messages: current.find((previous) => previous.id === item.id)?.messages ?? [] })))
        if (view === 'messages') setInboxRevision((current) => current + 1)
      } catch (error) {
        console.error('Actualisation de la messagerie impossible.', error)
      } finally { busy = false }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 5000)
    window.addEventListener('focus', refresh)
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [token, view])

  const toggleFavorite = async (stay: Stay) => {
    if (!token) {
      setPendingFavorite(stay)
      setAuthMode('register')
      setLoginOpen(true)
      setToast('Créez un compte ou connectez-vous pour enregistrer vos favoris')
      return
    }
    const isFavorite = favorites.includes(stay.id)
    try {
      await apiRequest<void>(`/favorites/${stay.id}`, token, { method: isFavorite ? 'DELETE' : 'PUT' })
      setFavorites((current) => isFavorite
        ? current.filter((id) => id !== stay.id)
        : current.includes(stay.id) ? current : [...current, stay.id])
      setToast(isFavorite ? 'Retiré de vos favoris' : 'Ajouté à vos favoris')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Impossible de modifier vos favoris.')
    }
  }

  const openTrips = () => {
    if (!token) {
      setAuthMode('login')
      setLoginOpen(true)
      setToast('Connectez-vous pour consulter vos voyages')
      return
    }
    setView('trips')
    setFavoritesOnly(false)
    setAccountOpen(false)
  }

  const openFavorites = () => {
    if (!token) {
      setAuthMode('login')
      setLoginOpen(true)
      setToast('Connectez-vous pour consulter vos favoris')
      return
    }
    setFavoritesOnly(true)
    setView('stays')
    setAccountOpen(false)
  }

  const openMessages = () => {
    if (!token) {
      setAuthMode('login')
      setLoginOpen(true)
      setToast('Connectez-vous pour accéder à vos messages')
      return
    }
    setView('messages')
    setFavoritesOnly(false)
    setAccountOpen(false)
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = messageDraft.trim()
    if (!text || !token || !activeConversationId) return
    try {
      const { message } = await apiRequest<{ message: ApiMessage }>(`/conversations/${activeConversationId}/messages`, token, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      })
      const nextMessage: ConversationMessage = { id: message.id, text: message.body, author: 'host', time: formatMessageTime(message.created_at), read: false }
      setConversations((current) => current.map((conversation) => conversation.id === activeConversationId
        ? { ...conversation, preview: messagePreview(message.body), time: nextMessage.time, messages: [...conversation.messages, nextMessage] }
        : conversation))
      setMessageDraft('')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Impossible d’envoyer ce message.')
    }
  }

  const selectConversation = (id: string) => {
    setActiveConversationId(id)
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, unread: 0 } : conversation))
  }

  const cancelBooking = async (booking: Booking) => {
    if (!canCancelBooking(booking) || cancellingBookingId) return
    if (!window.confirm('Annuler cette réservation ? Les dates seront libérées. Si vous avez déjà payé, cette action ne déclenche pas de remboursement automatique.')) return
    setCancellingBookingId(booking.id)
    try {
      await apiRequest(`/bookings/${booking.id}/cancel`, token, { method: 'POST' })
      setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, status: 'cancelled' } : item))
      setConversations((current) => current.map((item) => item.reservation?.id === booking.id ? { ...item, reservation: { ...item.reservation, status: 'cancelled' } } : item))
      setToast('Réservation annulée. Les dates sont de nouveau disponibles.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Impossible d’annuler la réservation.')
    } finally {
      setCancellingBookingId('')
    }
  }


  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (new Date(checkOut) <= new Date(checkIn)) {
      setToast('La date de départ doit être après la date d’arrivée')
      return
    }
    setQuery(destination)
    setFiltered(true)
    setFavoritesOnly(false)
    setView('stays')
    setMobileSearchOpen(false)
  }

  const openBooking = (stay: Stay) => {
    if (!profile) {
      setSelectedStay(null)
      setPendingStay(stay)
      setAuthMode('register')
      setLoginOpen(true)
      setToast('Connectez-vous pour réserver votre séjour')
      return
    }
    setPendingStay(null)
    setSelectedStay(null)
    setBookingStay(stay)
  }

  const confirmBooking = async (stay: Stay, start: string, end: string, guestCount: number, addOns: { id: string; quantity: number }[]) => {
    if (new Date(end) <= new Date(start)) {
      setToast('La date de départ doit être après la date d’arrivée')
      return
    }
    if (isBlockedRange(start, end, blockedRanges)) {
      setToast('Ces dates ne sont plus disponibles. Choisissez une autre période.')
      return
    }
    try {
      const { clientSecret } = await apiRequest<{ clientSecret: string }>('/bookings', token, {
        method: 'POST',
        body: JSON.stringify({ listingId: stay.id, checkIn: start, checkOut: end, guests: guestCount, addOns }),
      })
      setBookingStay(null)
      setStripeClientSecret(clientSecret)
      setStripeModalOpen(true)
    } catch (error) {
      console.error(error)
      setToast('Un incident est survenu lors du paiement de votre réservation, veuillez réessayer de nouveau. Votre réservation n’a pas été confirmée.')
    }
  }

  const openHost = () => {
    if (!profile) {
      setPendingHost(true)
      setAuthMode('register')
      setLoginOpen(true)
      setToast('Connectez-vous pour publier une annonce')
      return
    }
    setPendingHost(false)
    setHostOpen(true)
  }

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    if (!email || !password || (authMode === 'register' && !name)) return
    try {
      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login'
      const body = authMode === 'register' ? { name, email, password } : { email, password }
      const session = await apiRequest<{ user: Profile; token: string }>(endpoint, undefined, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      let nextFavorites: string[] = []
      const [favoriteData, bookingData] = await Promise.all([
        apiRequest<{ listingIds: string[] }>('/favorites', session.token),
        apiRequest<{ bookings: Booking[] }>('/bookings', session.token),
      ])
      nextFavorites = favoriteData.listingIds
      if (pendingFavorite && !nextFavorites.includes(pendingFavorite.id)) {
        await apiRequest<void>(`/favorites/${pendingFavorite.id}`, session.token, { method: 'PUT' })
        nextFavorites = [...nextFavorites, pendingFavorite.id]
      }
      setProfile(session.user)
      setToken(session.token)
      setFavorites(nextFavorites)
      setBookings(bookingData.bookings)
      setPendingFavorite(null)
      setLoginOpen(false)
      if (pendingStay) {
        setBookingStay(pendingStay)
        setPendingStay(null)
      } else if (pendingHost) {
        setHostOpen(true)
        setPendingHost(false)
      }
      setToast(`Bienvenue, ${session.user.name.split(' ')[0]} !`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Impossible de créer la session.')
    }
  }

  const publishStay = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') ?? '').trim()
    const location = String(form.get('location') ?? '').trim()
    const price = Number(form.get('price'))
    const cleaningFee = Number(form.get('cleaningFee'))
    const image = String(form.get('image') ?? '').trim()
    const description = String(form.get('description') ?? '').trim()
    const categoryValue = String(form.get('category') ?? 'Nature')
    if (!title || !location || !Number.isFinite(price) || price < 1 || !image || !description) return
    try {
      const { listing } = await apiRequest<{ listing: Stay }>('/listings', token, {
        method: 'POST',
        body: JSON.stringify({
          title,
          location,
          price,
          cleaningFee,
          category: categoryValue,
          image,
          description,
          amenities: [],
        }),
      })
      setStays((current) => [listing, ...current])
      setHostOpen(false)
      setCategory('Tout')
      setFavoritesOnly(false)
      setView('stays')
      setToast('Votre annonce est en ligne')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Impossible de publier cette annonce.')
    }
  }

  const resetFilters = () => {
    setCategory('Tout')
    setDestination('')
    setQuery('')
    setFiltered(false)
    setFavoritesOnly(false)
    setMaxPrice(300)
    setView('stays')
  }

  if (hostOpen) return <ListingWizard onClose={() => setHostOpen(false)} onPublish={publishStay} toast={toast} />
  if (accountSettingsOpen && profile) return <AccountSettings token={token} profile={profile} onClose={() => setAccountSettingsOpen(false)} onSaved={(nextProfile) => { setProfile(nextProfile); localStorage.setItem('foyaltoloman:profile', JSON.stringify(nextProfile)) }} />
  if (settingsOpen) return <Settings token={token} onClose={() => setSettingsOpen(false)} onManageListings={() => { setSettingsOpen(false); setManageListingsOpen(true) }} />
  if (manageListingsOpen) return <ManageListings token={token} onClose={() => { setManageListingsOpen(false); void apiRequest<{ listings: Stay[] }>('/listings').then(({ listings }) => setStays(listings)).catch(() => setToast('Impossible d’actualiser les logements.')) }} onCreate={() => { setManageListingsOpen(false); openHost() }} />

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); resetFilters() }} aria-label="Foyaltoloman, accueil">
          <img className="brand-logo" src="/foyaltoloman-logo.webp" alt="Foyaltoloman" />
        </a>

        <nav className="primary-nav" aria-label="Navigation principale">
          <button className={`nav-link ${view === 'stays' && !favoritesOnly ? 'active' : ''}`} onClick={resetFilters}>Séjours</button>
          <button className={`nav-link ${favoritesOnly ? 'active' : ''}`} onClick={openFavorites}>Mes favoris <span className="nav-count">{favorites.length}</span></button>
          <button className={`nav-link ${view === 'messages' ? 'active' : ''}`} onClick={openMessages}>Messages <span className="nav-count message-count">{conversations.reduce((total, conversation) => total + conversation.unread, 0)}</span></button>
        </nav>

        <div className="header-actions">
          <button className="host-link" onClick={openHost}>{profile ? 'Devenez hôte' : 'Créer mon compte'} <ArrowRight size={15} /></button>
          <div className="account-wrap">
            <button className="account-button" onClick={() => setAccountOpen(!accountOpen)} aria-label="Ouvrir le menu de compte" aria-expanded={accountOpen}>
              <Menu size={18} />
              <span className="avatar">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile?.name?.slice(0, 1).toUpperCase() ?? 'M'}</span>
            </button>
            {accountOpen && (
              <div className="account-menu">
                {profile ? <div className="account-identity">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : null}<div><strong>{profile.name}</strong><span>{profile.email}</span></div></div> : null}
                {profile && <>
                <button onClick={() => { setAccountOpen(false); setAccountSettingsOpen(true) }}>Mon compte</button>
                <button onClick={openTrips}>Mes voyages <span>{bookings.length}</span></button>
                <button onClick={openFavorites}>Mes favoris <span>{favorites.length}</span></button>
                <button onClick={openMessages}>Messages <span>{conversations.reduce((total, conversation) => total + conversation.unread, 0)}</span></button>
                <div className="menu-divider" />
                <button onClick={() => { setAccountOpen(false); openHost() }}>Devenir hôte</button>
                {profile.email.trim().toLowerCase() === 'foyal.toloman@gmail.com' && <button onClick={() => { setAccountOpen(false); openHost() }}>Créer une annonce</button>}
                {profile.email.trim().toLowerCase() === 'foyal.toloman@gmail.com' && <button onClick={() => { setAccountOpen(false); setManageListingsOpen(true) }}>Gérer les annonces</button>}
                <div className="menu-divider" />
                {profile.email.trim().toLowerCase() === 'foyal.toloman@gmail.com' && <button onClick={() => { setAccountOpen(false); setSettingsOpen(true) }}><SettingsIcon size={15} /> Paramètres</button>}
                </>}
                {profile ? <div className="menu-divider" /> : <><button onClick={() => { setAuthMode('register'); setPendingHost(false); setAccountOpen(false); setLoginOpen(true) }}>Créer mon compte</button><div className="menu-divider" /></>}
                {profile
                  ? <button onClick={() => { setProfile(null); setToken(''); setFavorites([]); setBookings([]); setConversations([]); setActiveConversationId(''); setAccountOpen(false); resetFilters(); window.scrollTo({ top: 0, behavior: 'smooth' }); setToast('Vous êtes déconnecté·e') }}>Se déconnecter</button>
                  : <button onClick={() => { setAuthMode('login'); setAccountOpen(false); setLoginOpen(true) }}>Se connecter</button>}
              </div>
            )}
          </div>
        </div>
      </header>

      <main>
        {view !== 'messages' && <section className={`search-section ${mobileSearchOpen ? 'mobile-open' : ''}`}>
          <div className="search-intro">
            <span className="eyebrow"><Sparkles size={14} /> Des séjours qui ont une âme</span>
            <h1>Votre prochaine <em>expérience</em> commence ici.</h1>
            <p>Des adresses choisies pour vivre quelque chose, pas juste dormir quelque part.</p>
          </div>
          <form className="search-bar" onSubmit={handleSearch}>
            <label className="search-field destination-field">
              <span>Où allez-vous ?</span>
              <input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Ville, région ou envie" aria-label="Destination" />
            </label>
            <label className="search-field date-field">
              <span>Arrivée</span>
              <input type="date" value={checkIn} min={dateOffset(0)} onChange={(event) => setCheckIn(event.target.value)} aria-label="Date d’arrivée" />
            </label>
            <label className="search-field date-field">
              <span>Départ</span>
              <input type="date" value={checkOut} min={checkIn || dateOffset(0)} onChange={(event) => setCheckOut(event.target.value)} aria-label="Date de départ" />
            </label>
            <label className="search-field guests-field">
              <span>Voyageurs</span>
              <select value={guests} onChange={(event) => setGuests(Number(event.target.value))} aria-label="Nombre de voyageurs">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} voyageur{count > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <button className="search-submit" type="submit"><Search size={19} /><span>Rechercher</span></button>
          </form>
          <button className="mobile-search-trigger" onClick={() => setMobileSearchOpen(!mobileSearchOpen)}>
            <Search size={18} /><span>{query || 'Où souhaitez-vous aller ?'}</span><span className="mobile-search-detail">{formatDate(checkIn)} · {guests} pers.</span>
          </button>
        </section>}

        <section className={`browse-section ${view === 'messages' ? 'messages-section' : ''}`}>
          {view === 'messages' ? <MessagesPanel
            conversations={conversations}
            token={token}
            isSuperhost={profile?.email.trim().toLowerCase() === 'foyal.toloman@gmail.com'}
            onMessageChanged={(conversationId, messageId, body) => setConversations((current) => current.map((conversation) => {
              if (conversation.id !== conversationId) return conversation
              const messages = body === null ? conversation.messages.filter((message) => message.id !== messageId) : conversation.messages.map((message) => message.id === messageId ? { ...message, text: body } : message)
              return { ...conversation, messages, preview: messagePreview(messages.at(-1)?.text ?? 'Aucun message pour le moment.') }
            }))}
            activeConversationId={activeConversationId}
            messageDraft={messageDraft}
            messageFilter={messageFilter}
            messageSearch={messageSearch}
            onDraftChange={setMessageDraft}
            onFilterChange={setMessageFilter}
            onSearchChange={setMessageSearch}
            onSelectConversation={selectConversation}
            onSend={sendMessage}
            onShowReservation={(reservation) => setSelectedReservation(reservation)}
          /> : <>
          <div className="category-row">
            <div className="category-scroller" role="tablist" aria-label="Catégories de séjours">
              {categories.map(({ label, icon: Icon }) => (
                <button key={label} role="tab" aria-selected={category === label} className={`category-tab ${category === label ? 'selected' : ''}`} onClick={() => { setCategory(label); setView('stays') }}>
                  <Icon size={20} strokeWidth={1.7} /><span>{label}</span>
                </button>
              ))}
            </div>
            <button className={`filter-button ${filtersOpen ? 'filter-active' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
              <SlidersHorizontal size={17} /> Filtres
            </button>
          </div>

          {filtersOpen && (
            <div className="filter-popover">
              <div className="filter-heading"><div><strong>Affiner votre recherche</strong><span>Des séjours faits pour vous</span></div><button className="icon-button" onClick={() => setFiltersOpen(false)} aria-label="Fermer"><X size={18} /></button></div>
              <label className="price-filter"><span>Prix maximum par nuit <strong>{maxPrice} €</strong></span><input type="range" min="60" max="300" step="10" value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} /></label>
              <div className="filter-footer"><button className="text-button" onClick={() => setMaxPrice(300)}>Effacer</button><button className="button-dark small-button" onClick={() => setFiltersOpen(false)}>Voir {visibleStays.length} séjours</button></div>
            </div>
          )}

          <div className="results-heading">
            <div>
              <p className="results-kicker">{view === 'trips' ? 'VOTRE CARNET DE VOYAGE' : favoritesOnly ? 'VOTRE SÉLECTION' : 'DES ADRESSES À PARTAGER'}</p>
              <h2>{view === 'trips' ? 'Vos prochains voyages' : favoritesOnly ? 'Vos coups de cœur' : query ? `Escapades à ${query}` : 'Des lieux qui font du bien'}</h2>
            </div>
            {(query || favoritesOnly || category !== 'Tout' || maxPrice < 300) && view === 'stays' && <button className="text-button clear-filters" onClick={resetFilters}><X size={14} /> Tout effacer</button>}
            <span className="results-count">{view === 'trips' ? `${bookings.length} séjour${bookings.length > 1 ? 's' : ''}` : `${visibleStays.length} adresse${visibleStays.length > 1 ? 's' : ''}`}</span>
          </div>

          {view === 'trips' ? (
            bookings.length ? (
              <div className="trip-list">
                {bookings.map((booking) => (
                  <article className="trip-card" key={booking.id}>
                    <img src={photoUrl(booking.image, 520)} alt={booking.title} />
                    <div className="trip-info"><span className="trip-status"><Check size={13} /> {booking.status === 'pending' ? 'En attente' : booking.status === 'confirmed' ? 'Confirmée' : booking.status === 'completed' ? 'Terminée' : 'Annulée'}</span><h3>{booking.title}</h3><p>{booking.location}</p><div className="trip-dates"><CalendarDays size={15} /> {formatDate(booking.checkIn)} — {formatDate(booking.checkOut)} <span>·</span> <Users size={15} /> {booking.guests} voyageur{booking.guests > 1 ? 's' : ''}</div>{booking.addons.length > 0 && <p className="trip-addons">Options : {booking.addons.map((addon) => `${addon.name}${addon.unitType === 'hour' ? ` (${addon.quantity} h)` : ''}`).join(' · ')}</p>}</div>
                    <div className="trip-total"><span>Total du séjour</span><strong>{booking.total} €</strong></div>
                    <div className="trip-cancellation"><button type="button" className="text-button" disabled={!canCancelBooking(booking) || Boolean(cancellingBookingId)} onClick={() => void cancelBooking(booking)}>{cancellingBookingId === booking.id ? 'Annulation…' : booking.status === 'cancelled' ? 'Réservation annulée' : 'Annuler la réservation'}</button><small>Possible jusqu’à la veille de l’arrivée (heure de Martinique).</small></div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={<CalendarDays size={25} />} title="Votre prochaine histoire vous attend" text="Quand vous réservez un séjour, il apparaît ici. À vous les beaux départs." action="Explorer les séjours" onClick={() => setView('stays')} />
            )
          ) : visibleStays.length ? (
            <div className="stay-grid">
              {visibleStays.map((stay, index) => (
                <article className="stay-card" key={stay.id}>
                  <button className="stay-photo" onClick={() => setSelectedStay(stay)} aria-label={`Voir ${stay.title}`}>
                    <img src={photoUrl(stay.image, 720)} alt={stay.title} loading={index > 5 ? 'lazy' : 'eager'} />
                    {stay.badge && <span className="photo-badge">{stay.badge}</span>}
                    <span className="photo-count"><span /> <span /> <span /> <span /> <span /></span>
                  </button>
                  <button className={`favorite-button ${favorites.includes(stay.id) ? 'is-favorite' : ''}`} onClick={() => toggleFavorite(stay)} aria-label={favorites.includes(stay.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'} aria-pressed={favorites.includes(stay.id)}>
                    <Heart size={20} fill={favorites.includes(stay.id) ? 'currentColor' : 'none'} strokeWidth={1.8} />
                  </button>
                  <button className="stay-details" onClick={() => setSelectedStay(stay)}>
                    <div className="stay-title-row"><h3>{stay.location}</h3><span><Star size={14} fill="currentColor" /> {stay.reviews ? stay.rating.toFixed(2) : 'Nouveau'}</span></div>
                    <p className="stay-name">{stay.title}</p>
                    <p className="stay-host"><span className="stay-host-avatar">{stay.hostAvatarUrl ? <img src={stay.hostAvatarUrl} alt="" /> : stay.host.slice(0, 1).toUpperCase()}</span>Hôte : {stay.host} · {stay.category}</p>
                    <p className="stay-price"><strong>{stay.price} €</strong> <span>/ nuit</span> <span className="price-total">· détail du prix</span></p>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={favoritesOnly ? <Heart size={25} /> : <Search size={25} />} title={favoritesOnly ? 'Aucun coup de cœur pour le moment' : 'Aucune adresse trouvée'} text={favoritesOnly ? 'Touchez le cœur sur une adresse pour la garder près de vous.' : 'Essayez une autre destination ou élargissez un peu vos filtres.'} action={favoritesOnly ? 'Découvrir les séjours' : 'Effacer les filtres'} onClick={resetFilters} />
          )}
          </>}
        </section>

        <section className="host-banner">
          <div className="host-illustration"><Home size={31} strokeWidth={1.4} /><span className="illustration-sun" /></div>
          <div><p className="results-kicker">ET SI VOUS OUVRIEZ VOTRE PORTE ?</p><h2>Les plus beaux séjours commencent chez vous.</h2><p>Partagez votre adresse avec des voyageurs qui en prendront soin.</p></div>
          <button className="button-dark" onClick={openHost}>Devenir hôte <ArrowRight size={16} /></button>
        </section>
      </main>

      <footer className="site-footer"><span>© {new Date().getFullYear()} Foyaltoloman</span><span>Des séjours choisis avec soin, partout en France.</span><button onClick={() => setToast('Une question ? Écrivez-nous à bonjour@foyaltoloman.fr')}>Besoin d’aide ?</button></footer>

      {selectedStay && <StayModal stay={selectedStay} onClose={() => setSelectedStay(null)} onFavorite={() => toggleFavorite(selectedStay)} isFavorite={favorites.includes(selectedStay.id)} onBook={() => openBooking(selectedStay)} />}
      {selectedReservation && <ReservationDetailsModal reservation={selectedReservation} onClose={() => setSelectedReservation(null)} />}
      {bookingStay && <BookingModal stay={bookingStay} addons={bookingAddons} blockedRanges={blockedRanges} initialCheckIn={checkIn} initialCheckOut={checkOut} initialGuests={guests} onClose={() => { setBookingStay(null); setPreviewAddon(null) }} onPreviewAddon={setPreviewAddon} onConfirm={confirmBooking} />}
      {stripeModalOpen && stripeClientSecret && <StripeCheckoutModal clientSecret={stripeClientSecret} onClose={() => { setStripeModalOpen(false); setStripeClientSecret('') }} />}
      {previewAddon && <Modal title={previewAddon.name} subtitle="Aperçu de cette option" onClose={() => setPreviewAddon(null)} wide><div className="addon-preview-modal"><img src={photoUrl(previewAddon.imageUrl, 1400)} alt={previewAddon.name} /><p>{previewAddon.description}</p></div></Modal>}
      {loginOpen && <Modal title={authMode === 'register' ? 'Créez votre compte' : 'Ravi de vous retrouver'} subtitle="Votre compte sécurisé vous suit sur tous vos appareils." onClose={() => { setLoginOpen(false); setPendingStay(null); setPendingFavorite(null); setPendingHost(false) }}><form className="dialog-form" onSubmit={submitLogin}>
        {googleEnabled && <a className="google-login full-button" href="/api/auth/google" onClick={() => {
          try {
            sessionStorage.setItem('foyaltoloman:pending-google-action', JSON.stringify({
              stayId: pendingStay?.id,
              favoriteId: pendingFavorite?.id,
              host: pendingHost,
            }))
          } catch (error) {
            console.error('Impossible de mémoriser l’action à reprendre après Google.', error)
          }
        }}><span aria-hidden="true">G</span> Continuer avec Google</a>}
        {googleEnabled && <p className="form-note">ou avec votre adresse e-mail</p>}
        {authMode === 'register' && <label>Votre prénom et nom<input name="name" autoComplete="name" placeholder="Camille Martin" required /></label>}
        <label>Votre adresse e-mail<input name="email" type="email" autoComplete="email" placeholder="camille@exemple.fr" required /></label>
        <label>Mot de passe<input name="password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={authMode === 'register' ? 8 : 1} maxLength={128} required /></label>
        <button className="button-dark full-button" type="submit">{authMode === 'register' ? 'Créer mon compte' : 'Se connecter'} <ArrowRight size={16} /></button>
        <button type="button" className="text-button" onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}>{authMode === 'register' ? 'J’ai déjà un compte' : 'Créer un compte'}</button>
        <p className="form-note">Mot de passe haché et informations enregistrées de façon sécurisée.</p>
      </form></Modal>}
      {confirmationOpen && <Modal title="Reservation enregistree" subtitle="Votre sejour est confirme" onClose={() => setConfirmationOpen(false)}><div className="dialog-form confirmation-content"><div className="empty-icon"><Check size={25} /></div><p>Votre reservation a bien ete enregistree.</p><p className="form-note">La confirmation sera envoyee par e-mail{profile?.email ? ` a ${profile.email}` : ''}.</p><button className="button-dark full-button" onClick={() => setConfirmationOpen(false)}>Voir mes voyages <ArrowRight size={16} /></button></div></Modal>}
      {toast && <div className="toast" role="status"><Check size={17} /> {toast}</div>}
    </div>
  )
}

function MessagesPanel({
  isSuperhost,
  token,
  onMessageChanged,
  conversations,
  activeConversationId,
  messageDraft,
  messageFilter,
  messageSearch,
  onDraftChange,
  onFilterChange,
  onSearchChange,
  onSelectConversation,
  onSend,
  onShowReservation,
}: {
  isSuperhost: boolean
  token: string
  onMessageChanged: (conversationId: string, messageId: string, body: string | null) => void
  conversations: Conversation[]
  activeConversationId: string
  messageDraft: string
  messageFilter: 'all' | 'unread'
  messageSearch: string
  onDraftChange: (value: string) => void
  onFilterChange: (value: 'all' | 'unread') => void
  onSearchChange: (value: string) => void
  onSelectConversation: (id: string) => void
  onSend: (event: FormEvent<HTMLFormElement>) => void
  onShowReservation: (reservation: ReservationSummary) => void
}) {
  const [contextMenu, setContextMenu] = useState<{ message: ConversationMessage; conversationId: string; x: number; y: number } | null>(null)
  const [editingMessage, setEditingMessage] = useState<{ id: string; conversationId: string; body: string } | null>(null)
  const [mutationBusy, setMutationBusy] = useState(false)
  const [messagingSettingsOpen, setMessagingSettingsOpen] = useState(false)
  const [mutationError, setMutationError] = useState('')
  useEffect(() => {
    const close = () => setContextMenu(null)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', key); window.removeEventListener('scroll', close, true) }
  }, [])
  const mutateMessage = async (conversationId: string, id: string, body: string | null) => {
    if (mutationBusy) return
    setMutationBusy(true); setMutationError(''); setContextMenu(null)
    try {
      const result = await apiRequest<{ message: { body: string } }>(`/conversations/${conversationId}/messages/${id}`, token, body === null ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify({ body }) })
      onMessageChanged(conversationId, id, body === null ? null : result.message.body)
      setEditingMessage(null)
    } catch (error) { setMutationError(error instanceof Error ? error.message : 'Opération impossible.') } finally { setMutationBusy(false) }
  }
  const filteredConversations = conversations.filter((conversation) => {
    const matchesFilter = messageFilter === 'all' || conversation.unread > 0
    const haystack = `${conversation.guestName} ${conversation.property} ${conversation.preview}`.toLocaleLowerCase('fr')
    return matchesFilter && haystack.includes(messageSearch.trim().toLocaleLowerCase('fr'))
  })
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0]

  return (
    <div className="messages-page">
      {isSuperhost && messagingSettingsOpen && <MessagingSettings token={token} onClose={() => setMessagingSettingsOpen(false)} onDraft={onDraftChange} conversations={conversations} onSelect={onSelectConversation} />}
      {mutationError && <p role="alert" className="wizard-error">{mutationError}</p>}
      {contextMenu && <div className="message-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
        <button role="menuitem" disabled={mutationBusy} onClick={() => { setEditingMessage({ id: contextMenu.message.id, conversationId: contextMenu.conversationId, body: contextMenu.message.text }); setContextMenu(null) }}>Modifier</button>
        <button role="menuitem" disabled={mutationBusy} onClick={() => { if (window.confirm('Supprimer définitivement ce message ?')) void mutateMessage(contextMenu.conversationId, contextMenu.message.id, null) }}>Supprimer</button>
      </div>}
      {editingMessage && <Modal title="Modifier le message" onClose={() => { if (!mutationBusy) setEditingMessage(null) }}><form className="dialog-form" onSubmit={(event) => { event.preventDefault(); void mutateMessage(editingMessage.conversationId, editingMessage.id, editingMessage.body) }}><textarea aria-label="Message à modifier" rows={6} maxLength={5000} required value={editingMessage.body} onChange={(event) => setEditingMessage({ ...editingMessage, body: event.target.value })} /><button className="button-dark" disabled={mutationBusy}>Enregistrer</button></form></Modal>}
      <div className="messages-heading">
        <div><p className="results-kicker">VOTRE BOÎTE DE RÉCEPTION</p><h2>Messages</h2><p>Échangez simplement avec vos voyageurs et vos hôtes, avant, pendant et après le séjour.</p></div>
        <div className="messaging-heading-actions"><span className="messages-secure"><MessageCircle size={15} /> Messagerie sécurisée</span>{isSuperhost && <button className="messaging-settings-trigger" onClick={() => setMessagingSettingsOpen(true)} aria-haspopup="dialog"><SettingsIcon size={18} /> Paramètres</button>}</div>
      </div>
      <div className="messages-layout">
        <aside className="conversation-sidebar">
          <div className="conversation-tools">
            <label className="message-search"><Search size={16} /><input value={messageSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="Rechercher une conversation" aria-label="Rechercher une conversation" /></label>
            <div className="message-filters"><button className={messageFilter === 'all' ? 'selected' : ''} onClick={() => onFilterChange('all')}>Toutes</button><button className={messageFilter === 'unread' ? 'selected' : ''} onClick={() => onFilterChange('unread')}>Non lues</button></div>
          </div>
          <div className="conversation-list">
            {filteredConversations.length ? filteredConversations.map((conversation) => (
              <button className={`conversation-item ${activeConversationId === conversation.id ? 'active' : ''}`} key={conversation.id} onClick={() => onSelectConversation(conversation.id)}>
                <span className="conversation-avatar-wrap"><span className="conversation-avatar" style={{ background: conversation.avatar }}>{conversation.avatarUrl ? <img src={conversation.avatarUrl} alt="" /> : conversation.guestInitials}</span><img className="conversation-property-thumb" src={photoUrl(conversation.propertyImage, 120)} alt="" /></span>
                <span className="conversation-copy"><span className="conversation-topline"><strong>{conversation.guestName}</strong><small>{conversation.time}</small></span><span className="conversation-property">{conversation.property} · {conversation.dates}</span><span className="conversation-preview">{conversation.preview}</span></span>
                {conversation.unread > 0 && <span className="unread-badge">{conversation.unread}</span>}
              </button>
            )) : <p className="messages-empty">Aucune conversation trouvée.</p>}
          </div>
        </aside>
        {activeConversation ? <section className="conversation-panel">
          <header className="conversation-header"><span className="conversation-avatar-wrap large"><span className="conversation-avatar large" style={{ background: activeConversation.avatar }}>{activeConversation.avatarUrl ? <img src={activeConversation.avatarUrl} alt="" /> : activeConversation.guestInitials}</span><img className="conversation-property-thumb" src={photoUrl(activeConversation.propertyImage, 120)} alt="" /></span><div><h3>{activeConversation.guestName}</h3><p>{activeConversation.property} · {activeConversation.location}</p></div><button className="conversation-action" aria-label="Voir la réservation"><CalendarDays size={17} /><span>Réservation</span></button></header>
          <div className="conversation-context"><span>{activeConversation.dates}</span><span>·</span><span>Échange avec votre hôte</span></div>
          <div className="message-stream">
            <div className="message-day">Aujourd’hui</div>
            {activeConversation.messages.map((message) => {
              const confirmationLabel = 'Afficher la réservation'
              const isConfirmation = message.text.includes('Réservation confirmée') && message.text.endsWith(confirmationLabel)
              return <div className={`message-row ${message.author === 'host' ? 'mine' : ''}`} key={message.id}><div tabIndex={message.author === 'host' && !isConfirmation ? 0 : undefined} onContextMenu={(event) => { if (message.author !== 'host' || isConfirmation) return; event.preventDefault(); setContextMenu({ message, conversationId: activeConversation.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 180)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 100)) }) }} className={`message-bubble ${isConfirmation ? 'booking-confirmation-bubble' : ''}`}>
                {isConfirmation ? <><div className="message-html" dangerouslySetInnerHTML={{ __html: messageHtml(message.text.slice(0, -confirmationLabel.length).trim()) }} /><button className="booking-message-link" type="button" onClick={() => activeConversation.reservation && onShowReservation(activeConversation.reservation)}>{confirmationLabel} <ArrowRight size={12} /></button></> : <div className="message-html" dangerouslySetInnerHTML={{ __html: messageHtml(message.text) }} />}
                <Attachments files={message.attachments ?? []} token={token} />
                <small>{message.time}{message.author === 'host' && <span> · ✓✓</span>}</small>
              </div></div>
            })}
          </div>
          <form className="message-composer" onSubmit={onSend}><button type="button" aria-label="Ajouter une pièce jointe"><Paperclip size={18} /></button><textarea value={messageDraft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Écrire un message HTML..." aria-label="Écrire un message" rows={2} /><button className="send-message" type="submit" aria-label="Envoyer le message" disabled={!messageDraft.trim()}><Send size={17} /></button></form>
          <p className="message-note">HTML autorisé : liens, paragraphes, listes et mise en forme. Les scripts sont bloqués.</p>
        </section> : <div className="messages-empty-panel">Sélectionnez une conversation pour commencer.</div>}
      </div>
    </div>
  )
}

function ReservationDetailsModal({ reservation, onClose }: { reservation: ReservationSummary; onClose: () => void }) {
  const statusLabel = reservation.status === 'confirmed' ? 'Confirmée' : reservation.status === 'pending' ? 'En attente' : reservation.status === 'completed' ? 'Terminée' : 'Annulée'
  return <Modal title="Détails de la réservation" subtitle={reservation.title} onClose={onClose} wide>
    <div className="reservation-details-modal">
      <img className="modal-stay-image" src={photoUrl(reservation.image, 1000)} alt={reservation.title} />
      <div className="reservation-details-copy"><span className="trip-status"><Check size={13} /> {statusLabel}</span><h3>{reservation.title}</h3><p>{reservation.location}</p></div>
      <div className="reservation-details-grid"><div><span>Arrivée</span><strong>{formatDate(reservation.checkIn)}</strong></div><div><span>Départ</span><strong>{formatDate(reservation.checkOut)}</strong></div><div><span>Voyageurs</span><strong>{reservation.guests} voyageur{reservation.guests > 1 ? 's' : ''}</strong></div><div><span>Total</span><strong>{formatEuro(reservation.total)}</strong></div></div>
    </div>
  </Modal>
}

function EmptyState({ icon, title, text, action, onClick }: { icon: React.ReactNode; title: string; text: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{text}</p><button className="button-dark" onClick={onClick}>{action} <ArrowRight size={15} /></button></div>
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><button className="dialog-close" onClick={onClose} aria-label="Fermer"><X size={20} /></button><div className="dialog-heading"><p className="results-kicker">BIENVENUE CHEZ FOYALTOLOMAN</p><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children}</section></div>
}

function StayModal({ stay, onClose, onFavorite, isFavorite, onBook }: { stay: Stay; onClose: () => void; onFavorite: () => void; isFavorite: boolean; onBook: () => void }) {
  return <Modal title={stay.title} subtitle={`${stay.location} · Hôte : ${stay.host}`} onClose={onClose} wide><div className="stay-modal-content"><img className="modal-stay-image" src={photoUrl(stay.image, 1200)} alt={stay.title} /><div className="stay-modal-summary"><span><Star size={15} fill="currentColor" /> {stay.reviews ? `${stay.rating.toFixed(2)} · ${stay.reviews} avis` : 'Tout nouveau sur Foyaltoloman'}</span><p>{stay.description}</p><div className="amenities">{stay.amenities.map((amenity, index) => <span key={amenity}>{index % 2 ? <BedDouble size={17} /> : <Bath size={17} />}{amenity}</span>)}</div>{stay.airbnbUrl && <a className="external-listing-link" href={stay.airbnbUrl} target="_blank" rel="noreferrer">Voir l'annonce sur Airbnb <ArrowRight size={15} /></a>}</div><div className="modal-booking-bar"><div><strong>{stay.price} €</strong> <span>/ nuit</span><small> · tarif provisoire à confirmer</small></div><div className="modal-book-actions"><button className={`modal-heart ${isFavorite ? 'is-favorite' : ''}`} onClick={onFavorite} aria-label="Ajouter aux favoris"><Heart size={19} fill={isFavorite ? 'currentColor' : 'none'} /></button><button className="button-dark" onClick={onBook}>Réserver <ArrowRight size={16} /></button></div></div></div></Modal>
}

function StripeCheckoutModal({ clientSecret, onClose }: { clientSecret: string; onClose: () => void }) {
  const checkoutContainer = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let checkout: EmbeddedCheckout | undefined
    let cancelled = false

    const mountCheckout = async () => {
      try {
        const { publishableKey } = await apiRequest<{ publishableKey: string }>('/stripe/config')
        if (!publishableKey || !window.Stripe) throw new Error('La clé publique Stripe n’est pas configurée.')
        const stripe = window.Stripe(publishableKey)
        checkout = await stripe.initEmbeddedCheckout({ fetchClientSecret: async () => clientSecret })
        if (!cancelled && checkoutContainer.current) {
          checkout.mount(checkoutContainer.current)
          setLoading(false)
        }
      } catch (mountError) {
        if (!cancelled) {
          setLoading(false)
          console.error(mountError)
          setError('Un incident est survenu lors du paiement de votre réservation, veuillez réessayer de nouveau. Votre réservation n’a pas été confirmée.')
        }
      }
    }

    void mountCheckout()
    return () => {
      cancelled = true
      checkout?.unmount()
    }
  }, [clientSecret])

  return <Modal title="Paiement sécurisé" subtitle="Réglez votre réservation directement dans Foyaltoloman" onClose={onClose} wide><div className="stripe-checkout-shell">{loading && <p className="stripe-checkout-status">Chargement du paiement sécurisé…</p>}{error ? <div className="stripe-checkout-error"><strong>Paiement indisponible</strong><p>{error}</p><button className="button-dark" onClick={onClose}>Fermer</button></div> : <div ref={checkoutContainer} className="stripe-checkout-container" />}</div></Modal>
}

function BookingModal({ stay, addons, blockedRanges, initialCheckIn, initialCheckOut, initialGuests, onClose, onPreviewAddon, onConfirm }: { stay: Stay; addons: BookingAddon[]; blockedRanges: BookingRange[]; initialCheckIn: string; initialCheckOut: string; initialGuests: number; onClose: () => void; onPreviewAddon: (addon: BookingAddon) => void; onConfirm: (stay: Stay, checkIn: string, checkOut: string, guests: number, addOns: { id: string; quantity: number }[]) => void }) {
  const [start, setStart] = useState(initialCheckIn)
  const [end, setEnd] = useState(initialCheckOut)
  const [guestCount, setGuestCount] = useState(initialGuests)
  const [selectedAddonQuantities, setSelectedAddonQuantities] = useState<Record<string, number>>({})
  const nights = nightCount(start, end)
  const subtotal = stay.price * nights
  const serviceFee = Math.round(subtotal * 0.12)
  const selectedAddons = addons.flatMap((addon) => {
    const quantity = selectedAddonQuantities[addon.id]
    return quantity ? [{ ...addon, quantity }] : []
  })
  const addonsTotal = selectedAddons.reduce((total, addon) => total + addon.price * addon.quantity, 0)
  const groupedAddons = addonCategories
    .map((category) => ({ category, items: addons.filter((addon) => addon.category === category) }))
    .filter((group) => group.items.length > 0)
  const toggleAddon = (addonId: string, selected: boolean) => {
    setSelectedAddonQuantities((current) => {
      if (selected) return { ...current, [addonId]: current[addonId] || 1 }
      const next = { ...current }
      delete next[addonId]
      return next
    })
  }
  const setAddonQuantity = (addonId: string, quantity: number) => {
    setSelectedAddonQuantities((current) => ({ ...current, [addonId]: quantity }))
  }
  const updateDates = (nextStart: string, nextEnd: string) => {
    setStart(nextStart)
    setEnd(nextEnd)
  }

  return <Modal title="Confirmez votre séjour" subtitle={stay.location} onClose={onClose}>
    <div className="booking-preview"><img src={photoUrl(stay.image, 360)} alt="" /><div><strong>{stay.title}</strong><span><Star size={13} fill="currentColor" /> {stay.reviews ? stay.rating.toFixed(2) : 'Nouveau'} · {stay.category}</span></div></div>
    <form className="dialog-form booking-form" onSubmit={(event) => { event.preventDefault(); onConfirm(stay, start, end, guestCount, selectedAddons.map(({ id, quantity }) => ({ id, quantity }))) }}>
      <div className="form-row">
        <label>Arrivée<input type="text" value={start ? start.split('-').reverse().join('/') : ''} placeholder="Choisir dans le calendrier" readOnly aria-describedby="booking-date-help" /></label>
        <label>Départ<input type="text" value={end ? end.split('-').reverse().join('/') : ''} placeholder="Choisir dans le calendrier" readOnly aria-describedby="booking-date-help" /></label>
      </div>
      <CalendarPicker start={start} end={end} blockedRanges={blockedRanges} onChange={updateDates} />
      <p id="booking-date-help" className="form-note">Sélectionnez vos dates dans le calendrier de disponibilités.</p>
      {blockedRanges.length > 0 && <p className="form-note booking-availability-note">Les journées dorées sont déjà réservées. Le jour de départ reste disponible pour une nouvelle arrivée.</p>}
      <label>Voyageurs<select value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} voyageur{count > 1 ? 's' : ''}</option>)}</select></label>
      {addons.length > 0 && <fieldset className="addon-section">
        <legend>Personnalisez votre séjour</legend>
        <p>Choisissez vos options. Les horaires anticipés et tardifs restent soumis à disponibilité.</p>
        <div className="addon-categories">
          {groupedAddons.map(({ category, items }, index) => <details className="addon-category" key={category} open={index === 0}>
            <summary><span>{category}</span><small>{items.length} option{items.length > 1 ? 's' : ''}</small></summary>
            <div className="addon-list">
              {items.map((addon) => {
                const quantity = selectedAddonQuantities[addon.id] || 1
                const selected = selectedAddonQuantities[addon.id] !== undefined
                return <div className={`addon-option ${selected ? 'addon-selected' : ''}`} key={addon.id}>
                  <div className="addon-choice">
                    <input id={`addon-${addon.id}`} type="checkbox" checked={selected} onChange={(event) => toggleAddon(addon.id, event.target.checked)} />
                    <button className="addon-thumb" type="button" onClick={() => onPreviewAddon(addon)} aria-label={`Agrandir l’image : ${addon.name}`}>
                      <img src={photoUrl(addon.imageUrl, 180)} alt="" loading="lazy" />
                    </button>
                    <label className="addon-copy" htmlFor={`addon-${addon.id}`}><strong>{addon.name}</strong><small>{addon.description}</small></label>
                  </div>
                  <div className="addon-actions">
                    <span className="addon-price">{formatEuro(addon.price)}{addon.priceUnit === 'hour' ? ' / h' : ''}</span>
                    {selected && addon.priceUnit === 'hour' && <label className="addon-duration">Durée
                      <select aria-label={`Durée pour ${addon.name}`} value={quantity} onChange={(event) => setAddonQuantity(addon.id, Number(event.target.value))}>
                        {Array.from({ length: 12 }, (_, hour) => hour + 1).map((hour) => <option key={hour} value={hour}>{hour} h</option>)}
                      </select>
                    </label>}
                  </div>
                </div>
              })}
            </div>
          </details>)}
        </div>
      </fieldset>}
      <div className="price-breakdown">
        <div><span>{stay.price} € × {nights} nuit{nights > 1 ? 's' : ''}</span><span>{subtotal} €</span></div>
        <div><span>Frais de service</span><span>{serviceFee} €</span></div>
        <div><span>Ménage</span><span>{formatEuro(stay.cleaningFee)}</span></div>
        {selectedAddons.map((addon) => <div key={addon.id}><span>{addon.name}{addon.priceUnit === 'hour' ? ` × ${addon.quantity} h` : ''}</span><span>{formatEuro(addon.price * addon.quantity)}</span></div>)}
        <div className="price-total-line"><strong>Total</strong><strong>{formatEuro(subtotal + serviceFee + stay.cleaningFee + addonsTotal)}</strong></div>
      </div>
      <button className="button-dark full-button" type="submit">Payer avec Stripe <Check size={17} /></button>
      <p className="form-note">Votre réservation sera enregistrée uniquement après confirmation du paiement.</p>
    </form>
  </Modal>
}

export default App
