export const CASH_ACCOUNT_DELETE_DESCRIPTION =
	"确认后会直接删除该账户，并同步移除与该账户相关的现金记录关联。";

export const CASH_ACCOUNT_DELETE_IMPACT_ITEMS = [
	"该账户本身会被移除。",
	"相关现金流水和账户划转会一并删除。",
	"投资买卖记录会保留，只会移除其中绑定到这个账户的现金结算关联。",
] as const;
