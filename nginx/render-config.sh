#!/bin/sh
set -eu

envsubst '$ASSET_TRACKER_API_TOKEN' \
	< /opt/nginx-templates/default.conf.template \
	> /etc/nginx/conf.d/default.conf
