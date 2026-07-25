import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import type { UnlockNotification } from '../types';

interface Props {
  notifications: UnlockNotification[];
  onClear: () => void;
}

export function UnlockToast({ notifications, onClear }: Props) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<UnlockNotification | null>(null);
  const [queue, setQueue] = useState<UnlockNotification[]>([]);

  useEffect(() => {
    if (notifications.length > 0) {
      setQueue(prev => [...prev, ...notifications]);
      onClear();
    }
  }, [notifications]);

  // Advance to the next queued notification once nothing is showing.
  useEffect(() => {
    if (!visible && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrent(next);
      setQueue(rest);
      setVisible(true);
    }
  }, [queue, visible]);

  // Auto-hide the current notification after a few seconds. Keyed on `current`
  // so each shown item gets its own timer that isn't cancelled by queue changes.
  useEffect(() => {
    if (!visible || !current) return;
    const t = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(t);
  }, [visible, current]);

  if (!visible || !current) return null;

  return (
    <div className="unlock-toast" onClick={() => setVisible(false)}>
      <span className="ut-icon"><Icon name={current.icon} size={28} /></span>
      <div className="ut-body">
        <div className="ut-type">
          <Icon name={current.type === 'achievement' ? 'medal' : 'award'} />{' '}
          {current.type === 'achievement' ? 'Achievement Unlocked' : 'Badge Earned'}
        </div>
        <div className="ut-name">{current.name}</div>
        <div className="ut-desc">{current.description}</div>
      </div>
    </div>
  );
}
