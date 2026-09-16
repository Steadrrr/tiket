// ============================================================================
// 발매 페이지를 감싸는 키오스크 오버레이
//
// ioms.foresttrip.go.kr은 로그인 후에도 최상위 URL이 "/main/init.do#"로
// 고정된 채, 좌측 메뉴를 클릭하면 dhtmlx 탭 안에 iframe으로 화면이 로드되는
// 구조다 (SPA형 MDI). 그래서 이 확장은:
//
// 1) 최상위(top) 프레임에서만 동작한다 (manifest에서 all_frames: false).
// 2) config.js의 ticketFrameSrcPattern과 src가 일치하면서 "현재 화면에
//    보이는(visible)" iframe을 계속 찾는다. (같은 src의 iframe이 탭
//    전환으로 숨겨진 채 DOM에 남아있을 수 있기 때문)
// 3) 그 iframe이 활성 상태가 되면, iframe.contentDocument 안에서 발매유형/
//    수량/결제버튼 요소를 찾아 최상위 문서 위에 전체화면 오버레이를 만든다.
// 4) 오버레이의 조작은 항상 iframe 내부의 진짜 요소 값을 바꾸고 진짜
//    이벤트를 발생시키는 방식으로 처리한다 (로그인 세션/결제 로직은 그대로).
// 5) 메뉴 탭이 바뀌거나 닫히면(= 발매 화면이 더 이상 보이지 않으면) 오버레이를
//    자동으로 걷어내서, 다른 업무(환불, 매표소변경 등)는 평소처럼 쓸 수 있다.
// ============================================================================
(function () {
  const cfg = window.KIOSK_CONFIG;
  if (!cfg) return;
  if (window.top !== window.self) return; // 최상위 문서에서만 실행

  const sel = cfg.selectors;

  let overlayRoot = null;
  let staffExitZone = null;
  let reengageBtn = null;
  let currentIframeDoc = null;
  let activeTeardown = null;

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

  function waitForElementIn(doc, selector, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const existing = doc.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = doc.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`요소를 찾지 못했습니다: ${selector}`));
      }, timeoutMs);
    });
  }

  function dispatchRealEvents(el, types) {
    types.forEach((type) => {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  function readOptionLabel(doc, optionEl) {
    switch (sel.ticketTypeLabelSource) {
      case 'text':
        return optionEl.textContent.trim();
      case 'value':
        return optionEl.value;
      case 'label':
      default: {
        if (optionEl.id) {
          const labelEl = doc.querySelector(`label[for="${CSS.escape(optionEl.id)}"]`);
          if (labelEl) return labelEl.textContent.trim();
        }
        const parentLabel = optionEl.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();
        return optionEl.textContent.trim() || optionEl.value || '옵션';
      }
    }
  }

  function selectRealTicketType(optionEl) {
    if (optionEl.tagName === 'INPUT' && (optionEl.type === 'radio' || optionEl.type === 'checkbox')) {
      optionEl.checked = true;
      dispatchRealEvents(optionEl, ['input', 'change', 'click']);
    } else if (optionEl.tagName === 'OPTION') {
      const selectEl = optionEl.closest('select');
      if (selectEl) {
        selectEl.value = optionEl.value;
        dispatchRealEvents(selectEl, ['input', 'change']);
      }
    } else {
      optionEl.click();
    }
  }

  function setRealQuantity(win, inputEl, value) {
    const clamped = Math.min(sel.quantityMax, Math.max(sel.quantityMin, value));
    const nativeSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(inputEl, String(clamped));
    dispatchRealEvents(inputEl, ['input', 'change']);
    return clamped;
  }

  function buildOverlay(doc, win, ticketTypeOptions, quantityInputEl, payButtonEl, totalPriceEl) {
    const root = document.createElement('div');
    root.id = 'kiosk-overlay-root';

    const title = document.createElement('div');
    title.className = 'kiosk-title';
    title.textContent = '입장권 발매';
    root.appendChild(title);

    // --- 발매유형 선택 ---
    const typeSection = document.createElement('div');
    typeSection.className = 'kiosk-section';
    const typeLabel = document.createElement('div');
    typeLabel.className = 'kiosk-section-label';
    typeLabel.textContent = '발매 유형 선택';
    typeSection.appendChild(typeLabel);

    const typeGrid = document.createElement('div');
    typeGrid.className = 'kiosk-type-grid';

    let selectedButton = null;
    ticketTypeOptions.forEach((optionEl, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kiosk-type-btn';
      btn.textContent = readOptionLabel(doc, optionEl);
      btn.addEventListener('click', () => {
        selectRealTicketType(optionEl);
        if (selectedButton) selectedButton.classList.remove('selected');
        btn.classList.add('selected');
        selectedButton = btn;
      });
      typeGrid.appendChild(btn);
      if (idx === 0) {
        btn.classList.add('selected');
        selectedButton = btn;
      }
    });
    typeSection.appendChild(typeGrid);
    root.appendChild(typeSection);

    // --- 수량 선택 ---
    const qtySection = document.createElement('div');
    qtySection.className = 'kiosk-section';
    const qtyLabel = document.createElement('div');
    qtyLabel.className = 'kiosk-section-label';
    qtyLabel.textContent = '수량 선택';
    qtySection.appendChild(qtyLabel);

    const qtyControl = document.createElement('div');
    qtyControl.className = 'kiosk-qty-control';

    let currentQty = Number(quantityInputEl.value) || sel.quantityMin;

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'kiosk-qty-btn';
    minusBtn.textContent = '－';

    const qtyDisplay = document.createElement('div');
    qtyDisplay.className = 'kiosk-qty-display';
    qtyDisplay.textContent = currentQty;

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'kiosk-qty-btn';
    plusBtn.textContent = '＋';

    function refreshQty(next) {
      currentQty = setRealQuantity(win, quantityInputEl, next);
      qtyDisplay.textContent = currentQty;
    }

    minusBtn.addEventListener('click', () => refreshQty(currentQty - 1));
    plusBtn.addEventListener('click', () => refreshQty(currentQty + 1));

    qtyControl.appendChild(minusBtn);
    qtyControl.appendChild(qtyDisplay);
    qtyControl.appendChild(plusBtn);
    qtySection.appendChild(qtyControl);
    root.appendChild(qtySection);

    // --- 총액 표시(선택) ---
    let priceObserver = null;
    if (totalPriceEl) {
      const priceDisplay = document.createElement('div');
      priceDisplay.className = 'kiosk-price';
      priceDisplay.textContent = totalPriceEl.textContent.trim();
      root.appendChild(priceDisplay);

      priceObserver = new MutationObserver(() => {
        priceDisplay.textContent = totalPriceEl.textContent.trim();
      });
      priceObserver.observe(totalPriceEl, { characterData: true, childList: true, subtree: true });
    }

    // --- 결제 버튼 ---
    const payBtn = document.createElement('button');
    payBtn.type = 'button';
    payBtn.className = 'kiosk-pay-btn';
    payBtn.textContent = '신용카드 결제';
    payBtn.addEventListener('click', () => {
      payBtn.disabled = true;
      payBtn.textContent = '카드결제기 진행 중...';
      payButtonEl.click();
      setTimeout(() => {
        payBtn.disabled = false;
        payBtn.textContent = '신용카드 결제';
      }, 8000);
    });
    root.appendChild(payBtn);

    document.body.appendChild(root);
    overlayRoot = root;
    setupStaffExit();

    return () => {
      if (priceObserver) priceObserver.disconnect();
    };
  }

  function setupStaffExit() {
    const zone = document.createElement('div');
    zone.id = 'kiosk-staff-exit-zone';
    document.body.appendChild(zone);
    staffExitZone = zone;

    const btn = document.createElement('button');
    btn.id = 'kiosk-reengage-btn';
    btn.type = 'button';
    btn.textContent = '키오스크 모드로 복귀';
    btn.style.display = 'none';
    btn.addEventListener('click', () => {
      if (overlayRoot) overlayRoot.style.display = '';
      zone.style.display = '';
      btn.style.display = 'none';
    });
    document.body.appendChild(btn);
    reengageBtn = btn;

    let taps = 0;
    let windowTimer = null;

    zone.addEventListener('click', () => {
      taps += 1;
      if (windowTimer) clearTimeout(windowTimer);
      windowTimer = setTimeout(() => {
        taps = 0;
      }, cfg.staffExit.tapWindowMs);

      if (taps >= cfg.staffExit.tapCount) {
        taps = 0;
        const input = window.prompt('직원 비밀번호를 입력하세요');
        if (input === cfg.staffExit.password) {
          if (overlayRoot) overlayRoot.style.display = 'none';
          zone.style.display = 'none';
          btn.style.display = '';
        }
      }
    });
  }

  function teardownOverlay() {
    if (activeTeardown) {
      activeTeardown();
      activeTeardown = null;
    }
    if (overlayRoot) {
      overlayRoot.remove();
      overlayRoot = null;
    }
    if (staffExitZone) {
      staffExitZone.remove();
      staffExitZone = null;
    }
    if (reengageBtn) {
      reengageBtn.remove();
      reengageBtn = null;
    }
    currentIframeDoc = null;
  }

  async function tryActivate() {
    const iframe = findActiveTicketIframe();

    if (!iframe) {
      if (overlayRoot || currentIframeDoc) teardownOverlay();
      return;
    }

    let doc;
    try {
      doc = iframe.contentDocument;
    } catch (e) {
      return; // 접근 불가(다른 오리진 등) - 발생하면 안 되지만 방어적으로 무시
    }
    if (!doc || doc.readyState === 'loading') return;

    if (doc === currentIframeDoc && overlayRoot) return; // 이미 구성됨, 유지

    teardownOverlay();
    currentIframeDoc = doc;

    try {
      const [quantityInputEl, payButtonEl] = await Promise.all([
        waitForElementIn(doc, sel.quantityInput),
        waitForElementIn(doc, sel.payButton),
      ]);
      const container = await waitForElementIn(doc, sel.ticketTypeContainer);

      // 그 사이 탭이 전환되어 버렸다면 중단
      if (findActiveTicketIframe() !== iframe) return;

      const ticketTypeOptions = Array.from(container.querySelectorAll(sel.ticketTypeOptionSelector));
      if (ticketTypeOptions.length === 0) {
        console.error('[키오스크] 발매유형 항목을 찾지 못했습니다. config.js의 선택자를 확인하세요.');
        return;
      }

      const totalPriceEl = sel.totalPriceDisplay ? doc.querySelector(sel.totalPriceDisplay) : null;

      activeTeardown = buildOverlay(
        doc,
        iframe.contentWindow,
        ticketTypeOptions,
        quantityInputEl,
        payButtonEl,
        totalPriceEl
      );
    } catch (err) {
      console.error('[키오스크] 초기화 실패:', err.message);
      console.error('[키오스크] config.js의 selectors 값이 실제 페이지와 일치하는지 확인하세요.');
    }
  }

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

  tryActivate();
})();
