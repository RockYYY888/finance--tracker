from fastapi import APIRouter

from app.schemas import (
	FixedAssetRead,
	LiabilityEntryRead,
	OtherAssetRead,
	SecurityHoldingRead,
	SecurityQuoteRead,
	SecuritySearchRead,
)
from app.services.portfolio_service import (
	create_fixed_asset,
	create_holding_legacy_endpoint,
	create_liability,
	create_other_asset,
	delete_fixed_asset,
	delete_holding,
	delete_liability,
	delete_other_asset,
	get_security_quote,
	list_fixed_assets,
	list_holdings,
	list_liabilities,
	list_other_assets,
	search_securities,
	update_fixed_asset,
	update_holding,
	update_liability,
	update_other_asset,
)

router = APIRouter()

router.add_api_route("/api/holdings", list_holdings, methods=["GET"], response_model=list[SecurityHoldingRead])
router.add_api_route("/api/holdings", create_holding_legacy_endpoint, methods=["POST"], status_code=410)
router.add_api_route("/api/holdings/{holding_id}", update_holding, methods=["PUT"], response_model=SecurityHoldingRead)
router.add_api_route("/api/holdings/{holding_id}", delete_holding, methods=["DELETE"], status_code=204)
router.add_api_route("/api/fixed-assets", list_fixed_assets, methods=["GET"], response_model=list[FixedAssetRead])
router.add_api_route("/api/fixed-assets", create_fixed_asset, methods=["POST"], response_model=FixedAssetRead, status_code=201)
router.add_api_route("/api/fixed-assets/{asset_id}", update_fixed_asset, methods=["PUT"], response_model=FixedAssetRead)
router.add_api_route("/api/fixed-assets/{asset_id}", delete_fixed_asset, methods=["DELETE"], status_code=204)
router.add_api_route("/api/liabilities", list_liabilities, methods=["GET"], response_model=list[LiabilityEntryRead])
router.add_api_route("/api/liabilities", create_liability, methods=["POST"], response_model=LiabilityEntryRead, status_code=201)
router.add_api_route("/api/liabilities/{entry_id}", update_liability, methods=["PUT"], response_model=LiabilityEntryRead)
router.add_api_route("/api/liabilities/{entry_id}", delete_liability, methods=["DELETE"], status_code=204)
router.add_api_route("/api/other-assets", list_other_assets, methods=["GET"], response_model=list[OtherAssetRead])
router.add_api_route("/api/other-assets", create_other_asset, methods=["POST"], response_model=OtherAssetRead, status_code=201)
router.add_api_route("/api/other-assets/{asset_id}", update_other_asset, methods=["PUT"], response_model=OtherAssetRead)
router.add_api_route("/api/other-assets/{asset_id}", delete_other_asset, methods=["DELETE"], status_code=204)
router.add_api_route("/api/securities/quote", get_security_quote, methods=["GET"], response_model=SecurityQuoteRead)
router.add_api_route("/api/securities/search", search_securities, methods=["GET"], response_model=list[SecuritySearchRead])
