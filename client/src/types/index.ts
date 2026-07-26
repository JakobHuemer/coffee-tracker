export interface Coffee {
  id: string;
  name: string;
  caffeine: number;
  icon: string;
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
  description: string | null;
  is_public: 0 | 1;
  username: string;
  avatar: string;
  profile_photo_url: string | null;
  likes_count: number;
  liked_by_me: boolean;
  bookmarked_by_me: boolean;
}

export interface User {
  id: string;
  username: string;
  avatar: string;
  profile_photo_url?: string | null;
  featured_badges: string[];
  timezone?: string;
  // Personal caffeine half-life in hours, driving the Buzz decay curve. null
  // means unset — the server falls back to the 5 h population default.
  caffeine_half_life_h?: number | null;
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

export interface Challenge {
  id: string;
  type: 'community' | 'personal';
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

export interface UnlockNotification {
  type: 'achievement' | 'badge';
  id: string;
  name: string;
  description: string;
  icon: string;
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

export interface LogCoffeeResponse {
  entry: CoffeeEntry;
  unlocked: UnlockNotification[];
}

export interface GoalsCompleteResponse {
  tasks: Task[];
  allDone: boolean;
  unlocked: UnlockNotification[];
  streak: Streak;
}

export interface JoinChallengeResponse {
  ok: boolean;
  unlocked: UnlockNotification[];
}

export interface RankingsResponse {
  rankings: RankingEntry[];
  my_rank: RankingEntry | null;
}

export interface CompareResponse {
  me: CompareUserProfile;
  them: CompareUserProfile;
  unlocked: UnlockNotification[];
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
 * Groups, matches and ratings. See docs/competitions-elo.md and
 * server/src/competition-core.js. All instants are UTC epoch ms. */

export type MatchMode = 'daily' | 'weekly' | 'ondemand' | '1v1' | 'team';

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
  joined_at: number;
  rating: number;
  matches: number;
}

export interface MatchParticipant {
  user_id: string;
  username: string;
  avatar: string;
  profile_photo_url: string | null;
  side: 'A' | 'B' | null;
  joined_at: number;
  // Live for a running match (window so far), frozen at settlement afterwards.
  score: number;
  points: number;
  contribution_share: number | null;
  rating_before: number | null;
  rating_after: number | null;
  delta: number | null;
  current_rating: number;
}

export interface Match {
  id: string;
  group_id: string;
  mode: MatchMode;
  // Civil period for the recurring modes, null for user-created ones.
  period_key: string | null;
  title: string | null;
  creator_id: string | null;
  scope_start: number;
  scope_end: number;
  state: MatchState;
  k_factor: number;
  team_size: number | null;
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
  rating: number;
  matches: number;
  rank: number;
}

export interface LeaderboardResponse {
  group: { id: string; name: string } | null;
  leaderboard: LeaderboardEntry[];
}
