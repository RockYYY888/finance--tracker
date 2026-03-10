import { createApiClient, type ApiClient } from "./apiClient";
import type {
	AssetApiClient,
	AssetManagerController,
	CashAccountInput,
	CashAccountRecord,
	CashLedgerAdjustmentInput,
	CashLedgerEntryRecord,
	CashTransferRecord,
	FixedAssetInput,
	FixedAssetRecord,
	HoldingInput,
	HoldingRecord,
	HoldingTransactionRecord,
	AgentTaskRecord,
	AssetMutationAuditRecord,
	LiabilityInput,
	LiabilityRecord,
	OtherAssetInput,
	OtherAssetRecord,
	SecuritySearchResult,
} from "../types/assets";

type HoldingTransactionApplyResponse = {
	holding: HoldingRecord | null;
	transaction: HoldingTransactionRecord;
};

type CashTransferApplyResponse = {
	transfer: CashTransferRecord;
};

type CashLedgerAdjustmentApplyResponse = {
	entry: CashLedgerEntryRecord;
};

function toJsonBody(
	payload:
		| CashAccountInput
		| CashLedgerAdjustmentInput
		| HoldingInput
		| FixedAssetInput
		| LiabilityInput
		| OtherAssetInput,
): string {
	return JSON.stringify(payload);
}

function toHoldingUpdateBody(payload: HoldingInput): string {
	return JSON.stringify({
		broker: payload.broker,
		note: payload.note,
	});
}

/**
 * Creates the replaceable asset API adapter for later integration work.
 */
export function createAssetApiClient(apiClient: ApiClient = createApiClient()): AssetApiClient {
	const applyHoldingTransaction = async (
		payload: HoldingInput,
	): Promise<HoldingRecord | null> => {
		if (!payload.started_on) {
			throw new Error("交易日为必填项。");
		}
		const response = await apiClient.request<HoldingTransactionApplyResponse>(
			"/api/holding-transactions",
			{
				method: "POST",
				body: JSON.stringify({
					side: payload.side,
					symbol: payload.symbol,
					name: payload.name,
					quantity: payload.quantity,
					price: payload.cost_basis_price,
					fallback_currency: payload.fallback_currency,
					market: payload.market,
					broker: payload.broker,
					traded_on: payload.started_on,
					note: payload.note,
					sell_proceeds_handling: payload.sell_proceeds_handling,
					sell_proceeds_account_id: payload.sell_proceeds_account_id,
					buy_funding_handling: payload.buy_funding_handling,
					buy_funding_account_id: payload.buy_funding_account_id,
				}),
			},
		);
		if (response.holding) {
			return {
				...response.holding,
				side: "BUY",
			};
		}

		return null;
	};

	return {
		listCashAccounts: () => apiClient.request<CashAccountRecord[]>("/api/accounts"),
		createCashAccount: (payload) =>
			apiClient.request<CashAccountRecord>("/api/accounts", {
				method: "POST",
				body: toJsonBody(payload),
			}),
		updateCashAccount: (recordId, payload) =>
			apiClient.request<CashAccountRecord>(`/api/accounts/${recordId}`, {
				method: "PUT",
				body: toJsonBody(payload),
			}),
		deleteCashAccount: (recordId) =>
			apiClient.request<void>(`/api/accounts/${recordId}`, {
				method: "DELETE",
			}),
		listCashTransfers: () => apiClient.request<CashTransferRecord[]>("/api/cash-transfers"),
		createCashTransfer: async (payload) => {
			const response = await apiClient.request<CashTransferApplyResponse>("/api/cash-transfers", {
				method: "POST",
				body: JSON.stringify(payload),
			});
			return response.transfer;
		},
		updateCashTransfer: async (recordId, payload) => {
			const response = await apiClient.request<CashTransferApplyResponse>(
				`/api/cash-transfers/${recordId}`,
				{
					method: "PATCH",
					body: JSON.stringify(payload),
				},
			);
			return response.transfer;
		},
		deleteCashTransfer: (recordId) =>
			apiClient.request<void>(`/api/cash-transfers/${recordId}`, {
				method: "DELETE",
			}),
		listCashLedgerEntries: (accountId) => {
			const searchParams = new URLSearchParams();
			if (accountId !== undefined) {
				searchParams.set("account_id", String(accountId));
			}
			const query = searchParams.toString();
			return apiClient.request<CashLedgerEntryRecord[]>(
				`/api/cash-ledger${query ? `?${query}` : ""}`,
			);
		},
		createCashLedgerAdjustment: async (payload) => {
			const response = await apiClient.request<CashLedgerAdjustmentApplyResponse>(
				"/api/cash-ledger/adjustments",
				{
					method: "POST",
					body: toJsonBody(payload),
				},
			);
			return response.entry;
		},
		updateCashLedgerAdjustment: async (recordId, payload) => {
			const response = await apiClient.request<CashLedgerAdjustmentApplyResponse>(
				`/api/cash-ledger/adjustments/${recordId}`,
				{
					method: "PATCH",
					body: toJsonBody(payload),
				},
			);
			return response.entry;
		},
		deleteCashLedgerAdjustment: (recordId) =>
			apiClient.request<void>(`/api/cash-ledger/adjustments/${recordId}`, {
				method: "DELETE",
			}),
		listAgentTasks: () => apiClient.request<AgentTaskRecord[]>("/api/agent/tasks"),
		listAssetMutationAudits: (params) => {
			const search = new URLSearchParams();
			if (params?.agentTaskId) {
				search.set("agent_task_id", String(params.agentTaskId));
			}
			const queryString = search.toString();
			const query = queryString ? `?${queryString}` : "";
			return apiClient.request<AssetMutationAuditRecord[]>(`/api/audit-log${query}`);
		},
		listHoldings: async () => {
			const holdings = await apiClient.request<HoldingRecord[]>("/api/holdings");
			return holdings.map((record) => ({
				...record,
				side: "BUY",
			}));
		},
		createHolding: (payload) => applyHoldingTransaction(payload),
		updateHolding: async (recordId, payload) => {
			const updatedHolding = await apiClient.request<HoldingRecord>(
				`/api/holdings/${recordId}`,
				{
					method: "PUT",
					body: toHoldingUpdateBody(payload),
				},
			);

			return {
				...updatedHolding,
				side: "BUY",
			};
		},
		deleteHolding: (recordId) =>
			apiClient.request<void>(`/api/holdings/${recordId}`, {
				method: "DELETE",
			}),
		listHoldingTransactions: () =>
			apiClient.request<HoldingTransactionRecord[]>("/api/holding-transactions"),
		updateHoldingTransaction: async (recordId, payload) => {
			const response = await apiClient.request<HoldingTransactionApplyResponse>(
				`/api/holding-transactions/${recordId}`,
				{
					method: "PATCH",
					body: JSON.stringify({
						quantity: payload.quantity,
						price: payload.price,
						fallback_currency: payload.fallback_currency,
						broker: payload.broker,
						traded_on: payload.traded_on,
						note: payload.note,
						sell_proceeds_handling: payload.sell_proceeds_handling,
						sell_proceeds_account_id: payload.sell_proceeds_account_id,
						buy_funding_handling: payload.buy_funding_handling,
						buy_funding_account_id: payload.buy_funding_account_id,
					}),
				},
			);
			return response.transaction;
		},
		deleteHoldingTransaction: (recordId) =>
			apiClient.request<void>(`/api/holding-transactions/${recordId}`, {
				method: "DELETE",
			}),
		listFixedAssets: () => apiClient.request<FixedAssetRecord[]>("/api/fixed-assets"),
		createFixedAsset: (payload) =>
			apiClient.request<FixedAssetRecord>("/api/fixed-assets", {
				method: "POST",
				body: toJsonBody(payload),
			}),
		updateFixedAsset: (recordId, payload) =>
			apiClient.request<FixedAssetRecord>(`/api/fixed-assets/${recordId}`, {
				method: "PUT",
				body: toJsonBody(payload),
			}),
		deleteFixedAsset: (recordId) =>
			apiClient.request<void>(`/api/fixed-assets/${recordId}`, {
				method: "DELETE",
			}),
		listLiabilities: () => apiClient.request<LiabilityRecord[]>("/api/liabilities"),
		createLiability: (payload) =>
			apiClient.request<LiabilityRecord>("/api/liabilities", {
				method: "POST",
				body: toJsonBody(payload),
			}),
		updateLiability: (recordId, payload) =>
			apiClient.request<LiabilityRecord>(`/api/liabilities/${recordId}`, {
				method: "PUT",
				body: toJsonBody(payload),
			}),
		deleteLiability: (recordId) =>
			apiClient.request<void>(`/api/liabilities/${recordId}`, {
				method: "DELETE",
			}),
		listOtherAssets: () => apiClient.request<OtherAssetRecord[]>("/api/other-assets"),
		createOtherAsset: (payload) =>
			apiClient.request<OtherAssetRecord>("/api/other-assets", {
				method: "POST",
				body: toJsonBody(payload),
			}),
		updateOtherAsset: (recordId, payload) =>
			apiClient.request<OtherAssetRecord>(`/api/other-assets/${recordId}`, {
				method: "PUT",
				body: toJsonBody(payload),
			}),
		deleteOtherAsset: (recordId) =>
			apiClient.request<void>(`/api/other-assets/${recordId}`, {
				method: "DELETE",
			}),
		searchSecurities: (query) =>
			apiClient.request<SecuritySearchResult[]>(
				`/api/securities/search?q=${encodeURIComponent(query)}`,
			),
	};
}

export const defaultAssetApiClient = createAssetApiClient();

export function createAssetManagerController(
	assetApiClient: AssetApiClient = defaultAssetApiClient,
): AssetManagerController {
	return {
		cashAccounts: {
			onCreate: (payload) => assetApiClient.createCashAccount(payload),
			onEdit: (recordId, payload) => assetApiClient.updateCashAccount(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteCashAccount(recordId),
			onRefresh: () => assetApiClient.listCashAccounts(),
		},
		cashTransfers: {
			onCreate: (payload) => assetApiClient.createCashTransfer(payload),
			onEdit: (recordId, payload) => assetApiClient.updateCashTransfer(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteCashTransfer(recordId),
			onRefresh: () => assetApiClient.listCashTransfers(),
		},
		cashLedgerAdjustments: {
			onCreate: (payload) => assetApiClient.createCashLedgerAdjustment(payload),
			onEdit: (recordId, payload) => assetApiClient.updateCashLedgerAdjustment(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteCashLedgerAdjustment(recordId),
			onRefresh: () => assetApiClient.listCashLedgerEntries(),
			onRefreshForAccount: (accountId) => assetApiClient.listCashLedgerEntries(accountId),
		},
		agentAudit: {
			onRefresh: async () => {
				const [tasks, audits] = await Promise.all([
					assetApiClient.listAgentTasks(),
					assetApiClient.listAssetMutationAudits(),
				]);
				return { tasks, audits };
			},
		},
		holdings: {
			onCreate: (payload) => assetApiClient.createHolding(payload),
			onEdit: (recordId, payload) => assetApiClient.updateHolding(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteHolding(recordId),
			onRefresh: () => assetApiClient.listHoldings(),
			onSearch: (query) => assetApiClient.searchSecurities(query),
		},
		holdingTransactions: {
			onEdit: (recordId, payload) => assetApiClient.updateHoldingTransaction(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteHoldingTransaction(recordId),
			onRefresh: () => assetApiClient.listHoldingTransactions(),
		},
		fixedAssets: {
			onCreate: (payload) => assetApiClient.createFixedAsset(payload),
			onEdit: (recordId, payload) => assetApiClient.updateFixedAsset(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteFixedAsset(recordId),
			onRefresh: () => assetApiClient.listFixedAssets(),
		},
		liabilities: {
			onCreate: (payload) => assetApiClient.createLiability(payload),
			onEdit: (recordId, payload) => assetApiClient.updateLiability(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteLiability(recordId),
			onRefresh: () => assetApiClient.listLiabilities(),
		},
		otherAssets: {
			onCreate: (payload) => assetApiClient.createOtherAsset(payload),
			onEdit: (recordId, payload) => assetApiClient.updateOtherAsset(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteOtherAsset(recordId),
			onRefresh: () => assetApiClient.listOtherAssets(),
		},
	};
}
