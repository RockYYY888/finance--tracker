import type {
	AssetRecordAssetClass,
	AssetRecordOperationKind,
	AssetRecordSource,
} from "../types/assets";

export type AssetRecordOperationFilterValue = AssetRecordOperationKind | "ALL";

export const ASSET_CLASS_OPTIONS: Array<{
	value: AssetRecordAssetClass;
	label: string;
}> = [
	{ value: "cash", label: "现金类" },
	{ value: "investment", label: "投资类" },
	{ value: "fixed", label: "固定资产" },
	{ value: "liability", label: "负债" },
	{ value: "other", label: "其他" },
];

export const OPERATION_OPTIONS_BY_CLASS: Record<
	AssetRecordAssetClass,
	Array<{ value: AssetRecordOperationFilterValue; label: string }>
> = {
	cash: [
		{ value: "ALL", label: "全部" },
		{ value: "NEW", label: "新建" },
		{ value: "EDIT", label: "编辑" },
		{ value: "TRANSFER", label: "划转" },
		{ value: "ADJUST", label: "调整" },
		{ value: "DELETE", label: "删除" },
	],
	investment: [
		{ value: "ALL", label: "全部" },
		{ value: "BUY", label: "买入" },
		{ value: "SELL", label: "卖出" },
		{ value: "EDIT", label: "编辑" },
		{ value: "DELETE", label: "删除" },
	],
	fixed: [
		{ value: "ALL", label: "全部" },
		{ value: "NEW", label: "新建" },
		{ value: "EDIT", label: "编辑" },
		{ value: "DELETE", label: "删除" },
	],
	liability: [
		{ value: "ALL", label: "全部" },
		{ value: "NEW", label: "新建" },
		{ value: "EDIT", label: "编辑" },
		{ value: "DELETE", label: "删除" },
	],
	other: [
		{ value: "ALL", label: "全部" },
		{ value: "NEW", label: "新建" },
		{ value: "EDIT", label: "编辑" },
		{ value: "DELETE", label: "删除" },
	],
};

export const SOURCE_FILTER_OPTIONS: Array<{
	value: AssetRecordSource | "ALL";
	label: string;
}> = [
	{ value: "ALL", label: "全部" },
	{ value: "USER", label: "用户" },
	{ value: "SYSTEM", label: "系统" },
	{ value: "API", label: "直连 API" },
	{ value: "AGENT", label: "Agent" },
];

export const ASSET_CLASS_BADGE_LABELS: Record<AssetRecordAssetClass, string> = {
	cash: "现金类",
	investment: "投资类",
	fixed: "固定资产",
	liability: "负债",
	other: "其他",
};

export const OPERATION_BADGE_LABELS: Record<AssetRecordOperationKind, string> = {
	NEW: "新建",
	EDIT: "编辑",
	DELETE: "删除",
	BUY: "买入",
	SELL: "卖出",
	TRANSFER: "划转",
	ADJUST: "调整",
};

export const SOURCE_BADGE_LABELS: Record<AssetRecordSource, string> = {
	USER: "用户",
	SYSTEM: "系统",
	API: "直连 API",
	AGENT: "Agent",
};
