/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("global layout styles", () => {
	it("reserves a stable page scrollbar gutter to prevent centered layout shifts", () => {
		const globalStylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

		expect(globalStylesheet).toMatch(
			/html\s*\{[\s\S]*scrollbar-gutter:\s*stable(?:\s+both-edges)?\s*;/,
		);
		expect(globalStylesheet).toMatch(
			/body\s*\{[\s\S]*scrollbar-gutter:\s*stable(?:\s+both-edges)?\s*;/,
		);
	});

	it("keeps key inner scroll containers width-stable when overflow toggles", () => {
		const globalStylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
		const assetStylesheet = readFileSync(
			resolve(process.cwd(), "src/components/assets/asset-components.css"),
			"utf8",
		);

		expect(globalStylesheet).toMatch(
			/\.admin-feedback-list\s*\{[\s\S]*overflow-y:\s*auto\s*;[\s\S]*scrollbar-gutter:\s*stable\s*;/,
		);
		expect(assetStylesheet).toMatch(
			/\.asset-manager__search-list\s*\{[\s\S]*overflow-y:\s*auto\s*;[\s\S]*scrollbar-gutter:\s*stable\s*;/,
		);
	});
});
