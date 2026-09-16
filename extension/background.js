// content.js는 --kiosk 플래그 없이 열린 일반 창도 자동으로 키오스크처럼(주소창/탭
// 없는 전체화면) 만들 수 있도록, 이 백그라운드 스크립트에 메시지를 보내
// chrome.windows.update로 창 상태를 바꾼다. (Fullscreen Web API는 사용자
// 클릭 직후가 아니면 호출이 막히지만, 확장프로그램의 chrome.windows API는
// 그렇지 않다 - 다만 경험상 최근 사용자 입력이 전혀 없을 때는 크롬이 창
// 상태 변경을 조용히 무시하는 경우가 있어, 성공 여부를 항상 응답으로
// 알려주고 content.js 쪽에서 클릭/키 입력이 있을 때마다 재시도하게 한다)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab || sender.tab.windowId === undefined) return false;
  const windowId = sender.tab.windowId;

  if (message && message.type === 'kiosk-enter-fullscreen') {
    chrome.windows.get(windowId, {}, (win) => {
      if (chrome.runtime.lastError) {
        console.warn('[키오스크 배경] 창 조회 실패:', chrome.runtime.lastError.message);
        sendResponse({ ok: false });
        return;
      }
      if (win.state === 'fullscreen') {
        sendResponse({ ok: true, already: true });
        return;
      }
      chrome.windows.update(windowId, { state: 'fullscreen' }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[키오스크 배경] 전체화면 전환 실패:', chrome.runtime.lastError.message);
          sendResponse({ ok: false });
        } else {
          sendResponse({ ok: true });
        }
      });
    });
    return true; // 비동기 응답이므로 메시지 채널을 열어둔다
  }

  if (message && message.type === 'kiosk-exit-fullscreen') {
    chrome.windows.update(windowId, { state: 'normal' }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[키오스크 배경] 전체화면 해제 실패:', chrome.runtime.lastError.message);
      }
      sendResponse({ ok: !chrome.runtime.lastError });
    });
    return true;
  }

  return false;
});
