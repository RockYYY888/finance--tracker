import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminFeedbackDialog } from "./AdminFeedbackDialog";
import { UserFeedbackInboxDialog } from "./UserFeedbackInboxDialog";
import type { UserFeedbackRecord } from "../../types/feedback";

function createFeedbackRecord(overrides: Partial<UserFeedbackRecord> = {}): UserFeedbackRecord {
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
					items={[systemItem]}
					releaseNotes={[]}
					errorMessage={null}
				onClose={vi.fn()}
				onCloseItem={vi.fn().mockResolvedValue(undefined)}
				onReplyItem={vi.fn().mockResolvedValue(undefined)}
				onCreateReleaseNote={vi.fn().mockResolvedValue(undefined)}
				onPublishReleaseNote={vi.fn().mockResolvedValue(undefined)}
			/>,
		);

		fireEvent.click(screen.getByText("展开"));

		expect(screen.queryByPlaceholderText("输入回复，用户会在自己的消息里看到。")).toBeNull();
		expect(screen.getByText("系统来源消息无需回复，可直接关闭或调整分类/优先级。")).not.toBeNull();
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
	});

	it("removes a message from current list after dismiss confirmation", () => {
		const userItem = createFeedbackRecord({
			id: 12,
			message: "这条消息会被前端移除",
		});

		render(
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

		fireEvent.click(screen.getByLabelText("从当前列表移除消息 #12"));
		expect(screen.getByRole("heading", { name: "移除消息" })).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "移除消息" }));

		expect(screen.queryByText("这条消息会被前端移除")).toBeNull();
	});
});
