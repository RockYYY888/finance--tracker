import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { LoginScreen } from "./LoginScreen";

function buildProps(overrides: Partial<ComponentProps<typeof LoginScreen>> = {}) {
	return {
		onLogin: vi.fn().mockResolvedValue(undefined),
		onRegister: vi.fn().mockResolvedValue(undefined),
		onResetPassword: vi.fn().mockResolvedValue(undefined),
		loading: false,
		checkingSession: false,
		errorMessage: null,
		noticeMessage: null,
		...overrides,
	};
}

describe("LoginScreen forgot-password guidance", () => {
	it("shows forgot-password prompt after repeated wrong-password hint", () => {
		render(
			<LoginScreen
				{...buildProps({
					errorMessage:
						"账号或密码错误。已连续输错 5 次，是否忘记密码？可点击“忘记密码”重设。",
				})}
			/>,
		);

		expect(
			screen.getByText("连续多次输入密码错误，是否需要改为找回密码？"),
		).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "去重设密码" }));

		expect(screen.getByText("找回密码")).not.toBeNull();
		expect(screen.getByText("邮箱")).not.toBeNull();
	});

	it("does not show forgot-password prompt for normal login errors", () => {
		render(
			<LoginScreen
				{...buildProps({
					errorMessage: "账号或密码错误。",
				})}
			/>,
		);

		expect(
			screen.queryByText("连续多次输入密码错误，是否需要改为找回密码？"),
		).toBeNull();
	});
});
