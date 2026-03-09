import type { TimelinePoint } from "../../types/portfolioAnalytics";

const CROSSING_EPSILON = 1e-8;

export type ThresholdSegmentedPoint = TimelinePoint & {
	positiveValue: number;
	negativeValue: number;
	crossingPoint?: boolean;
};

function toTimestampMs(point: TimelinePoint): number | null {
	if (!point.timestamp_utc) {
		return null;
	}

	const parsedTimestamp = Date.parse(point.timestamp_utc);
	if (!Number.isFinite(parsedTimestamp)) {
		return null;
	}

	return parsedTimestamp;
}

function buildThresholdCrossingPoint(
	left: TimelinePoint,
	right: TimelinePoint,
	thresholdValue: number,
): TimelinePoint {
	const denominator = right.value - left.value;
	const ratio = Math.min(
		1,
		Math.max(
			0,
			denominator === 0 ? 0 : (thresholdValue - left.value) / denominator,
		),
	);
	const leftTimestampMs = toTimestampMs(left);
	const rightTimestampMs = toTimestampMs(right);
	const interpolatedTimestamp =
		leftTimestampMs === null || rightTimestampMs === null
			? undefined
			: new Date(
				Math.round(leftTimestampMs + (rightTimestampMs - leftTimestampMs) * ratio),
			).toISOString();

	return {
		label: "",
		value: thresholdValue,
		timestamp_utc: interpolatedTimestamp,
		corrected: false,
	};
}

function shouldInsertCrossingPoint(
	left: TimelinePoint,
	right: TimelinePoint,
	thresholdValue: number,
): boolean {
	const leftDelta = left.value - thresholdValue;
	const rightDelta = right.value - thresholdValue;
	if (Math.abs(leftDelta) <= CROSSING_EPSILON || Math.abs(rightDelta) <= CROSSING_EPSILON) {
		return false;
	}

	return leftDelta * rightDelta < 0;
}

export function buildThresholdSegmentedChartData(
	series: TimelinePoint[],
	thresholdValue = 0,
): ThresholdSegmentedPoint[] {
	if (series.length <= 1) {
		return series.map((point) => ({
			...point,
			positiveValue: point.value >= thresholdValue ? point.value : thresholdValue,
			negativeValue: point.value < thresholdValue ? point.value : thresholdValue,
		}));
	}

	const segmentedSeries: TimelinePoint[] = [];
	segmentedSeries.push(series[0]);
	for (let index = 1; index < series.length; index += 1) {
		const previousPoint = series[index - 1];
		const currentPoint = series[index];

		if (shouldInsertCrossingPoint(previousPoint, currentPoint, thresholdValue)) {
			segmentedSeries.push(
				buildThresholdCrossingPoint(previousPoint, currentPoint, thresholdValue),
			);
		}
		segmentedSeries.push(currentPoint);
	}

	return segmentedSeries.map((point) => {
		const isCrossingPoint =
			Math.abs(point.value - thresholdValue) <= CROSSING_EPSILON && !point.label;
		return {
			...point,
			...(isCrossingPoint ? { crossingPoint: true } : {}),
			positiveValue: point.value >= thresholdValue ? point.value : thresholdValue,
			negativeValue: point.value < thresholdValue ? point.value : thresholdValue,
		};
	});
}
