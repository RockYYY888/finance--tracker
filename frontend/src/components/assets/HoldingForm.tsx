import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./asset-components.css";
import { DatePickerField } from "./DatePickerField";
import { formatSecurityMarket } from "../../lib/assetFormatting";
import { toErrorMessage } from "../../lib/apiClient";
import type {
	AssetEditorMode,
	HoldingFormDraft,
	HoldingInput,
	MaybePromise,
	SecuritySearchResult,
} from "../../types/assets";
import {
	DEFAULT_HOLDING_FORM_DRAFT,
	SECURITY_MARKET_OPTIONS,
} from "../../types/assets";

export interface HoldingFormProps {
	mode?: AssetEditorMode;
	value?: Partial<HoldingFormDraft> | null;
	recordId?: number | null;
	title?: string;
	subtitle?: string;
	submitLabel?: string;
	busy?: boolean;
	errorMessage?: string | null;
	onCreate?: (payload: HoldingInput) => MaybePromise<unknown>;
	onEdit?: (recordId: number, payload: HoldingInput) => MaybePromise<unknown>;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
	onSearch?: (query: string) => MaybePromise<SecuritySearchResult[]>;
	onCancel?: () => void;
}

function toHoldingDraft(value?: Partial<HoldingFormDraft> | null): HoldingFormDraft {
	return {
		...DEFAULT_HOLDING_FORM_DRAFT,
		...value,
	};
}

function toHoldingInput(draft: HoldingFormDraft): HoldingInput {
	const normalizedBroker = draft.broker.trim();
	const normalizedNote = draft.note.trim();

	return {
		symbol: draft.symbol.trim().toUpperCase(),
		name: draft.name.trim(),
		quantity: Number(draft.quantity),
		fallback_currency: draft.fallback_currency.trim().toUpperCase(),
		cost_basis_price: draft.cost_basis_price.trim()
			? Number(draft.cost_basis_price)
			: undefined,
		market: draft.market,
		broker: normalizedBroker || undefined,
		started_on: draft.started_on.trim() || undefined,
		note: normalizedNote || undefined,
	};
}

function normalizeSearchToken(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getSearchLabel(selection: { name: string; symbol: string }): string {
	return `${selection.name} (${selection.symbol})`;
}

function allowsFractionalQuantity(market: HoldingFormDraft["market"]): boolean {
	return market === "FUND" || market === "CRYPTO";
}

function shouldStartSearch(query: string): boolean {
	return query.trim().length >= 2;
}

function isImplicitSearchSourceLabel(source?: string | null): boolean {
	return source === "代码推断" || source === "本地映射";
}

function shouldPrefillBroker(source?: string | null): boolean {
	return Boolean(source && !isImplicitSearchSourceLabel(source));
}

export function HoldingForm({
	mode = "create",
	value,
	recordId = null,
	title,
	subtitle,
	submitLabel,
	busy = false,
	errorMessage = null,
	onCreate,
	onEdit,
	onDelete,
	onSearch,
	onCancel,
}: HoldingFormProps) {
	const [draft, setDraft] = useState<HoldingFormDraft>(() => toHoldingDraft(value));
	const [localError, setLocalError] = useState<string | null>(null);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SecuritySearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const searchRequestIdRef = useRef(0);
	const searchEnabled = Boolean(onSearch);

	useEffect(() => {
		const nextDraft = toHoldingDraft(value);
		setDraft(nextDraft);
		setSearchQuery(nextDraft.name || nextDraft.symbol);
		setSearchResults([]);
		setIsSearchOpen(false);
		setSearchError(null);
		setLocalError(null);
	}, [mode, value]);

	useEffect(() => {
		if (!onSearch) {
			return;
		}

		const normalizedQuery = normalizeSearchToken(searchQuery);
		const selectionTokens = [
			normalizeSearchToken(draft.name),
			normalizeSearchToken(draft.symbol),
			normalizeSearchToken(`${draft.name} ${draft.symbol}`),
		].filter(Boolean);

		if (!normalizedQuery) {
			setSearchResults([]);
			setIsSearchOpen(false);
			setSearchError(null);
			setIsSearching(false);
			return;
		}

		if (!shouldStartSearch(searchQuery)) {
			setSearchResults([]);
			setIsSearchOpen(false);
			setSearchError(null);
			setIsSearching(false);
			return;
		}

		if (selectionTokens.includes(normalizedQuery)) {
			setSearchResults([]);
			setIsSearchOpen(false);
			setSearchError(null);
			setIsSearching(false);
			return;
		}

		const requestId = ++searchRequestIdRef.current;
		setIsSearching(true);

		const timer = window.setTimeout(() => {
			void (async () => {
				try {
					const results = await onSearch(searchQuery.trim());
					if (requestId !== searchRequestIdRef.current) {
						return;
					}

					setSearchResults(results);
					setIsSearchOpen(results.length > 0);
					setSearchError(null);
				} catch (error) {
					if (requestId !== searchRequestIdRef.current) {
						return;
					}

					setSearchResults([]);
					setIsSearchOpen(false);
					setSearchError(toErrorMessage(error, "标的搜索失败，请稍后重试。"));
				} finally {
					if (requestId === searchRequestIdRef.current) {
						setIsSearching(false);
					}
				}
			})();
		}, 240);

		return () => window.clearTimeout(timer);
	}, [draft.name, draft.symbol, onSearch, searchQuery]);

	const effectiveError = localError ?? errorMessage;
	const isSubmitting = busy || isWorking;
	const resolvedTitle = title ?? (mode === "edit" ? "编辑投资类资产" : "新增投资类资产");
	const resolvedSubmitLabel = submitLabel ?? (mode === "edit" ? "编辑" : "新增");
	const cancelLabel = mode === "edit" ? "取消编辑" : "取消";
	const quantityLabel = draft.market === "FUND"
		? "份额"
		: draft.market === "CRYPTO"
			? "数量"
			: "数量（股/支）";
	const quantityStep = allowsFractionalQuantity(draft.market) ? "0.0001" : "1";
	const quantityMin = allowsFractionalQuantity(draft.market) ? "0.0001" : "1";

	function updateDraft<K extends keyof HoldingFormDraft>(
		field: K,
		nextValue: HoldingFormDraft[K],
	): void {
		setLocalError(null);
		setDraft((currentDraft) => ({
			...currentDraft,
			[field]: nextValue,
		}));
	}

	function handleSearchInput(nextValue: string): void {
		setLocalError(null);
		setSearchError(null);
		setSearchQuery(nextValue);
		if (!searchEnabled) {
			return;
		}

		setDraft((currentDraft) => ({
			...currentDraft,
			symbol: "",
			name: "",
		}));
	}

	function applySearchResult(result: SecuritySearchResult): void {
		setLocalError(null);
		setSearchError(null);
		setSearchQuery(result.name);
		setSearchResults([]);
		setIsSearchOpen(false);
		setDraft((currentDraft) => ({
			...currentDraft,
			symbol: result.symbol,
			name: result.name,
			market: result.market,
			fallback_currency: result.currency || currentDraft.fallback_currency,
			broker: shouldPrefillBroker(result.source)
				? result.source ?? currentDraft.broker
				: isImplicitSearchSourceLabel(currentDraft.broker)
					? ""
					: currentDraft.broker,
		}));
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		setLocalError(null);
		setIsWorking(true);

		try {
			const payload = toHoldingInput(draft);
			if (!payload.symbol || !payload.name || !payload.fallback_currency) {
				throw new Error("请先选择投资标的，再填写数量。");
			}
			if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
				throw new Error("请输入有效的持仓数量。");
			}
			if (
				payload.cost_basis_price !== undefined &&
				(!Number.isFinite(payload.cost_basis_price) || payload.cost_basis_price <= 0)
			) {
				throw new Error("请输入有效的持仓价。");
			}
			if (!allowsFractionalQuantity(draft.market) && !Number.isInteger(payload.quantity)) {
				throw new Error("股票请使用整数数量；基金和加密货币可使用小数。");
			}

			if (mode === "edit" && recordId !== null) {
				await onEdit?.(recordId, payload);
			} else {
				await onCreate?.(payload);
				setDraft(DEFAULT_HOLDING_FORM_DRAFT);
				setSearchQuery("");
				setSearchResults([]);
				setIsSearchOpen(false);
			}
		} catch (error) {
			setLocalError(toErrorMessage(error, "保存持仓失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	async function handleDelete(): Promise<void> {
		if (!onDelete || recordId === null) {
			return;
		}

		setLocalError(null);
		setIsWorking(true);

		try {
			await onDelete(recordId);
		} catch (error) {
			setLocalError(toErrorMessage(error, "删除持仓失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__panel-head">
				<div>
					<p className="asset-manager__eyebrow">HOLDING FORM</p>
					<h3>{resolvedTitle}</h3>
					{subtitle ? <p>{subtitle}</p> : null}
				</div>
			</div>

			{effectiveError ? (
				<div className="asset-manager__message asset-manager__message--error">
					{effectiveError}
				</div>
			) : null}

			<form className="asset-manager__form" onSubmit={(event) => void handleSubmit(event)}>
				<label className="asset-manager__field asset-manager__search-field">
					<span>搜索投资标的</span>
					<div className="asset-manager__search-shell">
						<input
							value={searchQuery}
							onChange={(event) => handleSearchInput(event.target.value)}
							onFocus={() => setIsSearchOpen(searchResults.length > 0)}
							onBlur={() => window.setTimeout(() => setIsSearchOpen(false), 120)}
							placeholder="输入名称或代码，例如：寒武纪 / 理想 / BTC"
							autoComplete="off"
						/>

						{isSearching ? (
							<p className="asset-manager__helper-text">正在搜索…</p>
						) : searchEnabled && searchQuery.trim().length === 1 && !draft.symbol ? (
							<p className="asset-manager__helper-text">请输入至少 2 个字符。</p>
						) : searchEnabled &&
							searchQuery.trim() &&
							!draft.symbol &&
							searchResults.length === 0 &&
							!searchError ? (
							<p className="asset-manager__helper-text">没有可选结果，请换一个名称或代码。</p>
						) : null}

						{isSearchOpen && searchResults.length > 0 ? (
							<div className="asset-manager__search-list" role="listbox">
								{searchResults.map((result) => (
									<button
										key={`${result.symbol}-${result.exchange ?? "unknown"}-${result.source ?? "unknown"}`}
										type="button"
										className="asset-manager__search-item"
										onMouseDown={(event) => {
											event.preventDefault();
											applySearchResult(result);
										}}
									>
										<strong>{result.name}</strong>
										<span>{result.symbol}</span>
										<small>
											{formatSecurityMarket(result.market)}
											{result.exchange ? ` · ${result.exchange}` : ""}
											{result.currency ? ` · ${result.currency}` : ""}
											{result.source ? ` · ${result.source}` : ""}
										</small>
									</button>
								))}
							</div>
						) : null}
					</div>
				</label>

				{searchError ? (
					<div className="asset-manager__message asset-manager__message--error">
						{searchError}
					</div>
				) : null}

				{searchEnabled && draft.symbol ? (
					<div className="asset-manager__selection-pill">{getSearchLabel(draft)}</div>
				) : null}

				<div className="asset-manager__field-grid">
					<label className="asset-manager__field">
						<span>代码</span>
						<input
							required
							value={draft.symbol}
							onChange={(event) => updateDraft("symbol", event.target.value)}
							placeholder="选择后自动填入"
							readOnly={searchEnabled}
						/>
					</label>

					<label className="asset-manager__field">
						<span>名称</span>
						<input
							required
							value={draft.name}
							onChange={(event) => updateDraft("name", event.target.value)}
							placeholder="选择后自动填入"
							readOnly={searchEnabled}
						/>
					</label>
				</div>

				<div className="asset-manager__field-grid asset-manager__field-grid--triple">
					<label className="asset-manager__field">
						<span>市场</span>
						<select
							value={draft.market}
							onChange={(event) =>
								updateDraft("market", event.target.value as HoldingFormDraft["market"])
							}
						>
							{SECURITY_MARKET_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>

					<label className="asset-manager__field">
						<span>{quantityLabel}</span>
						<input
							required
							type="number"
							min={quantityMin}
							step={quantityStep}
							value={draft.quantity}
							onChange={(event) => updateDraft("quantity", event.target.value)}
							placeholder={allowsFractionalQuantity(draft.market) ? "1.0000" : "100"}
						/>
					</label>

					<label className="asset-manager__field">
						<span>计价币种</span>
						<input
							required
							value={draft.fallback_currency}
							onChange={(event) =>
								updateDraft("fallback_currency", event.target.value)
							}
							placeholder="HKD"
						/>
					</label>
				</div>

				<label className="asset-manager__field">
					<span>持仓价（计价币种）</span>
					<input
						type="number"
						min="0.0001"
						step="0.0001"
						value={draft.cost_basis_price}
						onChange={(event) => updateDraft("cost_basis_price", event.target.value)}
						placeholder="可选，例如 536.89"
					/>
				</label>

				<label className="asset-manager__field">
					<span>来源 / 账户来源</span>
					<input
						value={draft.broker}
						onChange={(event) => updateDraft("broker", event.target.value)}
						placeholder="搜索后自动填入，可手动修改"
					/>
				</label>

				<label className="asset-manager__field">
					<span>持仓日</span>
					<DatePickerField
						value={draft.started_on}
						onChange={(nextValue) => updateDraft("started_on", nextValue)}
						placeholder="选择持仓日"
					/>
				</label>

				<label className="asset-manager__field">
					<span>备注</span>
					<textarea
						value={draft.note}
						onChange={(event) => updateDraft("note", event.target.value)}
						placeholder="可选"
					/>
				</label>

				<div className="asset-manager__form-actions">
					<button
						type="submit"
						className="asset-manager__button"
						disabled={isSubmitting}
					>
						{isSubmitting ? "保存中..." : resolvedSubmitLabel}
					</button>

					{onCancel ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--secondary"
							onClick={onCancel}
							disabled={isSubmitting}
						>
							{cancelLabel}
						</button>
					) : null}

					{mode === "edit" && recordId !== null && onDelete ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--danger"
							onClick={() => void handleDelete()}
							disabled={isSubmitting}
						>
							删除持仓
						</button>
					) : null}
				</div>
			</form>
		</section>
	);
}
