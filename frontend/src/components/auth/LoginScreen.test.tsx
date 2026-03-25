import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
	cleanup();
});

describe("LoginScreen forgot-password guidance", () => {
	it("submits username and password through the login callback", () => {
		const onLogin = vi.fn().mockResolvedValue(undefined);
		render(<LoginScreen {...buildProps({ onLogin })} />);

		fireEvent.change(screen.getByLabelText("用户名"), {
			target: { value: "alice" },
		});
		fireEvent.change(screen.getByLabelText("密码"), {
			target: { value: "qwer1234" },
		});
		fireEvent.submit(screen.getByRole("button", { name: "登录" }));

		expect(onLogin).toHaveBeenCalledWith({
			user_id: "alice",
			password: "qwer1234",
		});
	});

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

		expect(screen.getByRole("heading", { name: "找回密码" })).not.toBeNull();
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

	it("does not render ambient decorative layers", () => {
		const { container } = render(<LoginScreen {...buildProps()} />);

		expect(container.querySelector(".ambient")).toBeNull();
	});
});
