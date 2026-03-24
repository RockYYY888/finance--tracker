import { useEffect, useMemo, useRef, useState } from "react";

export type TimelinePointPickerOption = {
	key: string;
	label: string;
};

type TimelinePointPickerQuickAction = {
	label: string;
	key: string | null;
};

type TimelinePointPickerProps = {
	label: string;
	valueKey: string | null;
	options: TimelinePointPickerOption[];
	onChange: (nextKey: string) => void;
	placeholder?: string;
	disabled?: boolean;
	align?: "start" | "end";
	quickActions?: TimelinePointPickerQuickAction[];
};

export function TimelinePointPicker({
	label,
	valueKey,
	options,
	onChange,
	placeholder = "请选择时间点",
	disabled = false,
	align = "start",
	quickActions = [],
}: TimelinePointPickerProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const selectedOption = useMemo(
		() => options.find((option) => option.key === valueKey) ?? null,
		[options, valueKey],
	);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		function handleDocumentPointer(event: MouseEvent): void {
			if (!rootRef.current?.contains(event.target as Node)) {
				setIsOpen(false);
			}
		}

		function handleEscape(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				setIsOpen(false);
			}
		}

		document.addEventListener("mousedown", handleDocumentPointer);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("mousedown", handleDocumentPointer);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [isOpen]);

	useEffect(() => {
		if (disabled && isOpen) {
			setIsOpen(false);
		}
	}, [disabled, isOpen]);

	function handleSelect(nextKey: string): void {
		onChange(nextKey);
		setIsOpen(false);
	}

	return (
		<div className="analytics-timepoint-picker" ref={rootRef}>
			<span className="analytics-timepoint-picker__label">{label}</span>
			<button
				type="button"
				className={`analytics-timepoint-trigger ${selectedOption ? "" : "is-empty"}`}
				onClick={() => setIsOpen((currentState) => !currentState)}
				disabled={disabled}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				aria-label={`选择${label}时间点`}
			>
				<span className="analytics-timepoint-trigger__value">
					{selectedOption?.label ?? placeholder}
				</span>
				<span className="analytics-timepoint-trigger__icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" focusable="false">
						<path
							d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6Zm1.1 2.9v4.44l3.22 1.92a1.1 1.1 0 0 1-1.12 1.9l-3.75-2.23a1.1 1.1 0 0 1-.55-.95V7.1a1.1 1.1 0 1 1 2.2 0Z"
							fill="currentColor"
						/>
					</svg>
				</span>
			</button>

			{isOpen ? (
				<div
					className={`analytics-timepoint-popover ${align === "end" ? "analytics-timepoint-popover--end" : ""}`}
					role="dialog"
					aria-label={`选择${label}时间点`}
				>
					<div className="analytics-timepoint-popover__list">
						{options.map((option) => {
							const isActive = option.key === selectedOption?.key;
							return (
								<button
									key={option.key}
									type="button"
									className={`analytics-timepoint-option ${isActive ? "is-active" : ""}`}
									onClick={() => handleSelect(option.key)}
									aria-pressed={isActive}
								>
									{option.label}
								</button>
							);
						})}
					</div>
					{quickActions.length > 0 ? (
						<div className="analytics-timepoint-popover__actions">
							{quickActions.map((action) => (
								<button
									key={action.label}
									type="button"
									className={`analytics-timepoint-popover__action ${action.key === selectedOption?.key ? "analytics-timepoint-popover__action--muted" : ""}`}
									onClick={() => action.key && handleSelect(action.key)}
									disabled={!action.key || action.key === selectedOption?.key}
								>
									{action.label}
								</button>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
