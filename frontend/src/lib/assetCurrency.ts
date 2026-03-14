import type { SupportedCurrency } from "../types/assets";

export type SupportedCurrencyFxRates = Partial<Record<SupportedCurrency, number | null>>;

export const TARGET_DISPLAY_CURRENCY: SupportedCurrency = "CNY";

export function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
	return value === "CNY" || value === "USD" || value === "HKD";
}

export function normalizeSupportedCurrency(
	value: string | null | undefined,
	fallback: SupportedCurrency = "CNY",
): SupportedCurrency {
	const normalizedValue = value?.trim().toUpperCase();
	return isSupportedCurrency(normalizedValue) ? normalizedValue : fallback;
}

export function resolveFxRateToCny(
	currency: SupportedCurrency,
	options?: {
		explicitFxToCny?: number | null;
		fxRates?: SupportedCurrencyFxRates;
	},
): number | null {
	if (currency === "CNY") {
		return 1;
	}

	const explicitRate = options?.explicitFxToCny;
	if (explicitRate != null && Number.isFinite(explicitRate) && explicitRate > 0) {
		return explicitRate;
	}

	const fallbackRate = options?.fxRates?.[currency];
	if (fallbackRate != null && Number.isFinite(fallbackRate) && fallbackRate > 0) {
		return fallbackRate;
	}

	return null;
}

export function calculateTargetCnyAmount(
	amount: number | null | undefined,
	currency: SupportedCurrency,
	options?: {
		explicitFxToCny?: number | null;
		fxRates?: SupportedCurrencyFxRates;
		precision?: number;
	},
): number | null {
	if (amount == null || !Number.isFinite(amount)) {
		return null;
	}

	const fxRate = resolveFxRateToCny(currency, options);
	if (fxRate == null) {
		return null;
	}

	const precision = options?.precision ?? 2;
	return Number((amount * fxRate).toFixed(precision));
}
