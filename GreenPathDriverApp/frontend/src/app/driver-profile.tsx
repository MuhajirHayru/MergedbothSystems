"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react"
import {
  Camera,
  CheckCircle2,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Trash2,
  Truck,
  UserRound,
} from "lucide-react"

import {
  deleteDriverProfilePhoto,
  loadDriverProfile,
  updateDriverProfile,
  uploadDriverProfilePhoto,
  type DriverProfileResponse,
} from "@/lib/driver-features"
import { apiBaseUrl } from "@/lib/logistics-api"

type ProfileApplication = {
  status: string
  legal_full_name: string
  license_number: string
  license_expiry: string | null
  vehicle_type: string
  vehicle_registration: string
  cargo_capacity_kg: string | null
  service_region: string
  service_zone: string
  service_wereda: string
} | null

type DriverProfileProps = {
  user: {
    username: string
    email: string
    first_name: string
    last_name: string
  }
  application: ProfileApplication
  availability: { available: boolean; eligible: boolean } | null
  onProfileSaved: (fullName: string, phone: string) => void
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"]

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function DriverProfile({
  user,
  application,
  availability,
  onProfileSaved,
}: DriverProfileProps) {
  const [profile, setProfile] = useState<DriverProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [saving, setSaving] = useState(false)
  const [photoVersion, setPhotoVersion] = useState(0)
  const [photoSrc, setPhotoSrc] = useState("")
  const [photoPreview, setPhotoPreview] = useState("")
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoWorking, setPhotoWorking] = useState(false)
  const [photoError, setPhotoError] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const response = await loadDriverProfile()
      setProfile(response)
      setFullName(response.profile.full_name ?? "")
      setPhone(response.profile.phone ?? "")
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your profile.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!editing) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [editing])

  useEffect(() => {
    return () => {
      if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  const copied = profile?.profile
  const linked = Boolean(profile?.linked)
  const editable = profile?.editable ?? { full_name: false, phone: false, photo: false }
  const displayName =
    copied?.full_name ||
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.username
  const displayEmail = copied?.email || user.email
  const displayPhone = copied?.phone || phone || "Not provided"
  const initials = (displayName || "DR").slice(0, 2).toUpperCase()
  const accountStatus =
    copied?.status ??
    ((user as { is_active?: boolean }).is_active === false ? "SUSPENDED" : "APPROVED")
  const approvalStatus = copied?.approval || application?.status || ""
  const availabilityLabel = availability?.eligible
    ? availability.available
      ? "Active"
      : "Inactive"
    : "Unavailable"
  useEffect(() => {
    if (!profile?.profile.profile_photo) {
      setPhotoSrc("")
      return
    }
    let cancelled = false
    let objectUrl = ""
    fetch(`${apiBaseUrl()}/auth/profile/photo/?v=${photoVersion}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return
        if (typeof URL.createObjectURL !== "function") return
        objectUrl = URL.createObjectURL(blob)
        setPhotoSrc(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [profile?.profile.profile_photo, photoVersion])

  const photoUrl = photoSrc

  const dirty =
    editing && (fullName.trim() !== (copied?.full_name ?? "") || phone.trim() !== (copied?.phone ?? ""))

  function startEditing() {
    setFullName(copied?.full_name ?? "")
    setPhone(copied?.phone ?? "")
    setEditing(true)
    setNotice("")
    setError("")
  }

  function cancelEditing() {
    if (dirty && !window.confirm("Discard your unsaved profile changes?")) return
    setEditing(false)
    setFullName(copied?.full_name ?? "")
    setPhone(copied?.phone ?? "")
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const fields: { full_name?: string; phone?: string } = {}
    if (fullName.trim() && fullName.trim() !== copied?.full_name) fields.full_name = fullName.trim()
    if (phone.trim() && phone.trim() !== copied?.phone) fields.phone = phone.trim()
    if (!Object.keys(fields).length) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const result = await updateDriverProfile(fields)
      setProfile((current) =>
        current ? { ...current, profile: { ...current.profile, ...result.profile } } : current,
      )
      setEditing(false)
      setNotice("Profile updated.")
      onProfileSaved(result.profile.full_name ?? displayName, result.profile.phone ?? phone)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your profile could not be updated.")
    } finally {
      setSaving(false)
    }
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    setPhotoError("")
    const file = event.target.files?.[0]
    if (!file) return
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError("Choose a JPEG, PNG, or WebP image.")
      event.target.value = ""
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError("Profile images must be 5 MB or smaller.")
      event.target.value = ""
      return
    }
    if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview)
    setPhotoFile(file)
    let preview = ""
    if (typeof URL.createObjectURL === "function") {
      try {
        preview = URL.createObjectURL(file)
      } catch {
        preview = ""
      }
    }
    setPhotoPreview(preview)
  }

  async function savePhoto() {
    if (!photoFile || photoWorking) return
    setPhotoWorking(true)
    setPhotoError("")
    setNotice("")
    try {
      await uploadDriverProfilePhoto(photoFile)
      setPhotoVersion((value) => value + 1)
      setPhotoFile(null)
      if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview)
      setPhotoPreview("")
      if (fileInput.current) fileInput.current.value = ""
      await load()
      setNotice("Profile picture updated.")
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "The picture could not be uploaded.")
    } finally {
      setPhotoWorking(false)
    }
  }

  async function removePhoto() {
    if (photoWorking) return
    if (!window.confirm("Remove your current profile picture?")) return
    setPhotoWorking(true)
    setPhotoError("")
    setNotice("")
    try {
      await deleteDriverProfilePhoto()
      setPhotoVersion((value) => value + 1)
      setProfile((current) =>
        current ? { ...current, profile: { ...current.profile, profile_photo: null } } : current,
      )
      setNotice("Profile picture removed.")
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "The picture could not be removed.")
    } finally {
      setPhotoWorking(false)
    }
  }

  if (loading) {
    return (
      <section className="profile-card" aria-busy="true">
        <p className="panel-description">Loading your profile…</p>
      </section>
    )
  }

  return (
    <section className="profile-card" aria-labelledby="profile-heading">
      <div className="profile-card-identity">
        <div className="profile-photo">
          {photoPreview || photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview || photoUrl} alt="" />
          ) : (
            <span>{initials}</span>
          )}
          <button
            className="profile-photo-action"
            type="button"
            onClick={() => fileInput.current?.click()}
            aria-label="Choose a profile picture"
            disabled={!editable.photo || photoWorking}
          >
            <Camera size={14} aria-hidden="true" />
          </button>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={choosePhoto}
            aria-label="Profile picture file"
          />
        </div>

        <div className="profile-card-copy">
          <p className="eyebrow">DRIVER PROFILE</p>
          <h2 id="profile-heading">{displayName}</h2>
          <ul className="profile-contact">
            <li><Mail size={13} aria-hidden="true" /> {displayEmail}</li>
            <li><Phone size={13} aria-hidden="true" /> {displayPhone}</li>
            <li><MapPin size={13} aria-hidden="true" /> {copied?.location || "Location managed by Marketplace"}</li>
          </ul>
          <div className="profile-badges">
            <span className={`status-pill status-${accountStatus.toLowerCase()}`}>{readable(accountStatus)}</span>
            {approvalStatus && (
              <span className={`status-pill status-${approvalStatus}`}>{readable(approvalStatus)}</span>
            )}
            <span className={`status-pill ${availability?.available ? "status-approved" : "status-pending"}`}>
              {availabilityLabel}
            </span>
          </div>
        </div>
      </div>

      {(photoFile || photoError || photoWorking || (copied?.profile_photo && linked)) && (
        <div className="profile-photo-panel">
          {photoWorking && <p className="panel-description" role="status">Saving your picture…</p>}
          {photoError && <p className="feedback feedback-error" role="alert">{photoError}</p>}
          {photoFile && !photoWorking && (
            <div className="profile-photo-actions">
              <span className="field-hint">{photoFile.name}</span>
              <button className="button button-primary button-small" type="button" onClick={() => void savePhoto()}>
                Save picture
              </button>
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={() => {
                  setPhotoFile(null)
                  if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview)
                  setPhotoPreview("")
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {!photoFile && copied?.profile_photo && (
            <button
              className="button button-warning button-small"
              type="button"
              onClick={() => void removePhoto()}
              disabled={photoWorking}
            >
              <Trash2 size={13} aria-hidden="true" /> Remove picture
            </button>
          )}
        </div>
      )}

      {!linked && (
        <p className="feedback feedback-warning" role="status">
          {profile?.detail || "Re-open DriverApp from your Marketplace driver account to edit your canonical profile."}
        </p>
      )}

      <div className="profile-columns">
        <section className="profile-personal" aria-labelledby="profile-personal-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PERSONAL INFORMATION</p>
              <h3 id="profile-personal-heading">Contact details</h3>
            </div>
            {!editing && (
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={startEditing}
                disabled={!editable.full_name && !editable.phone}
              >
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <form className="profile-form" onSubmit={handleSave}>
              <label className="form-field">
                Full name
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  maxLength={255}
                  disabled={!editable.full_name}
                />
              </label>
              <label className="form-field">
                Phone number
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  type="tel"
                  maxLength={32}
                  disabled={!editable.phone}
                />
              </label>
              <p className="field-hint">
                Email, location, and account approval are managed by the Marketplace.
              </p>
              {error && <p className="feedback feedback-error" role="alert">{error}</p>}
              <div className="form-actions">
                <button className="button button-secondary" type="button" onClick={cancelEditing} disabled={saving}>
                  Cancel
                </button>
                <button className="button button-primary" type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          ) : (
            <dl className="profile-details">
              <div><dt>Full name</dt><dd>{displayName}</dd></div>
              <div><dt>Phone</dt><dd>{displayPhone}</dd></div>
              <div><dt>Email</dt><dd>{displayEmail}</dd></div>
              <div><dt>Location</dt><dd>{copied?.location || "Not provided"}</dd></div>
            </dl>
          )}
          {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
          {!editing && error && <p className="feedback feedback-error" role="alert">{error}</p>}
        </section>

        <section className="profile-personal" aria-labelledby="profile-driver-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DRIVER INFORMATION</p>
              <h3 id="profile-driver-heading">License and vehicle</h3>
            </div>
            <Truck size={18} aria-hidden="true" />
          </div>
          <dl className="profile-details">
            <div><dt>Driving license</dt><dd>{application?.license_number || "Not provided"}</dd></div>
            <div><dt>License expiry</dt><dd>{application?.license_expiry || "Not provided"}</dd></div>
            <div><dt>Vehicle type</dt><dd>{application?.vehicle_type || "Not provided"}</dd></div>
            <div><dt>Vehicle registration</dt><dd>{application?.vehicle_registration || "Not provided"}</dd></div>
            <div><dt>Cargo capacity</dt><dd>{application?.cargo_capacity_kg ? `${application.cargo_capacity_kg} kg` : "Not provided"}</dd></div>
            <div><dt>Service area</dt><dd>{[application?.service_region, application?.service_zone, application?.service_wereda].filter(Boolean).join(" · ") || "Not provided"}</dd></div>
          </dl>
          <p className="field-hint">
            <ShieldCheck size={13} aria-hidden="true" /> Verified license and approval details are
            read-only. Use the application section below to upload documents or request changes.
          </p>
        </section>
      </div>

      {application && (
        <div className="profile-approval-note">
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>
            Application status: <strong>{readable(application.status)}</strong>
            {copied?.approval ? ` · Marketplace approval: ${readable(copied.approval)}` : ""}
          </span>
          <UserRound size={14} aria-hidden="true" />
        </div>
      )}
    </section>
  )
}
