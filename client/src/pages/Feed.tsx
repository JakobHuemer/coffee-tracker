import { AppHeader } from '../components/AppHeader';
import { FeedList } from '../components/FeedList';

export function Feed() {
  return (
    <div className="page feed-page">
      <AppHeader />
      <FeedList
        queryKey={['feed']}
        endpoint="/feed"
        emptyIcon="coffee"
        emptyTitle="The pot’s empty"
        emptySub="Be the first — tap + to post a coffee and share it with everyone."
      />
    </div>
  );
}
