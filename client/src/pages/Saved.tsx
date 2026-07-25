import { AppHeader } from '../components/AppHeader';
import { FeedList } from '../components/FeedList';

export function Saved() {
  return (
    <div className="page feed-page">
      <AppHeader />
      <FeedList
        queryKey={['feed', 'saved']}
        endpoint="/feed/saved"
        emptyIcon="bookmark"
        emptyTitle="Nothing saved yet"
        emptySub="Tap the bookmark on any post to save it here for later."
        removeOnUnbookmark
      />
    </div>
  );
}
