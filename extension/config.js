// ============================================================================
// 키오스크 설정 파일
// ============================================================================
window.KIOSK_CONFIG = {
  // ioms.foresttrip.go.kr은 로그인 후에도 URL이 "/main/init.do#"로 고정된 채
  // 좌측 메뉴를 누르면 dhtmlx 탭 안에 iframe으로 화면이 로드되는 구조다.
  // "입장권판매" 메뉴를 클릭하면 아래 패턴과 일치하는 src를 가진 iframe이
  // 생성되는데, 이 iframe이 "현재 활성 탭"으로 화면에 보일 때만 오버레이를
  // 띄운다. (탭을 다른 메뉴로 전환하면 이 iframe은 DOM에 남아있되
  // visibility:hidden 처리되므로, 그 상태는 활성으로 보지 않는다)
  //
  // 실제로 확인된 경로: /rep/sm/sm/sptMngmeSalInsertEN/init.do?openMenuId=REPS0100
  // 매표소별로 openMenuId 값 등이 다를 수 있으니, 실제 환경에서 다르면 이
  // 패턴을 조정하세요.
  ticketFrameSrcPattern: /\/rep\/sm\/sm\/sptMngmeSalInsertEN\//,

  // 키오스크에서는 팔지 않는 유형(직원 창구에서만 처리). 발매유형 이름이
  // 정확히 일치하면 오버레이 카드 목록에서 제외한다.
  excludedTypeNames: ['쉬자파크숙박', '유료프로그램이용', '백운봉휴양림숙박', '시설대관', '무료주차'],

  // 최소 구매 수량이 정해져 있는 단체 유형. 이 유형은:
  // - "＋"를 처음 누르면 0 → bulkMinQty(30)으로 바로 올라가고, 그 다음부터는 1씩 증가
  // - "－"를 눌렀을 때 결과가 bulkMinQty 미만이 되면 30에서 바로 0으로 내려간다
  //   (예: 30에서 － → 0. 31에서 － → 30)
  bulkTypeNames: ['단체(일반)', '단체(초중고학생)'],
  bulkMinQty: 30,
  bulkMaxQty: 200,

  selectors: {
    // 발매유형은 dhtmlx 그리드의 <tr> 한 줄로 렌더링되며, 실제 확인된 HTML은:
    //   <td>일반</td><td>2,000</td><td><font color="blue">－</font></td>
    //   <td style="display:none">0</td><td><font color="blue">＋</font></td>...
    // content.js는 절대 컬럼 번호가 아니라 "－/＋ 셀 기준 상대 위치"로 행을
    // 찾는다 (앞에 숨겨진 컬럼이 몇 개든 상관없이 동작하도록). "－"/"＋" 두
    // 글자 모두 반각/전각이 섞여 나올 수 있어 둘 다 인정한다.
    ticketRow: {
      decGlyphs: ['－', '-'],
      addGlyphs: ['＋', '+'],
    },

    // 한 손님이 한 유형을 몇 개까지 누를 수 있는지(오버레이 표시용 상한).
    // 실제 페이지 자체의 최대 인원/정원 제한은 그대로 별도로 동작한다
    // (초과 시 실제 페이지의 alert가 뜰 수 있음 - README 참고).
    quantityMax: 10,

    // 받을금액(현재 결제해야 할 금액)이 표시되는 dhtmlx 폼 입력창.
    // dhtmlx form의 input은 name 속성이 그대로 남아있어 일반 CSS 선택자로 찾을 수 있다.
    totalPriceDisplay: 'input[name="txtLvamt"]',

    // "신용카드" 결제 버튼. 실제 확인된 HTML:
    //   <a class="btn btn-info btn-outline writeBtn" onclick="fn_crcrdSttlm();">신용카드</a>
    payButton: 'a[onclick*="fn_crcrdSttlm"]',
  },

  // 직원 전용 탈출 제스처: 화면 좌상단 모서리를 정해진 횟수만큼 연속으로 터치하면
  // 비밀번호 입력창이 뜨고, 맞으면 오버레이가 해제되어 실제 페이지가 보입니다.
  staffExit: {
    tapCount: 5,
    tapWindowMs: 3000,
    // 운영 전에 반드시 변경하세요. (평문 저장이므로 강력한 보안이 필요하면
    // chrome.storage 해시 비교 등으로 교체 권장)
    password: 'CHANGE_ME',
  },
};
