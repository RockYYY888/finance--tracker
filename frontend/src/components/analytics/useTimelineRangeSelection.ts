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

export function useTimelineRangeSelection(
	series: TimelinePoint[],
): TimelineRangeSelection {
	const selectablePoints = useMemo(
		() => buildSelectableTimelinePoints(series),
		[series],
	);
	const [startKey, setStartKey] = useState<string | null>(null);
	const [endKey, setEndKey] = useState<string | null>(null);
	const lastSelectablePoint = selectablePoints[selectablePoints.length - 1] ?? null;

	useEffect(() => {
		const firstKey = selectablePoints[0]?.key ?? null;
		const lastKey = lastSelectablePoint?.key ?? null;

		setStartKey((currentKey) =>
			currentKey && selectablePoints.some((point) => point.key === currentKey)
				? currentKey
				: firstKey,
		);
		setEndKey((currentKey) =>
			currentKey && selectablePoints.some((point) => point.key === currentKey)
				? currentKey
				: lastKey,
		);
	}, [lastSelectablePoint?.key, selectablePoints]);

	const startIndex = useMemo(
		() => findSelectablePointIndex(selectablePoints, startKey, 0),
		[selectablePoints, startKey],
	);
	const endIndex = useMemo(
		() =>
			findSelectablePointIndex(
				selectablePoints,
				endKey,
				Math.max(selectablePoints.length - 1, 0),
			),
		[selectablePoints, endKey],
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
			endKey,
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

		const currentStartIndex = findSelectablePointIndex(selectablePoints, startKey, 0);
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
		startKey,
		endKey,
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
