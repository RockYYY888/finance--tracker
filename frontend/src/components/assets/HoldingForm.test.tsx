import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HoldingForm } from "./HoldingForm";

describe("HoldingForm search results", () => {
	it("shows only real provider labels in search results", async () => {
		const onSearch = vi.fn().mockResolvedValue([
			{
				symbol: "688256.SS",
				name: "寒武纪-U",
				market: "CN",
				currency: "CNY",
				exchange: "SHH",
				source: "本地映射",
			},
			{
				symbol: "BTC-USD",
				name: "Bitcoin",
				market: "CRYPTO",
				currency: "USD",
				exchange: "BITGET",
				source: "Bitget",
			},
			{
				symbol: "AAPL",
				name: "Apple Inc.",
				market: "US",
				currency: "USD",
				exchange: "NMS",
				source: "代码推断",
			},
		]);

		render(<HoldingForm onSearch={onSearch} />);

		fireEvent.change(screen.getByLabelText("搜索投资标的"), {
			target: { value: "比特币" },
		});

		await waitFor(() => {
			expect(onSearch).toHaveBeenCalledWith("比特币");
		}, { timeout: 1000 });

		expect(screen.getByText("Bitcoin")).not.toBeNull();
		expect(screen.queryByText(/本地映射/)).toBeNull();
		expect(screen.queryByText(/代码推断/)).toBeNull();
		expect(screen.getByText(/Bitget/)).not.toBeNull();
	});
});
