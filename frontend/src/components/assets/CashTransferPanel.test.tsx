import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CashTransferPanel } from "./CashTransferPanel";

afterEach(() => {
	cleanup();
});

describe("CashTransferPanel", () => {
	it("clamps transfer amount to the selected source account balance", () => {
		render(
			<CashTransferPanel
				accounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 100,
						account_type: "BANK",
					},
					{
						id: 2,
						name: "备用金",
						platform: "Cash",
						currency: "CNY",
						balance: 0,
						account_type: "CASH",
					},
				]}
				onCreate={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByLabelText("转出账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("当前币种转出金额"), {
			target: { value: "150" },
		});

		expect((screen.getByLabelText("当前币种转出金额") as HTMLInputElement).value).toBe("100");
	});

	it("keeps transfer draft when accounts refresh upstream", () => {
		const { rerender } = render(
			<CashTransferPanel
				accounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 100,
						account_type: "BANK",
					},
					{
						id: 2,
						name: "备用金",
						platform: "Cash",
						currency: "CNY",
						balance: 50,
						account_type: "CASH",
					},
				]}
				onCreate={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByLabelText("转出账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("转入账户（CNY）"), {
			target: { value: "2" },
		});
		fireEvent.change(screen.getByLabelText("当前币种转出金额"), {
			target: { value: "25" },
		});
		fireEvent.change(screen.getByLabelText("备注"), {
			target: { value: "收盘后调仓" },
		});

		rerender(
			<CashTransferPanel
				accounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 95,
						account_type: "BANK",
					},
					{
						id: 2,
						name: "备用金",
						platform: "Cash",
						currency: "CNY",
						balance: 55,
						account_type: "CASH",
					},
				]}
				onCreate={vi.fn()}
			/>,
		);

		expect((screen.getByLabelText("当前币种转出金额") as HTMLInputElement).value).toBe("25");
		expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe(
			"收盘后调仓",
		);
	});

	it("submits a new cash transfer without rendering transfer history controls", async () => {
		const handleCreate = vi.fn().mockResolvedValue(undefined);

		render(
			<CashTransferPanel
				accounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 100,
						account_type: "BANK",
					},
					{
						id: 2,
						name: "备用金",
						platform: "Cash",
						currency: "CNY",
						balance: 0,
						account_type: "CASH",
					},
				]}
				onCreate={handleCreate}
			/>,
		);

		expect(screen.queryByText("还没有账户划转记录。")).toBeNull();
		expect(screen.queryByRole("button", { name: "编辑划转" })).toBeNull();

		fireEvent.change(screen.getByLabelText("转出账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("转入账户（CNY）"), {
			target: { value: "2" },
		});
		fireEvent.change(screen.getByLabelText("当前币种转出金额"), {
			target: { value: "30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "确认划转" }));

		await waitFor(() => {
			expect(handleCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					from_account_id: 1,
					to_account_id: 2,
					source_amount: 30,
				}),
			);
		});
	});

	it("shows readonly cny target amount for non-cny transfers", () => {
		render(
			<CashTransferPanel
				accounts={[
					{
						id: 1,
						name: "美元账户",
						platform: "Bank",
						currency: "USD",
						balance: 100,
						account_type: "BANK",
					},
					{
						id: 2,
						name: "人民币账户",
						platform: "Cash",
						currency: "CNY",
						balance: 0,
						account_type: "CASH",
					},
				]}
				fxRates={{ USD: 7 }}
				onCreate={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByLabelText("转出账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("当前币种转出金额"), {
			target: { value: "12" },
		});

		expect((screen.getByLabelText("目标币种") as HTMLInputElement).value).toBe("CNY");
		expect((screen.getByLabelText("目标币种到账金额（CNY）") as HTMLInputElement).value).toBe("¥84.00");
	});
});
