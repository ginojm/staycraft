import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OAuth2Client } from 'google-auth-library'
import Stripe from 'stripe'
import { pool } from './db.js'
import { registerScheduledMessages } from './scheduled-messages.js'
import { sendBookingConfirmation } from './mail.js'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const jwtSecret = process.env.JWT_SECRET
const distDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI
const googleOAuthClient = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && googleRedirectUri
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, googleRedirectUri)
  : null
const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:5173'
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters.')
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", 'https://js.stripe.com'],
      connectSrc: ["'self'", 'https://api.stripe.com', 'https://r.stripe.com'],
      frameSrc: ["'self'", 'blob:', 'https://js.stripe.com', 'https://checkout.stripe.com', 'https://hooks.stripe.com'],
      imgSrc: ["'self'", 'blob:', 'data:', 'https:'],
    },
  },
}))
app.use(cookieParser())
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

app.get('/api/stripe/config', (_req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' })
})

async function completeStripeCheckout(session) {
  let reservationId = session.metadata?.reservationId
  const draftId = session.metadata?.draftId
  if ((!reservationId && !draftId) || session.payment_status !== 'paid') return

  const client = await pool.connect()
  let confirmationEmailPending = false
  let emailData
  try {
    await client.query('BEGIN')
    if (draftId) {
      const { rows: drafts } = await client.query('SELECT * FROM checkout_drafts WHERE id = $1 FOR UPDATE', [draftId])
      const draft = drafts[0]
      if (!draft || draft.stripe_session_id !== session.id) throw new Error('Invalid checkout draft')
      const data = draft.payload
      if (session.amount_total !== Math.round(data.total * 100) || session.currency !== 'eur') throw new Error('Stripe amount mismatch')
      reservationId = draft.reservation_id
      if (!reservationId) {
        const result = await client.query(
          `INSERT INTO reservations (listing_id, guest_id, check_in, check_out, guests, price_per_night, service_fee, cleaning_fee, total_amount, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed') RETURNING id`,
          [data.listingId, draft.guest_id, data.checkIn, data.checkOut, data.guests, data.price, data.serviceFee, data.cleaningFee, data.total],
        )
        reservationId = result.rows[0].id
        for (const addon of data.addons) {
          await client.query(
            `INSERT INTO reservation_addons (reservation_id, addon_id, code_snapshot, name_snapshot, unit_price, quantity, line_total, billing_unit_snapshot)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [reservationId, addon.id, addon.code, addon.name, addon.price, addon.quantity, Math.round(addon.price * 100) * addon.quantity / 100, addon.price_unit],
          )
        }
        await client.query('UPDATE checkout_drafts SET reservation_id = $2 WHERE id = $1', [draftId, reservationId])
      }
    }
    const { rows } = await client.query(
      `SELECT r.id, r.guest_id, r.total_amount, r.status, r.check_in, r.check_out,
              r.guests, l.id AS listing_id, l.host_id, l.title
              , u.full_name AS guest_name, u.email
       FROM reservations r
       JOIN users u ON u.id = r.guest_id
       JOIN listings l ON l.id = r.listing_id
       WHERE r.id = $1 FOR UPDATE`,
      [reservationId],
    )
    const reservation = rows[0]
    if (!reservation) {
      await client.query('ROLLBACK')
      return
    }
    if (reservation.status === 'cancelled') {
      await client.query('ROLLBACK')
      return
    }

    const expectedAmount = Math.round(Number(reservation.total_amount) * 100)
    if (session.amount_total !== expectedAmount || session.currency !== 'eur') {
      await client.query('ROLLBACK')
      throw new Error(`Stripe amount mismatch for reservation ${reservationId}`)
    }

    if (reservation.status === 'pending') {
      await client.query(
        `UPDATE reservations SET status = 'confirmed', expires_at = NULL
         WHERE id = $1 AND status = 'pending'`,
        [reservationId],
      )
    }
    const { rows: conversationRows } = await client.query(
      `INSERT INTO conversations (reservation_id, listing_id) VALUES ($1, $2)
       ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL
       DO UPDATE SET reservation_id = EXCLUDED.reservation_id
       RETURNING id`,
      [reservation.id, reservation.listing_id],
    )
    const conversationId = conversationRows[0].id
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id)
       VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
      [conversationId, reservation.guest_id, reservation.host_id],
    )
    const confirmationBody = `Réservation confirmée · ${reservation.guests} voyageur${reservation.guests > 1 ? 's' : ''}, ${formatConfirmationDate(reservation.check_in)}–${formatConfirmationDate(reservation.check_out)}. Afficher la réservation`
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, body, status, is_system)
       SELECT $1, $2, $3, 'sent', true
       WHERE NOT EXISTS (
         SELECT 1 FROM messages WHERE conversation_id = $1 AND sender_id = $2 AND body = $3
       )`,
      [conversationId, reservation.guest_id, confirmationBody],
    )
    await client.query(
      `INSERT INTO notifications (user_id, kind, payload)
       SELECT user_id, 'new_message', jsonb_build_object('conversationId', ($2::uuid)::text)
       FROM conversation_participants WHERE conversation_id = $2::uuid
         AND (user_id = $1::uuid OR user_id IN (SELECT id FROM users WHERE lower(email) = 'foyal.toloman@gmail.com'))`,
      [reservation.host_id, conversationId],
    )
    const { rows: paymentRows } = await client.query(
      `INSERT INTO payment_transactions
        (reservation_id, amount, currency, provider, provider_payment_id, idempotency_key, status, metadata)
       VALUES ($1, $2, 'EUR', 'stripe', $3, $4, 'paid', $5::jsonb)
       ON CONFLICT (idempotency_key) DO UPDATE
       SET status = 'paid', provider_payment_id = EXCLUDED.provider_payment_id,
           metadata = EXCLUDED.metadata, updated_at = now()
       RETURNING confirmation_email_sent_at`,
      [reservationId, Number(reservation.total_amount), session.id, `stripe:${session.id}`, JSON.stringify({ checkoutSessionId: session.id })],
    )
    confirmationEmailPending = !paymentRows[0]?.confirmation_email_sent_at
    emailData = {
      to: reservation.email,
      guestName: reservation.guest_name,
      title: reservation.title,
      checkIn: dateOnly(reservation.check_in),
      checkOut: dateOnly(reservation.check_out),
      total: Number(reservation.total_amount),
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (draftId && error.code === '23P01' && session.payment_intent) {
      await stripe.refunds.create({ payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id }, { idempotencyKey: `unavailable:${session.id}` })
    }
    throw error
  } finally {
    client.release()
  }

  if (confirmationEmailPending && emailData) {
    const sent = await sendBookingConfirmation(emailData)
    if (sent) {
      await pool.query(
        `UPDATE payment_transactions
         SET confirmation_email_sent_at = now(), updated_at = now()
         WHERE provider = 'stripe' AND provider_payment_id = $1
           AND confirmation_email_sent_at IS NULL`,
        [session.id],
      )
    }
  }
}

function formatConfirmationDate(value) {
  const normalized = dateOnly(value)
  if (!normalized) return ''
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${normalized}T12:00:00Z`))
    .replace('.', '')
}

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), asyncRoute(async (req, res) => {
  if (!stripe || !stripeWebhookSecret) return res.status(503).json({ error: 'Le webhook Stripe n’est pas configuré.' })
  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), stripeWebhookSecret)
  } catch (error) {
    console.error('Stripe webhook signature failed:', error.message)
    return res.status(400).json({ error: 'Signature Stripe invalide.' })
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    await completeStripeCheckout(event.data.object)
  } else if (event.type === 'checkout.session.expired') {
    const reservationId = event.data.object.metadata?.reservationId
    if (reservationId) {
      await pool.query(
        `UPDATE reservations SET status = 'cancelled'
         WHERE id = $1 AND status = 'pending'`,
        [reservationId],
      )
    }
  }
  res.json({ received: true })
}))

app.use('/api/admin/scheduled-messages', express.json({ limit: '15mb' }))
app.use(express.json({ limit: '512kb' }))

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
})

const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase())
const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: z.string().min(8).max(128),
})
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) })
const safeUser = ({ id, full_name, first_name, last_name, email, avatar_url, address, phone, is_active }) => ({
  id,
  name: full_name,
  firstName: first_name || full_name?.split(' ')[0] || '',
  lastName: last_name || full_name?.split(' ').slice(1).join(' ') || '',
  email,
  avatarUrl: avatar_url || '',
  address: address || '',
  phone: phone || '',
  active: is_active !== false,
})
const tokenFor = (user) => jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d', issuer: 'foyaltoloman-api' })
const oauthStateCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth/google/callback',
}

function googleResultUrl(key, value) {
  const url = new URL('/', appBaseUrl)
  url.hash = new URLSearchParams({ [key]: value }).toString()
  return url.toString()
}

async function requireAuth(req, res, next) {
  const authorization = req.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise.' })
  }

  try {
    const payload = jwt.verify(authorization.slice(7), jwtSecret, { issuer: 'foyaltoloman-api' })
    const { rows } = await pool.query('SELECT is_active FROM users WHERE id = $1', [payload.sub])
    if (!rows[0] || !rows[0].is_active) return res.status(403).json({ error: 'Ce compte est désactivé.' })
    req.userId = payload.sub
    return next()
  } catch {
    return res.status(401).json({ error: 'Votre session a expiré. Reconnectez-vous.' })
  }
}

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      return res.status(400).json({
        error: 'Données invalides.',
        details: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
      })
    }
    if (source === 'query') req.validatedQuery = result.data
    else req[source] = result.data
    return next()
  }
}

function validateUuidParam(name) {
  return (req, res, next) => {
    if (!z.uuid().safeParse(req.params[name]).success) {
      return res.status(400).json({ error: 'Identifiant invalide.' })
    }
    return next()
  }
}

function listingFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    location: [row.city, row.country].filter(Boolean).join(', '),
    region: row.region,
    price: Number(row.price_per_night),
    rating: Number(row.average_rating),
    reviews: Number(row.review_count),
    category: row.category,
    image: row.cover_image_url,
    hostId: row.host_id,
    hostAvatarUrl: row.host_avatar_url || '',
    host: row.host_name,
    badge: row.badge || undefined,
    airbnbUrl: row.external_url || undefined,
    description: row.description,
    amenities: row.amenities || [],
  }
}

const listingSelect = `
  SELECT l.*, u.full_name AS host_name, u.avatar_url AS host_avatar_url,
    COALESCE(array_agg(DISTINCT a.amenity) FILTER (WHERE a.amenity IS NOT NULL), '{}') AS amenities
  FROM listings l
  JOIN users u ON u.id = l.host_id
  LEFT JOIN listing_amenities a ON a.listing_id = l.id
`

function dateOnly(value) {
  if (!value) return ''
  if (value instanceof Date && Number.isNaN(value.getTime())) return ''
  const normalized = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
}

const bookingFromRow = (row) => ({
  id: row.id,
  stayId: row.listing_id,
  title: row.title,
  location: [row.city, row.country].filter(Boolean).join(', '),
  image: row.cover_image_url,
  checkIn: dateOnly(row.check_in),
  checkOut: dateOnly(row.check_out),
  guests: Number(row.guests),
  total: Number(row.total_amount),
  status: row.status,
  addons: (row.addons || []).map((addon) => ({
    name: addon.name,
    price: Number(addon.price),
    quantity: Number(addon.quantity),
    unitType: addon.unitType,
  })),
})

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok', database: 'connected' })
}))

async function expireUnpaidReservations() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE reservations SET status = 'cancelled'
       WHERE status = 'pending' AND expires_at <= now()`,
    )
    if (rowCount) console.log(`Expired ${rowCount} unpaid reservation(s)`)
  } catch (error) {
    console.error('Unable to expire unpaid reservations:', error)
  }
}

const reservationExpiryTimer = setInterval(expireUnpaidReservations, 60_000)
reservationExpiryTimer.unref()
void expireUnpaidReservations()

app.post('/api/auth/register', loginLimiter, validate(registerSchema), asyncRoute(async (req, res) => {
  const { name, email, password } = req.body
  const passwordHash = await bcrypt.hash(password, 12)
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, email',
      [name, email, passwordHash],
    )
    const user = rows[0]
    res.status(201).json({ user: safeUser(user), token: tokenFor(user) })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Cette adresse e-mail possède déjà un compte.' })
    throw error
  }
}))

app.post('/api/auth/login', loginLimiter, validate(loginSchema), asyncRoute(async (req, res) => {
  const { email, password } = req.body
  const { rows } = await pool.query('SELECT id, full_name, first_name, last_name, email, password_hash, avatar_url, address, phone, is_active FROM users WHERE email = $1', [email])
  const user = rows[0]
  const passwordMatches = user?.password_hash ? await bcrypt.compare(password, user.password_hash) : false
  if (!passwordMatches) return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect.' })
  if (!user.is_active) return res.status(403).json({ error: 'Ce compte est désactivé.' })
  res.json({ user: safeUser(user), token: tokenFor(user) })
}))

app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT id, full_name, first_name, last_name, email, avatar_url, address, phone, is_active FROM users WHERE id = $1', [req.userId])
  if (!rows[0]) return res.status(401).json({ error: 'Compte introuvable.' })
  res.json({ user: safeUser(rows[0]) })
}))

const accountSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: emailSchema,
  avatarUrl: z.union([
    z.string().trim().url().max(2048),
    z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).max(500000),
    z.literal(''),
  ]).default(''),
  address: z.string().trim().max(250).default(''),
  phone: z.string().trim().max(30).default(''),
}).refine(({ firstName, lastName }) => `${firstName} ${lastName}`.trim().length <= 120, { message: 'Le nom complet est trop long.', path: ['lastName'] })

app.patch('/api/account', requireAuth, validate(accountSchema), asyncRoute(async (req, res) => {
  const { firstName, lastName, email, avatarUrl, address, phone } = req.body
  try {
    const { rows } = await pool.query(
      `UPDATE users SET first_name=$2, last_name=$3, full_name=$4, email=$5, avatar_url=$6, address=$7, phone=$8, updated_at=now()
       WHERE id=$1 RETURNING id, full_name, first_name, last_name, email, avatar_url, address, phone, is_active`,
      [req.userId, firstName, lastName, `${firstName} ${lastName}`.trim(), email, avatarUrl, address, phone],
    )
    res.json({ user: safeUser(rows[0]) })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Cette adresse e-mail possède déjà un compte.' })
    throw error
  }
}))

app.get('/api/auth/providers', (_req, res) => {
  res.json({ googleEnabled: Boolean(googleOAuthClient) })
})

app.get('/api/auth/google', (req, res) => {
  if (!googleOAuthClient) {
    return res.status(503).json({ error: 'La connexion Google n’est pas encore configurée.' })
  }
  const state = randomBytes(32).toString('hex')
  res.cookie('foyaltoloman_google_state', state, { ...oauthStateCookieOptions, maxAge: 10 * 60 * 1000 })
  return res.redirect(googleOAuthClient.generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
    nonce: state,
  }))
})

app.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
  const stateCookie = req.cookies?.foyaltoloman_google_state
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  res.clearCookie('foyaltoloman_google_state', oauthStateCookieOptions)

  if (!googleOAuthClient) return res.redirect(googleResultUrl('auth_error', 'google_not_configured'))
  if (!stateCookie || !state || stateCookie.length !== state.length ||
      !timingSafeEqual(Buffer.from(stateCookie), Buffer.from(state))) {
    return res.redirect(googleResultUrl('auth_error', 'google_invalid_state'))
  }
  if (req.query.error) return res.redirect(googleResultUrl('auth_error', 'google_cancelled'))
  if (typeof req.query.code !== 'string') return res.redirect(googleResultUrl('auth_error', 'google_failed'))

  try {
    const { tokens } = await googleOAuthClient.getToken(req.query.code)
    if (!tokens.id_token) return res.redirect(googleResultUrl('auth_error', 'google_failed'))
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    const googleUser = ticket.getPayload()
    if (!googleUser?.sub || googleUser.nonce !== state || !googleUser.email || googleUser.email_verified !== true) {
      return res.redirect(googleResultUrl('auth_error', 'google_unverified_email'))
    }

    const email = googleUser.email.toLowerCase()
    const fullName = (googleUser.name?.trim() || email.split('@')[0] || 'Utilisateur Google').slice(0, 120)
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, email_verified_at, google_sub)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (email) DO UPDATE
       SET google_sub = COALESCE(users.google_sub, EXCLUDED.google_sub),
           email_verified_at = COALESCE(users.email_verified_at, EXCLUDED.email_verified_at)
       WHERE users.google_sub IS NULL OR users.google_sub = EXCLUDED.google_sub
       RETURNING id, full_name, email`,
      [fullName, email, googleUser.sub],
    )
    if (!rows[0]) return res.redirect(googleResultUrl('auth_error', 'google_account_conflict'))

    const code = randomBytes(32).toString('base64url')
    const codeHash = createHash('sha256').update(code).digest('hex')
    await pool.query(
      `DELETE FROM google_auth_codes
       WHERE expires_at <= now() OR consumed_at < now() - interval '1 day'`,
    )
    await pool.query(
      `INSERT INTO google_auth_codes (code_hash, user_id, expires_at)
       VALUES ($1, $2, now() + interval '5 minutes')`,
      [codeHash, rows[0].id],
    )
    return res.redirect(googleResultUrl('google_code', code))
  } catch (error) {
    console.error('Google OAuth callback failed:', error)
    return res.redirect(googleResultUrl('auth_error', 'google_failed'))
  }
}))

const googleCodeSchema = z.object({ code: z.string().min(32).max(128) })
app.post('/api/auth/google/exchange', loginLimiter, validate(googleCodeSchema), asyncRoute(async (req, res) => {
  const codeHash = createHash('sha256').update(req.body.code).digest('hex')
  const { rows } = await pool.query(
    `UPDATE google_auth_codes SET consumed_at = now()
     WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [codeHash],
  )
  if (!rows[0]) return res.status(401).json({ error: 'Le lien Google a expiré ou a déjà été utilisé.' })

  const { rows: users } = await pool.query(
    'SELECT id, full_name, first_name, last_name, email, avatar_url, address, phone, is_active FROM users WHERE id = $1',
    [rows[0].user_id],
  )
  if (!users[0]) return res.status(401).json({ error: 'Compte Google introuvable.' })
  if (!users[0].is_active) return res.status(403).json({ error: 'Ce compte est désactivé.' })
  return res.json({ user: safeUser(users[0]), token: tokenFor(users[0]) })
}))

const listingFiltersSchema = z.object({
  category: z.string().trim().max(80).optional(),
  q: z.string().trim().max(120).optional(),
  maxPrice: z.coerce.number().positive().max(100000).optional(),
})

app.get('/api/listings', validate(listingFiltersSchema, 'query'), asyncRoute(async (req, res) => {
  const { category, q, maxPrice } = req.validatedQuery
  const conditions = ["l.status = 'published'"]
  const params = []
  if (category) {
    params.push(category)
    conditions.push(`l.category = $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    conditions.push(`(l.city ILIKE $${params.length} OR l.region ILIKE $${params.length} OR l.title ILIKE $${params.length})`)
  }
  if (maxPrice) {
    params.push(maxPrice)
    conditions.push(`l.price_per_night <= $${params.length}`)
  }
  const { rows } = await pool.query(
     `${listingSelect} WHERE ${conditions.join(' AND ')} GROUP BY l.id, u.full_name, u.avatar_url ORDER BY l.created_at DESC`,
    params,
  )
  res.json({ listings: rows.map(listingFromRow) })
}))

app.get('/api/listings/:listingId/availability', validateUuidParam('listingId'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT check_in, check_out
     FROM reservations
     WHERE listing_id = $1
       AND status IN ('pending', 'confirmed')
       AND check_out >= CURRENT_DATE
     ORDER BY check_in`,
    [req.params.listingId],
  )
  res.json({ blocked: rows.map((row) => ({ checkIn: dateOnly(row.check_in), checkOut: dateOnly(row.check_out) })) })
}))

const createListingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  location: z.string().trim().min(2).max(180),
  price: z.coerce.number().positive().max(100000),
  category: z.string().trim().min(1).max(80),
  image: z.string().trim().url().max(2048),
  amenities: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
})

app.post('/api/listings', requireAuth, validate(createListingSchema), asyncRoute(async (req, res) => {
  const { title, description, location, price, category, image, amenities } = req.body
  const [city, ...locationParts] = location.split(',').map((part) => part.trim())
  const region = locationParts.length > 1 ? locationParts.slice(0, -1).join(', ') : city
  const country = locationParts.at(-1) || 'France'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO listings (host_id, title, description, city, region, country, category, price_per_night, cover_image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.userId, title, description, city, region, country, category, price, image],
    )
    const listingId = rows[0].id
    if (amenities.length) {
      await client.query(
        'INSERT INTO listing_amenities (listing_id, amenity) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING',
        [listingId, amenities],
      )
    }
    await client.query('COMMIT')
    const listing = await pool.query(
      `${listingSelect} WHERE l.id = $1 GROUP BY l.id, u.full_name, u.avatar_url`,
      [listingId],
    )
    res.status(201).json({ listing: listingFromRow(listing.rows[0]) })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.get('/api/favorites', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT listing_id FROM favorites WHERE user_id = $1 ORDER BY created_at DESC', [req.userId])
  res.json({ listingIds: rows.map((row) => row.listing_id) })
}))

const requireSuperhost = asyncRoute(async (req, res, next) => {
  const result = await pool.query("SELECT 1 FROM users WHERE id = $1 AND lower(email) = 'foyal.toloman@gmail.com'", [req.userId])
  if (!result.rowCount) return res.status(403).json({ error: 'Cette fonction est réservée au superhôte.' })
  next()
})

app.get('/api/admin/listings', requireAuth, requireSuperhost, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`${listingSelect} WHERE l.status <> 'archived' GROUP BY l.id, u.full_name, u.avatar_url ORDER BY l.created_at DESC`)
  res.json({ listings: rows.map((row) => ({ ...listingFromRow(row), status: row.status })) })
}))

app.get('/api/admin/hosts', requireAuth, requireSuperhost, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, full_name, email FROM users ORDER BY lower(full_name), lower(email)',
  )
  res.json({ hosts: rows.map(({ id, full_name, email }) => ({ id, name: full_name, email })) })
}))

app.get('/api/admin/users', requireAuth, requireSuperhost, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.created_at, u.is_active, u.avatar_url, count(l.id)::int AS listing_count
     FROM users u
     LEFT JOIN listings l ON l.host_id = u.id AND l.status <> 'archived'
     GROUP BY u.id
     ORDER BY lower(u.full_name), lower(u.email)`,
  )
  res.json({ users: rows.map(({ id, full_name, email, created_at, is_active, avatar_url, listing_count }) => ({ id, name: full_name, email, createdAt: created_at, active: is_active, avatarUrl: avatar_url || '', listingCount: listing_count })) })
}))

const accountStatusSchema = z.object({ active: z.boolean() })
app.patch('/api/admin/users/:userId/status', requireAuth, requireSuperhost, validateUuidParam('userId'), validate(accountStatusSchema), asyncRoute(async (req, res) => {
  if (req.params.userId === req.userId) return res.status(400).json({ error: 'Le superhôte ne peut pas désactiver son propre compte.' })
  const { rows } = await pool.query(
    'UPDATE users SET is_active=$2, updated_at=now() WHERE id=$1 RETURNING id, is_active',
    [req.params.userId, req.body.active],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable.' })
  res.json({ userId: rows[0].id, active: rows[0].is_active })
}))

const updateListingSchema = createListingSchema.omit({ amenities: true }).partial().extend({
  amenities: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  status: z.enum(['published', 'paused']).optional(),
  hostId: z.string().uuid().optional(),
})
app.patch('/api/admin/listings/:listingId', requireAuth, requireSuperhost, validateUuidParam('listingId'), validate(updateListingSchema), asyncRoute(async (req, res) => {
  const data = req.body
  const location = data.location?.split(',').map((part) => part.trim())
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE listings SET title=COALESCE($2,title), description=COALESCE($3,description),
       city=COALESCE($4,city), country=COALESCE($5,country),
       price_per_night=COALESCE($6,price_per_night), category=COALESCE($7,category),
       cover_image_url=COALESCE($8,cover_image_url), host_id=COALESCE($9,host_id),
       status=COALESCE($10::listing_status,status), updated_at=now()
       WHERE id=$1 AND status <> 'archived' RETURNING id`,
      [req.params.listingId, data.title ?? null, data.description ?? null, location?.[0] ?? null, location ? location.at(-1) : null, data.price ?? null, data.category ?? null, data.image ?? null, data.hostId ?? null, data.status ?? null],
    )
    if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Annonce introuvable.' }) }
    if (data.amenities) {
      await client.query('DELETE FROM listing_amenities WHERE listing_id=$1', [req.params.listingId])
      await client.query('INSERT INTO listing_amenities (listing_id, amenity) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [req.params.listingId, data.amenities])
    }
    await client.query('COMMIT')
    res.json({ updated: true })
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}))

app.delete('/api/admin/listings/:listingId', requireAuth, requireSuperhost, validateUuidParam('listingId'), asyncRoute(async (req, res) => {
  const result = await pool.query("UPDATE listings SET status='archived', updated_at=now() WHERE id=$1 AND status <> 'archived' RETURNING id", [req.params.listingId])
  if (!result.rowCount) return res.status(404).json({ error: 'Annonce introuvable.' })
  res.json({ deleted: true })
}))

app.put('/api/favorites/:listingId', requireAuth, validateUuidParam('listingId'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `INSERT INTO favorites (user_id, listing_id)
     SELECT $1, id FROM listings WHERE id = $2 AND status = 'published'
     ON CONFLICT DO NOTHING RETURNING listing_id`,
    [req.userId, req.params.listingId],
  )
  if (!rows.length) {
    const existing = await pool.query('SELECT 1 FROM favorites WHERE user_id = $1 AND listing_id = $2', [req.userId, req.params.listingId])
    if (!existing.rowCount) return res.status(404).json({ error: 'Logement introuvable.' })
  }
  res.status(204).end()
}))

app.delete('/api/favorites/:listingId', requireAuth, validateUuidParam('listingId'), asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2', [req.userId, req.params.listingId])
  res.status(204).end()
}))

app.get('/api/booking-addons', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, code, name, description, price, category, image_url AS "imageUrl", price_unit AS "priceUnit"
     FROM booking_addons WHERE active = true ORDER BY category_order, sort_order, name`,
  )
  res.json({
    addons: rows.map((addon) => ({ ...addon, price: Number(addon.price) })),
  })
}))

app.get('/api/bookings', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, l.title, l.city, l.country, l.cover_image_url,
       COALESCE((
         SELECT json_agg(json_build_object(
           'name', ra.name_snapshot, 'price', ra.unit_price, 'quantity', ra.quantity,
           'unitType', ra.billing_unit_snapshot
         ) ORDER BY ra.id)
         FROM reservation_addons ra WHERE ra.reservation_id = r.id
       ), '[]'::json) AS addons
     FROM reservations r JOIN listings l ON l.id = r.listing_id
     WHERE r.guest_id = $1 ORDER BY r.created_at DESC`,
    [req.userId],
  )
  res.json({ bookings: rows.map(bookingFromRow) })
}))

app.post('/api/bookings/:bookingId/cancel', requireAuth, validateUuidParam('bookingId'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE reservations SET status = 'cancelled', expires_at = NULL, updated_at = now()
     WHERE id = $1 AND guest_id = $2 AND status IN ('pending', 'confirmed')
       AND check_in > (now() AT TIME ZONE 'America/Martinique')::date
     RETURNING id`,
    [req.params.bookingId, req.userId],
  )
  if (!rows.length) return res.status(409).json({ error: 'Annulation impossible : réservation inactive ou délai dépassé. Vous pouvez annuler jusqu’à la veille de l’arrivée.' })
  res.json({ id: rows[0].id, status: 'cancelled' })
}))

app.post('/api/payments/verify', requireAuth, asyncRoute(async (req, res) => {
  const sessionId = req.body?.sessionId
  if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_') || sessionId.length > 255) return res.status(400).json({ error: 'Session invalide.' })
  if (!stripe) return res.status(503).json({ error: 'Paiement indisponible.' })
  const draft = await pool.query('SELECT id FROM checkout_drafts WHERE stripe_session_id = $1 AND guest_id = $2', [sessionId, req.userId])
  if (!draft.rowCount) return res.status(404).json({ error: 'Paiement introuvable.' })
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  if (session.payment_status !== 'paid') return res.status(409).json({ error: 'Un incident est survenu lors du paiement de votre réservation, veuillez réessayer de nouveau. Votre réservation n’a pas été confirmée.' })
  await completeStripeCheckout(session)
  res.json({ confirmed: true })
}))

const createBookingSchema = z.object({
  listingId: z.string().uuid(),
  checkIn: z.iso.date(),
  checkOut: z.iso.date(),
  guests: z.coerce.number().int().min(1).max(32),
  addOns: z.array(z.object({
    id: z.string().uuid(),
    quantity: z.number().int().min(1).max(12),
  })).max(25).default([]),
  addOnIds: z.array(z.string().uuid()).max(25).default([]),
}).refine(({ checkIn, checkOut }) => checkOut > checkIn, {
  message: 'La date de départ doit être après la date d’arrivée.',
  path: ['checkOut'],
}).refine(({ checkIn }) => checkIn >= new Date().toISOString().slice(0, 10), {
  message: 'La date d’arrivée ne peut pas être dans le passé.',
  path: ['checkIn'],
}).refine(({ addOns, addOnIds }) => !(addOns.length && addOnIds.length), {
  message: 'Envoyez les options dans un seul format.',
}).refine(({ addOns }) => new Set(addOns.map((addon) => addon.id)).size === addOns.length, {
  message: 'Une option ne peut être sélectionnée qu’une fois.',
}).refine(({ addOnIds }) => new Set(addOnIds).size === addOnIds.length, {
  message: 'Une option ne peut être sélectionnée qu’une fois.',
})

app.post('/api/bookings', requireAuth, validate(createBookingSchema), asyncRoute(async (req, res) => {
  const { listingId, checkIn, checkOut, guests, addOns, addOnIds } = req.body
  const requestedAddons = addOns.length ? addOns : addOnIds.map((id) => ({ id, quantity: 1 }))
  const requestedAddonIds = requestedAddons.map((addon) => addon.id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const listingResult = await client.query(
      `SELECT id, host_id, price_per_night, max_guests FROM listings
       WHERE id = $1 AND status = 'published' FOR SHARE`,
      [listingId],
    )
    const listing = listingResult.rows[0]
    if (!listing) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Ce logement n’est plus disponible.' })
    }
    if (listing.host_id === req.userId) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Vous ne pouvez pas réserver votre propre logement.' })
    }
    if (guests > listing.max_guests) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: `Ce logement accepte au maximum ${listing.max_guests} voyageurs.` })
    }

    const addonResult = await client.query(
      `SELECT id, code, name, price, price_unit FROM booking_addons
       WHERE id = ANY($1::uuid[]) AND active = true ORDER BY sort_order FOR SHARE`,
      [requestedAddonIds],
    )
    if (addonResult.rowCount !== requestedAddonIds.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Une option sélectionnée n’est plus disponible. Actualisez puis réessayez.' })
    }
    const requestedQuantities = new Map(requestedAddons.map((addon) => [addon.id, addon.quantity]))
    const selectedAddons = addonResult.rows.map((addon) => ({
      ...addon,
      price: Number(addon.price),
      quantity: requestedQuantities.get(addon.id),
    }))
    if (selectedAddons.some((addon) => addon.price_unit === 'fixed' && addon.quantity !== 1)) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'La quantité de cette option doit être égale à une unité.' })
    }

    await client.query(
      `UPDATE reservations SET status = 'cancelled'
       WHERE listing_id = $1 AND status = 'pending' AND expires_at <= now()`,
      [listingId],
    )
    const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000)
    const price = Number(listing.price_per_night)
    const subtotal = price * nights
    const serviceFee = Math.round(subtotal * 0.12)
    const cleaningFee = 35
    const addonTotalCents = selectedAddons.reduce((sum, addon) => sum + Math.round(addon.price * 100) * addon.quantity, 0)
    const addonTotal = addonTotalCents / 100
    const conflict = await client.query(
      "SELECT 1 FROM reservations WHERE listing_id = $1 AND status IN ('pending', 'confirmed') AND check_in < $3::date AND check_out > $2::date",
      [listingId, checkIn, checkOut],
    )
    if (conflict.rowCount) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Ces dates ne sont plus disponibles.' })
    }
    if (!stripe) throw new Error('Stripe unavailable')
    const total = subtotal + serviceFee + cleaningFee + addonTotal
    const payload = { listingId, checkIn, checkOut, guests, price, serviceFee, cleaningFee, total, addons: selectedAddons }
    const draftResult = await client.query(
      'INSERT INTO checkout_drafts (guest_id, payload) VALUES ($1, $2::jsonb) RETURNING id',
      [req.userId, JSON.stringify(payload)],
    )
    const draftId = draftResult.rows[0].id
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded_page',
      line_items: [{ price_data: { currency: 'eur', unit_amount: Math.round(total * 100), product_data: { name: 'Votre séjour' } }, quantity: 1 }],
      metadata: { draftId },
      payment_intent_data: { metadata: { draftId } },
      return_url: `${appBaseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      redirect_on_completion: 'always',
      locale: 'fr',
    }, { idempotencyKey: `draft:${draftId}` })
    await client.query('UPDATE checkout_drafts SET stripe_session_id = $2 WHERE id = $1', [draftId, session.id])
    await client.query('COMMIT')
    res.status(201).json({ clientSecret: session.client_secret })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Checkout creation failed:', error)
    return res.status(502).json({ error: 'Un incident est survenu lors du paiement de votre réservation, veuillez réessayer de nouveau. Votre réservation n’a pas été confirmée.' })
  } finally {
    client.release()
  }
}))

app.post('/api/bookings/:bookingId/checkout', requireAuth, validateUuidParam('bookingId'), asyncRoute(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Le paiement Stripe n’est pas encore configuré.' })

  const { rows } = await pool.query(
    `SELECT r.id, r.total_amount, r.status, r.expires_at, l.title, u.email
     FROM reservations r
     JOIN listings l ON l.id = r.listing_id
     JOIN users u ON u.id = r.guest_id
     WHERE r.id = $1 AND r.guest_id = $2`,
    [req.params.bookingId, req.userId],
  )
  const reservation = rows[0]
  if (!reservation) return res.status(404).json({ error: 'Réservation introuvable.' })
  if (reservation.status !== 'pending' || !reservation.expires_at || new Date(reservation.expires_at) <= new Date()) {
    return res.status(409).json({ error: 'Cette réservation n’est plus payable.' })
  }

  const { rows: addons } = await pool.query(
    `SELECT name_snapshot AS name, unit_price, quantity, line_total
     FROM reservation_addons WHERE reservation_id = $1 ORDER BY id`,
    [reservation.id],
  )
  const lineItems = [
    {
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(Number(reservation.total_amount) * 100) - addons.reduce((sum, addon) => sum + Math.round(Number(addon.line_total) * 100), 0),
        product_data: { name: reservation.title },
      },
      quantity: 1,
    },
    ...addons.map((addon) => ({
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(Number(addon.unit_price) * 100),
        product_data: { name: addon.name },
      },
      quantity: addon.quantity,
    })),
  ]

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    ui_mode: 'embedded_page',
    line_items: lineItems,
    customer_email: reservation.email,
    client_reference_id: reservation.id,
    metadata: { reservationId: reservation.id },
    payment_intent_data: { metadata: { reservationId: reservation.id } },
    return_url: `${appBaseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    redirect_on_completion: 'if_required',
    locale: 'fr',
    submit_type: 'book',
  }, { idempotencyKey: `checkout:${reservation.id}` })

  await pool.query(
    `INSERT INTO payment_transactions
      (reservation_id, amount, currency, provider, provider_payment_id, idempotency_key, status, metadata)
     VALUES ($1, $2, 'EUR', 'stripe', $3, $4, 'pending', $5::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [reservation.id, Number(reservation.total_amount), session.id, `stripe:${session.id}`, JSON.stringify({ checkoutSessionId: session.id })],
  )
  res.json({ clientSecret: session.client_secret })
}))

const conversationSchema = z.object({ bookingId: z.string().uuid() })
app.post('/api/conversations', requireAuth, validate(conversationSchema), asyncRoute(async (req, res) => {
  const { bookingId } = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT r.id, r.guest_id, r.listing_id, l.host_id
       FROM reservations r JOIN listings l ON l.id = r.listing_id WHERE r.id = $1`,
      [bookingId],
    )
    const booking = rows[0]
    if (!booking || ![booking.guest_id, booking.host_id].includes(req.userId)) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Réservation introuvable.' })
    }
    const { rows: conversations } = await client.query(
      `INSERT INTO conversations (reservation_id, listing_id) VALUES ($1, $2)
       ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL
       DO UPDATE SET reservation_id = EXCLUDED.reservation_id RETURNING id`,
      [booking.id, booking.listing_id],
    )
    const conversationId = conversations[0].id
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id)
       VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
      [conversationId, booking.guest_id, booking.host_id],
    )
    await client.query('COMMIT')
    res.status(201).json({ conversationId })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.get('/api/conversations', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.reservation_id, c.updated_at, l.title, l.city, l.cover_image_url,
       r.check_in, r.check_out,
       CASE WHEN r.guest_id = $1 THEN host.full_name ELSE guest.full_name END AS contact_name,
       CASE WHEN r.guest_id = $1 THEN host.avatar_url ELSE guest.avatar_url END AS contact_avatar_url,
       CASE WHEN r.guest_id = $1 THEN host.id ELSE guest.id END AS contact_id,
       r.guests, r.total_amount, r.status,
       (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
       (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
       (SELECT count(*)::int FROM messages unread_messages
        WHERE unread_messages.conversation_id = c.id
          AND (unread_messages.sender_id <> $1 OR unread_messages.is_system)
          AND unread_messages.created_at > COALESCE(cp.last_read_at, '-infinity'::timestamptz)) AS unread_count
     FROM conversation_participants cp
     JOIN conversations c ON c.id = cp.conversation_id
     JOIN listings l ON l.id = c.listing_id
     JOIN reservations r ON r.id = c.reservation_id
     JOIN users guest ON guest.id = r.guest_id
     JOIN users host ON host.id = l.host_id
     WHERE cp.user_id = $1 ORDER BY c.updated_at DESC`,
    [req.userId],
  )
  res.json({ conversations: rows })
}))

app.get('/api/conversations/:conversationId/messages', requireAuth, validateUuidParam('conversationId'), asyncRoute(async (req, res) => {
  const participant = await pool.query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
    [req.params.conversationId, req.userId],
  )
  if (!participant.rowCount) return res.status(404).json({ error: 'Conversation introuvable.' })
  await pool.query(
    'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
    [req.params.conversationId, req.userId],
  )
  await pool.query(
    `UPDATE messages SET status = 'read'
     WHERE conversation_id = $1 AND sender_id <> $2 AND status = 'sent'`,
    [req.params.conversationId, req.userId],
  )
  const { rows } = await pool.query(
    `SELECT m.id, m.sender_id, u.full_name AS sender_name, m.body, m.status, m.created_at,
      COALESCE((SELECT json_agg(json_build_object('id',a.id,'name',a.name,'mime',a.mime,'size',a.size)) FROM message_attachments ma JOIN scheduled_attachments a ON a.id=ma.attachment_id WHERE ma.message_id=m.id),'[]') AS attachments
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = $1 ORDER BY m.created_at`,
    [req.params.conversationId],
  )
  res.json({ messages: rows })
}))

const messageSchema = z.object({ body: z.string().trim().min(1).max(5000) })
const allowedMessageTags = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'span'])
function sanitizeMessageHtml(value) {
  return value
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|svg|math)[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (full, tag, rawAttributes) => {
      const normalizedTag = tag.toLowerCase()
      if (!allowedMessageTags.has(normalizedTag)) return ''
      if (normalizedTag === 'br') return '<br>'
      if (normalizedTag !== 'a') return `<${normalizedTag}>`
      const hrefMatch = rawAttributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)
      const href = hrefMatch?.[1].trim() ?? ''
      if (!/^(https?:|mailto:)/i.test(href)) return '<a>'
      return `<a href="${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">`
    })
    .replace(/<\/([a-z][a-z0-9]*)\s*>/gi, (full, tag) => allowedMessageTags.has(tag.toLowerCase()) ? `</${tag.toLowerCase()}>` : '')
}
app.post('/api/conversations/:conversationId/messages', requireAuth, validateUuidParam('conversationId'), validate(messageSchema), asyncRoute(async (req, res) => {
  const body = sanitizeMessageHtml(req.body.body)
  if (!body.replace(/<[^>]*>/g, '').trim()) return res.status(400).json({ error: 'Le message ne peut pas être vide.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rowCount } = await client.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2 FOR SHARE',
      [req.params.conversationId, req.userId],
    )
    if (!rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Conversation introuvable.' })
    }
    const { rows } = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id, conversation_id, sender_id, body, status, created_at`,
       [req.params.conversationId, req.userId, body],
    )
    await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [req.params.conversationId])
    await client.query(
      `INSERT INTO notifications (user_id, kind, payload)
       SELECT user_id, 'new_message', jsonb_build_object('conversationId', $1::text, 'messageId', $2::text)
       FROM conversation_participants WHERE conversation_id = $1::uuid AND user_id <> $3::uuid`,
      [req.params.conversationId, rows[0].id, req.userId],
    )
    await client.query('COMMIT')
    res.status(201).json({ message: rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.patch('/api/conversations/:conversationId/messages/:messageId', requireAuth, validateUuidParam('conversationId'), validateUuidParam('messageId'), validate(messageSchema), asyncRoute(async (req, res) => {
  const body = sanitizeMessageHtml(req.body.body)
  if (!body.replace(/<[^>]*>/g, '').trim() || body.length > 5000) return res.status(400).json({ error: 'Message vide ou trop long.' })
  const { rows } = await pool.query(
    `UPDATE messages m SET body=$4 WHERE m.id=$1 AND m.conversation_id=$2 AND m.sender_id=$3 AND NOT m.is_system
     AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id=$2 AND user_id=$3)
     RETURNING m.id, m.body`,
    [req.params.messageId, req.params.conversationId, req.userId, body],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Message introuvable ou non modifiable.' })
  res.json({ message: rows[0] })
}))

app.delete('/api/conversations/:conversationId/messages/:messageId', requireAuth, validateUuidParam('conversationId'), validateUuidParam('messageId'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `DELETE FROM messages m WHERE m.id=$1 AND m.conversation_id=$2 AND m.sender_id=$3 AND NOT m.is_system
     AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id=$2 AND user_id=$3) RETURNING m.id`,
    [req.params.messageId, req.params.conversationId, req.userId],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Message introuvable ou non supprimable.' })
  res.status(204).end()
}))

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().min(5).max(3000),
})
app.post('/api/bookings/:bookingId/review', requireAuth, validateUuidParam('bookingId'), validate(reviewSchema), asyncRoute(async (req, res) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO reviews (reservation_id, listing_id, reviewer_id, rating, body)
       SELECT r.id, r.listing_id, r.guest_id, $3, $4
       FROM reservations r
       WHERE r.id = $1 AND r.guest_id = $2 AND r.status IN ('confirmed', 'completed') AND r.check_out <= CURRENT_DATE
       RETURNING id, reservation_id, listing_id, reviewer_id, rating, body, created_at`,
      [req.params.bookingId, req.userId, req.body.rating, req.body.body],
    )
    if (!rows.length) return res.status(409).json({ error: 'Un avis est possible après un séjour terminé.' })
    res.status(201).json({ review: rows[0] })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Un avis a déjà été publié pour ce séjour.' })
    throw error
  }
}))

app.get('/api/listings/:listingId/reviews', validateUuidParam('listingId'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.rating, r.body, r.host_response, r.created_at, u.full_name AS reviewer_name
     FROM reviews r JOIN users u ON u.id = r.reviewer_id
     WHERE r.listing_id = $1 ORDER BY r.created_at DESC`,
    [req.params.listingId],
  )
  res.json({ reviews: rows })
}))

const scheduledMessagesTimer = registerScheduledMessages(app, requireAuth, requireSuperhost, asyncRoute, sanitizeMessageHtml)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Route API introuvable.' }))

app.use(express.static(distDirectory, { index: false, maxAge: 0 }))
app.get('/{*path}', (_req, res) => res.sendFile(join(distDirectory, 'index.html')))

app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corps JSON invalide.' })
  console.error('API request failed:', error)
  res.status(500).json({ error: 'Une erreur serveur est survenue.' })
})

const server = app.listen(port, () => {
  console.log(`Foyaltoloman API listening on http://localhost:${port}`)
})

async function shutdown() {
  clearInterval(reservationExpiryTimer)
  clearInterval(scheduledMessagesTimer)
  server.close()
  await pool.end()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
