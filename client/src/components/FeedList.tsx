import { useCallback, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, uploadUrl } from '../api/client';
import { useAuthStore } from '../store/auth';
import { Icon } from './Icon';
import { PhotoLightbox } from './PhotoLightbox';
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
function patchList(
  old: InfiniteData<FeedPost[]> | undefined,
  id: string,
  fn: (p: FeedPost) => FeedPost,
): InfiniteData<FeedPost[]> | undefined {
  if (!old) return old;
  return { ...old, pages: old.pages.map(page => page.map(p => (p.id === id ? fn(p) : p))) };
}

// Drop the post with id from every page (used on the Saved list when a post is
// un-bookmarked — it no longer belongs there).
function removeFromList(
  old: InfiniteData<FeedPost[]> | undefined,
  id: string,
): InfiniteData<FeedPost[]> | undefined {
  if (!old) return old;
  return { ...old, pages: old.pages.map(page => page.filter(p => p.id !== id)) };
}

function PostCard({
  post, onLike, onBookmark, currentUserId,
}: {
  post: FeedPost;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  currentUserId: string;
}) {
  const navigate = useNavigate();
  const [zoomed, setZoomed] = useState(false);
  const liked = post.liked_by_me;
  const bookmarked = post.bookmarked_by_me;
  const isOwn = post.user_id === currentUserId;

  function handleUserClick() {
    if (post.user_id === currentUserId) {
      navigate('/profile');
    } else {
      navigate(`/compare/${post.username}`);
    }
  }

  return (
    <article className="feed-post">
      <div className="feed-post-header feed-post-header-clickable" onClick={handleUserClick} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleUserClick(); } }}>
        {post.profile_photo_url
          ? <img src={uploadUrl(post.profile_photo_url)} alt={post.username} className="feed-avatar-img" />
          : <span className="feed-avatar">{post.avatar}</span>}
        <div className="feed-post-meta">
          <span className="feed-username">{post.username}</span>
          <span className="feed-time">{timeAgo(post.logged_at)}</span>
        </div>
        {/* Only the owner's own list can contain private posts, but the badge is
            driven by the flag rather than the list so it can never mislabel. */}
        {!post.is_public && (
          <span className="feed-private-tag"><Icon name="lock" size={11} /> Private</span>
        )}
      </div>

      {post.photo_url && (
        // In the card the photo is capped at 1.1× its width; tapping it opens
        // the uncropped frame.
        <button className="feed-photo-wrap" onClick={() => setZoomed(true)} aria-label="View photo">
          <img className="feed-photo" src={uploadUrl(post.photo_url)} alt={post.coffee_id} loading="lazy" />
        </button>
      )}

      {zoomed && post.photo_url && (
        <PhotoLightbox
          src={uploadUrl(post.photo_url)}
          alt={post.coffee_id}
          onClose={() => setZoomed(false)}
        >
          <div className="gallery-lightbox-meta">
            <span className="gallery-lightbox-coffee">{post.coffee_id.replace(/_/g, ' ')}</span>
            <span className="gallery-lightbox-date">{timeAgo(post.logged_at)}</span>
          </div>
          {post.description && <p className="gallery-lightbox-desc">{post.description}</p>}
        </PhotoLightbox>
      )}

      <div className="feed-post-body">
        <div className="feed-coffee-tag">
          <span className="feed-coffee-name">{post.coffee_id.replace(/_/g, ' ')}</span>
          <span className="feed-caffeine">{post.caffeine_mg}mg</span>
        </div>
        {post.description && <p className="feed-description">{post.description}</p>}
      </div>

      <div className="feed-post-actions">
        {isOwn ? (
          <span className="feed-like-btn feed-like-static" aria-label="Likes">
            <Icon name="heart" /> <span className="feed-like-count">{post.likes_count}</span>
          </span>
        ) : (
          <button
            className={`feed-like-btn${liked ? ' liked' : ''}`}
            onClick={() => onLike(post.id, liked)}
            aria-label={liked ? 'Unlike' : 'Like'}
          >
            <Icon name={liked ? 'heart' : 'heart-o'} /> <span className="feed-like-count">{post.likes_count}</span>
          </button>
        )}

        {/* Bookmarks only exist for public posts — the server rejects the rest,
            so no button may offer it (VALUES.md 0.4). */}
        {post.is_public === 1 && (
          <button
            className={`feed-bookmark-btn${bookmarked ? ' saved' : ''}`}
            onClick={() => onBookmark(post.id, bookmarked)}
            aria-label={bookmarked ? 'Remove bookmark' : 'Save'}
          >
            <Icon name={bookmarked ? 'bookmark' : 'bookmark-o'} />
          </button>
        )}
      </div>
    </article>
  );
}

export function FeedList({
  queryKey, endpoint, emptyIcon, emptyTitle, emptySub, removeOnUnbookmark = false,
}: {
  queryKey: string[];
  endpoint: string;
  emptyIcon: string;
  emptyTitle: string;
  emptySub: string;
  removeOnUnbookmark?: boolean;
}) {
  const qc = useQueryClient();
  const currentUserId = useAuthStore(s => s.user?.id ?? '');

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 0 }) =>
      api.get<FeedPost[]>(`${endpoint}?limit=${PAGE_SIZE}&offset=${pageParam}`),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
    initialPageParam: 0,
  });

  // Likes are written straight into the list's cache — the single source of
  // truth — so the state survives navigation/unmount. onMutate applies the
  // optimistic flip, onError rolls back, onSuccess reconciles to the server's
  // authoritative count.
  const likeMutation = useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) =>
      liked
        ? api.delete<{ likes_count: number; liked_by_me: boolean }>(`/feed/${id}/like`)
        : api.post<{ likes_count: number; liked_by_me: boolean }>(`/feed/${id}/like`, {}),
    onMutate: async ({ id, liked }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<InfiniteData<FeedPost[]>>(queryKey);
      qc.setQueryData<InfiniteData<FeedPost[]>>(queryKey, old =>
        patchList(old, id, p => ({ ...p, liked_by_me: !liked, likes_count: p.likes_count + (liked ? -1 : 1) })));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSuccess: (result, { id }) => {
      qc.setQueryData<InfiniteData<FeedPost[]>>(queryKey, old =>
        patchList(old, id, p => ({ ...p, liked_by_me: result.liked_by_me, likes_count: result.likes_count })));
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: ({ id, bookmarked }: { id: string; bookmarked: boolean }) =>
      bookmarked
        ? api.delete<{ bookmarked_by_me: boolean }>(`/feed/${id}/bookmark`)
        : api.post<{ bookmarked_by_me: boolean }>(`/feed/${id}/bookmark`, {}),
    onMutate: async ({ id, bookmarked }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<InfiniteData<FeedPost[]>>(queryKey);
      qc.setQueryData<InfiniteData<FeedPost[]>>(queryKey, old =>
        removeOnUnbookmark && bookmarked
          ? removeFromList(old, id)
          : patchList(old, id, p => ({ ...p, bookmarked_by_me: !bookmarked })));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSuccess: () => {
      // Keep the other lists (feed / saved / mine) consistent with the toggle.
      qc.invalidateQueries({ queryKey: ['feed', 'saved'] });
      qc.invalidateQueries({ queryKey: ['feed', 'mine'] });
      qc.invalidateQueries({ queryKey: ['feed'], exact: true });
    },
  });

  const handleLike = useCallback((id: string, liked: boolean) => {
    likeMutation.mutate({ id, liked });
  }, [likeMutation]);

  const handleBookmark = useCallback((id: string, bookmarked: boolean) => {
    bookmarkMutation.mutate({ id, bookmarked });
  }, [bookmarkMutation]);

  const posts = data?.pages.flat() ?? [];

  return (
    <main className="feed-main">
      {isLoading && <div className="page-loading">Loading…</div>}

      {!isLoading && posts.length === 0 && (
        <div className="feed-empty">
          <div className="feed-empty-icon"><Icon name={emptyIcon} size={40} /></div>
          <div className="feed-empty-title">{emptyTitle}</div>
          <div className="feed-empty-sub">{emptySub}</div>
        </div>
      )}

      <div className="feed-list">
        {posts.map(post => (
          <PostCard
            key={post.id}
            post={post}
            onLike={handleLike}
            onBookmark={handleBookmark}
            currentUserId={currentUserId}
          />
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
  );
}
