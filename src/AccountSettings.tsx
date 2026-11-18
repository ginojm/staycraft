import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowRight, UserCircle, X } from 'lucide-react'
import { apiRequest } from './api'

export type AccountProfile = { id: string; name: string; firstName: string; lastName: string; email: string; avatarUrl: string; address: string; phone: string; active: boolean }

export default function AccountSettings({ token, profile, onClose, onSaved }: { token: string; profile: AccountProfile; onClose: () => void; onSaved: (profile: AccountProfile) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Sélectionnez une image JPG, PNG ou WebP.'); return }
    if (file.size > 5 * 1024 * 1024) { setError('La photo doit faire moins de 5 Mo.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const scale = Math.min(1, 512 / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
        setAvatarUrl(canvas.toDataURL('image/jpeg', 0.82)); setError('')
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const form = new FormData(event.currentTarget)
    try {
      const { user } = await apiRequest<{ user: AccountProfile }>('/account', token, { method: 'PATCH', body: JSON.stringify({ firstName: form.get('firstName'), lastName: form.get('lastName'), email: form.get('email'), avatarUrl, address: form.get('address'), phone: form.get('phone') }) })
      onSaved(user); setNotice('Votre compte a été mis à jour.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.') } finally { setBusy(false) }
  }

  return <div className="listing-wizard">
    <header className="listing-wizard-header"><span className="listing-wizard-brand"><UserCircle size={25} /> Mon compte</span><button className="wizard-exit" disabled={busy} onClick={onClose}>Retour au site</button></header>
    <main className="account-settings-main"><section className="account-settings-panel"><div className="account-settings-intro"><div className="account-profile-preview">{avatarUrl ? <img src={avatarUrl} alt="Photo de profil" /> : <UserCircle size={45} />}</div><div><p className="settings-kicker">VOTRE PROFIL</p><h1>Mes informations</h1><p>Modifiez les informations utilisées pour votre compte et vos réservations.</p></div></div>{error && <p className="wizard-error" role="alert">{error}</p>}{notice && <p className="manage-notice" role="status">{notice}</p>}<form className="account-settings-form" onSubmit={save}><div className="account-form-grid"><label>Prénom<input name="firstName" defaultValue={profile.firstName} maxLength={80} required /></label><label>Nom<input name="lastName" defaultValue={profile.lastName} maxLength={80} required /></label></div><label>E-mail<input name="email" type="email" defaultValue={profile.email} maxLength={254} required /></label><div className="profile-photo-field"><label>Photo de profil<input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto} /></label><small>JPG, PNG ou WebP · 5 Mo maximum. L’image est automatiquement redimensionnée.</small></div><label>Adresse<input name="address" defaultValue={profile.address} maxLength={250} placeholder="Adresse postale" /></label><label>Téléphone<input name="phone" type="tel" defaultValue={profile.phone} maxLength={30} placeholder="+596 …" /></label><div className="account-settings-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}><X size={15} /> Annuler</button><button className="button-dark" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'} <ArrowRight size={16} /></button></div></form></section></main>
  </div>
}
