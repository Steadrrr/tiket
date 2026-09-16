// ============================================================================
// 발매 페이지를 감싸는 키오스크 오버레이
//
// ioms.foresttrip.go.kr은 로그인 후에도 최상위 URL이 "/main/init.do#"로
// 고정된 채, 좌측 메뉴를 클릭하면 dhtmlx 탭 안에 iframe으로 화면이 로드되는
// 구조다 (SPA형 MDI). 그래서 이 확장은:
//
// 1) 최상위(top) 프레임에서만 동작한다 (manifest에서 all_frames: false).
// 2) config.js의 ticketFrameSrcPattern과 src가 일치하면서 "현재 화면에
//    보이는(visible)" iframe을 계속 찾는다.
// 3) 그 iframe 안의 발매유형 그리드(dhtmlx가 렌더링한 순수 <table>)에서
//    "－"/"＋" 버튼이 있는 행들을 찾아, 최상위 문서 위에 카드 형태의
//    전체화면 오버레이를 만든다.
// 4) 오버레이의 ＋/－ 버튼은 실제 그리드의 해당 셀에 진짜 클릭 이벤트를
//    그대로 전달한다 (dhtmlx 내부 로직/세션/결제 흐름은 손대지 않음).
// 5) 메뉴 탭이 바뀌거나 닫히면 오버레이를 자동으로 걷어낸다.
// ============================================================================
(function () {
  const cfg = window.KIOSK_CONFIG;
  if (!cfg) return;
  if (window.top !== window.self) return; // 최상위 문서에서만 실행

  const sel = cfg.selectors;
  const rowCfg = sel.ticketRow;

  let overlayRoot = null;
  let homeBtn = null;
  let currentIframeDoc = null;
  let pendingDoc = null; // 현재 초기화 시도 중인 iframe 문서(중복 시도 방지용)
  let priceInterval = null;
  let kioskConfirmed = false; // 배경 스크립트가 전체화면 적용을 확인해줬는지
  let suppressedIframe = null; // 홈버튼으로 명시적으로 나간 iframe(재진입 억제용)

  // 크롬은 최근 사용자 입력(클릭/키 입력 등)이 전혀 없는 상태에서는
  // chrome.windows.update(state:'fullscreen') 요청을 조용히 무시할 때가
  // 있다. 그래서 오버레이가 뜬 직후 1차 시도를 하고, 그 뒤로는 사용자가
  // 아무 클릭/키 입력을 할 때마다(문서 전체에 캡처링 리스너) 성공할
  // 때까지 계속 재시도한다.
  function requestKioskFullscreen() {
    if (kioskConfirmed) return;
    try {
      chrome.runtime.sendMessage({ type: 'kiosk-enter-fullscreen' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[키오스크] 전체화면 요청 오류:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.ok) {
          kioskConfirmed = true;
        }
      });
    } catch (e) {
      console.warn('[키오스크] 전체화면 요청 실패:', e.message);
    }
  }

  function exitKioskFullscreen() {
    kioskConfirmed = false;
    try {
      chrome.runtime.sendMessage({ type: 'kiosk-exit-fullscreen' });
    } catch (e) {
      console.warn('[키오스크] 전체화면 해제 요청 실패:', e.message);
    }
  }

  // 오버레이가 떠 있는 동안 발생하는 모든 클릭/키 입력을 전체화면 재시도
  // 기회로 사용한다 (오버레이 자체 버튼 클릭 포함). kioskConfirmed가 true가
  // 되면 더 이상 호출하지 않는다.
  document.addEventListener(
    'click',
    () => {
      if (overlayRoot && !kioskConfirmed) requestKioskFullscreen();
    },
    true
  );
  document.addEventListener(
    'keydown',
    () => {
      if (overlayRoot && !kioskConfirmed) requestKioskFullscreen();
    },
    true
  );

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function findActiveTicketIframe() {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      if (!iframe.src || !cfg.ticketFrameSrcPattern.test(iframe.src)) continue;
      const tabbarCell = iframe.closest('.dhx_cell_tabbar');
      if (tabbarCell && !isVisible(tabbarCell)) continue;
      return iframe;
    }
    return null;
  }

  // 발매유형 행을 "절대 컬럼 인덱스"가 아니라 "－/＋ 셀 기준 상대 위치"로 찾는다.
  // dhtmlx는 숨겨진 컬럼(상품ID 등)도 display:none인 <td>로 실제 DOM에 남겨두므로,
  // 앞에 숨겨진 컬럼이 몇 개가 오든 이 방식은 영향을 받지 않는다.
  // 알려진 실제 컬럼 순서: ... GOODS_NM, GOODS_UNPRC, DEC_BTN(－), UNT(숨김), ADD_BTN(＋)
  //   → dec 기준: price = dec.previousElementSibling, name = price.previousElementSibling
  //             add  = dec.nextElementSibling.nextElementSibling (사이에 숨겨진 UNT 1칸)
  function findTicketRows(doc) {
    const candidates = Array.from(doc.querySelectorAll('td, th'));
    const found = [];
    const seenRows = new Set();

    candidates.forEach((decCell) => {
      const decTxt = decCell.textContent.trim();
      if (!rowCfg.decGlyphs.includes(decTxt)) return;

      const tr = decCell.closest('tr');
      if (!tr || seenRows.has(tr)) return;

      const priceCell = decCell.previousElementSibling;
      const nameCell = priceCell && priceCell.previousElementSibling;
      const addCell = decCell.nextElementSibling && decCell.nextElementSibling.nextElementSibling;
      if (!priceCell || !nameCell || !addCell) return;

      const addTxt = addCell.textContent.trim();
      if (!rowCfg.addGlyphs.includes(addTxt)) return;

      seenRows.add(tr);
      found.push({ tr, nameCell, priceCell, decCell, addCell });
    });

    return found;
  }

  function waitForTicketUi(doc, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      function check() {
        const rows = findTicketRows(doc);
        const payButtonEl = doc.querySelector(sel.payButton);
        if (rows.length > 0 && payButtonEl) {
          resolve({ rows, payButtonEl });
          return true;
        }
        return false;
      }
      if (check()) return;

      const observer = new MutationObserver(() => {
        if (check()) observer.disconnect();
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        // 어떤 조건이 안 맞았는지 진단할 수 있도록 상세 로그를 남긴다.
        const decCandidates = Array.from(doc.querySelectorAll('td, th')).filter((el) =>
          rowCfg.decGlyphs.includes(el.textContent.trim())
        );
        console.warn('[키오스크] 진단: 문서 readyState =', doc.readyState);
        console.warn('[키오스크] 진단: "－" 글자를 가진 셀 개수 =', decCandidates.length);
        console.warn('[키오스크] 진단: 매칭된 발매유형 행 개수 =', findTicketRows(doc).length);
        console.warn('[키오스크] 진단: 신용카드 버튼(', sel.payButton, ') 존재 =', !!doc.querySelector(sel.payButton));
        reject(new Error('발매유형 그리드 또는 신용카드 버튼을 찾지 못했습니다.'));
      }, timeoutMs);
    });
  }

  function dispatchClick(el, win) {
    const MouseEventCtor = win.MouseEvent || MouseEvent;
    el.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true, view: win }));
  }

  // 할부 선택 팝업(fn_selectMonth)은 dhtmlx 폼 버튼(id: PayMonth1~6,
  // value: 일시불/2개월/.../6개월)으로 렌더링된다. id가 조금 달라져도
  // 안전하도록, 절대 id가 아니라 버튼에 보이는 값/텍스트가 정확히
  // "일시불", "2개월" 등과 일치하는지로 찾는다.
  const INSTALLMENT_LABELS = ['일시불', '2개월', '3개월', '4개월', '5개월', '6개월'];

  function findInstallmentButtons(doc) {
    const found = {};
    const candidates = Array.from(
      doc.querySelectorAll('input[type="button"], input[type="submit"], button, a')
    );
    candidates.forEach((el) => {
      const raw = el.value !== undefined && el.value !== '' ? el.value : el.textContent;
      const text = (raw || '').trim();
      if (INSTALLMENT_LABELS.includes(text) && !found[text]) {
        found[text] = el;
      }
    });
    return found;
  }

  function waitForInstallmentButtons(doc, timeoutMs = 6000) {
    return new Promise((resolve) => {
      function check() {
        const found = findInstallmentButtons(doc);
        if (Object.keys(found).length > 0) {
          resolve(found);
          return true;
        }
        return false;
      }
      if (check()) return;

      const observer = new MutationObserver(() => {
        if (check()) observer.disconnect();
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null); // 할부 팝업 없이 바로 진행된 경우(금액 미만 등)
      }, timeoutMs);
    });
  }

  // 실제 할부 선택 팝업은 발매 화면 iframe 안(dhtmlx 팝업)에 작게 뜨는데,
  // 우리 오버레이가 화면 전체를 덮고 있어 손님 눈에는 보이지 않는다.
  // 그래서 같은 선택지를 오버레이 위에 큼직하게 다시 보여주고, 고른 값을
  // 실제 버튼 클릭으로 그대로 전달한다.
  function showInstallmentPicker(doc, win, buttonsMap) {
    const backdrop = document.createElement('div');
    backdrop.id = 'kiosk-installment-backdrop';

    const card = document.createElement('div');
    card.id = 'kiosk-installment-card';

    const title = document.createElement('div');
    title.className = 'kiosk-installment-title';
    title.textContent = '할부 개월 수를 선택하세요';
    card.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'kiosk-installment-grid';

    INSTALLMENT_LABELS.forEach((label) => {
      const realBtn = buttonsMap[label];
      if (!realBtn) return;

      const optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.className = 'kiosk-installment-btn';
      if (label === '일시불') optBtn.classList.add('kiosk-installment-btn-primary');
      optBtn.textContent = label;
      optBtn.addEventListener('click', () => {
        dispatchClick(realBtn, win);
        backdrop.remove();
      });
      grid.appendChild(optBtn);
    });

    card.appendChild(grid);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
  }

  function buildOverlay(doc, win, rows, payButtonEl, totalPriceEl, iframe) {
    const root = document.createElement('div');
    root.id = 'kiosk-overlay-root';

    const title = document.createElement('div');
    title.className = 'kiosk-title';
    title.textContent = '입장권 발매';
    root.appendChild(title);

    const typeGrid = document.createElement('div');
    typeGrid.className = 'kiosk-type-grid';

    rows
      .filter((row) => {
        const name = row.nameCell.textContent.trim();
        return !cfg.excludedTypeNames.includes(name);
      })
      .forEach((row) => {
        const name = row.nameCell.textContent.trim();
        const price = row.priceCell.textContent.trim();
        const decCell = row.decCell;
        const addCell = row.addCell;

        const isBulk = cfg.bulkTypeNames.includes(name);
        const maxQty = isBulk ? cfg.bulkMaxQty : cfg.selectors.quantityMax;

        let qty = 0;

        const card = document.createElement('div');
        card.className = 'kiosk-type-card';

        const nameEl = document.createElement('div');
        nameEl.className = 'kiosk-type-name';
        nameEl.textContent = name;

        const priceEl = document.createElement('div');
        priceEl.className = 'kiosk-type-price';
        priceEl.textContent = price + '원';
        if (isBulk) {
          const hint = document.createElement('div');
          hint.className = 'kiosk-type-hint';
          hint.textContent = `최소 ${cfg.bulkMinQty}명부터 신청 가능`;
          card.appendChild(nameEl);
          card.appendChild(priceEl);
          card.appendChild(hint);
        } else {
          card.appendChild(nameEl);
          card.appendChild(priceEl);
        }

        const qtyControl = document.createElement('div');
        qtyControl.className = 'kiosk-qty-control';

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'kiosk-qty-btn';
        minusBtn.textContent = '－';

        const qtyDisplay = document.createElement('div');
        qtyDisplay.className = 'kiosk-qty-display';
        qtyDisplay.textContent = qty;

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'kiosk-qty-btn';
        plusBtn.textContent = '＋';

        function clickMany(cell, times) {
          for (let i = 0; i < times; i += 1) {
            dispatchClick(cell, win);
          }
        }

        minusBtn.addEventListener('click', () => {
          if (qty <= 0) return;
          if (isBulk && qty - 1 < cfg.bulkMinQty) {
            // 단체 최소수량 미만으로는 못 내려가므로, 바로 0으로 초기화
            // (실제 장바구니에도 현재 수량만큼 － 클릭을 반복 전달해 0으로 맞춘다)
            clickMany(decCell, qty);
            qty = 0;
          } else {
            dispatchClick(decCell, win);
            qty -= 1;
          }
          qtyDisplay.textContent = qty;
        });

        plusBtn.addEventListener('click', () => {
          if (qty >= maxQty) return;
          if (isBulk && qty <= 0) {
            // 단체 최초 신청은 최소수량(30)부터 시작
            clickMany(addCell, cfg.bulkMinQty);
            qty = cfg.bulkMinQty;
          } else {
            dispatchClick(addCell, win);
            qty += 1;
          }
          qtyDisplay.textContent = qty;
        });

        qtyControl.appendChild(minusBtn);
        qtyControl.appendChild(qtyDisplay);
        qtyControl.appendChild(plusBtn);

        card.appendChild(qtyControl);
        typeGrid.appendChild(card);
      });

    root.appendChild(typeGrid);

    // --- 총액 표시 ---
    const priceDisplay = document.createElement('div');
    priceDisplay.className = 'kiosk-price';
    function refreshPriceDisplay() {
      if (!totalPriceEl) return;
      const amount = totalPriceEl.value !== undefined ? totalPriceEl.value : totalPriceEl.textContent;
      priceDisplay.textContent = `받을금액: ${amount || 0}원`;
    }
    refreshPriceDisplay();
    root.appendChild(priceDisplay);
    if (totalPriceEl) {
      priceInterval = setInterval(refreshPriceDisplay, 500);
    }

    // --- 결제 버튼 ---
    const payBtn = document.createElement('button');
    payBtn.type = 'button';
    payBtn.className = 'kiosk-pay-btn';
    payBtn.textContent = '신용카드 결제';
    payBtn.addEventListener('click', () => {
      payBtn.disabled = true;
      payBtn.textContent = '카드결제기 진행 중...';
      dispatchClick(payButtonEl, win);
      // 총 결제금액이 일정 금액(보통 5만원) 이상이면 실제 페이지가 할부
      // 개월수를 고르는 내부 팝업(일시불~6개월)을 띄운다. 그 팝업이
      // 나타나는지 잠시 지켜보다가, 나타나면 오버레이 화면에 같은 선택지를
      // 큼직하게 보여주고 손님이 고른 값을 실제 버튼 클릭으로 전달한다.
      waitForInstallmentButtons(doc).then((buttonsMap) => {
        if (buttonsMap) {
          showInstallmentPicker(doc, win, buttonsMap);
        }
      });
      setTimeout(() => {
        payBtn.disabled = false;
        payBtn.textContent = '신용카드 결제';
      }, 8000);
    });
    root.appendChild(payBtn);

    document.body.appendChild(root);
    overlayRoot = root;
    requestKioskFullscreen();
    setupHomeButton(iframe);
  }

  // 우측 상단의 눈에 잘 안 띄는 홈 버튼. 누르면 비밀번호를 물어보고, 맞으면
  // 오버레이를 완전히 걷어내고 전체화면도 해제해서 원래 통합운영시스템
  // 화면으로 돌아간다. 이후 이 iframe에 대해서는(같은 탭을 유지하는 한)
  // 오버레이가 자동으로 다시 뜨지 않는다 - 새로고침하거나 탭을 닫았다
  // 다시 열면 정상적으로 키오스크 모드가 다시 시작된다.
  function setupHomeButton(iframe) {
    const btn = document.createElement('button');
    btn.id = 'kiosk-home-btn';
    btn.type = 'button';
    btn.title = '홈';
    btn.textContent = '⌂';
    btn.addEventListener('click', () => {
      showPasswordKeypad(iframe);
    });
    document.body.appendChild(btn);
    homeBtn = btn;
  }

  // 물리 키보드가 없는 터치 전용 환경에서도 비밀번호를 입력할 수 있도록,
  // window.prompt() 대신 화면에 직접 숫자 키패드를 그려서 보여준다.
  function showPasswordKeypad(iframe) {
    const backdrop = document.createElement('div');
    backdrop.id = 'kiosk-keypad-backdrop';

    const card = document.createElement('div');
    card.id = 'kiosk-keypad-card';

    const title = document.createElement('div');
    title.className = 'kiosk-keypad-title';
    title.textContent = '비밀번호 입력';

    const display = document.createElement('div');
    display.className = 'kiosk-keypad-display';

    const errorMsg = document.createElement('div');
    errorMsg.className = 'kiosk-keypad-error';

    let entered = '';

    function renderDisplay() {
      display.textContent = entered.length > 0 ? '●'.repeat(entered.length) : ' ';
    }
    renderDisplay();

    function cleanup() {
      backdrop.remove();
    }

    const grid = document.createElement('div');
    grid.className = 'kiosk-keypad-grid';

    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '지우기', '0', '확인'].forEach((key) => {
      const keyBtn = document.createElement('button');
      keyBtn.type = 'button';
      keyBtn.className = 'kiosk-keypad-btn';
      if (key === '확인') keyBtn.classList.add('kiosk-keypad-confirm');
      if (key === '지우기') keyBtn.classList.add('kiosk-keypad-clear');
      keyBtn.textContent = key;

      keyBtn.addEventListener('click', () => {
        if (key === '지우기') {
          entered = entered.slice(0, -1);
          errorMsg.textContent = '';
        } else if (key === '확인') {
          if (entered === cfg.homeButton.password) {
            cleanup();
            suppressedIframe = iframe;
            teardownOverlay();
            exitKioskFullscreen();
            return;
          }
          errorMsg.textContent = '비밀번호가 올바르지 않습니다';
          entered = '';
        } else {
          entered += key;
          errorMsg.textContent = '';
        }
        renderDisplay();
      });

      grid.appendChild(keyBtn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'kiosk-keypad-cancel';
    cancelBtn.textContent = '취소';
    cancelBtn.addEventListener('click', cleanup);

    card.appendChild(title);
    card.appendChild(display);
    card.appendChild(errorMsg);
    card.appendChild(grid);
    card.appendChild(cancelBtn);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
  }

  function teardownOverlay() {
    if (priceInterval) {
      clearInterval(priceInterval);
      priceInterval = null;
    }
    if (overlayRoot) {
      overlayRoot.remove();
      overlayRoot = null;
    }
    if (homeBtn) {
      homeBtn.remove();
      homeBtn = null;
    }
    currentIframeDoc = null;
    pendingDoc = null;
  }

  async function tryActivate() {
    const iframe = findActiveTicketIframe();

    if (!iframe) {
      if (overlayRoot || currentIframeDoc || pendingDoc) teardownOverlay();
      return;
    }

    if (iframe === suppressedIframe) return; // 홈버튼으로 명시적으로 나간 상태, 자동 재진입 억제

    let doc;
    try {
      doc = iframe.contentDocument;
    } catch (e) {
      return;
    }
    if (!doc || doc.readyState === 'loading') return;

    if (doc === currentIframeDoc && overlayRoot) return; // 이미 구성됨, 유지
    if (doc === pendingDoc) return; // 이미 이 문서에 대해 초기화 시도 중

    teardownOverlay();
    currentIframeDoc = doc;
    pendingDoc = doc;

    try {
      const { rows, payButtonEl } = await waitForTicketUi(doc);

      if (pendingDoc !== doc) return; // 대기 중 다른 시도로 대체됨
      if (findActiveTicketIframe() !== iframe) return; // 그 사이 탭 전환됨

      const totalPriceEl = sel.totalPriceDisplay ? doc.querySelector(sel.totalPriceDisplay) : null;

      buildOverlay(doc, iframe.contentWindow, rows, payButtonEl, totalPriceEl, iframe);
    } catch (err) {
      console.error('[키오스크] 초기화 실패:', err.message);
      console.error('[키오스크] config.js의 selectors 값이 실제 페이지와 일치하는지 확인하세요.');
    } finally {
      if (pendingDoc === doc) pendingDoc = null;
    }
  }

  // 이 사이트는 dhtmlx가 계속 자잘한 DOM 변화(스타일/클래스 변경 등)를
  // 일으키는 편이라, "변화가 감지되면 250ms 뒤 확인"하는 순수 디바운스만
  // 쓰면 변화가 끊이지 않아 타이머가 계속 밀리면서 한 번도 실행되지 않는
  // 경우가 생길 수 있다(개발자도구를 열어 렌더링이 잠깐 멎어야만 그 틈에
  // 실행되는 현상으로 나타남). 그래서 디바운스와는 별도로 일정 주기마다
  // 무조건 한 번씩 확인하는 안전장치(폴링)를 같이 둔다. tryActivate()는
  // 상태가 그대로면 바로 리턴하는 가벼운 함수라 자주 불러도 부담 없다.
  let debounceTimer = null;
  function scheduleActivate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryActivate, 250);
  }

  const globalObserver = new MutationObserver(scheduleActivate);
  globalObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  setInterval(tryActivate, 500);

  tryActivate();
})();
