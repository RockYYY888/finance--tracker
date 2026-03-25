#!/bin/sh
set -eu

cat /opt/nginx-templates/default.conf.template \
	> /etc/nginx/conf.d/default.conf
