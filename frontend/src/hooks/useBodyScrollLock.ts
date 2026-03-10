import { useEffect } from "react";

let bodyScrollLockCount = 0;
let previousBodyOverflow = "";
let previousBodyOverscrollBehavior = "";

/**
 * Locks body scrolling while `locked` is true.
 * Supports stacked dialogs by reference counting active locks.
 */
export function useBodyScrollLock(locked: boolean): void {
	useEffect(() => {
		if (!locked || typeof document === "undefined") {
			return;
		}

		if (bodyScrollLockCount === 0) {
			previousBodyOverflow = document.body.style.overflow;
			previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;
			document.body.style.overflow = "hidden";
			document.body.style.overscrollBehavior = "none";
		}

		bodyScrollLockCount += 1;

		return () => {
			bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
			if (bodyScrollLockCount === 0) {
				document.body.style.overflow = previousBodyOverflow;
				document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
			}
		};
	}, [locked]);
}
