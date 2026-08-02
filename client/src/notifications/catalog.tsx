import type { AppNotification } from '../types';

// Turns a stored notification payload into a display descriptor, keyed by type.
// Text and layout live here, never in the backend, so a change applies to every
// row. Each type gets a shape built around its own key figures — not one rigid
// row — so the data reads at a glance.
export type Tone = 'up' | 'down' | 'neutral';

// achievement / badge: icon + name lead, description secondary.
interface SimpleRender {
  kind: 'simple';
  icon: string;
  tag: string;   // "Achievement" | "Badge"
  name: string;
  description: string;
}

// match_end: the result leads; placing and rating change are discrete chips.
interface MatchRender {
  kind: 'match';
  icon: string;
  result: 'Won' | 'Lost' | 'Tied';
  tone: Tone;
  mode: string;    // "daily" | "weekly" | …, for the sentence
  rank: number;
  count: number;
  delta: number;
  context: string; // group name or "Global"
}

// unknown type: raw fallback so a server type ahead of the frontend still shows.
interface RawRender {
  kind: 'raw';
  icon: string;
  title: string;
  rows: [string, string][];
}

export type RenderedNotification = SimpleRender | MatchRender | RawRender;

interface AchievementPayload { id: string; name: string; icon: string; description: string }
interface MatchEndPayload {
  match_id: string; title: string | null; group_name: string | null;
  mode: string; rank: number; participant_count: number;
  score: number; delta: number;
}

const catalog: Record<string, (p: never) => RenderedNotification> = {
  achievement: (p: AchievementPayload): SimpleRender => ({
    kind: 'simple', icon: p.icon || 'medal', tag: 'Achievement', name: p.name, description: p.description,
  }),
  badge: (p: AchievementPayload): SimpleRender => ({
    kind: 'simple', icon: p.icon || 'award', tag: 'Badge', name: p.name, description: p.description,
  }),
  match_end: (p: MatchEndPayload): MatchRender => ({
    kind: 'match',
    icon: 'trophy',
    result: p.delta > 0 ? 'Won' : p.delta < 0 ? 'Lost' : 'Tied',
    tone: p.delta > 0 ? 'up' : p.delta < 0 ? 'down' : 'neutral',
    mode: p.mode,
    rank: p.rank,
    count: p.participant_count,
    delta: p.delta,
    context: p.group_name ?? 'Global',
  }),
} as Record<string, (p: never) => RenderedNotification>;

function renderDefault(n: AppNotification): RawRender {
  const p = n.payload;
  const rows: [string, string][] = p && typeof p === 'object'
    ? Object.entries(p as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    : [['value', String(p)]];
  return { kind: 'raw', icon: 'bell', title: n.type, rows };
}

export function renderNotification(n: AppNotification): RenderedNotification {
  const entry = catalog[n.type];
  return entry ? entry(n.payload as never) : renderDefault(n);
}

// 1st / 2nd / 3rd / 4th … for the rank pill.
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
