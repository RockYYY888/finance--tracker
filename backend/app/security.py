from __future__ import annotations

import hashlib
import hmac
import os
import re
from typing import Annotated

from fastapi import Header, HTTPException, Request

from app.settings import get_settings

USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,32}$")
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
PASSWORD_SCHEME = "scrypt"
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 64


def normalize_user_id(value: str) -> str:
	user_id = value.strip().lower()
	if not USERNAME_PATTERN.fullmatch(user_id):
		raise ValueError("用户名仅支持 3-32 位小写字母、数字和下划线。")
	return user_id


def validate_password_strength(value: str) -> str:
	password = value
	if not (PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH):
		raise ValueError(
			f"密码长度需在 {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} 位之间。",
		)
	return password


def normalize_email(value: str) -> str:
	email = value.strip().lower()
	if not EMAIL_PATTERN.fullmatch(email):
		raise ValueError("请输入有效的邮箱地址。")
	return email


def hash_email(email: str) -> str:
	normalized_email = normalize_email(email)
	pepper = get_settings().email_pepper_value().encode("utf-8")
	return hmac.new(
		pepper,
		normalized_email.encode("utf-8"),
		hashlib.sha256,
	).hexdigest()


def verify_email(email: str, email_digest: str | None) -> bool:
	if not email_digest:
		return False

	try:
		expected_digest = hash_email(email)
	except ValueError:
		return False

	return hmac.compare_digest(expected_digest, email_digest)


def hash_password(password: str) -> str:
	normalized_password = validate_password_strength(password)
	salt = os.urandom(16)
	derived_key = hashlib.scrypt(
		normalized_password.encode("utf-8"),
		salt=salt,
		n=SCRYPT_N,
		r=SCRYPT_R,
		p=SCRYPT_P,
		dklen=SCRYPT_DKLEN,
	)
	return (
		f"{PASSWORD_SCHEME}${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}"
		f"${salt.hex()}${derived_key.hex()}"
	)


def verify_password(password: str, password_digest: str) -> bool:
	try:
		scheme, n, r, p, salt_hex, expected_hex = password_digest.split("$", maxsplit=5)
		if scheme != PASSWORD_SCHEME:
			return False
		derived_key = hashlib.scrypt(
			validate_password_strength(password).encode("utf-8"),
			salt=bytes.fromhex(salt_hex),
			n=int(n),
			r=int(r),
			p=int(p),
			dklen=len(bytes.fromhex(expected_hex)),
		)
	except (ValueError, TypeError):
		return False

	return hmac.compare_digest(derived_key.hex(), expected_hex)


def get_session_user_id(request: Request) -> str | None:
	user_id = request.session.get("user_id")
	if not isinstance(user_id, str):
		return None

	try:
		return normalize_user_id(user_id)
	except ValueError:
		request.session.clear()
		return None


def require_session_user_id(request: Request) -> str:
	user_id = get_session_user_id(request)
	if user_id is None:
		raise HTTPException(status_code=401, detail="请先登录。")
	return user_id


def verify_api_token(
	request: Request,
	x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> None:
	"""Enforce origin checks and optionally require a shared server token."""
	settings = get_settings()
	origin = request.headers.get("origin")
	if origin and not settings.is_allowed_origin(origin):
		raise HTTPException(status_code=403, detail="Origin not allowed.")

	expected_token = settings.api_token_value()
	if expected_token is None:
		return

	if x_api_key is None:
		raise HTTPException(status_code=401, detail="Missing API token.")

	if x_api_key.strip() != expected_token:
		raise HTTPException(status_code=401, detail="Invalid API token.")
