import { Scatter } from "recharts";

import type { ChartTradeMarker } from "./chartTradeMarkers";

type TradeMarkerScatterProps = {
	markers: ChartTradeMarker[];
};

type TradeMarkerShapeProps = {
	cx?: number;
	cy?: number;
	payload?: ChartTradeMarker;
};

function renderTradeMarkerShape({
	cx,
	cy,
	payload,
}: TradeMarkerShapeProps): JSX.Element | null {
	if (
		typeof cx !== "number" ||
		typeof cy !== "number" ||
		payload === undefined
	) {
		return null;
	}

	return (
		<g className="analytics-trade-marker" pointerEvents="none" aria-hidden="true">
			<circle
				cx={cx}
				cy={cy}
				r={5.5}
				fill={payload.fill}
				stroke={payload.stroke}
				strokeWidth={2}
			/>
			<text
				x={cx}
				y={cy - 13}
				textAnchor="middle"
				fill={payload.labelColor}
				fontSize={12}
				fontWeight={700}
			>
				{payload.label}
			</text>
		</g>
	);
}

export function TradeMarkerScatter({
	markers,
}: TradeMarkerScatterProps): JSX.Element | null {
	if (markers.length === 0) {
		return null;
	}

	return (
		<Scatter
			data={markers}
			dataKey="yValue"
			isAnimationActive={false}
			legendType="none"
			shape={renderTradeMarkerShape}
		/>
	);
}
