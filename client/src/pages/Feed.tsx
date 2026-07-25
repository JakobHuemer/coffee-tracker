import { useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, uploadUrl } from '../api/client';
import { useAuthStore } from '../store/auth';
import { AppHeader } from '../components/AppHeader';
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

// Apply fn to the one post matching id across every infinite-query page,
// returning a new InfiniteData so React Query treats it as changed.
function patchFeed(
  old: InfiniteData<FeedPost[]> | undefined,
  id: string,
  fn: (p: FeedPost) => FeedPost,
): InfiniteData<FeedPost[]> | undefined {
  if (!old) return old;
  return { ...old, pages: old.pages.map(page => page.map(p => (p.id === id ? fn(p) : p))) };
}

function PostCard({ post, onLike, currentUserId }: { post: FeedPost; onLike: (id: string, liked: boolean) => void; currentUserId: string }) {
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
          ? <img src={uploadUrl(post.profile_photo_url)} alt={post.username} className="feed-avatar-img" />
          : <span className="feed-avatar">{post.avatar}</span>}
        <div className="feed-post-meta">
          <span className="feed-username">{post.username}</span>
          <span className="feed-time">{timeAgo(post.logged_at)}</span>
        </div>
      </div>

      {post.photo_url && (
        <div className="feed-photo-wrap">
          <img className="feed-photo" src={uploadUrl(post.photo_url)} alt={post.coffee_id} loading="lazy" />
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
          onClick={() => onLike(post.id, liked)}
          aria-label={liked ? 'Unlike' : 'Like'}
        >
          {liked ? '❤️' : '🤍'} <span className="feed-like-count">{post.likes_count}</span>
        </button>
      </div>
    </article>
  );
}

export function Feed() {
  const qc = useQueryClient();
  const currentUserId = useAuthStore(s => s.user?.id ?? '');

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam = 0 }) =>
      api.get<FeedPost[]>(`/feed?limit=${PAGE_SIZE}&offset=${pageParam}`),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
    initialPageParam: 0,
  });

  // Likes are written straight into the ['feed'] cache — the single source of
  // truth — so the state survives navigation/unmount. onMutate applies the
  // optimistic flip, onError rolls back, onSuccess reconciles to the server's
  // authoritative count.
  const likeMutation = useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) =>
      liked
        ? api.delete<{ likes_count: number; liked_by_me: boolean }>(`/feed/${id}/like`)
        : api.post<{ likes_count: number; liked_by_me: boolean }>(`/feed/${id}/like`, {}),
    onMutate: async ({ id, liked }) => {
      await qc.cancelQueries({ queryKey: ['feed'] });
      const prev = qc.getQueryData<InfiniteData<FeedPost[]>>(['feed']);
      qc.setQueryData<InfiniteData<FeedPost[]>>(['feed'], old =>
        patchFeed(old, id, p => ({ ...p, liked_by_me: !liked, likes_count: p.likes_count + (liked ? -1 : 1) })));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['feed'], ctx.prev);
    },
    onSuccess: (result, { id }) => {
      qc.setQueryData<InfiniteData<FeedPost[]>>(['feed'], old =>
        patchFeed(old, id, p => ({ ...p, liked_by_me: result.liked_by_me, likes_count: result.likes_count })));
    },
  });

  const handleLike = useCallback((id: string, liked: boolean) => {
    likeMutation.mutate({ id, liked });
  }, [likeMutation]);

  const posts = data?.pages.flat() ?? [];

  return (
    <div className="page feed-page">
      <AppHeader />

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
          {posts.map(post => (
            <PostCard key={post.id} post={post} onLike={handleLike} currentUserId={currentUserId} />
          ))}
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
