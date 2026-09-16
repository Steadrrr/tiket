// content.js는 --kiosk 플래그 없이 열린 일반 창도 자동으로 키오스크처럼(주소창/탭
// 없는 전체화면) 만들 수 있도록, 이 백그라운드 스크립트에 메시지를 보내
// chrome.windows.update로 창 상태를 바꾼다. (Fullscreen Web API는 사용자
// 클릭 없이는 호출이 막히지만, 확장프로그램의 chrome.windows API는 그렇지 않다)
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab || sender.tab.windowId === undefined) return;

  if (message && message.type === 'kiosk-enter-fullscreen') {
    chrome.windows.update(sender.tab.windowId, { state: 'fullscreen' });
  } else if (message && message.type === 'kiosk-exit-fullscreen') {
    chrome.windows.update(sender.tab.windowId, { state: 'normal' });
  }
});
