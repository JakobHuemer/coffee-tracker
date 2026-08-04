import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

// Same rule the server marks by (server/src/mentions.js): @username, 2–20 account
// chars, not directly after another username char (so an email local part is not
// a mention). Kept in sync with that file by hand — the two runtimes can't share.
const MENTION_RE = /(?<![A-Za-z0-9_-])@([A-Za-z0-9_-]{2,20})/g;

// Render a post description, turning each @mention of a really-marked user into a
// control: a link to the comparison page against them, or — when the viewer is
// the one tagged — their own handle with a "You've been marked" hover tooltip and
// no link (there's nothing to compare against yourself). `marks` is the post's
// resolved mention list from the server — only those tokens are treated as
// mentions, so an @word that isn't a real mark (or a mention the server didn't
// resolve) stays plain text and everything else is rendered verbatim.
export function MentionText({ text, marks }: { text: string; marks: string[] }) {
  const myUsername = useAuthStore(s => s.user?.username);

  if (!marks || marks.length === 0) return <>{text}</>;
  const marked = new Set(marks);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const name = m[1];
    if (!marked.has(name)) continue; // an @word that isn't a real mark — leave it
    const start = m.index ?? 0;
    if (start > cursor) nodes.push(<Fragment key={key++}>{text.slice(cursor, start)}</Fragment>);
    if (name === myUsername) {
      // The viewer is the marked person: show their handle (no link — nothing to
      // compare against yourself), and reveal "You've been marked" on hover.
      nodes.push(
        <span key={key++} className="mention mention-you" title="You've been marked">@{name}</span>,
      );
    } else {
      // stopPropagation keeps a mention tap from bubbling to any clickable
      // ancestor (e.g. a card that navigates to the author).
      nodes.push(
        <Link key={key++} to={`/compare/${name}`} className="mention" onClick={e => e.stopPropagation()}>
          @{name}
        </Link>,
      );
    }
    cursor = start + m[0].length;
  }
  if (cursor < text.length) nodes.push(<Fragment key={key++}>{text.slice(cursor)}</Fragment>);

  return <>{nodes}</>;
}
