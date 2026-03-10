import { useEffect, useId, useSyncExternalStore } from "react";

const activeGuardIds = new Set<string>();
const listeners = new Set<() => void>();

function emitChange(): void {
	for (const listener of listeners) {
		listener();
	}
}

function setGuardState(guardId: string, active: boolean): void {
	const previousSize = activeGuardIds.size;
	if (active) {
		activeGuardIds.add(guardId);
	} else {
		activeGuardIds.delete(guardId);
	}

	if (activeGuardIds.size !== previousSize) {
		emitChange();
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot(): boolean {
	return activeGuardIds.size > 0;
}

export function useAutoRefreshGuard(active: boolean, scope = "auto-refresh-guard"): void {
	const instanceId = useId();
	const guardId = `${scope}:${instanceId}`;

	useEffect(() => {
		setGuardState(guardId, active);
		return () => {
			setGuardState(guardId, false);
		};
	}, [active, guardId]);
}

export function useHasActiveAutoRefreshGuards(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function __resetAutoRefreshGuardsForTests(): void {
	if (activeGuardIds.size === 0) {
		return;
	}
	activeGuardIds.clear();
	emitChange();
}

export function __setAutoRefreshGuardForTests(guardId: string, active: boolean): void {
	setGuardState(guardId, active);
}
