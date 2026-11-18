import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Home, MapPin, Image, FileText, Wallet, X } from 'lucide-react'

const steps = [
  { title: 'Votre logement', description: 'Commençons par ce qui rend votre adresse unique.', icon: Home },
  { title: 'La localisation', description: 'Indiquez où les voyageurs poseront leurs valises.', icon: MapPin },
  { title: 'La présentation', description: 'Donnez envie de découvrir votre logement.', icon: Image },
  { title: 'Le tarif', description: 'Définissez votre prix par nuit et vos frais de ménage.', icon: Wallet },
  { title: 'Le récapitulatif', description: 'Vérifiez votre annonce avant de la publier.', icon: FileText },
]

export default function ListingWizard({ onClose, onPublish, toast }: { onClose: () => void; onPublish: (event: FormEvent<HTMLFormElement>) => Promise<void>; toast: string }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ title: '', category: 'Villa', city: '', country: 'France', image: '', description: '', price: '', cleaningFee: '35' })
  const update = (field: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const validate = () => {
    if (step === 0 && draft.title.trim().length < 3) return 'Donnez un titre d’au moins 3 caractères à votre logement.'
    if (step === 1 && (!draft.city.trim() || !draft.country.trim())) return 'Renseignez la ville et le pays.'
    if (step === 2) {
      try { const url = new URL(draft.image); if (!['https:', 'http:'].includes(url.protocol)) throw new Error() } catch { return 'Ajoutez une URL de photo valide (https://…).' }
      if (draft.description.trim().length < 10) return 'Décrivez le logement en au moins 10 caractères.'
    }
    if (step === 3 && (!Number.isFinite(Number(draft.price)) || Number(draft.price) < 1 || Number(draft.price) > 10000)) return 'Choisissez un prix entre 1 et 10 000 €.'
    if (step >= 3 && (!draft.cleaningFee.trim() || !Number.isFinite(Number(draft.cleaningFee)) || Number(draft.cleaningFee) < 0 || Number(draft.cleaningFee) > 100000 || !/^\d+(\.\d{1,2})?$/.test(draft.cleaningFee))) return 'Renseignez des frais de ménage entre 0 et 100 000 €, avec deux décimales maximum.'
    return ''
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const validation = validate()
    setError(validation)
    if (validation) return
    if (step < steps.length - 1) { setStep(step + 1); window.scrollTo(0, 0); return }
    setBusy(true)
    try { await onPublish(event) } finally { setBusy(false) }
  }
  const current = steps[step]
  const Icon = current.icon
  return <div className="listing-wizard">
    <header className="listing-wizard-header"><span className="listing-wizard-brand"><Home size={25} /> Foyaltoloman</span><button type="button" className="wizard-exit" disabled={busy} onClick={onClose}>Quitter <X size={16} /></button></header>
    <form onSubmit={submit} noValidate>
      <input type="hidden" name="cleaningFee" value={draft.cleaningFee} />
      <input type="hidden" name="title" value={draft.title.trim()} /><input type="hidden" name="category" value={draft.category} /><input type="hidden" name="location" value={`${draft.city.trim()}, ${draft.country.trim()}`} /><input type="hidden" name="image" value={draft.image.trim()} /><input type="hidden" name="description" value={draft.description.trim()} /><input type="hidden" name="price" value={draft.price} />
      <main className="listing-wizard-main">
        <aside className="wizard-intro"><span className="wizard-eyebrow">CRÉEZ VOTRE ANNONCE · ÉTAPE {step + 1} SUR {steps.length}</span><h1>{current.title}</h1><p>{current.description}</p><ol className="wizard-step-list">{steps.map((item, index) => <li key={item.title} className={index === step ? 'current' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={14} /> : index + 1}</span>{item.title}</li>)}</ol></aside>
        <section className="wizard-panel" aria-label={current.title}><div className="wizard-section-icon"><Icon size={28} /></div>
          {step === 0 && <><h2>Quel logement proposez-vous ?</h2><label>Nom du logement<input autoFocus value={draft.title} onChange={(e) => update('title', e.target.value)} maxLength={120} placeholder="Une villa paisible au bord de l’eau" /></label><fieldset><legend>Catégorie du logement</legend><div className="wizard-categories">{['Cabane', 'Bord de mer', 'Montagne', 'Villa', 'Ville', 'Nature'].map((category) => <button key={category} type="button" aria-pressed={draft.category === category} className={draft.category === category ? 'selected' : ''} onClick={() => update('category', category)}>{category}</button>)}</div></fieldset></>}
          {step === 1 && <><h2>Où se trouve votre logement ?</h2><label>Ville<input autoFocus value={draft.city} onChange={(e) => update('city', e.target.value)} placeholder="Fort-de-France" maxLength={100} /></label><label>Pays<input value={draft.country} onChange={(e) => update('country', e.target.value)} placeholder="France" maxLength={70} /></label><p className="wizard-hint">Cette localisation sera affichée sur votre annonce.</p></>}
          {step === 2 && <><h2>Faites une belle première impression</h2><label>Photo de couverture (URL)<input autoFocus type="url" value={draft.image} onChange={(e) => update('image', e.target.value)} placeholder="https://…" maxLength={2048} /></label>{/^https?:\/\//.test(draft.image) && <img className="wizard-cover" src={draft.image} alt="Aperçu de votre logement" />}<label>Description<textarea rows={5} value={draft.description} onChange={(e) => update('description', e.target.value)} maxLength={5000} placeholder="Parlez du logement, de son ambiance et de ce que les voyageurs apprécieront…" /></label><small>{draft.description.length} / 5 000 caractères</small></>}
          {step === 3 && <><h2>Quel est votre prix par nuit ?</h2><label>Prix par nuit (€)<input autoFocus className="wizard-price" type="number" min={1} max={10000} step="0.01" value={draft.price} onChange={(e) => update('price', e.target.value)} placeholder="120" /></label><p className="wizard-hint">Ce montant est le tarif de base du logement, hors frais et options de réservation.</p><label>Frais de ménage (€ par séjour)<input type="number" min={0} max={100000} step="0.01" value={draft.cleaningFee} onChange={(e) => update('cleaningFee', e.target.value)} required /></label><p className="wizard-hint">Facturés une seule fois par séjour. Indiquez 0 si vous ne facturez pas le ménage.</p></>}
          {step === 4 && <><h2>Votre annonce est prête</h2><article className="wizard-preview"><img className="wizard-cover" src={draft.image} alt={draft.title} /><span className="wizard-eyebrow">{draft.category}</span><h3>{draft.title}</h3><p>{draft.city}, {draft.country}</p><strong>{Number(draft.price).toLocaleString('fr-FR')} € <small>/ nuit</small></strong><p className="wizard-description">{draft.description}</p></article><p className="wizard-hint">Votre logement sera visible par les voyageurs dès sa publication.</p></>}
          {error && <p className="wizard-error" role="alert">{error}</p>}
          {step === 4 && <p>Frais de ménage : {Number(draft.cleaningFee).toLocaleString('fr-FR')} € par séjour.</p>}
        </section>
      </main>
      <footer className="wizard-footer"><div className="wizard-progress" aria-label={`Étape ${step + 1} sur ${steps.length}`}>{steps.map((item, index) => <span key={item.title} className={index <= step ? 'filled' : ''} />)}</div><div className="wizard-footer-actions"><button type="button" className="text-button" disabled={busy} onClick={() => { if (step === 0) onClose(); else { setStep(step - 1); setError('') } }}>{step === 0 ? 'Annuler' : 'Retour'}</button><span>{step + 1} / {steps.length}</span><button className="button-dark" type="submit" disabled={busy}>{busy ? 'Publication…' : step === steps.length - 1 ? 'Publier mon annonce' : 'Continuer'} <ArrowRight size={17} /></button></div></footer>
    </form>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}
