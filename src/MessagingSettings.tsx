import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, MessageCircle, Sparkles, Archive, Send, X } from 'lucide-react'
import ScheduledMessages from './ScheduledMessages'

export default function MessagingSettings({ token, onClose, onDraft, conversations, onSelect }: {
  token: string; onClose: () => void; onDraft: (text: string) => void;
  conversations: { id: string; guestName: string; property: string }[]; onSelect: (id: string) => void
}) {
  const [page, setPage] = useState('menu')
  const panel = useRef<HTMLElement>(null)
  const titles: Record<string, string> = { menu: 'Paramètres de messagerie', quick: 'Gérer mes réponses rapides', suggested: 'Réponses suggérées', previous: 'Conversations précédentes', feedback: 'Envoyer des remarques' }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]')
        if (!elements?.length) return
        const first = elements[0], last = elements[elements.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); previous?.focus() }
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section ref={panel} tabIndex={-1} className="messaging-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="messaging-settings-title">
    <header>{page !== 'menu' && <button className="messaging-settings-back" onClick={() => setPage('menu')} aria-label="Retour aux paramètres"><ArrowLeft size={20} /></button>}<h2 id="messaging-settings-title">{titles[page]}</h2><button className="messaging-settings-close" onClick={onClose} aria-label="Fermer"><X size={20} /></button></header>
    {page === 'menu' ? <nav aria-label="Paramètres de messagerie" className="messaging-settings-menu">
      <button onClick={() => setPage('quick')}><MessageCircle size={24} strokeWidth={1.5} />Gérer mes réponses rapides</button>
      <button onClick={() => setPage('suggested')}><Sparkles size={24} strokeWidth={1.5} />Réponses suggérées</button>
      <button onClick={() => setPage('previous')}><Archive size={24} strokeWidth={1.5} />Conversations précédentes</button>
      <button onClick={() => setPage('feedback')}><Send size={24} strokeWidth={1.5} />Envoyer des remarques</button>
    </nav> : <div className="messaging-settings-content">
      {page === 'quick' && <ScheduledMessages token={token} />}
      {page === 'suggested' && <><p>Sélectionnez une réponse pour l’insérer dans votre brouillon, sans l’envoyer.</p>{['Bonjour, merci pour votre message ! Je reviens vers vous rapidement.', 'Bonjour, votre arrivée approche ! À quelle heure prévoyez-vous d’arriver ?', 'Merci pour votre séjour ! Nous espérons vous accueillir à nouveau bientôt.'].map((text) => <button className="messaging-settings-choice" key={text} onClick={() => { onDraft(text); onClose() }}>{text}</button>)}</>}
      {page === 'previous' && <>{conversations.length ? conversations.map((c) => <button className="messaging-settings-choice" key={c.id} onClick={() => { onSelect(c.id); onClose() }}><strong>{c.guestName}</strong> · {c.property}</button>) : <p>Aucune conversation disponible.</p>}</>}
      {page === 'feedback' && <p>Pour transmettre une remarque sur la messagerie, contactez <a href="mailto:foyal.toloman@gmail.com?subject=Remarque%20sur%20la%20messagerie">foyal.toloman@gmail.com</a> depuis votre application de courrier.</p>}
    </div>}
  </section></div>
}
