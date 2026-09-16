#!/bin/bash
# 리눅스(예: 우분투 미니PC)에서 발매 키오스크용 Chrome을 켜는 스크립트.
# 실행 전에 아래 URL을 실제 로그인 페이지 주소로 바꿔주세요.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$SCRIPT_DIR/../extension"
PROFILE_DIR="$HOME/.kiosk-chrome-profile"
START_URL="https://REPLACE_WITH_REAL_LOGIN_URL"

CHROME_BIN="$(command -v google-chrome || command -v chromium-browser || command -v chromium)"

exec "$CHROME_BIN" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --no-first-run \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$EXTENSION_DIR" \
  "$START_URL"
