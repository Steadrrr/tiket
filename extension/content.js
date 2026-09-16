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
  let staffExitZone = null;
  let reengageBtn = null;
  let currentIframeDoc = null;
  let pendingDoc = null; // 현재 초기화 시도 중인 iframe 문서(중복 시도 방지용)
  let priceInterval = null;

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

  function buildOverlay(doc, win, rows, payButtonEl, totalPriceEl) {
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
      setTimeout(() => {
        payBtn.disabled = false;
        payBtn.textContent = '신용카드 결제';
      }, 8000);
    });
    root.appendChild(payBtn);

    document.body.appendChild(root);
    overlayRoot = root;
    setupStaffExit();
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
    if (priceInterval) {
      clearInterval(priceInterval);
      priceInterval = null;
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
    pendingDoc = null;
  }

  async function tryActivate() {
    const iframe = findActiveTicketIframe();

    if (!iframe) {
      if (overlayRoot || currentIframeDoc || pendingDoc) teardownOverlay();
      return;
    }

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

      buildOverlay(doc, iframe.contentWindow, rows, payButtonEl, totalPriceEl);
    } catch (err) {
      console.error('[키오스크] 초기화 실패:', err.message);
      console.error('[키오스크] config.js의 selectors 값이 실제 페이지와 일치하는지 확인하세요.');
    } finally {
      if (pendingDoc === doc) pendingDoc = null;
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
