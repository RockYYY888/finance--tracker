import { describe, expect, it } from "vitest";

import { formatTimestamp } from "./assetFormatting";

describe("formatTimestamp", () => {
	it("treats bare UTC timestamps as UTC instead of local naive time", () => {
		const bareValue = "2026-03-01T04:20:51.753577";
		const explicitUtcValue = "2026-03-01T04:20:51.753577Z";

		expect(formatTimestamp(bareValue)).toBe(formatTimestamp(explicitUtcValue));
	});
});
