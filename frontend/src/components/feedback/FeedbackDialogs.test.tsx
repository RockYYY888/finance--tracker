import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminFeedbackDialog } from "./AdminFeedbackDialog";
import { AdminReleaseNotesDialog } from "./AdminReleaseNotesDialog";
import { UserFeedbackInboxDialog } from "./UserFeedbackInboxDialog";
import type { AdminFeedbackRecord, ReleaseNoteDeliveryRecord, ReleaseNoteRecord } from "../../types/feedback";

function createFeedbackRecord(
	overrides: Partial<AdminFeedbackRecord> = {},
): AdminFeedbackRecord {
	return {
		id: 1,
		user_id: "alice",
		message: "测试消息",
		category: "USER_REQUEST",
		priority: "MEDIUM",
		source: "USER",
		status: "OPEN",
		is_system: false,
		reply_message: null,
		replied_at: null,
		replied_by: null,
		reply_seen_at: null,
		resolved_at: null,
		closed_by: null,
		created_at: "2026-03-05T10:00:00Z",
		assignee: null,
		acknowledged_at: null,
		acknowledged_by: null,
		ack_deadline: null,
		internal_note: null,
		internal_note_updated_at: null,
		internal_note_updated_by: null,
		fingerprint: null,
		dedupe_window_minutes: null,
		occurrence_count: 1,
		last_seen_at: null,
		...overrides,
	};
}

function createReleaseNoteRecord(
	overrides: Partial<ReleaseNoteRecord> = {},
): ReleaseNoteRecord {
	return {
		id: 1,
		version: "0.2.0",
		title: "图表可读性与修正能力更新",
		content: "支持任意两个有效时间点对比。",
		source_feedback_ids: [3, 5],
		created_by: "admin",
		created_at: "2026-03-05T10:00:00Z",
		published_at: null,
		delivery_count: 0,
		...overrides,
	};
}

function createReleaseNoteDeliveryRecord(
	overrides: Partial<ReleaseNoteDeliveryRecord> = {},
): ReleaseNoteDeliveryRecord {
	return {
		delivery_id: 8,
		release_note_id: 1,
		version: "0.2.0",
		title: "图表可读性与修正能力更新",
		content: "支持任意两个有效时间点对比。",
		source_feedback_ids: [3, 5],
		published_at: "2026-03-06T10:00:00Z",
		delivered_at: "2026-03-06T10:01:00Z",
		seen_at: null,
		...overrides,
	};
}

describe("Feedback dialogs policy rendering", () => {
	afterEach(() => {
		window.localStorage.clear();
		document.cookie = "feedback_dismiss_skip_confirm_v1=0; Max-Age=0; Path=/";
		document.documentElement.style.overflow = "";
		document.documentElement.style.overscrollBehavior = "";
		document.body.style.overflow = "";
		document.body.style.overscrollBehavior = "";
		cleanup();
	});

	it("hides reply editor for system feedback in admin inbox", () => {
		const systemItem = createFeedbackRecord({
			id: 7,
			user_id: "admin",
			category: "SYSTEM_ALERT",
			priority: "HIGH",
			source: "API_MONITOR",
			is_system: true,
			message: "[SYSTEM] API error",
		});

		render(
			<AdminFeedbackDialog
				open
				busy={false}
				viewerUserId="admin"
				userItems={[]}
				systemItems={[systemItem]}
				releaseNotes={[]}
				showDismissed={false}
				errorMessage={null}
				onHideItem={vi.fn().mockResolvedValue(undefined)}
				onClose={vi.fn()}
				onShowDismissedChange={vi.fn()}
				onCloseItem={vi.fn().mockResolvedValue(undefined)}
				onReplyItem={vi.fn().mockResolvedValue(undefined)}
			/>,
		);

		fireEvent.click(screen.getByText("展开"));

		expect(screen.queryByPlaceholderText("输入回复，用户会在自己的消息里看到。")).toBeNull();
		expect(screen.getByText("系统来源消息无需回复，可直接关闭。")).not.toBeNull();
	});

	it("shows source badge but not priority badge in user inbox", () => {
		const userItem = createFeedbackRecord({
			id: 9,
			priority: "HIGH",
			source: "USER",
			category: "USER_REQUEST",
		});

		const view = render(
			<UserFeedbackInboxDialog
				open
				busy={false}
				viewerUserId="alice"
				items={[userItem]}
				releaseNotes={[]}
				errorMessage={null}
				onClose={vi.fn()}
			/>,
		);

		expect(within(view.container).getByText("用户提交")).not.toBeNull();
		expect(within(view.container).queryByText("高优先级")).toBeNull();
		expect(within(view.container).queryByRole("button", { name: /从当前列表移除/ })).toBeNull();
	});

	it("shows a top-right toggle for previously dismissed admin messages", () => {
		const onShowDismissedChange = vi.fn();

		render(
			<AdminFeedbackDialog
				open
				busy={false}
				viewerUserId="admin"
				userItems={[createFeedbackRecord({ id: 21, user_id: "alice" })]}
				systemItems={[]}
				releaseNotes={[]}
				showDismissed={false}
				errorMessage={null}
				onHideItem={vi.fn().mockResolvedValue(undefined)}
				onClose={vi.fn()}
				onShowDismissedChange={onShowDismissedChange}
				onCloseItem={vi.fn().mockResolvedValue(undefined)}
				onReplyItem={vi.fn().mockResolvedValue(undefined)}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "显示已移除" }));

		expect(onShowDismissedChange).toHaveBeenCalledWith(true);
	});

	it("keeps release note surfaces in chinese for admin and user inbox dialogs", () => {
		const releaseNote = createReleaseNoteRecord();
		const delivery = createReleaseNoteDeliveryRecord();

		const adminView = render(
			<AdminReleaseNotesDialog
				open
				busy={false}
				releaseNotes={[releaseNote]}
				errorMessage={null}
				onClose={vi.fn()}
				onCreateReleaseNote={vi.fn().mockResolvedValue(undefined)}
				onPublishReleaseNote={vi.fn().mockResolvedValue(undefined)}
			/>,
		);

		expect(within(adminView.container).getByRole("heading", { name: "版本更新日志" })).not.toBeNull();
		expect(within(adminView.container).getByText("发布中心")).not.toBeNull();
		expect(within(adminView.container).getByRole("button", { name: "创建草稿" })).not.toBeNull();
		expect(within(adminView.container).queryByText("Release Notes")).toBeNull();

		adminView.unmount();

		const userView = render(
			<UserFeedbackInboxDialog
				open
				busy={false}
				viewerUserId="alice"
				items={[]}
				releaseNotes={[delivery]}
				errorMessage={null}
				onClose={vi.fn()}
			/>,
		);

		expect(within(userView.container).getByText("版本 v0.2.0")).not.toBeNull();
		expect(within(userView.container).getByText("更新内容")).not.toBeNull();
		expect(within(userView.container).getByText("关联反馈：#3, #5")).not.toBeNull();
		expect(within(userView.container).queryByText("Published:")).toBeNull();
	});

	it("renders product updates in the admin inbox message stream", () => {
		const delivery = createReleaseNoteDeliveryRecord();

		const view = render(
			<AdminFeedbackDialog
				open
				busy={false}
				viewerUserId="admin"
				userItems={[]}
				systemItems={[]}
				releaseNotes={[delivery]}
				showDismissed={false}
				errorMessage={null}
				onHideItem={vi.fn().mockResolvedValue(undefined)}
				onClose={vi.fn()}
				onShowDismissedChange={vi.fn()}
				onCloseItem={vi.fn().mockResolvedValue(undefined)}
				onReplyItem={vi.fn().mockResolvedValue(undefined)}
			/>,
		);

		expect(within(view.container).getByText("产品更新")).not.toBeNull();
		expect(within(view.container).getByText("版本 v0.2.0")).not.toBeNull();
		expect(within(view.container).getByText("更新内容")).not.toBeNull();
		expect(within(view.container).getByText("关联反馈：#3, #5")).not.toBeNull();
		expect(within(view.container).queryByText("Published:")).toBeNull();
	});

	it("keeps dismiss buttons out of the non-admin inbox", () => {
		const userItem = createFeedbackRecord({
			id: 12,
			message: "这条消息会保留在用户消息列表里",
		});

		render(
			<UserFeedbackInboxDialog
				open
				busy={false}
				viewerUserId="alice"
				items={[userItem]}
				releaseNotes={[createReleaseNoteDeliveryRecord()]}
				errorMessage={null}
				onClose={vi.fn()}
			/>,
		);

		expect(screen.queryByLabelText("从当前列表移除消息 #12")).toBeNull();
		expect(screen.queryByLabelText("从当前列表移除版本消息 v0.2.0")).toBeNull();
	});

	it("locks page scrolling while inbox dialog is open and uses a fixed panel shell", () => {
		const { container, rerender } = render(
			<UserFeedbackInboxDialog
				open
				busy={false}
				viewerUserId="alice"
				items={[]}
				releaseNotes={[]}
				errorMessage={null}
				onClose={vi.fn()}
			/>,
		);

		expect(
			container.querySelector(".feedback-modal__panel.feedback-modal__panel--list-layout"),
		).not.toBeNull();
		expect(document.documentElement.style.overflow).toBe("hidden");
		expect(document.documentElement.style.overscrollBehavior).toBe("none");
		expect(document.body.style.overflow).toBe("hidden");
		expect(document.body.style.overscrollBehavior).toBe("none");

		rerender(
			<UserFeedbackInboxDialog
				open={false}
				busy={false}
				viewerUserId="alice"
				items={[]}
				releaseNotes={[]}
				errorMessage={null}
				onClose={vi.fn()}
			/>,
		);

		expect(document.documentElement.style.overflow).toBe("");
		expect(document.documentElement.style.overscrollBehavior).toBe("");
		expect(document.body.style.overflow).toBe("");
		expect(document.body.style.overscrollBehavior).toBe("");
	});
});
