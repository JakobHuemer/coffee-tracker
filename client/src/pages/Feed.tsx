import { useState, useCallback } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import type { FeedPost } from '../types';

const PAGE_SIZE = 20;

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function PostCard({ post, onLike, currentUserId }: { post: FeedPost; onLike: (id: string, liked: boolean, count: number) => void; currentUserId: string }) {
  const navigate = useNavigate();
  const liked = post.liked_by_me;

  function handleUserClick() {
    if (post.user_id === currentUserId) {
      navigate('/profile');
    } else {
      navigate(`/compare/${post.username}`);
    }
  }

  return (
    <article className="feed-post">
      <div className="feed-post-header feed-post-header-clickable" onClick={handleUserClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && handleUserClick()}>
        {post.profile_photo_url
          ? <img src={post.profile_photo_url} alt={post.username} className="feed-avatar-img" />
          : <span className="feed-avatar">{post.avatar}</span>}
        <div className="feed-post-meta">
          <span className="feed-username">{post.username}</span>
          <span className="feed-time">{timeAgo(post.logged_at)}</span>
        </div>
      </div>

      {post.photo_url && (
        <div className="feed-photo-wrap">
          <img className="feed-photo" src={post.photo_url} alt={post.coffee_id} loading="lazy" />
        </div>
      )}

      <div className="feed-post-body">
        <div className="feed-coffee-tag">
          <span className="feed-coffee-name">{post.coffee_id.replace(/_/g, ' ')}</span>
          <span className="feed-caffeine">{post.caffeine_mg}mg</span>
        </div>
        {post.description && <p className="feed-description">{post.description}</p>}
      </div>

      <div className="feed-post-actions">
        <button
          className={`feed-like-btn${liked ? ' liked' : ''}`}
          onClick={() => onLike(post.id, liked, post.likes_count)}
          aria-label={liked ? 'Unlike' : 'Like'}
        >
          {liked ? '❤️' : '🤍'} <span className="feed-like-count">{post.likes_count}</span>
        </button>
      </div>
    </article>
  );
}

export function Feed() {
  const navigate = useNavigate();
  const { isDark, toggleDark, label } = useThemeStore();
  const currentUserId = useAuthStore(s => s.user?.id ?? '');
  const [optimistic, setOptimistic] = useState<Record<string, { liked: boolean; count: number }>>({});

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam = 0 }) =>
      api.get<FeedPost[]>(`/feed?limit=${PAGE_SIZE}&offset=${pageParam}`),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
    initialPageParam: 0,
  });

  const likeMutation = useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) =>
      liked
        ? api.delete<{ likes_count: number; liked_by_me: boolean }>(`/feed/${id}/like`)
        : api.post<{ likes_count: number; liked_by_me: boolean }>(`/feed/${id}/like`, {}),
    onSuccess: (result, { id }) => {
      setOptimistic(prev => ({ ...prev, [id]: { liked: result.liked_by_me, count: result.likes_count } }));
    },
  });

  const handleLike = useCallback((id: string, currentlyLiked: boolean, currentCount: number) => {
    const current = optimistic[id] ?? { liked: currentlyLiked, count: currentCount };
    setOptimistic(prev => ({
      ...prev,
      [id]: { liked: !current.liked, count: current.count + (current.liked ? -1 : 1) },
    }));
    likeMutation.mutate({ id, liked: current.liked });
  }, [optimistic, likeMutation]);

  const posts = data?.pages.flat() ?? [];

  return (
    <div className="page feed-page">
      <header className="app-header">
        <div className="header-brand">
          <img className="logo" src="/favicon.svg" alt="Coffee Tracker" />
          <div>
            <h1>Coffee Tracker</h1>
            <div className="date">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="theme-badge">{label}</span>
          <button className="dark-toggle-inline" onClick={toggleDark} title={isDark ? 'Light mode' : 'Dark mode'}>
            {isDark ? '☀️' : '🌙'}
          </button>
          <button className="profile-icon-btn-inline" onClick={() => navigate('/profile')} title="Profile" aria-label="Go to profile">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
            </svg>
          </button>
        </div>
      </header>

      <main className="feed-main">
        {isLoading && <div className="page-loading">Loading feed…</div>}

        {!isLoading && posts.length === 0 && (
          <div className="feed-empty">
            <div className="feed-empty-icon">☕</div>
            <div className="feed-empty-title">No posts yet</div>
            <div className="feed-empty-sub">Be the first — tap + to log a coffee and share it with everyone.</div>
          </div>
        )}

        <div className="feed-list">
          {posts.map(post => {
            const opt = optimistic[post.id];
            const resolved: FeedPost = opt
              ? { ...post, liked_by_me: opt.liked, likes_count: opt.count }
              : post;
            return <PostCard key={post.id} post={resolved} onLike={handleLike} currentUserId={currentUserId} />;
          })}
        </div>

        {hasNextPage && (
          <button
            className="feed-load-more"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </main>
    </div>
  );
}
