import { useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

type DatePickerFieldProps = {
	value: string;
	onChange: (nextValue: string) => void;
	placeholder?: string;
	disabled?: boolean;
};

function parseDateValue(value: string): Date | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return undefined;
	}

	const [year, month, day] = value.split("-").map((part) => Number(part));
	const parsedDate = new Date(year, month - 1, day);
	if (
		parsedDate.getFullYear() !== year
		|| parsedDate.getMonth() !== month - 1
		|| parsedDate.getDate() !== day
	) {
		return undefined;
	}

	return parsedDate;
}

function formatDateValue(value: Date): string {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string): string {
	const parsedDate = parseDateValue(value);
	if (!parsedDate) {
		return value || "请选择日期";
	}

	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(parsedDate);
}

export function DatePickerField({
	value,
	onChange,
	placeholder = "请选择日期",
	disabled = false,
}: DatePickerFieldProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const selectedDate = useMemo(() => parseDateValue(value), [value]);
	const [isOpen, setIsOpen] = useState(false);
	const [month, setMonth] = useState<Date>(selectedDate ?? new Date());

	useEffect(() => {
		if (selectedDate) {
			setMonth(selectedDate);
		}
	}, [selectedDate]);

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

	function handleSelect(nextDate: Date | undefined): void {
		if (!nextDate) {
			return;
		}

		onChange(formatDateValue(nextDate));
		setMonth(nextDate);
		setIsOpen(false);
	}

	function handleClear(): void {
		onChange("");
		setIsOpen(false);
	}

	function handleSelectToday(): void {
		const today = new Date();
		onChange(formatDateValue(today));
		setMonth(today);
		setIsOpen(false);
	}

	return (
		<div className="asset-date-picker" ref={rootRef}>
			<button
				type="button"
				className={`asset-date-trigger ${value ? "" : "is-empty"}`}
				onClick={() => setIsOpen((currentState) => !currentState)}
				disabled={disabled}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
			>
				<span className="asset-date-trigger__value">
					{value ? formatDisplayDate(value) : placeholder}
				</span>
				<span className="asset-date-trigger__icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" focusable="false">
						<path
							d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v11a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1Zm13 8H4v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8ZM5 6a1 1 0 0 0-1 1v1h16V7a1 1 0 0 0-1-1H5Z"
							fill="currentColor"
						/>
					</svg>
				</span>
			</button>

			{isOpen ? (
				<div className="asset-date-popover" role="dialog" aria-label="选择日期">
					<DayPicker
						animate
						mode="single"
						captionLayout="dropdown"
						selected={selectedDate}
						month={month}
						onMonthChange={setMonth}
						onSelect={handleSelect}
						showOutsideDays
						fixedWeeks
						startMonth={new Date(1970, 0)}
						endMonth={new Date(new Date().getFullYear() + 20, 11)}
					/>
					<div className="asset-date-popover__actions">
						<button
							type="button"
							className="asset-date-popover__action"
							onClick={handleSelectToday}
						>
							今天
						</button>
						<button
							type="button"
							className="asset-date-popover__action asset-date-popover__action--muted"
							onClick={handleClear}
						>
							清除
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
