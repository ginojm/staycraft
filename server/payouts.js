import { z } from 'zod'
import { pool } from './db.js'

const entry = z.object({ listingId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v), amount: z.number().positive().max(999999999).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001), reference: z.string().trim().min(1).max(180), status: z.enum(['paid', 'scheduled']).default('paid'), note: z.string().trim().max(2000).default('') })

export function registerPayouts(app, auth, admin, route) {
  app.get('/api/admin/payouts', auth, admin, route(async (_req, res) => {
    const [payments, listings] = await Promise.all([
      pool.query("SELECT p.id, p.listing_id AS \"listingId\", to_char(p.paid_on, 'YYYY-MM-DD') AS date, p.amount::float8 AS amount, p.reference, p.note, p.status, l.title FROM payouts p JOIN listings l ON l.id=p.listing_id ORDER BY p.paid_on DESC, p.created_at DESC"),
      pool.query("SELECT id, title FROM listings WHERE status <> 'archived' ORDER BY title"),
    ])
    res.json({ payments: payments.rows, listings: listings.rows })
  }))
  app.post('/api/admin/payouts', auth, admin, route(async (req, res) => {
    const parsed = z.object({ payments: z.array(entry).min(1).max(1000) }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Paiements invalides : vérifiez les dates, montants et références (1 000 lignes maximum).' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const p of parsed.data.payments) {
        const inserted = await client.query("INSERT INTO payouts (listing_id, created_by, paid_on, amount, reference, note, status) SELECT id,$2,$3,$4,$5,$6,$7 FROM listings WHERE id=$1 AND status <> 'archived' RETURNING id", [p.listingId, req.userId, p.date, p.amount, p.reference, p.note, p.status])
        if (!inserted.rowCount) throw new Error('INVALID_LISTING')
      }
      await client.query('COMMIT')
      res.status(201).json({ count: parsed.data.payments.length })
    } catch (error) {
      await client.query('ROLLBACK')
      if (error.code === '23505') return res.status(409).json({ error: 'Référence déjà utilisée : aucun paiement de cet envoi n’a été enregistré.' })
      if (error.message === 'INVALID_LISTING') return res.status(400).json({ error: 'Logement introuvable ou archivé : aucun paiement enregistré.' })
      throw error
    } finally { client.release() }
  }))
}
