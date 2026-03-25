import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginScreen } from "./LoginScreen";

function buildProps(overrides: Partial<ComponentProps<typeof LoginScreen>> = {}) {
	return {
		onAuthenticate: vi.fn().mockResolvedValue(undefined),
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

describe("LoginScreen API key access", () => {
	it("submits the pasted API key through the authentication callback", async () => {
		const onAuthenticate = vi.fn().mockResolvedValue(undefined);
		render(<LoginScreen {...buildProps({ onAuthenticate })} />);

		fireEvent.change(screen.getByLabelText("API Key"), {
			target: { value: "atrk_demo_key" },
		});
		fireEvent.submit(screen.getByRole("button", { name: "进入工作区" }));

		expect(onAuthenticate).toHaveBeenCalledWith({
			api_key: "atrk_demo_key",
		});
	});

	it("shows the API key verification status copy", () => {
		render(<LoginScreen {...buildProps({ checkingSession: true })} />);

		expect(screen.getByText("正在验证已保存的 API Key。")).not.toBeNull();
		expect(screen.getByText("需要新的 API Key？")).not.toBeNull();
	});

	it("does not render ambient decorative layers", () => {
		const { container } = render(<LoginScreen {...buildProps()} />);

		expect(container.querySelector(".ambient")).toBeNull();
	});
});
