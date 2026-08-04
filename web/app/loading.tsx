import { Loading } from './loading-mark';

/// The root boundary: covers every route without a closer one of its own.
export default function RootLoading() {
  return <Loading />;
}
