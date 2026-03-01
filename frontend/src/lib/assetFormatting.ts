const cnyFormatter = new Intl.NumberFormat("zh-CN", {
	style: "currency",
	currency: "CNY",
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("zh-CN", {
	maximumFractionDigits: 4,
});

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
		return "待更新";
	}

	const parsedValue = new Date(value);
	if (Number.isNaN(parsedValue.getTime())) {
		return "待更新";
	}

	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
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
