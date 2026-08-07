import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { Icon } from './Icon';
import { PhotoLightbox } from './PhotoLightbox';
import { ResponsiveImage } from './ResponsiveImage';
import { ConfirmDialog } from './ConfirmDialog';
import { BadgeRow } from './Badge';
import { MentionText } from './MentionText';
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

// The exact instant a coffee was logged, to the minute, shown beside the
// coarse "3d ago" so the precise time is never lost (issue #29). Rendered in
// the viewer's own locale/zone.
function exactTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
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
  post, onLike, onBookmark, onDelete, onDeleteDismiss, deleting, deleteError, currentUserId,
}: {
  post: FeedPost;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  // Clears a failed delete, so reopening the dialog doesn't show a stale error.
  onDeleteDismiss: () => void;
  deleting: boolean;
  deleteError: string | null;
  currentUserId: string;
}) {
  const navigate = useNavigate();
  const [zoomed, setZoomed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const liked = post.liked_by_me;
  const isOwn = post.user_id === currentUserId;

  function handleUserClick() {
    // Your own name goes to your editable profile; anyone else's to their public
    // profile (issue #73), where Compare now lives.
    if (post.user_id === currentUserId) {
      navigate('/profile');
    } else {
      navigate(`/u/${post.username}`);
    }
  }

  return (
    <article className={`feed-post${post.marked_me ? ' feed-post-marked' : ''}`}>
      <div className="feed-post-header feed-post-header-clickable" onClick={handleUserClick} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleUserClick(); } }}>
        {post.profile_image || post.profile_photo_url
          ? <ResponsiveImage image={post.profile_image} fallback={post.profile_photo_url} alt={post.username} className="feed-avatar-img" sizes="48px" />
          : <span className="feed-avatar">{post.avatar}</span>}
        <div className="feed-post-meta">
          <span className="feed-user-line">
            <span className="feed-username">{post.username}</span>
            {/* Badges travel with the profile (issue #80): a post header is a
                profile surface, so the author's earned badges show here too
                (display-only — the info popover is the profile page's alone). */}
            <BadgeRow badges={post.badges} size={18} />
          </span>
          <span className="feed-time" title={new Date(post.logged_at).toLocaleString()}>
            {timeAgo(post.logged_at)} · {exactTime(post.logged_at)}
          </span>
        </div>
        {/* Only the owner's own list can contain private posts, but the badge is
            driven by the flag rather than the list so it can never mislabel. */}
        {!post.is_public && (
          <span className="feed-private-tag"><Icon name="lock" size={11} /> Private</span>
        )}
      </div>

      {(post.image || post.photo_url) && (
        // In the card the photo is capped at 1.1× its width; tapping it opens
        // the uncropped frame.
        <button className="feed-photo-wrap" onClick={() => setZoomed(true)} aria-label="View photo">
          <ResponsiveImage className="feed-photo" image={post.image} fallback={post.photo_url} alt={post.coffee_id} loading="lazy" sizes="(max-width: 600px) 100vw, 600px" />
        </button>
      )}

      {zoomed && (post.image || post.photo_url) && (
        <PhotoLightbox
          image={post.image}
          fallback={post.photo_url}
          alt={post.coffee_id}
          onClose={() => setZoomed(false)}
        >
          <div className="gallery-lightbox-meta">
            <span className="gallery-lightbox-coffee">{post.coffee_id.replace(/_/g, ' ')}</span>
            <span className="gallery-lightbox-date" title={new Date(post.logged_at).toLocaleString()}>
              {timeAgo(post.logged_at)} · {exactTime(post.logged_at)}
            </span>
          </div>
          {post.description && (
            <p className="gallery-lightbox-desc"><MentionText text={post.description} marks={post.marks} /></p>
          )}
        </PhotoLightbox>
      )}

      <div className={`feed-post-body${post.is_public ? '' : ' with-float'}`}>
        {/* With no like control beside it a private post's actions row is an
            empty band, so the save button floats into the body instead and the
            coffee tag / description flow around it. */}
        {!post.is_public && (
          <div className="feed-body-float">
            <BookmarkButton post={post} onBookmark={onBookmark} />
            {isOwn && <DeleteButton onClick={() => setConfirming(true)} />}
          </div>
        )}
        <div className="feed-coffee-tag">
          <span className="feed-coffee-name">{post.coffee_id.replace(/_/g, ' ')}</span>
          <span className="feed-caffeine">{post.caffeine_mg}mg</span>
        </div>
        {post.description && (
          <p className="feed-description"><MentionText text={post.description} marks={post.marks} /></p>
        )}
      </div>

      {/* Nobody can like a private post — it is visible to its owner alone — so
          the count is meaningless and the whole row goes with it; its save
          button lives in the body above. */}
      {post.is_public === 1 && (
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

          <BookmarkButton post={post} onBookmark={onBookmark} />
          {isOwn && <DeleteButton onClick={() => setConfirming(true)} />}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title="Delete this coffee?"
          message="The entry, its photo and everything it counted towards — stats, streaks, Buzz — go with it. This cannot be undone."
          confirmLabel="Delete coffee"
          busy={deleting}
          error={deleteError}
          onConfirm={() => onDelete(post.id)}
          onCancel={() => { if (!deleting) { setConfirming(false); onDeleteDismiss(); } }}
        />
      )}
    </article>
  );
}

function BookmarkButton({
  post, onBookmark,
}: {
  post: FeedPost;
  onBookmark: (id: string, bookmarked: boolean) => void;
}) {
  const bookmarked = post.bookmarked_by_me;
  return (
    <button
      className={`feed-bookmark-btn${bookmarked ? ' saved' : ''}`}
      onClick={() => onBookmark(post.id, bookmarked)}
      aria-label={bookmarked ? 'Remove bookmark' : 'Save'}
    >
      <Icon name={bookmarked ? 'bookmark' : 'bookmark-o'} />
    </button>
  );
}

// Only ever rendered on the viewer's own posts — the server enforces that too,
// DELETE /coffees/entries/:id matches on user_id.
function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="feed-delete-btn" onClick={onClick} aria-label="Delete coffee">
      <Icon name="trash" />
    </button>
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

  // Deleting a coffee moves every derived surface (stats, streaks, Buzz, the
  // Profile gallery, the other feed lists), so the whole set is invalidated
  // rather than only this list. No optimistic removal: the card stays put until
  // the server confirms, so a failed delete can't look like it worked.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/coffees/entries/${id}`),
    onSuccess: (_result, id) => {
      qc.setQueryData<InfiniteData<FeedPost[]>>(queryKey, old => removeFromList(old, id));
      for (const key of ['feed', 'entries', 'my-photos', 'stats', 'streaks', 'goals',
        'badges', 'achievements', 'casualties', 'challenges', 'rankings', 'energy']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const handleLike = useCallback((id: string, liked: boolean) => {
    likeMutation.mutate({ id, liked });
  }, [likeMutation]);

  const handleBookmark = useCallback((id: string, bookmarked: boolean) => {
    bookmarkMutation.mutate({ id, bookmarked });
  }, [bookmarkMutation]);

  const handleDelete = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const posts = data?.pages.flat() ?? [];

  // Infinite scroll: an empty sentinel sits just past the last card. The
  // observer's 600px rootMargin means it counts as "visible" while still ~1-2
  // cards below the fold, so the next page is fetched before the reader hits
  // the end. Watching the sentinel's position (not a fixed height) keeps this
  // correct whatever the card heights are — posts with and without photos mix
  // freely — and across every screen size. React Query's isFetchingNextPage
  // already dedupes overlapping fetches; the guard just avoids queuing more.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
            onDelete={handleDelete}
            onDeleteDismiss={deleteMutation.reset}
            // Pending/error state is per-mutation, not per-card, but only the
            // card being deleted has its dialog open to show it.
            deleting={deleteMutation.isPending && deleteMutation.variables === post.id}
            deleteError={deleteMutation.variables === post.id && deleteMutation.error
              ? deleteMutation.error.message
              : null}
            currentUserId={currentUserId}
          />
        ))}
      </div>

      {/* Sits below the last card; when it nears the viewport the observer
          above pulls the next page in. Rendered only while more pages exist. */}
      {hasNextPage && <div ref={sentinelRef} className="feed-scroll-sentinel" aria-hidden="true" />}

      {isFetchingNextPage && <div className="feed-load-more">Loading…</div>}
    </main>
  );
}
