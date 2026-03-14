import { describe, expect, it } from "vitest";

import { formatOperationTimestamp, formatTimestamp } from "./assetFormatting";

describe("formatTimestamp", () => {
	it("treats bare UTC timestamps as UTC instead of local naive time", () => {
		const bareValue = "2026-03-01T04:20:51.753577";
		const explicitUtcValue = "2026-03-01T04:20:51.753577Z";

		expect(formatTimestamp(bareValue)).toBe(formatTimestamp(explicitUtcValue));
	});
});

describe("formatOperationTimestamp", () => {
	it("combines the effective date with the precise recorded time", () => {
		expect(
			formatOperationTimestamp("2026-03-10", "2026-03-10T13:00:00.125Z"),
		).toBe("2026/03/10 21:00:00.125");
	});

	it("falls back to the recorded timestamp when the effective date is missing", () => {
		expect(
			formatOperationTimestamp(undefined, "2026-03-10T13:00:00.125Z"),
		).toBe("2026/03/10 21:00:00.125");
	});
});
