import type {
	FeedbackCategory,
	FeedbackPriority,
	FeedbackSource,
	FeedbackStatus,
} from "../types/feedback";

type FeedbackBadgeMeta = {
	label: string;
	tone: "sky" | "pink" | "amber" | "teal" | "slate";
};

const CATEGORY_META: Record<FeedbackCategory, FeedbackBadgeMeta> = {
	USER_REQUEST: { label: "用户工单", tone: "sky" },
	SYSTEM_ALERT: { label: "系统告警", tone: "pink" },
	SYSTEM_HEARTBEAT: { label: "系统巡检", tone: "teal" },
	SYSTEM_TASK: { label: "系统任务", tone: "slate" },
};

const PRIORITY_META: Record<FeedbackPriority, FeedbackBadgeMeta> = {
	HIGH: { label: "高优先级", tone: "pink" },
	MEDIUM: { label: "中优先级", tone: "amber" },
	LOW: { label: "低优先级", tone: "teal" },
};

const SOURCE_META: Record<FeedbackSource, FeedbackBadgeMeta> = {
	USER: { label: "用户提交", tone: "sky" },
	SYSTEM: { label: "系统", tone: "slate" },
	API_MONITOR: { label: "API 巡检", tone: "teal" },
	TRADING_AGENT: { label: "Trading Agent", tone: "amber" },
	ADMIN: { label: "管理员", tone: "slate" },
};

const STATUS_META: Record<FeedbackStatus, FeedbackBadgeMeta> = {
	OPEN: { label: "待处理", tone: "pink" },
	ACKED: { label: "已确认", tone: "sky" },
	IN_PROGRESS: { label: "处理中", tone: "amber" },
	SILENCED: { label: "已静默", tone: "slate" },
	RESOLVED: { label: "已关闭", tone: "teal" },
};

function fallbackMeta(label: string): FeedbackBadgeMeta {
	return { label, tone: "slate" };
}

export function getFeedbackCategoryMeta(category: string): FeedbackBadgeMeta {
	return CATEGORY_META[category as FeedbackCategory] ?? fallbackMeta(category || "未分类");
}

export function getFeedbackPriorityMeta(priority: string): FeedbackBadgeMeta {
	return PRIORITY_META[priority as FeedbackPriority] ?? fallbackMeta(priority || "未知优先级");
}

export function getFeedbackSourceMeta(source: string): FeedbackBadgeMeta {
	return SOURCE_META[source as FeedbackSource] ?? fallbackMeta(source || "未知来源");
}

export function getFeedbackStatusMeta(status: string): FeedbackBadgeMeta {
	return STATUS_META[status as FeedbackStatus] ?? fallbackMeta(status || "未知状态");
}
