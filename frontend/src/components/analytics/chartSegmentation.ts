import type { TimelinePoint } from "../../types/portfolioAnalytics";

const CROSSING_EPSILON = 1e-8;

type TimelineCoordinatePoint = TimelinePoint & {
	xValue: number;
};

export type ThresholdSegmentedPoint = TimelinePoint & {
	positiveValue: number;
	negativeValue: number;
	crossingPoint?: boolean;
};

type ThresholdCrossingTimelinePoint = TimelinePoint & {
	crossingPoint: true;
	xValue?: number;
};

export type ThresholdSegmentedCoordinatePoint = ThresholdSegmentedPoint & {
	xValue: number;
};

export function isThresholdSegmentedCrossingPoint(
	point: Pick<ThresholdSegmentedPoint, "crossingPoint"> | null | undefined,
): boolean {
	return point?.crossingPoint === true;
}

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

function toNumericXValue(
	point: TimelinePoint & {
		xValue?: number;
	},
): number | null {
	if (typeof point.xValue === "number" && Number.isFinite(point.xValue)) {
		return point.xValue;
	}

	return toTimestampMs(point);
}

function buildTimelineCoordinateSeries(series: TimelinePoint[]): TimelineCoordinatePoint[] {
	const timestampValues = series.map((point) => toTimestampMs(point));
	const useTimestampScale = timestampValues.every((value) => value !== null);

	return series.map((point, index) => ({
		...point,
		xValue: useTimestampScale ? (timestampValues[index] ?? index) : index,
	}));
}

function buildThresholdCrossingPoint(
	left: TimelinePoint & { xValue?: number },
	right: TimelinePoint & { xValue?: number },
	thresholdValue: number,
): ThresholdCrossingTimelinePoint {
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
	const leftXValue = toNumericXValue(left);
	const rightXValue = toNumericXValue(right);
	const interpolatedTimestamp =
		leftTimestampMs === null || rightTimestampMs === null
			? undefined
			: new Date(
				Math.round(leftTimestampMs + (rightTimestampMs - leftTimestampMs) * ratio),
			).toISOString();
	const interpolatedXValue =
		leftXValue === null || rightXValue === null
			? undefined
			: leftXValue + (rightXValue - leftXValue) * ratio;

	return {
		label: "",
		value: thresholdValue,
		timestamp_utc: interpolatedTimestamp,
		corrected: false,
		crossingPoint: true,
		xValue: interpolatedXValue,
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

function buildSegmentedPoint(
	point: TimelinePoint,
	thresholdValue: number,
): ThresholdSegmentedPoint {
	return {
		...point,
		positiveValue: point.value >= thresholdValue ? point.value : thresholdValue,
		negativeValue: point.value < thresholdValue ? point.value : thresholdValue,
	};
}

export function buildThresholdSegmentedChartData(
	series: TimelinePoint[],
	thresholdValue = 0,
): ThresholdSegmentedPoint[] {
	return series.map((point) => buildSegmentedPoint(point, thresholdValue));
}

export function buildThresholdSegmentedAreaData(
	series: TimelinePoint[],
	thresholdValue = 0,
): ThresholdSegmentedPoint[] {
	if (series.length <= 1) {
		return buildThresholdSegmentedChartData(series, thresholdValue);
	}

	const segmentedSeries: Array<TimelinePoint | ThresholdCrossingTimelinePoint> = [series[0]!];

	for (let index = 1; index < series.length; index += 1) {
		const previousPoint = series[index - 1]!;
		const currentPoint = series[index]!;

		if (shouldInsertCrossingPoint(previousPoint, currentPoint, thresholdValue)) {
			segmentedSeries.push(
				buildThresholdCrossingPoint(previousPoint, currentPoint, thresholdValue),
			);
		}

		segmentedSeries.push(currentPoint);
	}

	return segmentedSeries.map((point) => buildSegmentedPoint(point, thresholdValue));
}

export function buildThresholdSegmentedCoordinateData(
	series: TimelinePoint[],
	thresholdValue = 0,
): {
	chartData: ThresholdSegmentedCoordinatePoint[];
	areaData: ThresholdSegmentedCoordinatePoint[];
} {
	const coordinateSeries = buildTimelineCoordinateSeries(series);

	return {
		chartData: buildThresholdSegmentedChartData(
			coordinateSeries,
			thresholdValue,
		) as ThresholdSegmentedCoordinatePoint[],
		areaData: buildThresholdSegmentedAreaData(
			coordinateSeries,
			thresholdValue,
		) as ThresholdSegmentedCoordinatePoint[],
	};
}
