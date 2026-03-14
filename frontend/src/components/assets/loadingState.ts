export type CollectionLoadingState = {
	showBlockingLoader: boolean;
	showRefreshingHint: boolean;
};

/**
 * Keeps existing collection content visible during background refreshes so the
 * UI does not flash between "loading" and the already rendered list.
 */
export function getCollectionLoadingState(
	loading: boolean,
	itemCount: number,
): CollectionLoadingState {
	const safeItemCount = Math.max(itemCount, 0);
	return {
		showBlockingLoader: loading && safeItemCount === 0,
		showRefreshingHint: loading && safeItemCount > 0,
	};
}
