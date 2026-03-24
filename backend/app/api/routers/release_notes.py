from fastapi import APIRouter

from app.schemas import ActionMessageRead, ReleaseNoteDeliveryRead, ReleaseNoteRead
from app.services.release_note_service import (
	create_release_note_for_admin,
	list_release_notes_for_admin,
	list_release_notes_for_current_user,
	mark_release_notes_seen_for_current_user,
	publish_changelog_release_note_for_admin,
	publish_release_note_for_admin,
)

router = APIRouter()

router.add_api_route(
	"/api/admin/release-notes",
	list_release_notes_for_admin,
	methods=["GET"],
	response_model=list[ReleaseNoteRead],
)
router.add_api_route(
	"/api/admin/release-notes",
	create_release_note_for_admin,
	methods=["POST"],
	response_model=ReleaseNoteRead,
	status_code=201,
)
router.add_api_route(
	"/api/admin/release-notes/publish-changelog",
	publish_changelog_release_note_for_admin,
	methods=["POST"],
	response_model=ReleaseNoteRead,
)
router.add_api_route(
	"/api/release-notes",
	list_release_notes_for_current_user,
	methods=["GET"],
	response_model=list[ReleaseNoteDeliveryRead],
)
router.add_api_route(
	"/api/release-notes/mark-seen",
	mark_release_notes_seen_for_current_user,
	methods=["POST"],
	response_model=ActionMessageRead,
)
router.add_api_route(
	"/api/admin/release-notes/{release_note_id}/publish",
	publish_release_note_for_admin,
	methods=["POST"],
	response_model=ReleaseNoteRead,
)
