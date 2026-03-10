import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
				transfers={[]}
				onCreate={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "新增划转" }));
		fireEvent.change(screen.getByLabelText("转出账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("划转金额"), {
			target: { value: "150" },
		});

		expect((screen.getByLabelText("划转金额") as HTMLInputElement).value).toBe("100");
	});

	it("allows editing a transfer up to the rolled back source balance", () => {
		const handleEdit = vi.fn();

		render(
			<CashTransferPanel
				accounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 400,
						account_type: "BANK",
					},
					{
						id: 2,
						name: "备用金",
						platform: "Cash",
						currency: "CNY",
						balance: 100,
						account_type: "CASH",
					},
				]}
				transfers={[
					{
						id: 10,
						from_account_id: 1,
						to_account_id: 2,
						source_amount: 100,
						target_amount: 100,
						source_currency: "CNY",
						target_currency: "CNY",
						transferred_on: "2026-03-10",
						note: "旧划转",
					},
				]}
				onEdit={handleEdit}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "编辑划转" }));
		fireEvent.change(screen.getByLabelText("划转金额"), {
			target: { value: "550" },
		});

		expect((screen.getByLabelText("划转金额") as HTMLInputElement).value).toBe("500");
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
				transfers={[]}
				onCreate={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "新增划转" }));
		fireEvent.change(screen.getByLabelText("转出账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("转入账户"), {
			target: { value: "2" },
		});
		fireEvent.change(screen.getByLabelText("划转金额"), {
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
				transfers={[]}
				onCreate={vi.fn()}
			/>,
		);

		expect((screen.getByLabelText("划转金额") as HTMLInputElement).value).toBe("25");
		expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe(
			"收盘后调仓",
		);
	});
});
