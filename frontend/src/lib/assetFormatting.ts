const cnyFormatter = new Intl.NumberFormat("zh-CN", {
	style: "currency",
	currency: "CNY",
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("zh-CN", {
	maximumFractionDigits: 4,
});

const priceFormatter = new Intl.NumberFormat("zh-CN", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("zh-CN", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});
const DISPLAY_TIME_ZONE = "Asia/Shanghai";
const BARE_UTC_TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

const cashAccountTypeLabels: Record<string, string> = {
	ALIPAY: "支付宝",
	WECHAT: "微信",
	BANK: "银行卡",
	CASH: "现金",
	OTHER: "其他",
};

const securityMarketLabels: Record<string, string> = {
	CN: "A 股 / 内地",
	HK: "港股",
	US: "美股",
	FUND: "基金",
	CRYPTO: "加密货币",
	OTHER: "其他",
};

const fixedAssetCategoryLabels: Record<string, string> = {
	REAL_ESTATE: "不动产",
	VEHICLE: "车辆",
	PRECIOUS_METAL: "贵金属",
	COLLECTIBLE: "收藏品",
	SOCIAL_SECURITY: "社会保障",
	OTHER: "其他",
};

const liabilityCategoryLabels: Record<string, string> = {
	MORTGAGE: "房贷",
	AUTO_LOAN: "车贷",
	CREDIT_CARD: "信用卡",
	PERSONAL_LOAN: "个人借款",
	OTHER: "其他",
};

const otherAssetCategoryLabels: Record<string, string> = {
	RECEIVABLE: "应收款项",
	OTHER: "其他",
};

export function formatCnyAmount(value?: number | null): string {
	const numericValue = Number(value ?? 0);
	return cnyFormatter.format(Number.isFinite(numericValue) ? numericValue : 0);
}

export function formatMoneyAmount(value: number, currency: string): string {
	const numericValue = Number.isFinite(value) ? value : 0;
	return `${numberFormatter.format(numericValue)} ${currency.toUpperCase()}`;
}

export function formatPriceAmount(value: number, currency: string): string {
	const numericValue = Number.isFinite(value) ? value : 0;
	return `${priceFormatter.format(numericValue)} ${currency.toUpperCase()}`;
}

export function formatPercentValue(value?: number | null): string {
	const numericValue = Number(value ?? 0);
	const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
	return `${percentFormatter.format(safeValue)}%`;
}

export function formatQuantity(value: number): string {
	return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function normalizeUtcTimestampValue(value: string): string {
	const trimmedValue = value.trim();
	const normalizedValue = trimmedValue.replace(
		/^(\d{4}-\d{2}-\d{2}) /,
		"$1T",
	);

	if (BARE_UTC_TIMESTAMP_PATTERN.test(normalizedValue)) {
		return `${normalizedValue}Z`;
	}

	return normalizedValue;
}

export function formatTimestamp(value?: string | null): string {
	if (!value) {
		return "待更新";
	}

	const parsedValue = new Date(normalizeUtcTimestampValue(value));
	if (Number.isNaN(parsedValue.getTime())) {
		return "待更新";
	}

	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		timeZone: DISPLAY_TIME_ZONE,
	}).format(parsedValue);
}

export function formatDateValue(value?: string | null): string {
	if (!value) {
		return "未填写";
	}

	const parsedValue = new Date(`${value}T00:00:00`);
	if (Number.isNaN(parsedValue.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(parsedValue);
}

export function formatCashAccountType(value?: string | null): string {
	if (!value) {
		return "其他";
	}

	return cashAccountTypeLabels[value] ?? value;
}

export function formatSecurityMarket(value?: string | null): string {
	if (!value) {
		return "其他";
	}

	return securityMarketLabels[value] ?? value;
}

export function formatFixedAssetCategory(value?: string | null): string {
	if (!value) {
		return "其他";
	}

	return fixedAssetCategoryLabels[value] ?? value;
}

export function formatLiabilityCategory(value?: string | null): string {
	if (!value) {
		return "其他";
	}

	return liabilityCategoryLabels[value] ?? value;
}

export function formatOtherAssetCategory(value?: string | null): string {
	if (!value) {
		return "其他";
	}

	return otherAssetCategoryLabels[value] ?? value;
}
