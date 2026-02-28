const cnyFormatter = new Intl.NumberFormat("zh-CN", {
	style: "currency",
	currency: "CNY",
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("zh-CN", {
	maximumFractionDigits: 4,
});

export function formatCnyAmount(value?: number | null): string {
	const numericValue = Number(value ?? 0);
	return cnyFormatter.format(Number.isFinite(numericValue) ? numericValue : 0);
}

export function formatMoneyAmount(value: number, currency: string): string {
	const numericValue = Number.isFinite(value) ? value : 0;
	return `${numberFormatter.format(numericValue)} ${currency.toUpperCase()}`;
}

export function formatQuantity(value: number): string {
	return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatTimestamp(value?: string | null): string {
	if (!value) {
		return "待同步";
	}

	const parsedValue = new Date(value);
	if (Number.isNaN(parsedValue.getTime())) {
		return "待同步";
	}

	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(parsedValue);
}
