import { describe, expect, it } from "vitest";

import { getCollectionLoadingState } from "./loadingState";

describe("getCollectionLoadingState", () => {
	it("shows a blocking loader only when no content is available yet", () => {
		expect(getCollectionLoadingState(true, 0)).toEqual({
			showBlockingLoader: true,
			showRefreshingHint: false,
		});
	});

	it("keeps existing content visible during background refreshes", () => {
		expect(getCollectionLoadingState(true, 3)).toEqual({
			showBlockingLoader: false,
			showRefreshingHint: true,
		});
	});

	it("stays idle when nothing is loading", () => {
		expect(getCollectionLoadingState(false, 2)).toEqual({
			showBlockingLoader: false,
			showRefreshingHint: false,
		});
	});
});
