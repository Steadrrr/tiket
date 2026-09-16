// ============================================================================
// 발매 페이지를 감싸는 키오스크 오버레이
//
// 동작 방식:
// 1) config.js의 activatePathPattern과 현재 URL이 일치할 때만 동작한다.
// 2) 실제 페이지의 발매유형/수량/결제버튼 요소를 찾을 때까지 기다린다.
// 3) 화면 전체를 덮는 단순한 터치 UI(오버레이)를 만든다.
// 4) 오버레이에서의 조작은 항상 "실제 페이지의 요소 값을 바꾸고 진짜 이벤트를
//    발생시키는" 방식으로 처리한다 (원본 페이지의 로직/세션/보안을 그대로 사용).
// 5) 실제 페이지는 오버레이 뒤에 그대로 남아있고, 오버레이가 화면을 덮어
//    직원 전용 탈출 제스처 전까지는 보이지도 눌리지도 않는다.
// ============================================================================
(function () {
  const cfg = window.KIOSK_CONFIG;
  if (!cfg) return;

  if (!cfg.activatePathPattern || !cfg.activatePathPattern.test(location.href)) {
    // 발매 페이지가 아니면(예: 로그인 화면) 아무것도 하지 않고 실제 화면을 그대로 노출.
    return;
  }

  const sel = cfg.selectors;

  function waitForElement(selector, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

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

  function readOptionLabel(optionEl) {
    switch (sel.ticketTypeLabelSource) {
      case 'text':
        return optionEl.textContent.trim();
      case 'value':
        return optionEl.value;
      case 'label':
      default: {
        if (optionEl.id) {
          const labelEl = document.querySelector(`label[for="${CSS.escape(optionEl.id)}"]`);
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

  function setRealQuantity(inputEl, value) {
    const clamped = Math.min(sel.quantityMax, Math.max(sel.quantityMin, value));
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(inputEl, String(clamped));
    dispatchRealEvents(inputEl, ['input', 'change']);
    return clamped;
  }

  function buildOverlay(ticketTypeOptions, quantityInputEl, payButtonEl, totalPriceEl) {
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
      btn.textContent = readOptionLabel(optionEl);
      btn.addEventListener('click', () => {
        selectRealTicketType(optionEl);
        if (selectedButton) selectedButton.classList.remove('selected');
        btn.classList.add('selected');
        selectedButton = btn;
      });
      typeGrid.appendChild(btn);
      if (idx === 0) {
        // 기본 선택값을 실제 페이지 상태와 맞춰줌
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
      currentQty = setRealQuantity(quantityInputEl, next);
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
    let priceDisplay = null;
    if (totalPriceEl) {
      priceDisplay = document.createElement('div');
      priceDisplay.className = 'kiosk-price';
      priceDisplay.textContent = totalPriceEl.textContent.trim();
      root.appendChild(priceDisplay);

      new MutationObserver(() => {
        priceDisplay.textContent = totalPriceEl.textContent.trim();
      }).observe(totalPriceEl, { characterData: true, childList: true, subtree: true });
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
      // 결제기 처리 중 중복 클릭 방지. 완료/취소 후 다음 손님을 위해 초기화.
      setTimeout(() => {
        payBtn.disabled = false;
        payBtn.textContent = '신용카드 결제';
      }, 8000);
    });
    root.appendChild(payBtn);

    document.body.appendChild(root);
    setupStaffExit(root);
  }

  function setupStaffExit(overlayRoot) {
    const cornerZone = document.createElement('div');
    cornerZone.id = 'kiosk-staff-exit-zone';
    document.body.appendChild(cornerZone);

    let taps = 0;
    let windowTimer = null;

    cornerZone.addEventListener('click', () => {
      taps += 1;
      if (windowTimer) clearTimeout(windowTimer);
      windowTimer = setTimeout(() => {
        taps = 0;
      }, cfg.staffExit.tapWindowMs);

      if (taps >= cfg.staffExit.tapCount) {
        taps = 0;
        const input = window.prompt('직원 비밀번호를 입력하세요');
        if (input === cfg.staffExit.password) {
          overlayRoot.style.display = 'none';
          cornerZone.style.display = 'none';
        }
      }
    });
  }

  async function init() {
    try {
      const [quantityInputEl, payButtonEl] = await Promise.all([
        waitForElement(sel.quantityInput),
        waitForElement(sel.payButton),
      ]);
      await waitForElement(sel.ticketTypeContainer);

      const container = document.querySelector(sel.ticketTypeContainer);
      const ticketTypeOptions = Array.from(container.querySelectorAll(sel.ticketTypeOptionSelector));
      if (ticketTypeOptions.length === 0) {
        console.error('[키오스크] 발매유형 항목을 찾지 못했습니다. config.js의 선택자를 확인하세요.');
        return;
      }

      const totalPriceEl = sel.totalPriceDisplay ? document.querySelector(sel.totalPriceDisplay) : null;

      buildOverlay(ticketTypeOptions, quantityInputEl, payButtonEl, totalPriceEl);
    } catch (err) {
      console.error('[키오스크] 초기화 실패:', err.message);
      console.error('[키오스크] config.js의 selectors 값이 실제 페이지와 일치하는지 확인하세요.');
    }
  }

  init();
})();
