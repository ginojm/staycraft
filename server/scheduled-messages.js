import { z } from 'zod'
import { pool } from './db.js'
import { scheduledMessageHtml } from './message-html.js'
import { attachmentsSchema, prepareAttachments } from './attachments.js'

const listingIdsSchema = z.array(z.string().uuid()).min(1).max(200).refine((ids) => new Set(ids).size === ids.length)
const schema = z.object({ name: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4000), event: z.enum(['manual','confirmed','arrival','departure']), hours_before: z.coerce.number().int().min(0).max(720), enabled: z.boolean(), listingIds: listingIdsSchema, attachments: attachmentsSchema })
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])

export function registerScheduledMessages(app, auth, admin, route, sanitize) {
  app.get('/api/admin/scheduled-messages', auth, admin, route(async (_req, res) => {
    const templates = await pool.query(`SELECT t.*, ARRAY(SELECT listing_id FROM scheduled_message_listings WHERE template_id=t.id) AS listing_ids, (SELECT count(*)::int FROM scheduled_message_deliveries d WHERE d.template_id=t.id) AS sent_count FROM scheduled_messages t ORDER BY created_at DESC`)
    const bookings = await pool.query(`SELECT r.id, r.listing_id, l.title, u.full_name, r.check_in FROM reservations r JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.guest_id WHERE r.status='confirmed' ORDER BY r.check_in DESC LIMIT 200`)
    const listings = await pool.query("SELECT id,title,cover_image_url AS image FROM listings WHERE status <> 'archived' ORDER BY title")
    const files = await pool.query('SELECT id,template_id,name,mime,size FROM scheduled_attachments WHERE template_id IS NOT NULL')
    res.json({ templates: templates.rows.map((t) => ({ ...t, attachments:files.rows.filter((a) => a.template_id===t.id), body: scheduledMessageHtml(t.body, sanitize) })), bookings: bookings.rows, listings: listings.rows })
  }))
  app.post('/api/admin/scheduled-messages', auth, admin, route(async (req, res) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Modèle invalide.' })
    const data = parsed.data
    let files
    try { files=prepareAttachments(data.attachments) } catch (error) { return res.status(400).json({error:error.message}) }
    const body = scheduledMessageHtml(data.body, sanitize)
    if (!body.replace(/<[^>]*>/g, '').trim()) return res.status(400).json({ error: 'Message vide.' })
    const { rows } = await pool.query(`WITH valid AS (SELECT id FROM listings WHERE id=ANY($7::uuid[]) AND status<>'archived'),
      model AS (INSERT INTO scheduled_messages (owner_id,name,body,event,hours_before,enabled) SELECT $1,$2,$3,$4,$5,$6 WHERE (SELECT count(*) FROM valid)=cardinality($7::uuid[]) RETURNING *),
      links AS (INSERT INTO scheduled_message_listings SELECT model.id,valid.id FROM model CROSS JOIN valid),
      files AS (INSERT INTO scheduled_attachments (template_id,name,mime,size,data) SELECT model.id,a.name,a.mime,a.size,decode(a.base64,'base64') FROM model CROSS JOIN jsonb_to_recordset($8::jsonb) AS a(name text,mime text,size int,base64 text))
      SELECT * FROM model`, [req.userId,data.name,body,data.event,data.hours_before,data.enabled,data.listingIds,JSON.stringify(files)])
    if (!rows[0]) return res.status(400).json({ error: 'Un logement sélectionné est introuvable ou archivé.' })
    res.status(201).json({ template: rows[0] })
  }))
  app.patch('/api/admin/scheduled-messages/:id', auth, admin, route(async (req, res) => {
    if (req.body.listingIds !== undefined) {
      const ids = listingIdsSchema.safeParse(req.body.listingIds)
      if (!z.string().uuid().safeParse(req.params.id).success || !ids.success) return res.status(400).json({ error: 'Sélectionnez au moins un logement valide.' })
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const model = await client.query('SELECT id FROM scheduled_messages WHERE id=$1 FOR UPDATE', [req.params.id])
        if (!model.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Modèle introuvable.' }) }
        const valid = await client.query("SELECT id FROM listings WHERE id=ANY($1::uuid[]) AND status<>'archived' FOR SHARE", [ids.data])
        if (valid.rowCount !== ids.data.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Logement introuvable ou archivé.' }) }
        await client.query('DELETE FROM scheduled_message_listings WHERE template_id=$1', [req.params.id])
        await client.query('INSERT INTO scheduled_message_listings SELECT $1,unnest($2::uuid[])', [req.params.id,ids.data])
        await client.query('COMMIT')
        return res.json({ updated: true })
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (!z.string().uuid().safeParse(req.params.id).success || typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'Données invalides.' })
    const result = await pool.query('UPDATE scheduled_messages SET enabled=$2 WHERE id=$1 AND (NOT $2 OR EXISTS (SELECT 1 FROM scheduled_message_listings WHERE template_id=$1)) RETURNING id', [req.params.id,req.body.enabled])
    res.status(result.rowCount ? 200 : 404).json({ updated: !!result.rowCount })
  }))
  app.delete('/api/admin/scheduled-messages/:id', auth, admin, route(async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' })
    await pool.query('DELETE FROM scheduled_messages WHERE id=$1', [req.params.id])
    res.status(204).end()
  }))
  app.post('/api/admin/scheduled-messages/:id/send', auth, admin, route(async (req, res) => {
    if (![req.params.id, req.body.reservationId].every((id) => z.string().uuid().safeParse(id).success)) return res.status(400).json({ error: 'Réservation invalide.' })
    const sent = await deliver(req.params.id, req.body.reservationId, sanitize)
    res.status(sent ? 200 : 409).json(sent ? { sent: true } : { error: 'Déjà envoyé à cette réservation ou réservation non éligible.' })
  }))

  let running = false
  app.post('/api/admin/scheduled-messages/:id/attachments', auth, admin, route(async (req,res) => {
    const parsed=attachmentsSchema.safeParse(req.body.attachments)
    if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success || !parsed.data.length) return res.status(400).json({error:'Fichiers invalides.'})
    let files
    try { files=prepareAttachments(parsed.data) } catch (error) { return res.status(400).json({error:error.message}) }
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      const model=await client.query('SELECT id FROM scheduled_messages WHERE id=$1 FOR UPDATE',[req.params.id])
      if (!model.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({error:'Modèle introuvable.'}) }
      const existing=await client.query('SELECT count(*)::int AS count,COALESCE(sum(size),0)::int AS size FROM scheduled_attachments WHERE template_id=$1',[req.params.id])
      if (existing.rows[0].count+files.length>5 || existing.rows[0].size+files.reduce((sum,a)=>sum+a.size,0)>10485760) { await client.query('ROLLBACK'); return res.status(400).json({error:'Maximum 5 fichiers et 10 Mo par modèle.'}) }
      for (const a of files) await client.query('INSERT INTO scheduled_attachments (template_id,name,mime,size,data) VALUES ($1,$2,$3,$4,decode($5,\'base64\'))',[req.params.id,a.name,a.mime,a.size,a.base64])
      await client.query('COMMIT'); res.status(201).json({added:true})
    } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }))
  app.delete('/api/admin/scheduled-messages/:id/attachments/:attachmentId',auth,admin,route(async(req,res)=>{
    if (![req.params.id,req.params.attachmentId].every((id)=>z.string().uuid().safeParse(id).success)) return res.status(400).json({error:'Identifiant invalide.'})
    await pool.query('UPDATE scheduled_attachments SET template_id=NULL WHERE id=$1 AND template_id=$2',[req.params.attachmentId,req.params.id])
    res.status(204).end()
  }))
  app.get('/api/attachments/:id',auth,route(async(req,res)=>{
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({error:'Identifiant invalide.'})
    const {rows}=await pool.query(`SELECT a.* FROM scheduled_attachments a WHERE a.id=$1 AND (
      (a.template_id IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE id=$2 AND lower(email)='foyal.toloman@gmail.com')) OR
      EXISTS(SELECT 1 FROM message_attachments ma JOIN messages m ON m.id=ma.message_id JOIN conversation_participants cp ON cp.conversation_id=m.conversation_id WHERE ma.attachment_id=a.id AND cp.user_id=$2))`,[req.params.id,req.userId])
    if (!rows[0]) return res.status(404).json({error:'Fichier introuvable.'})
    res.set({'Content-Type':rows[0].mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
    res.send(rows[0].data)
  }))
  const tick = async () => {
    if (running) return
    running = true
    try {
      const { rows } = await pool.query(`SELECT t.id, r.id AS reservation_id FROM scheduled_messages t
        JOIN users owner ON owner.id=t.owner_id AND owner.is_active
        JOIN reservations r ON r.status='confirmed'
        JOIN scheduled_message_listings scope ON scope.template_id=t.id AND scope.listing_id=r.listing_id
        WHERE t.enabled AND t.event<>'manual' AND NOT EXISTS (SELECT 1 FROM scheduled_message_deliveries d WHERE d.template_id=t.id AND d.reservation_id=r.id)
        AND CASE t.event
          WHEN 'confirmed' THEN r.created_at >= t.created_at AND r.check_in >= CURRENT_DATE
          WHEN 'arrival' THEN now() >= (r.check_in::timestamp AT TIME ZONE 'America/Martinique') - t.hours_before * interval '1 hour' AND now() < (r.check_in::timestamp AT TIME ZONE 'America/Martinique') + CASE WHEN t.hours_before=0 THEN interval '1 day' ELSE interval '0' END
          WHEN 'departure' THEN now() >= (r.check_out::timestamp AT TIME ZONE 'America/Martinique') - t.hours_before * interval '1 hour' AND now() < (r.check_out::timestamp AT TIME ZONE 'America/Martinique') + CASE WHEN t.hours_before=0 THEN interval '1 day' ELSE interval '0' END
          ELSE false END LIMIT 100`)
      for (const row of rows) await deliver(row.id, row.reservation_id, sanitize)
    } catch (error) { console.error('Scheduled messages:', error.message) } finally { running = false }
  }
  const timer = setInterval(tick, 60000)
  timer.unref()
  return timer
}

async function deliver(templateId, reservationId, sanitize) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT t.*, r.guest_id, r.listing_id, r.check_in, r.check_out, l.title, l.host_id, u.full_name
      FROM scheduled_messages t JOIN users owner ON owner.id=t.owner_id AND owner.is_active
      JOIN reservations r ON r.id=$2 AND r.status='confirmed' JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.guest_id WHERE t.id=$1
      AND EXISTS (SELECT 1 FROM scheduled_message_listings WHERE template_id=t.id AND listing_id=r.listing_id) FOR SHARE OF t,r`, [templateId,reservationId])
    const row = rows[0]
    if (!row) { await client.query('ROLLBACK'); return false }
    const claimed = await client.query('INSERT INTO scheduled_message_deliveries (template_id,reservation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id', [templateId,reservationId])
    if (!claimed.rowCount) { await client.query('ROLLBACK'); return false }
    const values = { voyageur: row.full_name, logement: row.title, arrivee: new Date(row.check_in).toLocaleDateString('fr-FR', {timeZone:'UTC'}), depart: new Date(row.check_out).toLocaleDateString('fr-FR', {timeZone:'UTC'}) }
    const html = scheduledMessageHtml(row.body, sanitize)
    const body = scheduledMessageHtml(html.replace(/\{\{(voyageur|logement|arrivee|depart)\}\}/g, (_, key) => escape(values[key])), sanitize)
    if (!body) throw new Error('Message programmé vide')
    if (body.length > 5000) throw new Error('Message personnalisé trop long')
    const conversation = await client.query(`INSERT INTO conversations (reservation_id,listing_id) VALUES ($1,$2) ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL DO UPDATE SET updated_at=now() RETURNING id`, [reservationId,row.listing_id])
    const conversationId = conversation.rows[0].id
    await client.query('INSERT INTO conversation_participants (conversation_id,user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [conversationId,[row.guest_id,row.host_id,row.owner_id]])
    const message = await client.query('INSERT INTO messages (conversation_id,sender_id,body,is_system) VALUES ($1,$2,$3,true) RETURNING id', [conversationId,row.owner_id,body])
    await client.query('INSERT INTO message_attachments (message_id,attachment_id) SELECT $1,id FROM scheduled_attachments WHERE template_id=$2',[message.rows[0].id,templateId])
    await client.query('UPDATE scheduled_message_deliveries SET message_id=$2 WHERE id=$1', [claimed.rows[0].id,message.rows[0].id])
    await client.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [conversationId])
    await client.query(`INSERT INTO notifications (user_id,kind,payload) SELECT user_id,'new_message',jsonb_build_object('conversationId',$1::text) FROM conversation_participants WHERE conversation_id=$1::uuid AND user_id<>$2`, [conversationId,row.owner_id])
    await client.query('COMMIT')
    return true
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
