import { createApiClient, type ApiClient } from "./apiClient";
import type {
	AssetApiClient,
	AssetManagerController,
	CashAccountInput,
	CashAccountRecord,
	FixedAssetInput,
	FixedAssetRecord,
	HoldingInput,
	HoldingRecord,
	LiabilityInput,
	LiabilityRecord,
	OtherAssetInput,
	OtherAssetRecord,
	SecuritySearchResult,
} from "../types/assets";

function toJsonBody(
	payload:
		| CashAccountInput
		| HoldingInput
		| FixedAssetInput
		| LiabilityInput
		| OtherAssetInput,
): string {
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
		holdings: {
			onCreate: (payload) => assetApiClient.createHolding(payload),
			onEdit: (recordId, payload) => assetApiClient.updateHolding(recordId, payload),
			onDelete: (recordId) => assetApiClient.deleteHolding(recordId),
			onRefresh: () => assetApiClient.listHoldings(),
			onSearch: (query) => assetApiClient.searchSecurities(query),
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
