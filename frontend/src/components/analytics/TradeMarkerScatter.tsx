import type { ChartTradeMarker } from "./chartTradeMarkers";

type TradeMarkerScatterProps = {
	markers: ChartTradeMarker[];
	chartWidth: number;
	chartHeight: number;
	plotLeft: number;
	plotTop: number;
	plotWidth: number;
	plotHeight: number;
	xDomain: [number, number];
	yDomain: [number, number];
};

function resolveHorizontalPosition(
	value: number,
	domain: [number, number],
	plotLeft: number,
	plotWidth: number,
): number | null {
	const [domainMin, domainMax] = domain;
	if (
		!Number.isFinite(value)
		|| !Number.isFinite(domainMin)
		|| !Number.isFinite(domainMax)
		|| plotWidth <= 0
	) {
		return null;
	}

	if (domainMax === domainMin) {
		return plotLeft + plotWidth / 2;
	}

	return plotLeft + ((value - domainMin) / (domainMax - domainMin)) * plotWidth;
}

function resolveVerticalPosition(
	value: number,
	domain: [number, number],
	plotTop: number,
	plotHeight: number,
): number | null {
	const [domainMin, domainMax] = domain;
	if (
		!Number.isFinite(value)
		|| !Number.isFinite(domainMin)
		|| !Number.isFinite(domainMax)
		|| plotHeight <= 0
	) {
		return null;
	}

	if (domainMax === domainMin) {
		return plotTop + plotHeight / 2;
	}

	return plotTop + ((domainMax - value) / (domainMax - domainMin)) * plotHeight;
}

export function TradeMarkerScatter({
	markers,
	chartWidth,
	chartHeight,
	plotLeft,
	plotTop,
	plotWidth,
	plotHeight,
	xDomain,
	yDomain,
}: TradeMarkerScatterProps): JSX.Element | null {
	if (
		markers.length === 0
		|| chartWidth <= 0
		|| chartHeight <= 0
		|| plotWidth <= 0
		|| plotHeight <= 0
	) {
		return null;
	}

	return (
		<svg
			className="analytics-trade-marker-overlay"
			width={chartWidth}
			height={chartHeight}
			viewBox={`0 0 ${chartWidth} ${chartHeight}`}
			aria-hidden="true"
			pointerEvents="none"
		>
			{markers.map((marker) => {
				const cx = resolveHorizontalPosition(
					marker.xValue,
					xDomain,
					plotLeft,
					plotWidth,
				);
				const cy = resolveVerticalPosition(
					marker.yValue,
					yDomain,
					plotTop,
					plotHeight,
				);
				if (cx === null || cy === null) {
					return null;
				}

				return (
					<g
						key={`trade-marker-${marker.xValue}-${marker.label}`}
						className="analytics-trade-marker"
						pointerEvents="none"
					>
						<circle
							cx={cx}
							cy={cy}
							r={5.5}
							fill={marker.fill}
							stroke={marker.stroke}
							strokeWidth={2}
						/>
						<text
							x={cx}
							y={cy - 13}
							textAnchor="middle"
							fill={marker.labelColor}
							fontSize={12}
							fontWeight={700}
						>
							{marker.label}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
