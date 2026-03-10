import { useCallback, useEffect, useMemo, useState } from "react";
import type { HTMLAttributes } from "react";

import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";

type ChartInteractionHandlers = Pick<
	HTMLAttributes<HTMLDivElement>,
	| "onPointerDown"
	| "onPointerUp"
	| "onPointerCancel"
	| "onTouchStart"
	| "onTouchEnd"
	| "onTouchCancel"
>;

/**
 * Prevents the page from scrolling while the user is dragging inside a chart.
 * This keeps touch exploration focused on the chart instead of the page.
 */
export function useChartInteractionLock(): {
	chartInteractionHandlers: ChartInteractionHandlers;
	isTouchInteracting: boolean;
} {
	const [isTouchInteracting, setIsTouchInteracting] = useState(false);

	useBodyScrollLock(isTouchInteracting);

	const releaseInteractionLock = useCallback(() => {
		setIsTouchInteracting(false);
	}, []);

	const engageInteractionLock = useCallback(() => {
		setIsTouchInteracting(true);
	}, []);

	useEffect(() => {
		if (!isTouchInteracting || typeof window === "undefined") {
			return;
		}

		window.addEventListener("pointerup", releaseInteractionLock);
		window.addEventListener("pointercancel", releaseInteractionLock);
		window.addEventListener("touchend", releaseInteractionLock);
		window.addEventListener("touchcancel", releaseInteractionLock);

		return () => {
			window.removeEventListener("pointerup", releaseInteractionLock);
			window.removeEventListener("pointercancel", releaseInteractionLock);
			window.removeEventListener("touchend", releaseInteractionLock);
			window.removeEventListener("touchcancel", releaseInteractionLock);
		};
	}, [isTouchInteracting, releaseInteractionLock]);

	const chartInteractionHandlers = useMemo<ChartInteractionHandlers>(
		() => ({
			onPointerDown: (event) => {
				if (event.pointerType === "mouse") {
					return;
				}

				engageInteractionLock();
			},
			onPointerUp: releaseInteractionLock,
			onPointerCancel: releaseInteractionLock,
			onTouchStart: engageInteractionLock,
			onTouchEnd: releaseInteractionLock,
			onTouchCancel: releaseInteractionLock,
		}),
		[engageInteractionLock, releaseInteractionLock],
	);

	return {
		chartInteractionHandlers,
		isTouchInteracting,
	};
}
