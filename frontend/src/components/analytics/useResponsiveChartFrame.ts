import { useEffect, useRef, useState } from "react";

const DEFAULT_COMPACT_BREAKPOINT_PX = 560;

export function useResponsiveChartFrame(breakpointPx = DEFAULT_COMPACT_BREAKPOINT_PX) {
	const chartContainerRef = useRef<HTMLDivElement>(null);
	const [chartWidth, setChartWidth] = useState(0);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const element = chartContainerRef.current;
		if (!element) {
			return;
		}

		const updateWidth = () => {
			const nextWidth = Math.round(element.getBoundingClientRect().width);
			setChartWidth((currentWidth) => (
				currentWidth === nextWidth ? currentWidth : nextWidth
			));
		};

		updateWidth();

		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateWidth);
			return () => window.removeEventListener("resize", updateWidth);
		}

		const observer = new ResizeObserver(() => {
			updateWidth();
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return {
		chartContainerRef,
		chartWidth,
		compactAxisMode: chartWidth > 0 && chartWidth <= breakpointPx,
	};
}
