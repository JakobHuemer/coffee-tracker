import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { UnlockToast } from '../components/UnlockToast';
import { Icon } from '../components/Icon';
import {
  PastTimePicker, currentPastTime, resolvePastTime, useNow, type PastTime,
} from '../components/PastTimePicker';
import { getSkipSpacing } from '../devFlags';
import type { Coffee, UnlockNotification } from '../types';
type Step = 'photo' | 'details';

export function LogCoffee() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const token = useAuthStore(s => s.token);

  const { data: coffees = [] } = useQuery<Coffee[]>({
    queryKey: ['coffees'],
    queryFn: () => fetch('/api/coffees', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    staleTime: Infinity,
  });

  const [step, setStep] = useState<Step>('photo');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  // What the user typed into the picker. The timestamp is derived from it on
  // every render rather than stored, so there is no second copy to fall out of
  // date — and `now` ticks, so a value can leave the 24h window on its own.
  const [pastTime, setPastTime] = useState<PastTime>(currentPastTime);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notifications, setNotifications] = useState<UnlockNotification[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  // Mirrors photoPreview so the URL can be revoked without reading state.
  const previewRef = useRef<string | null>(null);

  const now = useNow(30_000);
  const resolvedTime = resolvePastTime(pastTime, now);

  // A *public* post must carry a photo or a description — mirrors the server's
  // POST /coffees/entries rule. A private entry needs only the coffee type.
  // Keep every label/hint here in sync with that rule; a disabled button with
  // no explanation is a bug (see VALUES.md 0.4).
  const hasPhoto = !!photo;
  const hasDescription = description.trim().length > 0;
  const meetsContentRule = !isPublic || hasPhoto || hasDescription;

  // Object URLs are entries in the document's blob URL store, which holds a
  // strong reference to the File. Dropping the string does not free the image —
  // only revoking does, and this is an SPA, so nothing unloads the document to
  // clear the store for us. Every URL created here is revoked through this one
  // setter (and on unmount below), so the photo can be swapped freely.
  //
  // Deliberately not done inside a state updater: React may invoke an updater
  // twice, which would mint a second URL and orphan the first.
  function setPreview(next: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next;
    setPhotoPreview(next);
  }

  // Abandoning the form (back out, navigate away, post and redirect) must not
  // strand the last preview. Revoke straight off the ref — no state update on
  // an unmounted component.
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
  }, []);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  // Clearing the input first is what makes "use another" work when the user
  // re-picks the very same file — an unchanged value fires no change event.
  function openPhotoPicker() {
    if (fileRef.current) fileRef.current.value = '';
    fileRef.current?.click();
  }

  function retakePhoto() {
    setPhoto(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSubmit() {
    if (!selectedId) { setError('Please select a coffee type.'); return; }
    if (!meetsContentRule) { setError('Public posts need a photo or a description.'); return; }
    // No future logs, nothing older than 24h — the picker flags both inline, so
    // this only catches a submit that races the window's edge. Re-resolved
    // against a fresh Date.now() rather than the render's ticking clock, since
    // that is the instant the server will judge it by.
    // (See docs/time-and-timezones.md.)
    const { timestamp } = resolvePastTime(pastTime, Date.now());
    if (timestamp === null) {
      setError('Pick a time within the last 24 hours.');
      return;
    }
    setError(null);
    setSubmitting(true);

    const fd = new FormData();
    fd.append('coffeeId', selectedId);
    fd.append('timestamp', String(timestamp));
    fd.append('is_public', isPublic ? '1' : '0');
    if (description.trim()) fd.append('description', description.trim());
    if (photo) fd.append('photo', photo);
    // Debug switch from the Profile page. Ignored unless the server itself runs
    // with DEV_OVERRIDES=1 (see server/src/routes/coffees.js).
    if (getSkipSpacing()) fd.append('skip_spacing', '1');

    try {
      const res = await fetch('/api/coffees/entries', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        setSubmitting(false);
        return;
      }
      // A new coffee can move every derived surface (unlocks, tasks, streaks,
      // casualties, rankings, Buzz), so invalidate all of them — not just the
      // feed — to keep every page consistent with the just-logged entry.
      for (const key of ['feed', 'entries', 'stats', 'streaks', 'goals',
        'badges', 'achievements', 'casualties', 'challenges', 'rankings',
        'energy']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      if (data.unlocked?.length) {
        setNotifications(data.unlocked);
        // Brief pause so the toast is visible before navigating.
        setTimeout(() => navigate('/'), 2500);
      } else {
        navigate('/');
      }
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="page log-page">
      <UnlockToast notifications={notifications} onClear={() => setNotifications([])} />

      {/* Lives outside both steps: the details step can reopen the picker, so
          unmounting it with the photo step would break "Add a photo" there. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handlePhotoChange}
      />

      <header className="log-header-bar">
        <button className="log-back-btn" onClick={() => navigate('/')} aria-label="Close"><Icon name="close" /></button>
        <h2 className="log-title">{step === 'photo' ? 'Snap a photo' : 'New coffee'}</h2>
        {step === 'photo' && (
          <button className="log-skip-btn" onClick={() => setStep('details')}>Skip</button>
        )}
        {step === 'details' && <span />}
      </header>

      {step === 'photo' && (
        <div className="log-photo-step">
          {photoPreview ? (
            <div className="log-photo-preview-wrap">
              <img className="log-photo-preview" src={photoPreview} alt="Preview" />
              <button className="log-retake-btn" onClick={retakePhoto}>Retake</button>
              <button className="btn-primary log-next-btn" onClick={() => setStep('details')}>
                Use this photo <Icon name="arrow-right" />
              </button>
            </div>
          ) : (
            <div className="log-camera-area">
              <div className="log-camera-icon"><Icon name="camera" size={44} /></div>
              <p className="log-camera-hint">Add a photo of your coffee</p>
              <button className="btn-primary log-camera-btn" onClick={openPhotoPicker}>
                Add photo
              </button>
              <button className="btn-secondary log-skip-inline" onClick={() => setStep('details')}>
                Skip photo
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'details' && (
        <div className="log-details-step">
          {photoPreview ? (
            <div className="log-details-thumb-wrap">
              <img className="log-details-thumb" src={photoPreview} alt="Your coffee" />
              <div className="log-thumb-actions">
                <button className="log-thumb-btn" onClick={openPhotoPicker}>
                  <Icon name="camera" size={15} /> Use another
                </button>
                <button className="log-thumb-btn danger" onClick={retakePhoto}>
                  <Icon name="close" size={15} /> Remove
                </button>
              </div>
            </div>
          ) : (
            // Skipping the photo step is not final — a description-only entry is
            // valid, but the photo has to stay one tap away from here.
            <button className="log-add-photo-bar" onClick={openPhotoPicker}>
              <Icon name="camera" size={18} />
              <span>Add a photo</span>
            </button>
          )}

          <div className="log-form">
            <div className="section-label">Coffee type</div>
            <div className="coffee-grid">
              {coffees.map(c => (
                <button
                  key={c.id}
                  className={`coffee-btn${selectedId === c.id ? ' selected' : ''}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className="cb-icon"><Icon name={c.icon} size={24} /></span>
                  <span className="cb-name">{c.name}</span>
                  <span className="cb-mg">{c.caffeine}mg</span>
                </button>
              ))}
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label>Time</label>
              <PastTimePicker
                value={pastTime}
                resolved={resolvedTime}
                now={now}
                onChange={setPastTime}
              />
            </div>

            <div className="field">
              <label>
                Description{' '}
                <span className="field-hint">
                  {hasPhoto || !isPublic ? '(optional)' : '(required unless you add a photo)'}
                </span>
              </label>
              <textarea
                className="log-textarea"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What made this coffee special?"
                rows={2}
                maxLength={280}
              />
            </div>

            <div className="log-share-row">
              <div>
                <div className="log-share-label">Share with everyone</div>
                <div className="log-share-sub">Visible in the public feed</div>
              </div>
              <button
                className={`log-toggle${isPublic ? ' on' : ''}`}
                onClick={() => setIsPublic(v => !v)}
                aria-pressed={isPublic}
              >
                <span className="log-toggle-knob" />
              </button>
            </div>

            {error && <div className="auth-error">{error}</div>}

            {!selectedId && (
              <div className="log-requirement-hint">Pick a coffee type to continue.</div>
            )}
            {selectedId && !meetsContentRule && (
              <div className="log-requirement-hint">Add a photo or write a description to post publicly.</div>
            )}

            <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !selectedId || !meetsContentRule || resolvedTime.timestamp === null}>
              {submitting ? 'Posting…' : 'Post coffee'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
