import { useEffect, useMemo, useState } from "react";

import type { TimelinePoint } from "../../types/portfolioAnalytics";
import {
	buildSelectableTimelinePoints,
	type TimelineSelectablePoint,
} from "../../utils/portfolioAnalytics";

type TimelineRangeSelection = {
	selectablePoints: TimelineSelectablePoint[];
	startKey: string | null;
	endKey: string | null;
	startPoint: TimelineSelectablePoint | null;
	endPoint: TimelineSelectablePoint | null;
	intervalPoints: TimelinePoint[];
	hasSelectableRange: boolean;
	isFullRangeSelected: boolean;
	handleStartKeyChange: (nextKey: string) => void;
	handleEndKeyChange: (nextKey: string) => void;
	resetSelection: () => void;
};

function findSelectablePointIndex(
	selectablePoints: TimelineSelectablePoint[],
	key: string | null,
	fallbackIndex: number,
): number | null {
	if (selectablePoints.length === 0) {
		return null;
	}

	if (!key) {
		return fallbackIndex;
	}

	const matchedIndex = selectablePoints.findIndex((point) => point.key === key);
	return matchedIndex >= 0 ? matchedIndex : fallbackIndex;
}

function resolveSelectablePointKey(
	selectablePoints: TimelineSelectablePoint[],
	key: string | null,
	fallbackIndex: number,
): string | null {
	const resolvedIndex = findSelectablePointIndex(
		selectablePoints,
		key,
		fallbackIndex,
	);
	return resolvedIndex === null ? null : (selectablePoints[resolvedIndex]?.key ?? null);
}

export function useTimelineRangeSelection(
	series: TimelinePoint[],
): TimelineRangeSelection {
	const selectablePoints = useMemo(
		() => buildSelectableTimelinePoints(series),
		[series],
	);
	const lastSelectablePoint = selectablePoints[selectablePoints.length - 1] ?? null;
	const [startKey, setStartKey] = useState<string | null>(
		() => selectablePoints[0]?.key ?? null,
	);
	const [endKey, setEndKey] = useState<string | null>(
		() => lastSelectablePoint?.key ?? null,
	);
	const resolvedStartKey = resolveSelectablePointKey(selectablePoints, startKey, 0);
	const resolvedEndKey = resolveSelectablePointKey(
		selectablePoints,
		endKey,
		Math.max(selectablePoints.length - 1, 0),
	);

	useEffect(() => {
		setStartKey((currentKey) =>
			resolveSelectablePointKey(selectablePoints, currentKey, 0),
		);
		setEndKey((currentKey) =>
			resolveSelectablePointKey(
				selectablePoints,
				currentKey,
				Math.max(selectablePoints.length - 1, 0),
			),
		);
	}, [selectablePoints]);

	const startIndex = useMemo(
		() => findSelectablePointIndex(selectablePoints, resolvedStartKey, 0),
		[resolvedStartKey, selectablePoints],
	);
	const endIndex = useMemo(
		() =>
			findSelectablePointIndex(
				selectablePoints,
				resolvedEndKey,
				Math.max(selectablePoints.length - 1, 0),
			),
		[resolvedEndKey, selectablePoints],
	);
	const startPoint =
		startIndex === null ? null : (selectablePoints[startIndex] ?? null);
	const endPoint =
		endIndex === null ? null : (selectablePoints[endIndex] ?? null);
	const intervalPoints = useMemo(() => {
		if (startIndex === null || endIndex === null || startIndex > endIndex) {
			return [];
		}

		return selectablePoints
			.slice(startIndex, endIndex + 1)
			.map((entry) => entry.point);
	}, [endIndex, selectablePoints, startIndex]);
	const hasSelectableRange = selectablePoints.length >= 2;
	const isFullRangeSelected =
		startPoint?.key === selectablePoints[0]?.key
		&& endPoint?.key === lastSelectablePoint?.key;

	function handleStartKeyChange(nextKey: string): void {
		const nextIndex = selectablePoints.findIndex((point) => point.key === nextKey);
		if (nextIndex < 0) {
			return;
		}

		const currentEndIndex = findSelectablePointIndex(
			selectablePoints,
			resolvedEndKey,
			Math.max(selectablePoints.length - 1, 0),
		);
		if (currentEndIndex === null || nextIndex >= currentEndIndex) {
			return;
		}

		setStartKey(nextKey);
	}

	function handleEndKeyChange(nextKey: string): void {
		const nextIndex = selectablePoints.findIndex((point) => point.key === nextKey);
		if (nextIndex < 0) {
			return;
		}

		const currentStartIndex = findSelectablePointIndex(
			selectablePoints,
			resolvedStartKey,
			0,
		);
		if (currentStartIndex === null || nextIndex <= currentStartIndex) {
			return;
		}

		setEndKey(nextKey);
	}

	function resetSelection(): void {
		setStartKey(selectablePoints[0]?.key ?? null);
		setEndKey(lastSelectablePoint?.key ?? null);
	}

	return {
		selectablePoints,
		startKey: resolvedStartKey,
		endKey: resolvedEndKey,
		startPoint,
		endPoint,
		intervalPoints,
		hasSelectableRange,
		isFullRangeSelected,
		handleStartKeyChange,
		handleEndKeyChange,
		resetSelection,
	};
}
