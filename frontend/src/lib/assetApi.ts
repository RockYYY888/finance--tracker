import { createApiClient, type ApiClient } from "./apiClient";
import type {
	AssetApiClient,
	AssetManagerController,
	CashAccountInput,
	CashAccountRecord,
	HoldingInput,
	HoldingRecord,
	SecuritySearchResult,
} from "../types/assets";

function toJsonBody(payload: CashAccountInput | HoldingInput): string {
	return JSON.stringify(payload);
}

/**
 * Creates the replaceable asset API adapter for later integration work.
 */
export function createAssetApiClient(apiClient: ApiClient = createApiClient()): AssetApiClient {
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
		listHoldings: () => apiClient.request<HoldingRecord[]>("/api/holdings"),
		createHolding: (payload) =>
			apiClient.request<HoldingRecord>("/api/holdings", {
				method: "POST",
				body: toJsonBody(payload),
			}),
		updateHolding: (recordId, payload) =>
			apiClient.request<HoldingRecord>(`/api/holdings/${recordId}`, {
				method: "PUT",
				body: toJsonBody(payload),
			}),
		deleteHolding: (recordId) =>
			apiClient.request<void>(`/api/holdings/${recordId}`, {
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
		holdings: {
			onCreate: (payload) => assetApiClient.createHolding(payload),
			onEdit: (recordId, payload) => assetApiClient.updateHolding(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteHolding(recordId),
			onRefresh: () => assetApiClient.listHoldings(),
			onSearch: (query) => assetApiClient.searchSecurities(query),
		},
	};
}
