import type { TimelineSelectablePoint } from "../../utils/portfolioAnalytics";
import {
	TimelinePointPicker,
	type TimelinePointPickerOption,
} from "./TimelinePointPicker";

type TimelineRangeSelectorProps = {
	selectablePoints: TimelineSelectablePoint[];
	startKey: string | null;
	endKey: string | null;
	isFullRangeSelected: boolean;
	onStartChange: (nextKey: string) => void;
	onEndChange: (nextKey: string) => void;
	onReset: () => void;
	showHeader?: boolean;
	embedded?: boolean;
};

export function TimelineRangeSelector({
	selectablePoints,
	startKey,
	endKey,
	isFullRangeSelected,
	onStartChange,
	onEndChange,
	onReset,
	showHeader = true,
	embedded = false,
}: TimelineRangeSelectorProps) {
	const options: TimelinePointPickerOption[] = selectablePoints.map((point) => ({
		key: point.key,
		label: point.label,
	}));
	const startIndex = selectablePoints.findIndex((point) => point.key === startKey);
	const endIndex = selectablePoints.findIndex((point) => point.key === endKey);
	const startOptions =
		endIndex < 0 ? options : options.filter((_, index) => index < endIndex);
	const endOptions =
		startIndex < 0 ? options : options.filter((_, index) => index > startIndex);
	const earliestStartKey = startOptions[0]?.key ?? null;
	const latestStartKey = startOptions[startOptions.length - 1]?.key ?? null;
	const earliestEndKey = endOptions[0]?.key ?? null;
	const latestEndKey = endOptions[endOptions.length - 1]?.key ?? null;

	return (
		<div
			className={[
				"analytics-interval-selector",
				embedded ? "analytics-interval-selector--embedded" : "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			{showHeader ? (
				<div className="analytics-interval-selector__header">
					<span className="analytics-interval-selector__label">比较区间</span>
					{!isFullRangeSelected ? (
						<button
							type="button"
							className="analytics-interval-selector__reset"
							onClick={onReset}
						>
							恢复全区间
						</button>
					) : null}
				</div>
			) : null}
			<div className="analytics-interval-selector__fields">
				<TimelinePointPicker
					label="起点"
					valueKey={startKey}
					options={startOptions}
					onChange={onStartChange}
					disabled={startOptions.length === 0}
					quickActions={[
						{ label: "最早", key: earliestStartKey },
						{ label: "最晚", key: latestStartKey },
					]}
				/>
				<span className="analytics-interval-selector__separator" aria-hidden="true">
					→
				</span>
				<TimelinePointPicker
					label="终点"
					valueKey={endKey}
					options={endOptions}
					onChange={onEndChange}
					disabled={endOptions.length === 0}
					align="end"
					quickActions={[
						{ label: "最早", key: earliestEndKey },
						{ label: "最新", key: latestEndKey },
					]}
				/>
			</div>
		</div>
	);
}
