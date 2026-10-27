/**
 * 감지기 생산현황 관리 시스템 - 코어 비즈니스 로직
 * (Google Firebase Firestore 실시간 연동, 스프레드시트 키보드 내비게이션, 품명 분리/동기화)
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Firebase Cloud Firestore 설정 (detectorDB)
  // =========================================================================
  const firebaseConfig = {
    apiKey: "AIzaSyDw5xFYRJnA4tQF5k6WM2hs0DDv60ad0bo",
    authDomain: "detectordb-c9771.firebaseapp.com",
    projectId: "detectordb-c9771",
    storageBucket: "detectordb-c9771.firebasestorage.app",
    messagingSenderId: "381997617419",
    appId: "1:381997617419:web:6abf156bb56bfd71ae520e",
    measurementId: "G-F528310ENY"
  };

  let db = null;
  let isFirestoreActive = false;

  // 실시간 Firestore 구독 해제 핸들러
  let unsubscribeInspection = null;
  let unsubscribeProduction = null;
  let unsubscribeMasterInspItems = null;
  let unsubscribeMasterProdItems = null;
  let unsubscribeMasterWorkers = null;

  // 디바운스 타이머
  let saveInspectionDebounceTimer = null;
  let saveProductionDebounceTimer = null;

  // 로컬 저장소 키
  const STORAGE_KEYS = {
    INSP_ITEMS: 'pms_insp_items_v3',
    PROD_ITEMS: 'pms_prod_items_v3',
    WORKERS: 'pms_workers_v3',
    LAST_INSP_DATE: 'pms_last_insp_date_v3',
    LAST_PROD_DATE: 'pms_last_prod_date_v3',
    VIEW_MODE: 'pms_view_mode_v3',
    INSPECTION_PREFIX: 'pms_insp_data_v3_',
    PRODUCTION_PREFIX: 'pms_prod_data_v3_'
  };

  // 기본 품목
  const DEFAULT_ITEMS = [
    { id: 'item_1', name: '광전식 스포트형 감지기 (1종)' },
    { id: 'item_2', name: '광전식 스포트형 감지기 (2종)' },
    { id: 'item_3', name: '차동식 스포트형 감지기 (2종)' },
    { id: 'item_4', name: '정온식 스포트형 감지기 (특종)' },
    { id: 'item_5', name: '정온식 스포트형 감지기 (1종)' },
    { id: 'item_6', name: '자외선/적외선 불꽃감지기' },
    { id: 'item_7', name: '아날로그식 복합형 감지기' },
    { id: 'item_8', name: '방폭형 열감지기' }
  ];

  // 기본 작업자
  const DEFAULT_WORKERS = [
    { id: 'worker_1', name: '김철수' },
    { id: 'worker_2', name: '이영희' },
    { id: 'worker_3', name: '박민수' },
    { id: 'worker_4', name: '정수진' },
    { id: 'worker_5', name: '최동욱' },
    { id: 'worker_6', name: '강현우' }
  ];

  const DAYS_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  // =========================================================================
  // 2. 전역 상태 (State)
  // =========================================================================
  const state = {
    currentTab: 'tab-inspection',
    // 자동 리셋 방지: 마지막 작업 일자 유지 (없으면 오늘)
    inspectionDate: localStorage.getItem(STORAGE_KEYS.LAST_INSP_DATE) || getTodayDateString(),
    productionDate: localStorage.getItem(STORAGE_KEYS.LAST_PROD_DATE) || getTodayDateString(),
    viewMode: localStorage.getItem(STORAGE_KEYS.VIEW_MODE) || 'default',
    inspItems: [], // 생산현황용 품목
    prodItems: [], // 생산일정용 품목
    workers: [],   // 작업자
    inspectionData: { process: {}, assembly: {} },
    productionRows: []
  };

  let toastTimer = null;

  // =========================================================================
  // 3. 유틸리티 함수
  // =========================================================================
  function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatDateObj(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d;
  }

  // 0 값은 빈칸("")으로 표시
  function formatNumberDisplay(num) {
    if (num === null || num === undefined || isNaN(num) || num === '' || Number(num) === 0) {
      return '';
    }
    return Number(num).toLocaleString('ko-KR');
  }

  function parseSafeInt(val) {
    if (val === '' || val === null || val === undefined) return 0;
    const parsed = parseInt(String(val).replace(/,/g, ''), 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  function parseSafeFloat(val) {
    if (val === '' || val === null || val === undefined) return 0;
    const parsed = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }

  function generateUniqueId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  // 로트번호 자동완성 (예: '1' 입력 시 '26-001'로 스마트 변환)
  function formatSmartLotNumber(val) {
    if (!val) return '';
    let raw = String(val).trim().toUpperCase();

    // 사용자가 순수 숫자만 입력한 경우 (예: "1", "15", "102")
    if (/^\d+$/.test(raw)) {
      const currentYear = new Date().getFullYear();
      const yy = String(currentYear).slice(-2);
      const paddedNum = String(parseInt(raw, 10)).padStart(3, '0');
      return `${yy}-${paddedNum}`;
    }

    // 이미 "YY-숫자" 형태인 경우 유지
    if (/^\d{2}-\d+$/.test(raw)) {
      const parts = raw.split('-');
      return `${parts[0]}-${parts[1].padStart(3, '0')}`;
    }

    return raw;
  }

  // =========================================================================
  // 4. Toast 알림 및 상태 인디케이터
  // =========================================================================
  function showToast(message = '저장되었습니다') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    const toastTimestamp = document.getElementById('toast-timestamp');
    if (!toast) return;

    if (toastMsg) toastMsg.textContent = message;
    if (toastTimestamp) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      toastTimestamp.textContent = `${timeStr} 클라우드 저장`;
    }

    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      toastTimer = null;
    }, 1500);
  }

  function updateDbStatus(isConnected, message) {
    const badge = document.getElementById('db-status-badge');
    const dot = document.getElementById('db-status-dot');
    const text = document.getElementById('db-status-text');

    if (text) text.textContent = message;
    if (dot) dot.style.backgroundColor = isConnected ? '#10b981' : '#f59e0b';
    if (badge) {
      badge.style.backgroundColor = isConnected ? '#ecfdf5' : '#fffbeb';
      badge.style.borderColor = isConnected ? '#a7f3d0' : '#fde68a';
    }
  }

  function updateDateStatusPills() {
    // 생산현황 날짜 데이터 유무 상태 표시
    const inspPill = document.getElementById('insp-date-status-pill');
    if (inspPill) {
      const hasInspData = (state.inspectionData.process && Object.keys(state.inspectionData.process).length > 0) ||
                          (state.inspectionData.assembly && Object.keys(state.inspectionData.assembly).length > 0);
      if (hasInspData) {
        inspPill.textContent = '● 데이터 저장됨';
        inspPill.className = 'date-status-pill has-data';
      } else {
        inspPill.textContent = '○ 새 날짜';
        inspPill.className = 'date-status-pill no-data';
      }
    }

    // 생산일정 날짜 데이터 유무 상태 표시
    const prodPill = document.getElementById('prod-date-status-pill');
    if (prodPill) {
      const hasProdData = state.productionRows && state.productionRows.some(r => r.qty > 0 || r.lotNo || r.note);
      if (hasProdData) {
        prodPill.textContent = '● 데이터 저장됨';
        prodPill.className = 'date-status-pill has-data';
      } else {
        prodPill.textContent = '○ 새 날짜';
        prodPill.className = 'date-status-pill no-data';
      }
    }
  }

  // =========================================================================
  // 5. Firebase Cloud Firestore 실시간 동기화
  // =========================================================================
  function initFirebase() {
    if (typeof firebase !== 'undefined' && firebase.initializeApp) {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        isFirestoreActive = true;
        updateDbStatus(true, 'Firestore 실시간 연결됨 (detectorDB)');

        subscribeMasterData();
        subscribeInspectionData(state.inspectionDate);
        subscribeProductionData(state.productionDate);
      } catch (err) {
        console.warn('Firebase 초기화 실패, 로컬 모드로 작동합니다:', err);
        fallbackToLocal();
      }
    } else {
      fallbackToLocal();
    }
  }

  function fallbackToLocal() {
    isFirestoreActive = false;
    updateDbStatus(false, '로컬 모드 (오프라인)');
    loadLocalMasterData();
    loadLocalInspectionData(state.inspectionDate);
    loadLocalProductionData(state.productionDate);
    renderAll();
  }

  // --- 마스터 데이터 분리 구독 (생산현황 품목 / 생산일정 품목 / 작업자) ---
  function subscribeMasterData() {
    if (!isFirestoreActive || !db) return;

    // 1. 생산현황 품목
    const inspItemsRef = db.collection('pms_metadata').doc('inspection_items');
    unsubscribeMasterInspItems = inspItemsRef.onSnapshot((doc) => {
      if (doc.exists && Array.isArray(doc.data().items)) {
        state.inspItems = doc.data().items;
      } else {
        state.inspItems = [...DEFAULT_ITEMS];
        inspItemsRef.set({ items: state.inspItems });
      }
      localStorage.setItem(STORAGE_KEYS.INSP_ITEMS, JSON.stringify(state.inspItems));
      renderMasterInspItems();
      renderInspectionTable();
    }, () => loadLocalMasterData());

    // 2. 생산일정 품목
    const prodItemsRef = db.collection('pms_metadata').doc('production_items');
    unsubscribeMasterProdItems = prodItemsRef.onSnapshot((doc) => {
      if (doc.exists && Array.isArray(doc.data().items)) {
        state.prodItems = doc.data().items;
      } else {
        state.prodItems = [...DEFAULT_ITEMS];
        prodItemsRef.set({ items: state.prodItems });
      }
      localStorage.setItem(STORAGE_KEYS.PROD_ITEMS, JSON.stringify(state.prodItems));
      renderMasterProdItems();
      renderProductionTable();
    }, () => loadLocalMasterData());

    // 3. 작업자
    const workersRef = db.collection('pms_metadata').doc('master_workers');
    unsubscribeMasterWorkers = workersRef.onSnapshot((doc) => {
      if (doc.exists && Array.isArray(doc.data().workers)) {
        state.workers = doc.data().workers;
      } else {
        state.workers = [...DEFAULT_WORKERS];
        workersRef.set({ workers: state.workers });
      }
      localStorage.setItem(STORAGE_KEYS.WORKERS, JSON.stringify(state.workers));
      renderMasterWorkers();
      renderProductionTable();
    }, () => loadLocalMasterData());
  }

  function saveInspItems(triggerToast = true) {
    localStorage.setItem(STORAGE_KEYS.INSP_ITEMS, JSON.stringify(state.inspItems));
    if (isFirestoreActive && db) {
      db.collection('pms_metadata').doc('inspection_items').set({ items: state.inspItems });
    }
    if (triggerToast) showToast('생산현황 품목이 저장되었습니다');
  }

  function saveProdItems(triggerToast = true) {
    localStorage.setItem(STORAGE_KEYS.PROD_ITEMS, JSON.stringify(state.prodItems));
    if (isFirestoreActive && db) {
      db.collection('pms_metadata').doc('production_items').set({ items: state.prodItems });
    }
    if (triggerToast) showToast('생산일정 품목이 저장되었습니다');
  }

  function saveWorkers(triggerToast = true) {
    localStorage.setItem(STORAGE_KEYS.WORKERS, JSON.stringify(state.workers));
    if (isFirestoreActive && db) {
      db.collection('pms_metadata').doc('master_workers').set({ workers: state.workers });
    }
    if (triggerToast) showToast('작업자 목록이 저장되었습니다');
  }

  function loadLocalMasterData() {
    try {
      const rawInsp = localStorage.getItem(STORAGE_KEYS.INSP_ITEMS);
      state.inspItems = rawInsp ? JSON.parse(rawInsp) : [...DEFAULT_ITEMS];

      const rawProd = localStorage.getItem(STORAGE_KEYS.PROD_ITEMS);
      state.prodItems = rawProd ? JSON.parse(rawProd) : [...DEFAULT_ITEMS];

      const rawWk = localStorage.getItem(STORAGE_KEYS.WORKERS);
      state.workers = rawWk ? JSON.parse(rawWk) : [...DEFAULT_WORKERS];
    } catch (e) {
      state.inspItems = [...DEFAULT_ITEMS];
      state.prodItems = [...DEFAULT_ITEMS];
      state.workers = [...DEFAULT_WORKERS];
    }
  }

  // --- 생산현황 (구 검정일정) 데이터 동기화 ---
  function subscribeInspectionData(dateStr) {
    localStorage.setItem(STORAGE_KEYS.LAST_INSP_DATE, dateStr);

    if (!isFirestoreActive || !db) {
      loadLocalInspectionData(dateStr);
      renderInspectionTable();
      updateDateStatusPills();
      return;
    }

    if (unsubscribeInspection) unsubscribeInspection();

    const docRef = db.collection('pms_inspection').doc(dateStr);
    unsubscribeInspection = docRef.onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        state.inspectionData = {
          process: data.process || {},
          assembly: data.assembly || {}
        };
      } else {
        state.inspectionData = { process: {}, assembly: {} };
      }
      localStorage.setItem(STORAGE_KEYS.INSPECTION_PREFIX + dateStr, JSON.stringify(state.inspectionData));

      const activeEl = document.activeElement;
      if (!activeEl || (!activeEl.classList.contains('input-daily-qty') && !activeEl.classList.contains('input-weekly-qty'))) {
        renderInspectionTable();
      } else {
        updateAllInspectionCalculations();
      }
      updateDateStatusPills();
    }, () => {
      loadLocalInspectionData(dateStr);
      renderInspectionTable();
      updateDateStatusPills();
    });
  }

  function saveInspectionData(triggerToast = true) {
    localStorage.setItem(STORAGE_KEYS.INSPECTION_PREFIX + state.inspectionDate, JSON.stringify(state.inspectionData));
    if (triggerToast) showToast('클라우드 DB에 저장되었습니다');

    if (isFirestoreActive && db) {
      if (saveInspectionDebounceTimer) clearTimeout(saveInspectionDebounceTimer);
      saveInspectionDebounceTimer = setTimeout(() => {
        db.collection('pms_inspection').doc(state.inspectionDate).set({
          process: state.inspectionData.process || {},
          assembly: state.inspectionData.assembly || {},
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        updateDateStatusPills();
      }, 300);
    }
  }

  function loadLocalInspectionData(dateStr) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.INSPECTION_PREFIX + dateStr);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.inspectionData = {
          process: parsed.process || parsed || {},
          assembly: parsed.assembly || {}
        };
      } else {
        state.inspectionData = { process: {}, assembly: {} };
      }
    } catch (e) {
      state.inspectionData = { process: {}, assembly: {} };
    }
  }

  // --- 생산 일정 데이터 동기화 ---
  function subscribeProductionData(dateStr) {
    localStorage.setItem(STORAGE_KEYS.LAST_PROD_DATE, dateStr);

    if (!isFirestoreActive || !db) {
      loadLocalProductionData(dateStr);
      renderProductionTable();
      updateDateStatusPills();
      return;
    }

    if (unsubscribeProduction) unsubscribeProduction();

    const docRef = db.collection('pms_production').doc(dateStr);
    unsubscribeProduction = docRef.onSnapshot((doc) => {
      if (doc.exists && Array.isArray(doc.data().rows)) {
        state.productionRows = doc.data().rows;
      } else {
        state.productionRows = [createDefaultProductionRow()];
      }
      localStorage.setItem(STORAGE_KEYS.PRODUCTION_PREFIX + dateStr, JSON.stringify(state.productionRows));

      const activeEl = document.activeElement;
      if (!activeEl || (!activeEl.classList.contains('input-prod-qty') && !activeEl.classList.contains('input-worker-hour') && !activeEl.classList.contains('input-prod-lot') && !activeEl.classList.contains('input-prod-note'))) {
        renderProductionTable();
      } else {
        calculateProductionTotals();
      }
      updateDateStatusPills();
    }, () => {
      loadLocalProductionData(dateStr);
      renderProductionTable();
      updateDateStatusPills();
    });
  }

  function saveProductionData(triggerToast = true) {
    localStorage.setItem(STORAGE_KEYS.PRODUCTION_PREFIX + state.productionDate, JSON.stringify(state.productionRows));
    if (triggerToast) showToast('클라우드 DB에 저장되었습니다');

    if (isFirestoreActive && db) {
      if (saveProductionDebounceTimer) clearTimeout(saveProductionDebounceTimer);
      saveProductionDebounceTimer = setTimeout(() => {
        db.collection('pms_production').doc(state.productionDate).set({
          rows: state.productionRows,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        updateDateStatusPills();
      }, 300);
    }
  }

  function loadLocalProductionData(dateStr) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PRODUCTION_PREFIX + dateStr);
      if (raw) {
        state.productionRows = JSON.parse(raw);
      } else {
        state.productionRows = [createDefaultProductionRow()];
      }
    } catch (e) {
      state.productionRows = [createDefaultProductionRow()];
    }
  }

  // 행 추가 시 로트번호는 '빈칸'으로 시작
  function createDefaultProductionRow() {
    const firstItemId = state.prodItems.length > 0 ? state.prodItems[0].id : '';
    return {
      id: generateUniqueId('prod_row'),
      itemId: firstItemId,
      note: '',      // 신규 '비고' 필드
      lotNo: '',     // 기본 빈칸
      qty: 0,
      workerHours: {}
    };
  }

  // =========================================================================
  // 6. 탭 1: [생산현황] 렌더링 및 계산 (오프셋 버그 수정 & 토/일 잠금)
  // =========================================================================
  const INSPECTION_SECTIONS = [
    {
      key: 'process',
      title: '공정검사',
      tbodyId: 'inspection-process-tbody',
      headerDatesId: 'inspection-process-date-headers',
      tfootId: 'inspection-process-tfoot',
      sumWeeklyId: 'sum-insp-process-weekly',
      sumCompletedId: 'sum-insp-process-completed',
      sumBalanceId: 'sum-insp-process-balance',
      pillWeeklyId: 'pill-insp-process-weekly',
      pillCompletedId: 'pill-insp-process-completed',
      pillBalanceId: 'pill-insp-process-balance'
    },
    {
      key: 'assembly',
      title: '자동화조립',
      tbodyId: 'inspection-assembly-tbody',
      headerDatesId: 'inspection-assembly-date-headers',
      tfootId: 'inspection-assembly-tfoot',
      sumWeeklyId: 'sum-insp-assembly-weekly',
      sumCompletedId: 'sum-insp-assembly-completed',
      sumBalanceId: 'sum-insp-assembly-balance',
      pillWeeklyId: 'pill-insp-assembly-weekly',
      pillCompletedId: 'pill-insp-assembly-completed',
      pillBalanceId: 'pill-insp-assembly-balance'
    }
  ];

  function renderInspectionHeaders() {
    const baseDate = state.inspectionDate;

    INSPECTION_SECTIONS.forEach(sec => {
      const headerRow = document.getElementById(sec.headerDatesId);
      if (!headerRow) return;

      headerRow.innerHTML = '';
      for (let i = 0; i < 11; i++) {
        const dateObj = addDays(baseDate, i);
        const dayOfWeekIdx = dateObj.getDay();
        const dayName = DAYS_OF_WEEK[dayOfWeekIdx];
        const mm = dateObj.getMonth() + 1;
        const dd = dateObj.getDate();

        const th = document.createElement('th');
        th.className = 'th-date';

        // 주말 색상 및 슬림 너비 적용
        if (dayOfWeekIdx === 6) {
          th.classList.add('is-sat');
        } else if (dayOfWeekIdx === 0) {
          th.classList.add('is-sun');
        }

        th.innerHTML = `
          <span class="date-main">${mm}/${dd}</span>
          <span class="date-sub">(${dayName})</span>
        `;
        headerRow.appendChild(th);
      }
    });

    const rangeBadge = document.getElementById('insp-date-range-badge');
    if (rangeBadge) {
      const startDate = addDays(baseDate, 0);
      const endDate = addDays(baseDate, 10);
      const sStr = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
      const eStr = `${endDate.getMonth() + 1}/${endDate.getDate()}`;
      rangeBadge.textContent = `11일간 일정: ${sStr} ~ ${eStr}`;
    }
  }

  function renderInspectionTable() {
    renderInspectionHeaders();

    const badge = document.getElementById('badge-inspection-items');
    if (badge) badge.textContent = state.inspItems.length > 0 ? state.inspItems.length : '';

    INSPECTION_SECTIONS.forEach(sec => {
      renderSingleInspectionSection(sec);
    });

    attachInspectionEventListeners();
  }

  function renderSingleInspectionSection(sec) {
    const tbody = document.getElementById(sec.tbodyId);
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!state.inspectionData[sec.key]) {
      state.inspectionData[sec.key] = {};
    }
    const sectionData = state.inspectionData[sec.key];

    if (state.inspItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="16" style="text-align:center; padding: 24px; color: var(--text-muted);">
        [설정] 탭에서 생산현황 품목을 먼저 등록해주세요.
      </td></tr>`;
      calculateSectionTotals(sec);
      return;
    }

    const baseDate = state.inspectionDate;

    state.inspItems.forEach((item, index) => {
      if (!sectionData[item.id]) {
        sectionData[item.id] = { weeklyQty: 0, dailyQuantities: new Array(11).fill(0) };
      }

      const itemRowData = sectionData[item.id];
      if (!Array.isArray(itemRowData.dailyQuantities) || itemRowData.dailyQuantities.length !== 11) {
        itemRowData.dailyQuantities = new Array(11).fill(0);
      }

      const completedQty = itemRowData.dailyQuantities.reduce((acc, cur) => acc + (parseSafeInt(cur) || 0), 0);
      const weeklyQty = parseSafeInt(itemRowData.weeklyQty) || 0;
      const balance = weeklyQty - completedQty;

      const tr = document.createElement('tr');
      tr.dataset.section = sec.key;
      tr.dataset.itemId = item.id;
      tr.dataset.rowIndex = index;

      // 주간물량, 완료, 잔량 (0은 빈칸 표시, 잔량은 적색 폰트)
      let html = `
        <td class="col-no">${index + 1}</td>
        <td class="col-item" title="${item.name}">${escapeHtml(item.name)}</td>
        <td class="col-weekly">
          <input type="text" class="cell-input text-right num-cell input-weekly-qty"
                 value="${weeklyQty === 0 ? '' : weeklyQty}" placeholder=""
                 data-section="${sec.key}"
                 data-item-id="${item.id}"
                 data-row="${index}" data-col="0" />
        </td>
        <td class="col-completed calc-cell completed font-bold num-cell" id="calc-completed-${sec.key}-${item.id}">
          ${formatNumberDisplay(completedQty)}
        </td>
        <td class="col-balance calc-cell num-cell font-bold" id="calc-balance-${sec.key}-${item.id}">
          ${formatNumberDisplay(balance)}
        </td>
      `;

      // 11일간 일자별 생산량 셀 (토/일은 입력 차단 및 슬림화)
      for (let dayIdx = 0; dayIdx < 11; dayIdx++) {
        const dateObj = addDays(baseDate, dayIdx);
        const dayOfWeekIdx = dateObj.getDay();
        const isWeekend = (dayOfWeekIdx === 0 || dayOfWeekIdx === 6);

        let weekendClass = '';
        if (dayOfWeekIdx === 6) weekendClass = 'td-sat';
        if (dayOfWeekIdx === 0) weekendClass = 'td-sun';

        const dayVal = itemRowData.dailyQuantities[dayIdx];
        const displayVal = (dayVal === 0 || dayVal === '0' || !dayVal) ? '' : dayVal;

        html += `
          <td class="${weekendClass}">
            <input type="text" class="cell-input text-right num-cell input-daily-qty ${isWeekend ? 'is-weekend-locked' : ''}"
                   value="${isWeekend ? '' : displayVal}" placeholder=""
                   ${isWeekend ? 'disabled tabindex="-1"' : ''}
                   data-section="${sec.key}"
                   data-item-id="${item.id}"
                   data-day-index="${dayIdx}"
                   data-row="${index}" data-col="${dayIdx + 1}" />
          </td>
        `;
      }

      tr.innerHTML = html;
      tbody.appendChild(tr);
    });

    calculateSectionTotals(sec);
  }

  // ★ 오류 수정: tfoot 요일별 합계 열 1:1 수직 정합성 완벽 보장
  function calculateSectionTotals(sec) {
    let totalWeekly = 0;
    let totalCompleted = 0;
    let totalBalance = 0;
    const dailyTotals = new Array(11).fill(0);

    const sectionData = state.inspectionData[sec.key] || {};

    state.inspItems.forEach(item => {
      const row = sectionData[item.id];
      if (row) {
        const wQty = parseSafeInt(row.weeklyQty);
        totalWeekly += wQty;

        const rowCompleted = (row.dailyQuantities || []).reduce((acc, cur, idx) => {
          const val = parseSafeInt(cur);
          dailyTotals[idx] = (dailyTotals[idx] || 0) + val;
          return acc + val;
        }, 0);

        totalCompleted += rowCompleted;
        totalBalance += (wQty - rowCompleted);
      }
    });

    // 합계 푸터 기본 컬럼 갱신 (0은 빈칸 표시)
    const sumWeeklyEl = document.getElementById(sec.sumWeeklyId);
    const sumCompletedEl = document.getElementById(sec.sumCompletedId);
    const sumBalanceEl = document.getElementById(sec.sumBalanceId);

    if (sumWeeklyEl) sumWeeklyEl.textContent = formatNumberDisplay(totalWeekly);
    if (sumCompletedEl) sumCompletedEl.textContent = formatNumberDisplay(totalCompleted);
    if (sumBalanceEl) sumBalanceEl.textContent = formatNumberDisplay(totalBalance);

    // 섹션 헤더 요약 뱃지 갱신
    const pillWeekly = document.getElementById(sec.pillWeeklyId);
    const pillCompleted = document.getElementById(sec.pillCompletedId);
    const pillBalance = document.getElementById(sec.pillBalanceId);

    if (pillWeekly) pillWeekly.textContent = formatNumberDisplay(totalWeekly);
    if (pillCompleted) pillCompleted.textContent = formatNumberDisplay(totalCompleted);
    if (pillBalance) pillBalance.textContent = formatNumberDisplay(totalBalance);

    // ★ 11일간 각 요일 합계 셀 렌더링 (앞 5개 셀 뒤에 정확히 11개 td 배치)
    const tfootRow = document.getElementById(sec.tfootId);
    if (tfootRow) {
      // 기존 11일 합계 td들 제거 (앞의 No, 품명, 주간, 완료, 잔량 5개 보존)
      while (tfootRow.children.length > 5) {
        tfootRow.removeChild(tfootRow.lastChild);
      }

      const baseDate = state.inspectionDate;
      for (let dayIdx = 0; dayIdx < 11; dayIdx++) {
        const dateObj = addDays(baseDate, dayIdx);
        const dayOfWeekIdx = dateObj.getDay();
        const isWeekend = (dayOfWeekIdx === 0 || dayOfWeekIdx === 6);

        const td = document.createElement('td');
        td.className = 'num-cell text-right font-bold';
        if (dayOfWeekIdx === 6) td.className += ' td-sat text-blue-700';
        if (dayOfWeekIdx === 0) td.className += ' td-sun text-red-700';

        // 주말이거나 합계가 0이면 빈칸
        td.textContent = isWeekend ? '' : formatNumberDisplay(dailyTotals[dayIdx]);
        tfootRow.appendChild(td);
      }
    }
  }

  function updateAllInspectionCalculations() {
    INSPECTION_SECTIONS.forEach(sec => {
      state.inspItems.forEach(item => updateRowCalculations(sec.key, item.id));
      calculateSectionTotals(sec);
    });
  }

  function attachInspectionEventListeners() {
    // 주간물량 입력 이벤트
    document.querySelectorAll('.input-weekly-qty').forEach(input => {
      input.oninput = function () {
        const cleaned = this.value.replace(/[^0-9]/g, '');
        this.value = cleaned;

        const secKey = this.dataset.section;
        const itemId = this.dataset.itemId;

        if (!state.inspectionData[secKey]) state.inspectionData[secKey] = {};
        if (!state.inspectionData[secKey][itemId]) {
          state.inspectionData[secKey][itemId] = { weeklyQty: 0, dailyQuantities: new Array(11).fill(0) };
        }
        state.inspectionData[secKey][itemId].weeklyQty = parseSafeInt(cleaned);

        updateRowCalculations(secKey, itemId);
        const sec = INSPECTION_SECTIONS.find(s => s.key === secKey);
        if (sec) calculateSectionTotals(sec);
        saveInspectionData(true);
      };
    });

    // 일자별 생산량 입력 이벤트
    document.querySelectorAll('.input-daily-qty').forEach(input => {
      input.oninput = function () {
        const cleaned = this.value.replace(/[^0-9]/g, '');
        this.value = cleaned;

        const secKey = this.dataset.section;
        const itemId = this.dataset.itemId;
        const dayIdx = parseInt(this.dataset.dayIndex, 10);

        if (!state.inspectionData[secKey]) state.inspectionData[secKey] = {};
        if (!state.inspectionData[secKey][itemId]) {
          state.inspectionData[secKey][itemId] = { weeklyQty: 0, dailyQuantities: new Array(11).fill(0) };
        }
        if (!Array.isArray(state.inspectionData[secKey][itemId].dailyQuantities)) {
          state.inspectionData[secKey][itemId].dailyQuantities = new Array(11).fill(0);
        }

        state.inspectionData[secKey][itemId].dailyQuantities[dayIdx] = parseSafeInt(cleaned);

        updateRowCalculations(secKey, itemId);
        const sec = INSPECTION_SECTIONS.find(s => s.key === secKey);
        if (sec) calculateSectionTotals(sec);
        saveInspectionData(true);
      };
    });
  }

  function updateRowCalculations(secKey, itemId) {
    const secData = state.inspectionData[secKey];
    if (!secData) return;
    const row = secData[itemId];
    if (!row) return;

    const completedQty = (row.dailyQuantities || []).reduce((acc, cur) => acc + (parseSafeInt(cur) || 0), 0);
    const weeklyQty = parseSafeInt(row.weeklyQty) || 0;
    const balance = weeklyQty - completedQty;

    const compEl = document.getElementById(`calc-completed-${secKey}-${itemId}`);
    const balEl = document.getElementById(`calc-balance-${secKey}-${itemId}`);

    if (compEl) compEl.textContent = formatNumberDisplay(completedQty);
    if (balEl) balEl.textContent = formatNumberDisplay(balance);
  }

  // =========================================================================
  // 7. 탭 2: [생산 일정] 렌더링 (비고 칸 추가, 로트 스마트 마스킹)
  // =========================================================================
  function renderProductionWorkerHeaders() {
    const headerRow = document.getElementById('production-worker-headers');
    const groupHeader = document.getElementById('th-workers-group-header');
    if (!headerRow) return;

    headerRow.innerHTML = '';
    const workerCount = state.workers.length;

    if (groupHeader) {
      groupHeader.setAttribute('colspan', Math.max(1, workerCount));
      groupHeader.textContent = `작업자별 작업시간 (${workerCount}명)`;
    }

    if (workerCount === 0) {
      const th = document.createElement('th');
      th.textContent = '작업자 없음';
      headerRow.appendChild(th);
      return;
    }

    state.workers.forEach(w => {
      const th = document.createElement('th');
      th.className = 'col-worker-time';
      th.textContent = w.name;
      th.title = `작업자: ${w.name}`;
      headerRow.appendChild(th);
    });
  }

  function renderProductionTable() {
    renderProductionWorkerHeaders();

    const tbody = document.getElementById('production-tbody');
    const badge = document.getElementById('badge-production-rows');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (badge) badge.textContent = state.productionRows.length > 0 ? state.productionRows.length : '';

    if (state.productionRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${6 + Math.max(1, state.workers.length)}" style="text-align:center; padding: 24px; color: var(--text-muted);">
        생산 일정이 없습니다. 우측 상단의 [생산 행 추가] 버튼을 눌러 행을 추가하세요.
      </td></tr>`;
      calculateProductionTotals();
      return;
    }

    state.productionRows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;
      tr.dataset.rowIndex = index;

      // 생산일정 품목 리스트 바인딩
      let itemOptions = '';
      if (state.prodItems.length === 0) {
        itemOptions = '<option value="">품목 없음 (설정에서 등록)</option>';
      } else {
        itemOptions = state.prodItems.map(item => {
          const selected = item.id === row.itemId ? 'selected' : '';
          return `<option value="${item.id}" ${selected}>${escapeHtml(item.name)}</option>`;
        }).join('');
      }

      // No, 품명, 비고, 로트번호, 생산수량
      let html = `
        <td class="col-no">${index + 1}</td>
        <td class="col-item-prod">
          <select class="cell-select select-prod-item" data-row-id="${row.id}">
            ${itemOptions}
          </select>
        </td>
        <td class="col-note">
          <input type="text" class="cell-input input-prod-note"
                 value="${escapeHtml(row.note || '')}"
                 placeholder=""
                 data-row-id="${row.id}"
                 data-row="${index}" data-col="note" />
        </td>
        <td class="col-lot">
          <input type="text" class="cell-input code-font text-center input-prod-lot"
                 value="${escapeHtml(row.lotNo || '')}"
                 placeholder=""
                 maxlength="10"
                 data-row-id="${row.id}"
                 data-row="${index}" data-col="lot" />
        </td>
        <td class="col-qty">
          <input type="text" class="cell-input text-right num-cell input-prod-qty"
                 value="${row.qty === 0 || !row.qty ? '' : row.qty}"
                 placeholder=""
                 data-row-id="${row.id}"
                 data-row="${index}" data-col="qty" />
        </td>
      `;

      // 작업자별 작업시간 입력칸
      if (state.workers.length === 0) {
        html += `<td style="text-align:center; color: var(--text-muted);">-</td>`;
      } else {
        state.workers.forEach((worker, wIdx) => {
          const hours = row.workerHours && row.workerHours[worker.id] !== undefined ? row.workerHours[worker.id] : '';
          const displayHours = (hours === 0 || hours === '0' || hours === '') ? '' : hours;

          html += `
            <td class="col-worker-time">
              <input type="text" class="cell-input text-right num-cell input-worker-hour"
                     value="${displayHours}"
                     placeholder=""
                     maxlength="5"
                     data-row-id="${row.id}"
                     data-worker-id="${worker.id}"
                     data-row="${index}" data-col="worker_${wIdx}" />
            </td>
          `;
        });
      }

      html += `
        <td class="col-action">
          <button type="button" class="btn btn-sm btn-danger-ghost btn-delete-prod-row" data-row-id="${row.id}" title="행 삭제">
            <svg style="width:13px;height:13px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </td>
      `;

      tr.innerHTML = html;
      tbody.appendChild(tr);
    });

    calculateProductionTotals();
    attachProductionEventListeners();
  }

  function calculateProductionTotals() {
    let totalQty = 0;
    const workerTotals = {};

    state.workers.forEach(w => workerTotals[w.id] = 0);

    state.productionRows.forEach(row => {
      totalQty += parseSafeInt(row.qty);

      if (row.workerHours) {
        Object.entries(row.workerHours).forEach(([wId, h]) => {
          if (workerTotals[wId] !== undefined) {
            workerTotals[wId] += parseSafeFloat(h);
          }
        });
      }
    });

    const sumQtyEl = document.getElementById('sum-prod-qty');
    if (sumQtyEl) sumQtyEl.textContent = formatNumberDisplay(totalQty);

    const tfootRow = document.getElementById('production-tfoot');
    if (tfootRow) {
      // 앞 5개 td(No, 품명, 비고, 로트번호, 생산수량) 보존 후 작업자 합계 td 갱신
      while (tfootRow.children.length > 5) {
        tfootRow.removeChild(tfootRow.children[5]);
      }

      if (state.workers.length === 0) {
        const td = document.createElement('td');
        td.className = 'summary-empty';
        tfootRow.appendChild(td);
      } else {
        state.workers.forEach(w => {
          const td = document.createElement('td');
          td.className = 'num-cell text-right font-bold';
          const sum = workerTotals[w.id] || 0;
          td.textContent = sum === 0 ? '' : (sum % 1 === 0 ? sum.toFixed(0) : sum.toFixed(1));
          tfootRow.appendChild(td);
        });
      }

      // 관리 액션 빈 셀 추가
      const tdAction = document.createElement('td');
      tdAction.className = 'col-action summary-empty';
      tfootRow.appendChild(tdAction);
    }
  }

  function attachProductionEventListeners() {
    const tbody = document.getElementById('production-tbody');
    if (!tbody) return;

    tbody.querySelectorAll('.select-prod-item').forEach(select => {
      select.onchange = function () {
        const rowId = this.dataset.rowId;
        const row = state.productionRows.find(r => r.id === rowId);
        if (row) {
          row.itemId = this.value;
          saveProductionData(true);
        }
      };
    });

    // 비고 입력 이벤트
    tbody.querySelectorAll('.input-prod-note').forEach(input => {
      input.oninput = function () {
        const rowId = this.dataset.rowId;
        const row = state.productionRows.find(r => r.id === rowId);
        if (row) {
          row.note = this.value;
          saveProductionData(true);
        }
      };
    });

    // 로트번호 입력 이벤트 (스마트 1 -> 26-001 자동 포맷팅)
    tbody.querySelectorAll('.input-prod-lot').forEach(input => {
      input.oninput = function () {
        const rowId = this.dataset.rowId;
        const row = state.productionRows.find(r => r.id === rowId);
        if (row) {
          row.lotNo = this.value;
          saveProductionData(true);
        }
      };

      // 블러 또는 엔터 시 스마트 마스킹 완성
      input.onblur = function () {
        const formatted = formatSmartLotNumber(this.value);
        if (formatted !== this.value) {
          this.value = formatted;
          const rowId = this.dataset.rowId;
          const row = state.productionRows.find(r => r.id === rowId);
          if (row) {
            row.lotNo = formatted;
            saveProductionData(true);
          }
        }
      };
    });

    // 생산수량 입력
    tbody.querySelectorAll('.input-prod-qty').forEach(input => {
      input.oninput = function () {
        const cleaned = this.value.replace(/[^0-9]/g, '');
        this.value = cleaned;

        const rowId = this.dataset.rowId;
        const row = state.productionRows.find(r => r.id === rowId);
        if (row) {
          row.qty = parseSafeInt(cleaned);
          calculateProductionTotals();
          saveProductionData(true);
        }
      };
    });

    // 작업자 시간 입력
    tbody.querySelectorAll('.input-worker-hour').forEach(input => {
      input.oninput = function () {
        let val = this.value.replace(/[^0-9.]/g, '');
        const parts = val.split('.');
        if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
        if (parts.length === 2 && parts[1].length > 1) val = parts[0] + '.' + parts[1].slice(0, 1);
        this.value = val;

        const rowId = this.dataset.rowId;
        const workerId = this.dataset.workerId;
        const row = state.productionRows.find(r => r.id === rowId);
        if (row) {
          if (!row.workerHours) row.workerHours = {};
          row.workerHours[workerId] = val === '' ? 0 : parseSafeFloat(val);
          calculateProductionTotals();
          saveProductionData(true);
        }
      };
    });

    // 행 삭제
    tbody.querySelectorAll('.btn-delete-prod-row').forEach(btn => {
      btn.onclick = function () {
        const rowId = this.dataset.rowId;
        if (state.productionRows.length <= 1) {
          state.productionRows = [createDefaultProductionRow()];
        } else {
          state.productionRows = state.productionRows.filter(r => r.id !== rowId);
        }
        renderProductionTable();
        saveProductionData(true);
      };
    });
  }

  // =========================================================================
  // 8. 엑셀 스프레드시트 방식 전역 키보드 내비게이션 (Tab 우측 / Enter 아래)
  // =========================================================================
  function initSpreadsheetKeyboardNavigation() {
    document.addEventListener('keydown', function (e) {
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains('cell-input')) return;

      const currentTable = activeEl.closest('table');
      if (!currentTable) return;

      const currentTd = activeEl.closest('td');
      const currentTr = activeEl.closest('tr');
      if (!currentTd || !currentTr) return;

      // [1] Enter 키: 아래 행으로 이동 (Shift+Enter는 위 행)
      if (e.key === 'Enter') {
        e.preventDefault();
        activeEl.blur(); // 로트번호 스마트 변환 등 onblur 트리거

        const colIndex = Array.from(currentTr.children).indexOf(currentTd);
        const allTrs = Array.from(currentTable.querySelectorAll('tbody tr'));
        const currentTrIndex = allTrs.indexOf(currentTr);

        let targetTrIndex = e.shiftKey ? currentTrIndex - 1 : currentTrIndex + 1;
        if (targetTrIndex >= 0 && targetTrIndex < allTrs.length) {
          const targetTr = allTrs[targetTrIndex];
          const targetTd = targetTr.children[colIndex];
          const targetInput = targetTd ? targetTd.querySelector('.cell-input:not(:disabled)') : null;
          if (targetInput) {
            targetInput.focus();
            if (targetInput.select) targetInput.select();
          }
        }
      }

      // [2] Tab 키: 우측 행으로 이동 (Shift+Tab은 좌측)
      // 주말 컬럼(disabled)은 자동으로 건너뜀
      if (e.key === 'Tab') {
        const allInputs = Array.from(currentTable.querySelectorAll('tbody .cell-input:not(:disabled)'));
        const currentIndex = allInputs.indexOf(activeEl);

        if (currentIndex !== -1) {
          let nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;
          if (nextIndex >= 0 && nextIndex < allInputs.length) {
            e.preventDefault();
            activeEl.blur();
            allInputs[nextIndex].focus();
            if (allInputs[nextIndex].select) allInputs[nextIndex].select();
          }
        }
      }

      // [3] 방향키 이동 지원 (ArrowDown, ArrowUp)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const colIndex = Array.from(currentTr.children).indexOf(currentTd);
        const allTrs = Array.from(currentTable.querySelectorAll('tbody tr'));
        const currentTrIndex = allTrs.indexOf(currentTr);

        let targetTrIndex = e.key === 'ArrowUp' ? currentTrIndex - 1 : currentTrIndex + 1;
        if (targetTrIndex >= 0 && targetTrIndex < allTrs.length) {
          const targetTr = allTrs[targetTrIndex];
          const targetTd = targetTr.children[colIndex];
          const targetInput = targetTd ? targetTd.querySelector('.cell-input:not(:disabled)') : null;
          if (targetInput) {
            e.preventDefault();
            targetInput.focus();
            if (targetInput.select) targetInput.select();
          }
        }
      }
    });
  }

  // =========================================================================
  // 9. 탭 3: [설정] 마스터 데이터 관리 (품목 분리 및 상호 동기화)
  // =========================================================================
  function renderMasterInspItems() {
    const tbody = document.getElementById('master-insp-items-tbody');
    const badge = document.getElementById('count-insp-items-badge');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (badge) badge.textContent = `${state.inspItems.length}개`;

    state.inspItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:center; color: var(--text-muted); font-weight: 600;">${index + 1}</td>
        <td>
          <span class="item-name-text" data-id="${item.id}">${escapeHtml(item.name)}</span>
          <input type="text" class="master-edit-input" style="display:none;" value="${escapeHtml(item.name)}" data-id="${item.id}">
        </td>
        <td style="text-align:center; white-space: nowrap;">
          <button type="button" class="btn btn-sm btn-ghost btn-edit-insp-item" data-id="${item.id}">수정</button>
          <button type="button" class="btn btn-sm btn-danger-ghost btn-delete-insp-item" data-id="${item.id}">삭제</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    attachMasterInspEvents();
  }

  function attachMasterInspEvents() {
    const tbody = document.getElementById('master-insp-items-tbody');
    if (!tbody) return;

    tbody.querySelectorAll('.btn-edit-insp-item').forEach(btn => {
      btn.onclick = function () {
        const tr = this.closest('tr');
        const textSpan = tr.querySelector('.item-name-text');
        const input = tr.querySelector('.master-edit-input');

        if (input.style.display === 'none') {
          input.style.display = 'block';
          textSpan.style.display = 'none';
          input.focus();
          this.textContent = '완료';
          this.classList.add('text-primary');
        } else {
          const newName = input.value.trim();
          if (newName) {
            const itemId = this.dataset.id;
            const item = state.inspItems.find(i => i.id === itemId);
            if (item) item.name = newName;
            saveInspItems(true);
            renderMasterInspItems();
            renderInspectionTable();
          }
        }
      };
    });

    tbody.querySelectorAll('.btn-delete-insp-item').forEach(btn => {
      btn.onclick = function () {
        const itemId = this.dataset.id;
        const item = state.inspItems.find(i => i.id === itemId);
        if (!item) return;

        if (confirm(`'${item.name}' 품목을 생산현황 목록에서 삭제하시겠습니까?`)) {
          state.inspItems = state.inspItems.filter(i => i.id !== itemId);
          saveInspItems(true);
          renderMasterInspItems();
          renderInspectionTable();
        }
      };
    });
  }

  function renderMasterProdItems() {
    const tbody = document.getElementById('master-prod-items-tbody');
    const badge = document.getElementById('count-prod-items-badge');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (badge) badge.textContent = `${state.prodItems.length}개`;

    state.prodItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:center; color: var(--text-muted); font-weight: 600;">${index + 1}</td>
        <td>
          <span class="item-name-text" data-id="${item.id}">${escapeHtml(item.name)}</span>
          <input type="text" class="master-edit-input" style="display:none;" value="${escapeHtml(item.name)}" data-id="${item.id}">
        </td>
        <td style="text-align:center; white-space: nowrap;">
          <button type="button" class="btn btn-sm btn-ghost btn-edit-prod-item" data-id="${item.id}">수정</button>
          <button type="button" class="btn btn-sm btn-danger-ghost btn-delete-prod-item" data-id="${item.id}">삭제</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    attachMasterProdEvents();
  }

  function attachMasterProdEvents() {
    const tbody = document.getElementById('master-prod-items-tbody');
    if (!tbody) return;

    tbody.querySelectorAll('.btn-edit-prod-item').forEach(btn => {
      btn.onclick = function () {
        const tr = this.closest('tr');
        const textSpan = tr.querySelector('.item-name-text');
        const input = tr.querySelector('.master-edit-input');

        if (input.style.display === 'none') {
          input.style.display = 'block';
          textSpan.style.display = 'none';
          input.focus();
          this.textContent = '완료';
          this.classList.add('text-primary');
        } else {
          const newName = input.value.trim();
          if (newName) {
            const itemId = this.dataset.id;
            const item = state.prodItems.find(i => i.id === itemId);
            if (item) item.name = newName;
            saveProdItems(true);
            renderMasterProdItems();
            renderProductionTable();
          }
        }
      };
    });

    tbody.querySelectorAll('.btn-delete-prod-item').forEach(btn => {
      btn.onclick = function () {
        const itemId = this.dataset.id;
        const item = state.prodItems.find(i => i.id === itemId);
        if (!item) return;

        if (confirm(`'${item.name}' 품목을 생산일정 목록에서 삭제하시겠습니까?`)) {
          state.prodItems = state.prodItems.filter(i => i.id !== itemId);
          saveProdItems(true);
          renderMasterProdItems();
          renderProductionTable();
        }
      };
    });
  }

  function renderMasterWorkers() {
    const tbody = document.getElementById('master-workers-tbody');
    const badge = document.getElementById('count-workers-badge');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (badge) badge.textContent = `${state.workers.length}명`;

    state.workers.forEach((worker, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:center; color: var(--text-muted); font-weight: 600;">${index + 1}</td>
        <td>
          <span class="worker-name-text" data-id="${worker.id}">${escapeHtml(worker.name)}</span>
          <input type="text" class="master-edit-input" style="display:none;" value="${escapeHtml(worker.name)}" data-id="${worker.id}">
        </td>
        <td style="text-align:center; white-space: nowrap;">
          <button type="button" class="btn btn-sm btn-ghost btn-edit-worker" data-id="${worker.id}">수정</button>
          <button type="button" class="btn btn-sm btn-danger-ghost btn-delete-worker" data-id="${worker.id}">삭제</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    attachMasterWorkerEvents();
  }

  function attachMasterWorkerEvents() {
    const tbody = document.getElementById('master-workers-tbody');
    if (!tbody) return;

    tbody.querySelectorAll('.btn-edit-worker').forEach(btn => {
      btn.onclick = function () {
        const tr = this.closest('tr');
        const textSpan = tr.querySelector('.worker-name-text');
        const input = tr.querySelector('.master-edit-input');

        if (input.style.display === 'none') {
          input.style.display = 'block';
          textSpan.style.display = 'none';
          input.focus();
          this.textContent = '완료';
          this.classList.add('text-primary');
        } else {
          const newName = input.value.trim();
          if (newName) {
            const workerId = this.dataset.id;
            const worker = state.workers.find(w => w.id === workerId);
            if (worker) worker.name = newName;
            saveWorkers(true);
            renderMasterWorkers();
            renderProductionTable();
          }
        }
      };
    });

    tbody.querySelectorAll('.btn-delete-worker').forEach(btn => {
      btn.onclick = function () {
        const workerId = this.dataset.id;
        const worker = state.workers.find(w => w.id === workerId);
        if (!worker) return;

        if (confirm(`'${worker.name}' 작업자를 삭제하시겠습니까?`)) {
          state.workers = state.workers.filter(w => w.id !== workerId);
          saveWorkers(true);
          renderMasterWorkers();
          renderProductionTable();
        }
      };
    });
  }

  // =========================================================================
  // 10. CSV 내보내기 & 백업
  // =========================================================================
  function exportInspectionToCsv() {
    let csv = '\uFEFF';
    csv += `감지기 생산현황 관리 시스템 - 생산현황\n`;
    csv += `생산 시작일:,${state.inspectionDate}\n\n`;

    const dateHeaders = [];
    for (let i = 0; i < 11; i++) {
      const d = addDays(state.inspectionDate, i);
      dateHeaders.push(`"${d.getMonth() + 1}/${d.getDate()}(${DAYS_OF_WEEK[d.getDay()]})"`);
    }

    csv += `[공정검사]\n`;
    csv += `No,품명,주간물량,생산완료,잔량,${dateHeaders.join(',')}\n`;

    const processData = state.inspectionData.process || {};
    state.inspItems.forEach((item, idx) => {
      const row = processData[item.id] || { weeklyQty: 0, dailyQuantities: new Array(11).fill(0) };
      const completed = (row.dailyQuantities || []).reduce((a, b) => a + parseSafeInt(b), 0);
      const weekly = parseSafeInt(row.weeklyQty);
      const balance = weekly - completed;
      const dailyVals = (row.dailyQuantities || []).map(v => parseSafeInt(v));

      csv += `${idx + 1},"${item.name.replace(/"/g, '""')}",${weekly},${completed},${balance},${dailyVals.join(',')}\n`;
    });

    csv += `\n[자동화조립]\n`;
    csv += `No,품명,주간물량,생산완료,잔량,${dateHeaders.join(',')}\n`;

    const assemblyData = state.inspectionData.assembly || {};
    state.inspItems.forEach((item, idx) => {
      const row = assemblyData[item.id] || { weeklyQty: 0, dailyQuantities: new Array(11).fill(0) };
      const completed = (row.dailyQuantities || []).reduce((a, b) => a + parseSafeInt(b), 0);
      const weekly = parseSafeInt(row.weeklyQty);
      const balance = weekly - completed;
      const dailyVals = (row.dailyQuantities || []).map(v => parseSafeInt(v));

      csv += `${idx + 1},"${item.name.replace(/"/g, '""')}",${weekly},${completed},${balance},${dailyVals.join(',')}\n`;
    });

    downloadCsvFile(csv, `생산현황_${state.inspectionDate}.csv`);
  }

  function exportProductionToCsv() {
    let csv = '\uFEFF';
    csv += `감지기 생산현황 관리 시스템 - 생산 일정\n`;
    csv += `생산일자:,${state.productionDate}\n\n`;

    const workerHeaders = state.workers.map(w => `"${w.name.replace(/"/g, '""')}"`);
    csv += `No,품명,비고,로트번호,생산수량,${workerHeaders.join(',')}\n`;

    state.productionRows.forEach((row, idx) => {
      const item = state.prodItems.find(i => i.id === row.itemId);
      const itemName = item ? item.name : '';
      const hours = state.workers.map(w => (row.workerHours && row.workerHours[w.id]) || 0);

      csv += `${idx + 1},"${itemName.replace(/"/g, '""')}","${row.note || ''}","${row.lotNo || ''}",${row.qty || 0},${hours.join(',')}\n`;
    });

    downloadCsvFile(csv, `생산일정_${state.productionDate}.csv`);
  }

  function downloadCsvFile(content, fileName) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`${fileName} 파일이 다운로드되었습니다`);
  }

  function exportAllDataAsJson() {
    const allData = {
      version: '3.0',
      exportedAt: new Date().toISOString(),
      inspItems: state.inspItems,
      prodItems: state.prodItems,
      workers: state.workers,
      inspectionData: state.inspectionData,
      productionRows: state.productionRows
    };

    const jsonStr = JSON.stringify(allData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `감지기생산현황_백업_${getTodayDateString()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('전체 시스템 데이터 백업 완료');
  }

  function importAllDataFromJson(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const imported = JSON.parse(e.target.result);
        if (imported.inspItems) state.inspItems = imported.inspItems;
        if (imported.prodItems) state.prodItems = imported.prodItems;
        if (imported.workers) state.workers = imported.workers;
        saveInspItems(false);
        saveProdItems(false);
        saveWorkers(false);
        subscribeInspectionData(state.inspectionDate);
        subscribeProductionData(state.productionDate);
        renderAll();
        showToast('데이터 복원이 완료되었습니다');
      } catch (err) {
        alert('올바른 백업 JSON 파일이 아닙니다: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // =========================================================================
  // 11. 뷰 모드 제어 (기본형 Centered / 와이드형 Full-width)
  // =========================================================================
  function applyViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem(STORAGE_KEYS.VIEW_MODE, mode);

    document.body.className = mode === 'wide' ? 'view-mode-wide' : 'view-mode-default';

    document.getElementById('btn-view-default')?.classList.toggle('active', mode === 'default');
    document.getElementById('btn-view-wide')?.classList.toggle('active', mode === 'wide');
  }

  // =========================================================================
  // 12. 전역 이벤트 바인딩
  // =========================================================================
  function initEventHandlers() {
    // 뷰 모드 토글
    document.getElementById('btn-view-default')?.addEventListener('click', () => applyViewMode('default'));
    document.getElementById('btn-view-wide')?.addEventListener('click', () => applyViewMode('wide'));
    applyViewMode(state.viewMode);

    // 탭 전환
    document.querySelectorAll('.nav-tab').forEach(tabBtn => {
      tabBtn.onclick = function () {
        const targetTabId = this.dataset.tab;
        state.currentTab = targetTabId;

        document.querySelectorAll('.nav-tab').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        this.classList.add('active');
        this.setAttribute('aria-selected', 'true');
        const targetPane = document.getElementById(targetTabId);
        if (targetPane) targetPane.classList.add('active');

        if (targetTabId === 'tab-inspection') {
          renderInspectionTable();
        } else if (targetTabId === 'tab-production') {
          renderProductionTable();
        } else if (targetTabId === 'tab-settings') {
          renderMasterInspItems();
          renderMasterProdItems();
          renderMasterWorkers();
        }
      };
    });

    // 생산현황 (구 검정일정) 날짜 컨트롤 (수동 조작 유지)
    const inspDateInput = document.getElementById('inspection-date');
    if (inspDateInput) {
      inspDateInput.value = state.inspectionDate;
      inspDateInput.onchange = function () {
        state.inspectionDate = this.value || getTodayDateString();
        subscribeInspectionData(state.inspectionDate);
        showToast(`${state.inspectionDate} 일정 불러옴`);
      };
    }

    document.getElementById('btn-insp-prev-day')?.addEventListener('click', () => {
      const prevDate = addDays(state.inspectionDate, -1);
      state.inspectionDate = formatDateObj(prevDate);
      if (inspDateInput) inspDateInput.value = state.inspectionDate;
      subscribeInspectionData(state.inspectionDate);
      showToast(`${state.inspectionDate} 일정 불러옴`);
    });

    document.getElementById('btn-insp-next-day')?.addEventListener('click', () => {
      const nextDate = addDays(state.inspectionDate, 1);
      state.inspectionDate = formatDateObj(nextDate);
      if (inspDateInput) inspDateInput.value = state.inspectionDate;
      subscribeInspectionData(state.inspectionDate);
      showToast(`${state.inspectionDate} 일정 불러옴`);
    });

    document.getElementById('btn-insp-today')?.addEventListener('click', () => {
      state.inspectionDate = getTodayDateString();
      if (inspDateInput) inspDateInput.value = state.inspectionDate;
      subscribeInspectionData(state.inspectionDate);
      showToast('오늘 날짜로 이동');
    });

    document.getElementById('btn-insp-clear-day')?.addEventListener('click', () => {
      if (confirm(`생산 시작일 [${state.inspectionDate}]의 공정검사 및 자동화조립 데이터를 모두 초기화하시겠습니까?`)) {
        state.inspectionData = { process: {}, assembly: {} };
        saveInspectionData(true);
        renderInspectionTable();
      }
    });

    // 생산 일정 날짜 컨트롤
    const prodDateInput = document.getElementById('production-date');
    if (prodDateInput) {
      prodDateInput.value = state.productionDate;
      prodDateInput.onchange = function () {
        state.productionDate = this.value || getTodayDateString();
        subscribeProductionData(state.productionDate);
        showToast(`${state.productionDate} 생산일정 불러옴`);
      };
    }

    document.getElementById('btn-prod-prev-day')?.addEventListener('click', () => {
      const prevDate = addDays(state.productionDate, -1);
      state.productionDate = formatDateObj(prevDate);
      if (prodDateInput) prodDateInput.value = state.productionDate;
      subscribeProductionData(state.productionDate);
      showToast(`${state.productionDate} 생산일정 불러옴`);
    });

    document.getElementById('btn-prod-next-day')?.addEventListener('click', () => {
      const nextDate = addDays(state.productionDate, 1);
      state.productionDate = formatDateObj(nextDate);
      if (prodDateInput) prodDateInput.value = state.productionDate;
      subscribeProductionData(state.productionDate);
      showToast(`${state.productionDate} 생산일정 불러옴`);
    });

    document.getElementById('btn-prod-today')?.addEventListener('click', () => {
      state.productionDate = getTodayDateString();
      if (prodDateInput) prodDateInput.value = state.productionDate;
      subscribeProductionData(state.productionDate);
      showToast('오늘 날짜로 이동');
    });

    document.getElementById('btn-prod-clear-day')?.addEventListener('click', () => {
      if (confirm(`생산일자 [${state.productionDate}]의 생산 일정을 초기화하시겠습니까?`)) {
        state.productionRows = [createDefaultProductionRow()];
        saveProductionData(true);
        renderProductionTable();
      }
    });

    // 생산 행 추가 (로트번호 빈칸으로 시작)
    document.getElementById('btn-add-production-row')?.addEventListener('click', () => {
      const newRow = createDefaultProductionRow();
      state.productionRows.push(newRow);
      renderProductionTable();
      saveProductionData(true);

      const newlyAddedRowEl = document.querySelector(`tr[data-row-id="${newRow.id}"] .input-prod-lot`);
      if (newlyAddedRowEl) newlyAddedRowEl.focus();
    });

    // 설정: 생산현황 품목 추가
    document.getElementById('form-add-insp-item')?.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = document.getElementById('input-new-insp-item');
      const name = input.value.trim();
      if (!name) return;

      state.inspItems.push({ id: generateUniqueId('it_insp'), name: name });
      input.value = '';
      saveInspItems(true);
      renderMasterInspItems();
      renderInspectionTable();
    });

    // 설정: 생산일정 품목 추가
    document.getElementById('form-add-prod-item')?.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = document.getElementById('input-new-prod-item');
      const name = input.value.trim();
      if (!name) return;

      state.prodItems.push({ id: generateUniqueId('it_prod'), name: name });
      input.value = '';
      saveProdItems(true);
      renderMasterProdItems();
      renderProductionTable();
    });

    // 설정: 품목 동기화 버튼 (생산현황 ➔ 생산일정)
    document.getElementById('btn-sync-insp-to-prod')?.addEventListener('click', () => {
      if (confirm(`생산현황 품목 (${state.inspItems.length}개)을 생산일정 품목 목록으로 복사/동기화하시겠습니까?`)) {
        state.prodItems = JSON.parse(JSON.stringify(state.inspItems));
        saveProdItems(true);
        renderMasterProdItems();
        renderProductionTable();
        showToast('생산일정 품목으로 동기화 완료');
      }
    });

    // 설정: 품목 동기화 버튼 (생산일정 ➔ 생산현황)
    document.getElementById('btn-sync-prod-to-insp')?.addEventListener('click', () => {
      if (confirm(`생산일정 품목 (${state.prodItems.length}개)을 생산현황 품목 목록으로 복사/동기화하시겠습니까?`)) {
        state.inspItems = JSON.parse(JSON.stringify(state.prodItems));
        saveInspItems(true);
        renderMasterInspItems();
        renderInspectionTable();
        showToast('생산현황 품목으로 동기화 완료');
      }
    });

    // 설정: 작업자 추가
    document.getElementById('form-add-worker')?.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = document.getElementById('input-new-worker');
      const name = input.value.trim();
      if (!name) return;

      state.workers.push({ id: generateUniqueId('worker'), name: name });
      input.value = '';
      saveWorkers(true);
      renderMasterWorkers();
      renderProductionTable();
    });

    // CSV 및 백업 버튼들
    document.getElementById('btn-export-inspection-csv')?.addEventListener('click', exportInspectionToCsv);
    document.getElementById('btn-export-production-csv')?.addEventListener('click', exportProductionToCsv);
    document.getElementById('btn-export-json')?.addEventListener('click', exportAllDataAsJson);

    const importInput = document.getElementById('input-import-json');
    if (importInput) {
      importInput.addEventListener('change', function () {
        if (this.files && this.files[0]) {
          importAllDataFromJson(this.files[0]);
          this.value = '';
        }
      });
    }

    startClock();
    initSpreadsheetKeyboardNavigation();
  }

  function startClock() {
    const clockEl = document.getElementById('clock-display');
    if (!clockEl) return;

    function update() {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      clockEl.textContent = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }
    update();
    setInterval(update, 1000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderAll() {
    renderInspectionTable();
    renderProductionTable();
    renderMasterInspItems();
    renderMasterProdItems();
    renderMasterWorkers();
  }

  // =========================================================================
  // 13. 부트스트랩 초기화
  // =========================================================================
  function initApp() {
    initEventHandlers();
    initFirebase();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
