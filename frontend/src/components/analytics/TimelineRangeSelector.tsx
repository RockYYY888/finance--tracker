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
};

export function TimelineRangeSelector({
	selectablePoints,
	startKey,
	endKey,
	isFullRangeSelected,
	onStartChange,
	onEndChange,
	onReset,
}: TimelineRangeSelectorProps) {
	const options: TimelinePointPickerOption[] = selectablePoints.map((point) => ({
		key: point.key,
		label: point.label,
	}));
	const firstKey = selectablePoints[0]?.key ?? null;
	const lastKey = selectablePoints[selectablePoints.length - 1]?.key ?? null;

	return (
		<div className="analytics-interval-selector">
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
			<div className="analytics-interval-selector__fields">
				<TimelinePointPicker
					label="起点"
					valueKey={startKey}
					options={options}
					onChange={onStartChange}
					disabled={options.length === 0}
					quickActions={[
						{ label: "最早", key: firstKey },
						{ label: "最新", key: lastKey },
					]}
				/>
				<span className="analytics-interval-selector__separator" aria-hidden="true">
					→
				</span>
				<TimelinePointPicker
					label="终点"
					valueKey={endKey}
					options={options}
					onChange={onEndChange}
					disabled={options.length === 0}
					align="end"
					quickActions={[
						{ label: "最早", key: firstKey },
						{ label: "最新", key: lastKey },
					]}
				/>
			</div>
		</div>
	);
}
