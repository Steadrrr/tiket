// ============================================================================
// 키오스크 설정 파일
// 실제 발매 페이지의 URL / HTML 구조를 확인한 뒤 아래 TODO 항목을 채워주세요.
// (개발자도구 > Elements 탭에서 각 요소를 우클릭 > Copy > Copy selector 로
//  선택자를 뽑아 붙여넣으면 됩니다)
// ============================================================================
window.KIOSK_CONFIG = {
  // 이 정규식과 일치하는 URL(발매 페이지)에서만 키오스크 오버레이가 자동으로 켜집니다.
  // 로그인 페이지 등 다른 화면에서는 오버레이가 뜨지 않아 직원이 정상적으로
  // 공인인증서 로그인을 진행할 수 있습니다.
  // 예: /\/ticket\/issue/  또는  /\/reservation\/onsite/
  activatePathPattern: /TODO_발매페이지_경로_패턴/,

  selectors: {
    // 발매유형(입장권 종류)들을 감싸는 부모 컨테이너
    // 예: '.ticket-type-wrap', '#ticketTypeArea'
    ticketTypeContainer: 'TODO_발매유형_컨테이너_선택자',

    // 발매유형 컨테이너 안에서, 하나의 유형을 나타내는 개별 요소(라디오 input 또는 li/label 등)
    // 예: 'input[type=radio][name=ticketType]'
    ticketTypeOptionSelector: 'TODO_발매유형_개별항목_선택자',

    // 각 유형 항목에서 사람이 읽는 이름(성인/청소년 등)이 들어있는 텍스트 소스
    // - 'label': 항목과 연결된 <label> 텍스트 사용
    // - 'text': 항목 자신의 textContent 사용
    // - 'value': 항목의 value 속성 사용
    ticketTypeLabelSource: 'label',

    // 수량 입력창 (input[type=number] 또는 input[type=text])
    quantityInput: 'TODO_수량_입력창_선택자',

    // 수량 +/- 버튼이 이미 페이지에 있다면 선택자를 지정 (없으면 null로 두고
    // 오버레이 자체 +/- 버튼이 quantityInput 값을 직접 바꿉니다)
    quantityIncrementButton: null,
    quantityDecrementButton: null,

    // 수량 제한 (실제 페이지의 min/max와 동일하게 맞춰주세요)
    quantityMin: 1,
    quantityMax: 10,

    // 총 결제금액이 표시되는 요소 (있으면 오버레이에 실시간으로 그대로 보여줍니다)
    totalPriceDisplay: null,

    // "신용카드" 결제 버튼
    payButton: 'TODO_신용카드_결제버튼_선택자',
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
