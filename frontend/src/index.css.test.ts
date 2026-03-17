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

	it("keeps modal and viewport rules robust on mobile and keyboard navigation", () => {
		const globalStylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
		const assetStylesheet = readFileSync(
			resolve(process.cwd(), "src/components/assets/asset-components.css"),
			"utf8",
		);
		const analyticsStylesheet = readFileSync(
			resolve(process.cwd(), "src/components/analytics/analytics.css"),
			"utf8",
		);

		expect(globalStylesheet).toContain("min-height: 100dvh;");
		expect(globalStylesheet).not.toContain(".session-recovery-mask");
		expect(globalStylesheet).toMatch(
			/\.workspace-switch__button:focus-visible\s*\{[\s\S]*outline:\s*2px\s+solid/,
		);
		expect(globalStylesheet).toMatch(
			/\.feedback-modal__panel\s*\{[\s\S]*max-height:\s*min\(84dvh,\s*720px\)\s*;[\s\S]*overflow-y:\s*auto\s*;/,
		);
		expect(globalStylesheet).toMatch(
			/\.feedback-modal__backdrop\s*\{[\s\S]*border-radius:\s*0\s*;[\s\S]*box-shadow:\s*none\s*;/,
		);
		expect(assetStylesheet).toMatch(
			/\.asset-manager__modal-panel\s*\{[\s\S]*max-height:\s*min\(84dvh,\s*760px\)\s*;[\s\S]*overflow-y:\s*auto\s*;/,
		);
		expect(assetStylesheet).toMatch(
			/\.asset-manager__modal-backdrop\s*\{[\s\S]*border-radius:\s*0\s*;[\s\S]*box-shadow:\s*none\s*;/,
		);
		expect(assetStylesheet).toMatch(
			/\.asset-manager__modal-backdrop:hover:not\(:disabled\)\s*\{[\s\S]*transform:\s*none\s*;/,
		);
		const feedbackModalPanelBlock =
			globalStylesheet.match(/\.feedback-modal__panel\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
		const assetModalPanelBlock =
			assetStylesheet.match(/\.asset-manager__modal-panel\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
		expect(globalStylesheet).not.toContain("radial-gradient(");
		expect(globalStylesheet).not.toMatch(/\.ambient(?:-left|-right)?\s*\{/);
		expect(assetStylesheet).not.toContain("radial-gradient(");
		expect(analyticsStylesheet).not.toContain("radial-gradient(");
		expect(feedbackModalPanelBlock).not.toContain("radial-gradient(");
		expect(assetModalPanelBlock).not.toContain("radial-gradient(");
		expect(analyticsStylesheet).toMatch(
			/\.analytics-segmented button:focus-visible\s*\{[\s\S]*outline:\s*2px\s+solid/,
		);
	});

	it("preserves semantic hidden behavior even when layout classes set display styles", () => {
		const globalStylesheet = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

		expect(globalStylesheet).toMatch(
			/\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important\s*;/,
		);
	});
});
