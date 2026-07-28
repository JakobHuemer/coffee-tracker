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
import { api } from '../api/client';
import type { Coffee, UnlockNotification } from '../types';

// Display label per drink class (issue #11). The server sends the class id on
// each catalog item; the client owns the label, mirroring how icon keys resolve.
const CLASS_LABEL: Record<string, string> = {
  coffee: 'Coffee',
  milk: 'Milk',
  chocolate: 'Chocolate',
  tea: 'Tea',
  energy: 'Energy',
};

export function LogCoffee() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const token = useAuthStore(s => s.token);

  const {
    data: coffees = [], isPending: menuPending, isError: menuFailed, refetch: refetchMenu,
  } = useQuery<Coffee[]>({
    queryKey: ['coffees'],
    queryFn: () => api.get<Coffee[]>('/coffees'),
    staleTime: Infinity,
  });

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

  // Two inputs, not one. A single `accept="image/*"` input hands the choice to
  // the platform, and on Android 13+ that means the system photo picker, which
  // has no camera at all — the shot-a-fresh-photo path just disappears. Asking
  // for each source explicitly is the only way to keep both reachable.
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
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

  // Clearing the input first is what makes re-picking work when the user
  // chooses the very same file — an unchanged value fires no change event.
  function openPicker(ref: React.RefObject<HTMLInputElement | null>) {
    if (ref.current) ref.current.value = '';
    ref.current?.click();
  }

  function removePhoto() {
    setPhoto(null);
    setPreview(null);
    // Both inputs, or the cleared one still holds a stale file.
    if (galleryRef.current) galleryRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
  }

  async function handleSubmit() {
    if (!selectedId) { setError('Please select a drink.'); return; }
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

      {/* `capture` is the whole reason these are separate elements: it is an
          attribute, not an argument, so one input cannot offer both sources. */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handlePhotoChange}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoChange}
      />

      <header className="log-header-bar">
        <button className="log-back-btn" onClick={() => navigate('/')} aria-label="Close"><Icon name="close" /></button>
        <h2 className="log-title">New coffee</h2>
        <span />
      </header>

      <div className="log-details-step">
        {photoPreview ? (
          <div className="log-details-thumb-wrap">
            <img className="log-details-thumb" src={photoPreview} alt="Your coffee" />
            <div className="log-thumb-actions">
              <button className="log-thumb-btn" onClick={() => openPicker(cameraRef)}>
                <Icon name="camera" size={15} /> Camera
              </button>
              <button className="log-thumb-btn" onClick={() => openPicker(galleryRef)}>
                <Icon name="gallery" size={15} /> Gallery
              </button>
              <button className="log-thumb-btn danger" onClick={removePhoto}>
                <Icon name="trash" size={15} /> Remove
              </button>
            </div>
          </div>
        ) : (
          // A photo is optional — a description-only entry is valid — but both
          // ways of adding one stay a single tap from the form.
          <div className="log-photo-actions">
            <button className="log-photo-btn" onClick={() => openPicker(cameraRef)}>
              <Icon name="camera" size={18} />
              <span>Take photo</span>
            </button>
            <button className="log-photo-btn" onClick={() => openPicker(galleryRef)}>
              <Icon name="gallery" size={18} />
              <span>Choose photo</span>
            </button>
          </div>
        )}

        <div className="log-form">
          <div className="section-label">Drink</div>
          {/* The menu is the server's now, so it can be missing. An empty grid
              under "Pick a coffee type to continue" is a dead end that blames
              the user for a failed fetch — say what happened and offer a retry. */}
          {menuPending ? (
            <div className="log-menu-note">Loading the coffee menu…</div>
          ) : menuFailed || coffees.length === 0 ? (
            <div className="log-requirement-hint">
              Couldn’t load the coffee menu.{' '}
              <button className="log-menu-retry" onClick={() => refetchMenu()}>Try again</button>
            </div>
          ) : (
            <div className="coffee-classes">
              {[...new Set(coffees.map(c => c.class))].map(cls => (
                <div className="coffee-class" key={cls}>
                  <div className="coffee-class-label">{CLASS_LABEL[cls] ?? cls}</div>
                  <div className="coffee-grid">
                    {coffees.filter(c => c.class === cls).map(c => (
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
                </div>
              ))}
            </div>
          )}

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

          {/* Only ask for a pick when there is something to pick from — with no
              menu the block above already explains why. */}
          {!selectedId && coffees.length > 0 && (
            <div className="log-requirement-hint">Pick a drink to continue.</div>
          )}
          {selectedId && !meetsContentRule && (
            <div className="log-requirement-hint">Add a photo or write a description to post publicly.</div>
          )}

          <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !selectedId || !meetsContentRule || resolvedTime.timestamp === null}>
            {submitting ? 'Posting…' : 'Post coffee'}
          </button>
        </div>
      </div>
    </div>
  );
}
