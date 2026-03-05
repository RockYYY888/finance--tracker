import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminFeedbackDialog } from "./AdminFeedbackDialog";
import { UserFeedbackInboxDialog } from "./UserFeedbackInboxDialog";
import type { AdminFeedbackRecord } from "../../types/feedback";

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

describe("Feedback dialogs policy rendering", () => {
	afterEach(() => {
		window.localStorage.clear();
		document.cookie = "feedback_dismiss_skip_confirm_v1=0; Max-Age=0; Path=/";
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
				errorMessage={null}
				onHideItem={vi.fn().mockResolvedValue(undefined)}
				onClose={vi.fn()}
				onCloseItem={vi.fn().mockResolvedValue(undefined)}
				onReplyItem={vi.fn().mockResolvedValue(undefined)}
				onCreateReleaseNote={vi.fn().mockResolvedValue(undefined)}
				onPublishReleaseNote={vi.fn().mockResolvedValue(undefined)}
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
				onHideFeedbackItem={vi.fn().mockResolvedValue(undefined)}
				onHideReleaseNote={vi.fn().mockResolvedValue(undefined)}
			/>,
		);

		expect(within(view.container).getByText("用户提交")).not.toBeNull();
		expect(within(view.container).queryByText("高优先级")).toBeNull();
	});

	it("removes a message from current list after dismiss confirmation", async () => {
		const userItem = createFeedbackRecord({
			id: 12,
			message: "这条消息会被前端移除",
		});
		const onHideFeedbackItem = vi.fn().mockResolvedValue(undefined);

		render(
			<UserFeedbackInboxDialog
				open
				busy={false}
				viewerUserId="alice"
				items={[userItem]}
				releaseNotes={[]}
				errorMessage={null}
				onClose={vi.fn()}
				onHideFeedbackItem={onHideFeedbackItem}
				onHideReleaseNote={vi.fn().mockResolvedValue(undefined)}
			/>,
		);

		fireEvent.click(screen.getByLabelText("从当前列表移除消息 #12"));
		expect(screen.getByRole("heading", { name: "移除消息" })).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "移除消息" }));

		await waitFor(() => {
			expect(onHideFeedbackItem).toHaveBeenCalledWith(12);
		});
		await waitFor(() => {
			expect(screen.queryByText("这条消息会被前端移除")).toBeNull();
		});
	});
});
