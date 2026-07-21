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
}

export interface User {
  id: string;
  username: string;
  avatar: string;
  featured_badges: string[];
  created_at: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  secret: boolean;
  category: string;
  unlocked: boolean;
  unlocked_at: number | null;
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

export interface CompareUserProfile {
  id: string;
  username: string;
  avatar: string;
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
