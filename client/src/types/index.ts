export interface Coffee {
  id: string;
  name: string;
  caffeine: number;
  icon: string;
  // Drink class/kind (issue #11): 'coffee' | 'tea' | 'energy' | 'chocolate'.
  // A semantic key like `icon` — the client owns the display label.
  class: string;
}

// One stored rendition of an image. `width` is the pixel width for srcset; a
// legacy single-file image (pre-backfill) has one variant with width null.
export interface ImageVariant {
  url: string;
  width: number | null;
  format: string;
}

// The server's responsive-image payload (issue #15): variants ascending by
// width, plus the original aspect. null when the row carries no image.
export interface ImageField {
  width: number | null;
  height: number | null;
  variants: ImageVariant[];
}

export interface CoffeeEntry {
  id: string;
  user_id: string;
  coffee_id: string;
  caffeine_mg: number;
  logged_at: number;
  created_at?: number;
  photo_path: string | null;
  photo_url?: string | null;
  // Responsive variants for a new-scheme photo; falls back to photo_url.
  image?: ImageField | null;
  description: string | null;
  is_public: 0 | 1;
}

export interface FeedPost {
  id: string;
  user_id: string;
  coffee_id: string;
  caffeine_mg: number;
  logged_at: number;
  photo_path: string | null;
  photo_url: string | null;
  image?: ImageField | null;
  description: string | null;
  is_public: 0 | 1;
  username: string;
  avatar: string;
  profile_photo_url: string | null;
  profile_image?: ImageField | null;
  likes_count: number;
  liked_by_me: boolean;
  bookmarked_by_me: boolean;
}

export interface User {
  id: string;
  username: string;
  avatar: string;
  profile_photo_url?: string | null;
  profile_image?: ImageField | null;
  featured_badges: string[];
  timezone?: string;
  // Personal caffeine half-life in hours, driving the Buzz decay curve. null
  // means unset — the server falls back to the 5 h population default.
  caffeine_half_life_h?: number | null;
  // Opt-in: enter me in my group's recurring matches without pressing join.
  // Off by default — nothing ever puts a user on a roster otherwise.
  auto_join_daily?: 0 | 1;
  auto_join_weekly?: 0 | 1;
  // Admin flag. Admins can reset non-admin passwords and promote non-admins
  // from the Profile page. Absent/0 for ordinary users.
  is_admin?: 0 | 1;
  // Protected "primary" admin (bootstrapped from ADMIN_USERNAME). The only admin
  // allowed to manage other admins; cannot itself be demoted or reset. Implies
  // is_admin.
  is_super_admin?: 0 | 1;
  created_at: number;
}

// Which running total a milestone counts toward. Server-defined — see the
// `progress` block in server/src/data/achievements.js.
export type ProgressMetric = 'total_cups' | 'total_caffeine' | 'unique_types' | 'goal_streak';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  secret: boolean;
  category: string;
  unlocked: boolean;
  unlocked_at: number | null;
  // Present only on counter milestones; event achievements get no bar. The
  // target is the server's, never restated here (see issue #30).
  progress?: { metric: ProgressMetric; target: number };
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'secret';
  secret: boolean;
  unlocked: boolean;
  unlocked_at: number | null;
}

export interface Streak {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_goal_date: string | null;
  goals_completed: number;
}

export interface Combo {
  current_combo: number;
  highest_combo: number;
  last_coffee_at: number | null;
  active: number;
}

// GET /streaks returns both, nested — not a flat streak object. Typing it
// inline as flat is what made the streak read `undefined` and every streak
// figure render as 0.
export interface StreaksResponse {
  streak: Streak;
  combo: Combo;
}

export interface Task {
  id: string;
  label: string;
  icon: string;
  completed: boolean;
}

export interface GoalsResponse {
  date: string;
  tasks: Task[];
  streak: Streak;
}

// Personal challenges were removed (issue #51); only community challenges remain.
export interface Challenge {
  id: string;
  type: 'community';
  creator_id: string | null;
  name: string;
  description: string;
  metric: string;
  target: number;
  start_date: string;
  end_date: string;
  status: 'active' | 'completed' | 'cancelled';
  participants_count: number;
  community_progress: number;
  my_progress: number | null;
  joined: boolean;
}

export interface RankingEntry {
  id: string;
  username: string;
  avatar: string;
  // The global board is an Elo ladder (issue #40): `rating` is the sort key,
  // `cups`/`total_caffeine` are display columns for the selected period.
  rating: number;
  // Settled competition matches. 0 = unrated; those sort last and show no rank.
  matches: number;
  // The player's competition group, or null if they are in none.
  group_name: string | null;
  cups: number;
  total_caffeine: number;
  rank: number;
}

export interface CasualtiesData {
  global_count: number;
  today_caffeine: number;
  heart_attack_risk: number;
  disclaimer: string;
}

// ── Notifications (issue #32) ────────────────────────────────────────────────
// An immutable, self-contained event. `payload` is opaque here on purpose: the
// frontend render catalog (src/notifications/catalog.tsx) is the only thing that
// interprets it, keyed by `type`, with a default renderer for unknown types.
// `Notification` is a DOM global, hence `AppNotification`.
export type NotificationType = 'match_end' | 'achievement' | 'badge';

export interface AppNotification {
  id: string;
  type: NotificationType | string;
  payload: unknown;
  read_at: number | null;
  created_at: number;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unread_count: number;
}

export interface Stats {
  total_cups: number;
  today_cups: number;
  today_caffeine: number;
  total_caffeine: number;
  seven_day_avg: number;
  by_type: Record<string, number>;
  last14: Array<{ date: string; cups: number; caffeine: number }>;
}

export interface CompareUserStats {
  total_cups: number;
  total_caffeine: number;
  today_cups: number;
  today_caffeine: number;
  seven_day_avg: number;
  favourite_coffee: Coffee | null;
  unique_types: number;
  current_streak: number;
  longest_streak: number;
  achievements_count: number;
  badges_count: number;
}

export interface FeaturedBadge {
  id: string;
  name: string;
  icon: string;
  rarity: string;
}

export interface CompareUserProfile {
  id: string;
  username: string;
  avatar: string;
  profile_photo_url?: string | null;
  profile_image?: ImageField | null;
  featured_badges: FeaturedBadge[];
  stats: CompareUserStats;
}

/* ── API response envelopes ──────────────────────────────────────────────────
 * Shapes returned by the Express server for the non-entity endpoints. These are
 * currently re-declared inline in several pages (and typed as `any` in Goals);
 * defining them here keeps every caller aligned with the server contract. */

export interface AuthResponse {
  token: string;
  user: User;
}

// Unlocks are no longer surfaced inline (issue #32): a successful unlock is
// persisted as a notification and reaches the client through the bell, so these
// envelopes carry only their primary result now.
export interface LogCoffeeResponse {
  entry: CoffeeEntry;
}

export interface GoalsCompleteResponse {
  tasks: Task[];
  allDone: boolean;
  streak: Streak;
}

export interface JoinChallengeResponse {
  ok: boolean;
}

export interface RankingsResponse {
  rankings: RankingEntry[];
  my_rank: RankingEntry | null;
}

export interface CompareResponse {
  me: CompareUserProfile;
  them: CompareUserProfile;
}

/* ── Buzz (energy score) ─────────────────────────────────────────────────────
 * GET /api/energy — derived, never stored. See server/src/energy.js. All `t`
 * values are UTC epoch ms (instant domain). */

export interface EnergyPoint {
  t: number;
  level: number;
  active_mg: number;
}

export interface EnergyDose {
  id: string;
  coffee_id: string;
  caffeine_mg: number;
  logged_at: number;
}

export interface EnergyResponse {
  level: number;
  active_mg: number;
  full_mg: number;
  state: 'charging' | 'draining' | 'empty';
  half_life_h: number;
  window_hours: number;
  step_ms: number;
  now: number;
  peak: EnergyPoint;
  empty_at: number | null;
  series: EnergyPoint[];
  doses: EnergyDose[];
}

/* ── Competitions ────────────────────────────────────────────────────────────
 * Groups, matches and ratings. See docs/competitions-rating-v2.md and
 * server/src/competition-core.js. All instants are UTC epoch ms. */

export type MatchMode = 'daily' | 'weekly' | 'ondemand' | '1v1';

// open      lobby, players may still join (user-created modes only)
// pending   running, roster locked
// settled   deltas written and applied to every participant's rating
// cancelled never reached a legal roster; no rating changed hands
export type MatchState = 'open' | 'pending' | 'settled' | 'cancelled';

export interface CompetitionGroup {
  id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  // One IANA zone for the whole group — every member's day/week boundary.
  timezone: string;
  is_public: 0 | 1;
  member_count: number;
  created_at: number;
  // Members only: the code that lets someone join a private group.
  join_code?: string;
}

export interface GroupMember {
  id: string;
  username: string;
  avatar: string;
  profile_photo_url: string | null;
  profile_image?: ImageField | null;
  joined_at: number;
  rating: number;
  matches: number;
}

export interface MatchParticipant {
  user_id: string;
  username: string;
  avatar: string;
  profile_photo_url: string | null;
  profile_image?: ImageField | null;
  joined_at: number;
  // Live for a running match (window so far), frozen at settlement afterwards.
  // A linear, uncapped integer — there is no maximum to render it against, so
  // never show it as a percentage, a bar, or a fraction of anything.
  points: number;
  rating_before: number | null;
  rating_after: number | null;
  delta: number | null;
  current_rating: number;
}

export interface Match {
  id: string;
  // null for a global (cross-group) match that belongs to no group (issue #35).
  group_id: string | null;
  mode: MatchMode;
  // Civil period for the recurring modes, null for user-created ones.
  period_key: string | null;
  title: string | null;
  creator_id: string | null;
  scope_start: number;
  scope_end: number;
  state: MatchState;
  k_factor: number;
  created_at: number;
  settled_at: number | null;
  participant_count: number;
  participants: MatchParticipant[];
}

export interface CompetitionsResponse {
  group: { id: string; name: string; timezone: string } | null;
  open: Match[];
  live: Match[];
  settled: Match[];
  // Group-less matches anyone can join (issue #35). `open` is every open global
  // lobby; `live`/`settled` are only the ones the caller is in.
  global: { open: Match[]; live: Match[]; settled: Match[] };
  my_rating: number;
  my_matches: number;
}

export interface GroupsResponse {
  groups: CompetitionGroup[];
  my_group: CompetitionGroup | null;
}

export interface GroupDetailResponse {
  group: CompetitionGroup | null;
  members: GroupMember[];
  is_member?: boolean;
  // Set by join/leave so the UI can say which group was left behind.
  left_group?: { id: string; name: string } | null;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  avatar: string;
  profile_photo_url: string | null;
  profile_image?: ImageField | null;
  rating: number;
  matches: number;
  rank: number;
}

// `rank` is global in both scopes — the group scope filters who is listed, it
// does not re-rank them (issue #53). `me` is the caller's own row, always
// present even when they fall outside the returned page.
export interface LeaderboardResponse {
  scope: CompeteScope;
  group: { id: string; name: string } | null;
  me: LeaderboardEntry | null;
  leaderboard: LeaderboardEntry[];
}

export type CompeteScope = 'global' | 'group';

// One settled match the caller played, as an elo-change event (issue #34). Only
// settled matches appear, so rating_before/after/delta are always present here
// (a cancelled match, which moves no rating, is never in this list).
export interface PersonalHistoryEntry {
  match_id: string;
  mode: MatchMode;
  title: string | null;
  group_id: string | null;
  scope_start: number;
  scope_end: number;
  settled_at: number;
  rating_before: number;
  rating_after: number;
  delta: number;
}

// GET /api/competitions/history — the caller's rating timeline (personal) and
// their group's finished matches (public). The graph windows `personal`
// client-side into 30d/7d/24h.
export interface CompetitionHistoryResponse {
  group: { id: string; name: string } | null;
  my_rating: number;
  personal: PersonalHistoryEntry[];
  group_history: Match[];
}
