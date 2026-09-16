@echo off
REM Windows 터치모니터 PC에서 발매 키오스크용 Chrome을 켜는 스크립트.
REM 실행 전에 아래 URL을 실제 로그인 페이지 주소로 바꿔주세요.

set SCRIPT_DIR=%~dp0
set EXTENSION_DIR=%SCRIPT_DIR%..\extension
set PROFILE_DIR=%USERPROFILE%\.kiosk-chrome-profile
set START_URL=https://REPLACE_WITH_REAL_LOGIN_URL

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk ^
  --noerrdialogs ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-translate ^
  --no-first-run ^
  --disable-pinch ^
  --overscroll-history-navigation=0 ^
  --user-data-dir="%PROFILE_DIR%" ^
  --load-extension="%EXTENSION_DIR%" ^
  "%START_URL%"
