import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiabilityForm } from "./LiabilityForm";

afterEach(() => {
	cleanup();
});

describe("LiabilityForm", () => {
	it("uses a currency selector and shows readonly cny liability preview", () => {
		render(
			<LiabilityForm
				fxRates={{ HKD: 0.91 }}
				value={{
					currency: "HKD",
				}}
			/>,
		);

		fireEvent.change(screen.getByLabelText("当前币种待偿余额"), {
			target: { value: "50" },
		});

		expect((screen.getByLabelText("当前币种") as HTMLSelectElement).value).toBe("HKD");
		expect((screen.getByLabelText("目标币种") as HTMLInputElement).value).toBe("CNY");
		expect((screen.getByLabelText("目标币种负债额（CNY）") as HTMLInputElement).value).toBe(
			"¥45.50",
		);
	});
});
