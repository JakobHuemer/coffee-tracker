import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { UnlockToast } from '../components/UnlockToast';
import type { UnlockNotification } from '../types';

const COFFEES = [
  { id: 'espresso',        name: 'Espresso',        caffeine: 63,  icon: '☕' },
  { id: 'espresso_mac',   name: 'Espresso Mac.',   caffeine: 63,  icon: '☕' },
  { id: 'doppio',          name: 'Doppio',           caffeine: 128, icon: '☕' },
  { id: 'lungo',           name: 'Lungo',            caffeine: 60,  icon: '☕' },
  { id: 'americano',       name: 'Americano',        caffeine: 95,  icon: '☕' },
  { id: 'cappuccino',      name: 'Cappuccino',       caffeine: 75,  icon: '☕' },
  { id: 'flat_white',      name: 'Flat White',       caffeine: 130, icon: '☕' },
  { id: 'latte',           name: 'Latte',            caffeine: 75,  icon: '🥛' },
  { id: 'latte_macchiato', name: 'Latte Macchiato',  caffeine: 75,  icon: '🥛' },
  { id: 'affogato',        name: 'Affogato',         caffeine: 63,  icon: '🍨' },
  { id: 'frappuccino',     name: 'Frappuccino',      caffeine: 95,  icon: '🧋' },
  { id: 'chocochino',      name: 'Chocochino',       caffeine: 30,  icon: '🍫' },
  { id: 'hot_chocolate',   name: 'Hot Chocolate',    caffeine: 25,  icon: '🍫' },
];

type Step = 'photo' | 'details';

export function LogCoffee() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const token = useAuthStore(s => s.token);

  const [step, setStep] = useState<Step>('photo');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [timeValue, setTimeValue] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notifications, setNotifications] = useState<UnlockNotification[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function retakePhoto() {
    setPhoto(null);
    setPhotoPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSubmit() {
    if (!selectedId) { setError('Please select a coffee type.'); return; }
    setError(null);
    setSubmitting(true);

    const [h, m] = timeValue.split(':').map(Number);
    const ts = new Date();
    ts.setHours(h, m, 0, 0);

    const fd = new FormData();
    fd.append('coffeeId', selectedId);
    fd.append('timestamp', String(ts.getTime()));
    fd.append('is_public', isPublic ? '1' : '0');
    if (description.trim()) fd.append('description', description.trim());
    if (photo) fd.append('photo', photo);

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
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['streaks'] });
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

      <header className="log-header-bar">
        <button className="log-back-btn" onClick={() => navigate('/')}>✕</button>
        <h2 className="log-title">{step === 'photo' ? 'Snap a photo' : 'Log coffee'}</h2>
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
                Use this photo →
              </button>
            </div>
          ) : (
            <div className="log-camera-area">
              <div className="log-camera-icon">📷</div>
              <p className="log-camera-hint">Take a photo of your coffee</p>
              <button className="btn-primary log-camera-btn" onClick={() => fileRef.current?.click()}>
                Open camera
              </button>
              <button className="btn-secondary log-skip-inline" onClick={() => setStep('details')}>
                Skip photo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={handlePhotoChange}
              />
            </div>
          )}
        </div>
      )}

      {step === 'details' && (
        <div className="log-details-step">
          {photoPreview && (
            <div className="log-details-thumb-wrap">
              <img className="log-details-thumb" src={photoPreview} alt="Your coffee" />
            </div>
          )}

          <div className="log-form">
            <div className="section-label">Coffee type</div>
            <div className="coffee-grid">
              {COFFEES.map(c => (
                <button
                  key={c.id}
                  className={`coffee-btn${selectedId === c.id ? ' selected' : ''}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className="cb-icon">{c.icon}</span>
                  <span className="cb-name">{c.name}</span>
                  <span className="cb-mg">{c.caffeine}mg</span>
                </button>
              ))}
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label>Time</label>
              <input type="time" value={timeValue} onChange={e => setTimeValue(e.target.value)} />
            </div>

            <div className="field">
              <label>Description <span className="field-hint">(optional)</span></label>
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

            <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !selectedId}>
              {submitting ? 'Logging…' : 'Log coffee'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
