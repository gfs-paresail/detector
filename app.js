/**
 * 감지기 생산현황 관리 시스템 - 코어 비즈니스 로직 (Detector PMS v4.1)
 * (Firestore 무료 플랜 최적화, 수동 저장 및 로컬 임시저장, 이탈 방지,
 *  검정예정일 사이드바 수정/삭제, 10일 기본 복원 및 일정 추가/삭제,
 *  3개 분할 생산일정 및 변동작업자 툴바 통합, 설정 인라인 수정, 빈칸 클린 UX)
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

  // 로컬 저장소 키
  const STORAGE_KEYS = {
    COMMON_ITEMS: 'pms_common_items_v4',
    ETC_ITEMS: 'pms_etc_items_v4',
    WORKERS: 'pms_workers_v4',
    LAST_INSP_START: 'pms_last_insp_start_v4',
    LAST_INSP_TARGET: 'pms_last_insp_target_v4',
    LAST_PROD_DATE: 'pms_last_prod_date_v4',
    VIEW_MODE: 'pms_view_mode_v4',
    INSP_DATA_PREFIX: 'pms_insp_data_v4_',
    INSP_SCHEDULES: 'pms_insp_schedules_v4',
    PROD_DATA_PREFIX: 'pms_prod_data_v4_'
  };

  // 기본 공통 품목 (생산현황, 생산일정 조립/검사 공통)
  const DEFAULT_COMMON_ITEMS = [
    { id: 'item_1', name: '광전식 스포트형 감지기 (1종)' },
    { id: 'item_2', name: '광전식 스포트형 감지기 (2종)' },
    { id: 'item_3', name: '차동식 스포트형 감지기 (2종)' },
    { id: 'item_4', name: '정온식 스포트형 감지기 (특종)' },
    { id: 'item_5', name: '정온식 스포트형 감지기 (1종)' },
    { id: 'item_6', name: '자외선/적외선 불꽃감지기' },
    { id: 'item_7', name: '아날로그식 복합형 감지기' },
    { id: 'item_8', name: '방폭형 열감지기' }
  ];

  // 기본 기타 작업 품목 (생산일정 '기타' 전용)
  const DEFAULT_ETC_ITEMS = [
    { id: 'etc_1', name: '외주 포장 작업' },
    { id: 'etc_2', name: 'PCB 기판 수리' },
    { id: 'etc_3', name: '수입 부품 선별 검사' },
    { id: 'etc_4', name: '시제품 샘플 조립' }
  ];

  // 기본 작업자 (고정 3명, 변동 3명 기본 배치)
  const DEFAULT_WORKERS = [
    { id: 'worker_1', name: '김철수', type: 'fixed' },
    { id: 'worker_2', name: '이영희', type: 'fixed' },
    { id: 'worker_3', name: '박민수', type: 'fixed' },
    { id: 'worker_4', name: '정수진', type: 'variable' },
    { id: 'worker_5', name: '최동욱', type: 'variable' },
    { id: 'worker_6', name: '강현우', type: 'variable' }
  ];

  const DAYS_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  // =========================================================================
  // 2. 전역 상태 (State)
  // =========================================================================
  const state = {
    currentTab: 'tab-inspection',
    viewMode: localStorage.getItem(STORAGE_KEYS.VIEW_MODE) || 'default',

    // 마스터 데이터
    commonItems: [],
    etcItems: [],
    workers: [],

    // 생산현황 상태
    inspectionStartDate: localStorage.getItem(STORAGE_KEYS.LAST_INSP_START) || getTodayDateString(),
    inspectionTargetDate: localStorage.getItem(STORAGE_KEYS.LAST_INSP_TARGET) || addDaysStr(getTodayDateString(), 9),
    inspectionDayCount: 10, // 기본 10일간 표시
    inspectionData: { process: {}, assembly: {} },
    inspectionSchedules: [], // [{ targetDate: 'YYYY-MM-DD', startDate: 'YYYY-MM-DD', dayCount: 10, updatedAt }]
    sidebarYearFilter: 'ALL',
    sidebarMonthFilter: 'ALL',

    // 생산 일정 상태
    productionDate: localStorage.getItem(STORAGE_KEYS.LAST_PROD_DATE) || getTodayDateString(),
    selectedVarWorkerIds: [], // 현재 생산일자에 투입된 변동 작업자 ID 목록
    productionData: {
      assembly: {},    // { [itemId]: { note: '', lotNo: '', qty: 0, workerHours: {} } }
      inspection: {},  // { [itemId]: { note: '', lotNo: '', qty: 0, workerHours: {} } }
      etc: {}          // { [itemId]: { note: '', lotNo: '', qty: 0, workerHours: {} } }
    },

    // 미저장 변경사항 플래그
    isDirty: false
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

  function addDaysStr(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
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

  // 0 또는 빈 값은 완전 빈칸("")으로 표시
  function formatNumberDisplay(num) {
    if (num === null || num === undefined || isNaN(num) || num === '' || Number(num) === 0) {
      return '';
    }
    return Number(num).toLocaleString('ko-KR');
  }

  function formatFloatDisplay(num) {
    if (num === null || num === undefined || isNaN(num) || num === '' || Number(num) === 0) {
      return '';
    }
    return Number(num).toFixed(1);
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

  // 스마트 로트번호 자동완성 ('1' 입력 시 '26-001'로 변환)
  function formatSmartLotNumber(val) {
    if (!val) return '';
    const raw = String(val).trim().toUpperCase();
    if (/^\d+$/.test(raw)) {
      const currentYear = new Date().getFullYear();
      const yy = String(currentYear).slice(-2);
      const paddedNum = String(parseInt(raw, 10)).padStart(3, '0');
      return `${yy}-${paddedNum}`;
    }
    if (/^\d{2}-\d+$/.test(raw)) {
      const parts = raw.split('-');
      return `${parts[0]}-${parts[1].padStart(3, '0')}`;
    }
    return raw;
  }

  // Toast 알림
  function showToast(message = '저장되었습니다') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    const toastTimestamp = document.getElementById('toast-timestamp');
    if (!toast) return;

    if (toastMsg) toastMsg.textContent = message;
    if (toastTimestamp) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      toastTimestamp.textContent = `${timeStr} 처리 완료`;
    }

    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      toastTimer = null;
    }, 1600);
  }

  function updateDbStatus(isConnected, message = 'DB 연결됨') {
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

  function markAsDirty(isDirty = true) {
    state.isDirty = isDirty;
    updateDateStatusPills();
  }

  function updateDateStatusPills() {
    // 생산현황 상태 배지
    const inspPill = document.getElementById('insp-date-status-pill');
    if (inspPill) {
      if (state.isDirty && state.currentTab === 'tab-inspection') {
        inspPill.innerHTML = '● 미저장 변경사항<span class="dirty-indicator-dot"></span>';
        inspPill.className = 'date-status-pill';
        inspPill.style.backgroundColor = '#fef2f2';
        inspPill.style.color = '#dc2626';
        inspPill.style.border = '1px solid #fecaca';
      } else {
        const hasInspData = (state.inspectionData.process && Object.keys(state.inspectionData.process).length > 0) ||
                            (state.inspectionData.assembly && Object.keys(state.inspectionData.assembly).length > 0);
        if (hasInspData) {
          inspPill.textContent = '● 데이터 저장됨';
          inspPill.className = 'date-status-pill has-data';
          inspPill.removeAttribute('style');
        } else {
          inspPill.textContent = '○ 새 일정';
          inspPill.className = 'date-status-pill no-data';
          inspPill.removeAttribute('style');
        }
      }
    }

    // 생산일정 상태 배지
    const prodPill = document.getElementById('prod-date-status-pill');
    if (prodPill) {
      if (state.isDirty && state.currentTab === 'tab-production') {
        prodPill.innerHTML = '● 미저장 변경사항<span class="dirty-indicator-dot"></span>';
        prodPill.className = 'date-status-pill';
        prodPill.style.backgroundColor = '#fef2f2';
        prodPill.style.color = '#dc2626';
        prodPill.style.border = '1px solid #fecaca';
      } else {
        const hasProdData = Object.values(state.productionData).some(sec => 
          Object.values(sec).some(r => r && (r.qty > 0 || r.lotNo || r.note || Object.values(r.workerHours || {}).some(h => h > 0)))
        );
        if (hasProdData) {
          prodPill.textContent = '● 데이터 저장됨';
          prodPill.className = 'date-status-pill has-data';
          prodPill.removeAttribute('style');
        } else {
          prodPill.textContent = '○ 새 일정';
          prodPill.className = 'date-status-pill no-data';
          prodPill.removeAttribute('style');
        }
      }
    }
  }

  // =========================================================================
  // 4. Firebase Cloud Firestore 초기화 및 수동 연동 (비용 99% 절감 모드)
  // =========================================================================
  async function initFirebase() {
    loadLocalMasterData();
    loadLocalInspectionSchedules();
    loadLocalInspectionData(state.inspectionTargetDate);
    loadLocalProductionData(state.productionDate);

    if (typeof firebase !== 'undefined' && firebase.initializeApp) {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        isFirestoreActive = true;
        updateDbStatus(true, 'DB 연결됨');

        // Firestore에서 최신 마스터 데이터 및 일정 인덱스를 1회 get()으로 로드
        await loadMasterDataFromDb();
        await loadInspectionSchedulesFromDb();
        await loadInspectionDataFromDb(state.inspectionTargetDate);
      } catch (err) {
        console.warn('Firebase 연결 실패, 로컬 모드로 작동합니다:', err);
        fallbackToLocal();
      }
    } else {
      fallbackToLocal();
    }

    renderAll();
  }

  function fallbackToLocal() {
    isFirestoreActive = false;
    updateDbStatus(false, '로컬 모드');
    loadLocalMasterData();
    loadLocalInspectionSchedules();
    loadLocalInspectionData(state.inspectionTargetDate);
    loadLocalProductionData(state.productionDate);
    renderAll();
  }

  // =========================================================================
  // 5. 마스터 데이터 관리 (품목등록 / 기타작업 / 작업자 관리)
  // =========================================================================
  function loadLocalMasterData() {
    try {
      const rawCommon = localStorage.getItem(STORAGE_KEYS.COMMON_ITEMS);
      state.commonItems = rawCommon ? JSON.parse(rawCommon) : [...DEFAULT_COMMON_ITEMS];

      const rawEtc = localStorage.getItem(STORAGE_KEYS.ETC_ITEMS);
      state.etcItems = rawEtc ? JSON.parse(rawEtc) : [...DEFAULT_ETC_ITEMS];

      const rawWorkers = localStorage.getItem(STORAGE_KEYS.WORKERS);
      state.workers = rawWorkers ? JSON.parse(rawWorkers) : [...DEFAULT_WORKERS];
    } catch (e) {
      state.commonItems = [...DEFAULT_COMMON_ITEMS];
      state.etcItems = [...DEFAULT_ETC_ITEMS];
      state.workers = [...DEFAULT_WORKERS];
    }
  }

  async function loadMasterDataFromDb() {
    if (!isFirestoreActive || !db) return;
    try {
      const metaRef = db.collection('pms_metadata');

      const [commonDoc, etcDoc, workerDoc] = await Promise.all([
        metaRef.doc('common_items').get(),
        metaRef.doc('etc_items').get(),
        metaRef.doc('master_workers').get()
      ]);

      if (commonDoc.exists && Array.isArray(commonDoc.data().items)) {
        state.commonItems = commonDoc.data().items;
      } else {
        metaRef.doc('common_items').set({ items: state.commonItems });
      }

      if (etcDoc.exists && Array.isArray(etcDoc.data().items)) {
        state.etcItems = etcDoc.data().items;
      } else {
        metaRef.doc('etc_items').set({ items: state.etcItems });
      }

      if (workerDoc.exists && Array.isArray(workerDoc.data().workers)) {
        state.workers = workerDoc.data().workers;
      } else {
        metaRef.doc('master_workers').set({ workers: state.workers });
      }

      saveLocalMasterData();
    } catch (err) {
      console.warn('마스터 데이터 DB 로드 오류 (로컬 유지):', err);
    }
  }

  function saveLocalMasterData() {
    localStorage.setItem(STORAGE_KEYS.COMMON_ITEMS, JSON.stringify(state.commonItems));
    localStorage.setItem(STORAGE_KEYS.ETC_ITEMS, JSON.stringify(state.etcItems));
    localStorage.setItem(STORAGE_KEYS.WORKERS, JSON.stringify(state.workers));
  }

  async function saveMasterToDb() {
    saveLocalMasterData();

    if (isFirestoreActive && db) {
      try {
        const metaRef = db.collection('pms_metadata');
        await Promise.all([
          metaRef.doc('common_items').set({ items: state.commonItems }),
          metaRef.doc('etc_items').set({ items: state.etcItems }),
          metaRef.doc('master_workers').set({ workers: state.workers })
        ]);
        showToast('설정이 DB에 저장되었습니다');
        markAsDirty(false);
      } catch (err) {
        console.error('설정 DB 저장 실패:', err);
        showToast('로컬에 임시 저장되었습니다 (DB 오류)');
      }
    } else {
      showToast('로컬에 저장되었습니다');
      markAsDirty(false);
    }

    renderAll();
  }

  // =========================================================================
  // 6. 생산현황 데이터 관리 및 사이드바 (검정예정일 키 단위)
  // =========================================================================
  function loadLocalInspectionSchedules() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.INSP_SCHEDULES);
      state.inspectionSchedules = raw ? JSON.parse(raw) : [];
    } catch (e) {
      state.inspectionSchedules = [];
    }
  }

  function saveLocalInspectionSchedules() {
    localStorage.setItem(STORAGE_KEYS.INSP_SCHEDULES, JSON.stringify(state.inspectionSchedules));
  }

  async function loadInspectionSchedulesFromDb() {
    if (!isFirestoreActive || !db) return;
    try {
      const doc = await db.collection('pms_metadata').doc('inspection_schedules').get();
      if (doc.exists && Array.isArray(doc.data().schedules)) {
        state.inspectionSchedules = doc.data().schedules;
        saveLocalInspectionSchedules();
      }
    } catch (err) {
      console.warn('검정일정 목록 DB 로드 오류:', err);
    }
  }

  function loadLocalInspectionData(targetDate) {
    if (!targetDate) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.INSP_DATA_PREFIX + targetDate);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.inspectionStartDate = parsed.startDate || state.inspectionStartDate;
        state.inspectionTargetDate = parsed.targetDate || targetDate;
        // 저장된 dayCount가 있으면 적용, 없으면 기본 10일
        state.inspectionDayCount = parsed.dayCount ? Number(parsed.dayCount) : 10;
        state.inspectionData = {
          process: parsed.process || {},
          assembly: parsed.assembly || {}
        };
      } else {
        // 새 날짜인 경우 무조건 기본 10일로 초기화!
        state.inspectionDayCount = 10;
        state.inspectionData = { process: {}, assembly: {} };
      }
    } catch (e) {
      state.inspectionDayCount = 10;
      state.inspectionData = { process: {}, assembly: {} };
    }
  }

  function saveLocalInspectionData() {
    const payload = {
      targetDate: state.inspectionTargetDate,
      startDate: state.inspectionStartDate,
      dayCount: state.inspectionDayCount || 10,
      process: state.inspectionData.process || {},
      assembly: state.inspectionData.assembly || {},
      updatedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEYS.INSP_DATA_PREFIX + state.inspectionTargetDate, JSON.stringify(payload));
    localStorage.setItem(STORAGE_KEYS.LAST_INSP_START, state.inspectionStartDate);
    localStorage.setItem(STORAGE_KEYS.LAST_INSP_TARGET, state.inspectionTargetDate);
  }

  async function loadInspectionDataFromDb(targetDate) {
    if (!targetDate) return;
    loadLocalInspectionData(targetDate);

    if (!isFirestoreActive || !db) return;
    try {
      const doc = await db.collection('pms_inspection').doc(targetDate).get();
      if (doc.exists) {
        const data = doc.data();
        state.inspectionStartDate = data.startDate || state.inspectionStartDate;
        state.inspectionTargetDate = targetDate;
        state.inspectionDayCount = data.dayCount ? Number(data.dayCount) : 10;
        state.inspectionData = {
          process: data.process || {},
          assembly: data.assembly || {}
        };
        saveLocalInspectionData();
      } else {
        const raw = localStorage.getItem(STORAGE_KEYS.INSP_DATA_PREFIX + targetDate);
        if (!raw) {
          state.inspectionDayCount = 10;
        }
      }
    } catch (err) {
      console.warn('생산현황 DB 조회 실패 (로컬 유지):', err);
    }
  }

  // [생산현황 - 일정저장] 클릭 시 DB 저장
  async function saveInspectionToDb() {
    const targetDate = state.inspectionTargetDate;
    if (!targetDate) {
      alert('검정예정일을 선택해 주세요.');
      return;
    }

    saveLocalInspectionData();

    // 사이드바 일정 목록 갱신 (최근순 정렬)
    const existingIdx = state.inspectionSchedules.findIndex(s => s.targetDate === targetDate);
    const scheduleItem = {
      targetDate: targetDate,
      startDate: state.inspectionStartDate,
      dayCount: state.inspectionDayCount || 10,
      updatedAt: Date.now()
    };

    if (existingIdx >= 0) {
      state.inspectionSchedules[existingIdx] = scheduleItem;
    } else {
      state.inspectionSchedules.push(scheduleItem);
    }

    // 최신 날짜 내림차순 정렬
    state.inspectionSchedules.sort((a, b) => b.targetDate.localeCompare(a.targetDate));
    saveLocalInspectionSchedules();
    renderSidebarSchedules();

    if (isFirestoreActive && db) {
      try {
        await Promise.all([
          db.collection('pms_inspection').doc(targetDate).set({
            targetDate: targetDate,
            startDate: state.inspectionStartDate,
            dayCount: state.inspectionDayCount || 10,
            process: state.inspectionData.process || {},
            assembly: state.inspectionData.assembly || {},
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }),
          db.collection('pms_metadata').doc('inspection_schedules').set({
            schedules: state.inspectionSchedules
          })
        ]);
        showToast(`[${targetDate}] 일정이 DB에 저장되었습니다`);
        markAsDirty(false);
      } catch (err) {
        console.error('생산현황 DB 저장 실패:', err);
        showToast('로컬에 저장되었습니다 (DB 통신 오류)');
      }
    } else {
      showToast(`[${targetDate}] 로컬에 저장되었습니다`);
      markAsDirty(false);
    }

    updateDateStatusPills();
  }

  // 검정예정일 날짜 수정 기능
  async function editScheduleDate(oldTargetDate) {
    const newTargetDate = prompt('새로운 검정예정일 날짜를 입력하세요 (YYYY-MM-DD):', oldTargetDate);
    if (!newTargetDate || !newTargetDate.trim() || newTargetDate.trim() === oldTargetDate) return;

    const trimmedDate = newTargetDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      alert('올바른 날짜 형식(YYYY-MM-DD)으로 입력해 주세요.');
      return;
    }

    // 기존 데이터 로드
    let dataToMove = state.inspectionData;
    const raw = localStorage.getItem(STORAGE_KEYS.INSP_DATA_PREFIX + oldTargetDate);
    if (raw) {
      try { dataToMove = JSON.parse(raw); } catch(e){}
    }

    // 로컬스토리지 이동
    localStorage.removeItem(STORAGE_KEYS.INSP_DATA_PREFIX + oldTargetDate);
    dataToMove.targetDate = trimmedDate;
    localStorage.setItem(STORAGE_KEYS.INSP_DATA_PREFIX + trimmedDate, JSON.stringify(dataToMove));

    // 일정 인덱스 갱신
    const sItem = state.inspectionSchedules.find(s => s.targetDate === oldTargetDate);
    if (sItem) {
      sItem.targetDate = trimmedDate;
      sItem.updatedAt = Date.now();
    }
    state.inspectionSchedules.sort((a, b) => b.targetDate.localeCompare(a.targetDate));
    saveLocalInspectionSchedules();

    // Firestore 처리
    if (isFirestoreActive && db) {
      try {
        await Promise.all([
          db.collection('pms_inspection').doc(trimmedDate).set({
            ...dataToMove,
            targetDate: trimmedDate,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }),
          db.collection('pms_inspection').doc(oldTargetDate).delete(),
          db.collection('pms_metadata').doc('inspection_schedules').set({
            schedules: state.inspectionSchedules
          })
        ]);
      } catch (err) {
        console.warn('DB 날짜 이동 실패 (로컬 적용됨):', err);
      }
    }

    if (state.inspectionTargetDate === oldTargetDate) {
      state.inspectionTargetDate = trimmedDate;
      const targetInput = document.getElementById('inspection-target-date');
      if (targetInput) targetInput.value = trimmedDate;
    }

    renderSidebarSchedules();
    renderInspectionTable();
    showToast(`검정예정일이 [${trimmedDate}]로 수정되었습니다`);
  }

  // 검정예정일 삭제 기능
  async function deleteSchedule(targetDate) {
    if (!confirm(`[${targetDate}] 검정일정을 완전히 삭제하시겠습니까?`)) return;

    // 로컬 삭제
    localStorage.removeItem(STORAGE_KEYS.INSP_DATA_PREFIX + targetDate);
    state.inspectionSchedules = state.inspectionSchedules.filter(s => s.targetDate !== targetDate);
    saveLocalInspectionSchedules();

    // Firestore 삭제
    if (isFirestoreActive && db) {
      try {
        await Promise.all([
          db.collection('pms_inspection').doc(targetDate).delete(),
          db.collection('pms_metadata').doc('inspection_schedules').set({
            schedules: state.inspectionSchedules
          })
        ]);
      } catch (err) {
        console.warn('DB 삭제 오류 (로컬 삭제 완료):', err);
      }
    }

    // 만약 현재 열려있던 일정을 삭제했다면
    if (state.inspectionTargetDate === targetDate) {
      if (state.inspectionSchedules.length > 0) {
        const nextTarget = state.inspectionSchedules[0].targetDate;
        state.inspectionTargetDate = nextTarget;
        const targetInput = document.getElementById('inspection-target-date');
        if (targetInput) targetInput.value = nextTarget;
        await loadInspectionDataFromDb(nextTarget);
      } else {
        state.inspectionTargetDate = addDaysStr(getTodayDateString(), 9);
        state.inspectionDayCount = 10;
        state.inspectionData = { process: {}, assembly: {} };
        const targetInput = document.getElementById('inspection-target-date');
        if (targetInput) targetInput.value = state.inspectionTargetDate;
      }
      markAsDirty(false);
    }

    renderSidebarSchedules();
    renderInspectionTable();
    showToast(`[${targetDate}] 일정이 삭제되었습니다`);
  }

  // [+]로 추가된 일정 삭제(1일 축소) 기능
  function removeAddedInspectionDay(indexToRemove = -1) {
    if (state.inspectionDayCount <= 10) {
      alert('기본 10일간 일정은 삭제할 수 없습니다.');
      return;
    }

    const baseDate = state.inspectionStartDate;
    const count = state.inspectionDayCount;
    const targetIdx = (indexToRemove >= 10 && indexToRemove < count) ? indexToRemove : (count - 1);
    const dateStrToDel = addDaysStr(baseDate, targetIdx);

    // 해당 날짜 입력 데이터 정리
    ['process', 'assembly'].forEach(sec => {
      const secData = state.inspectionData[sec] || {};
      Object.keys(secData).forEach(itemId => {
        if (secData[itemId] && secData[itemId].daily) {
          delete secData[itemId].daily[dateStrToDel];
        }
      });
    });

    state.inspectionDayCount--;
    saveLocalInspectionData();
    markAsDirty(true);
    renderInspectionTable();
    showToast(`일정이 ${state.inspectionDayCount}일로 축소되었습니다`);
  }

  // =========================================================================
  // 7. 생산 일정 데이터 관리 (일자별 조립/검사/기타 3개 분할)
  // =========================================================================
  function loadLocalProductionData(dateStr) {
    if (!dateStr) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PROD_DATA_PREFIX + dateStr);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.selectedVarWorkerIds = Array.isArray(parsed.selectedVarWorkerIds) ? parsed.selectedVarWorkerIds : [];
        state.productionData = {
          assembly: parsed.assembly || {},
          inspection: parsed.inspection || {},
          etc: parsed.etc || {}
        };
      } else {
        state.selectedVarWorkerIds = [];
        state.productionData = { assembly: {}, inspection: {}, etc: {} };
      }
    } catch (e) {
      state.selectedVarWorkerIds = [];
      state.productionData = { assembly: {}, inspection: {}, etc: {} };
    }
  }

  function saveLocalProductionData() {
    const payload = {
      date: state.productionDate,
      selectedVarWorkerIds: state.selectedVarWorkerIds,
      assembly: state.productionData.assembly || {},
      inspection: state.productionData.inspection || {},
      etc: state.productionData.etc || {},
      updatedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEYS.PROD_DATA_PREFIX + state.productionDate, JSON.stringify(payload));
    localStorage.setItem(STORAGE_KEYS.LAST_PROD_DATE, state.productionDate);
  }

  async function loadProductionDataFromDb(dateStr) {
    if (!dateStr) return;
    loadLocalProductionData(dateStr);

    if (!isFirestoreActive || !db) return;
    try {
      const doc = await db.collection('pms_production').doc(dateStr).get();
      if (doc.exists) {
        const data = doc.data();
        state.selectedVarWorkerIds = Array.isArray(data.selectedVarWorkerIds) ? data.selectedVarWorkerIds : [];
        state.productionData = {
          assembly: data.assembly || {},
          inspection: data.inspection || {},
          etc: data.etc || {}
        };
        saveLocalProductionData();
      }
    } catch (err) {
      console.warn('생산일정 DB 조회 실패 (로컬 유지):', err);
    }
  }

  // [생산일정 - 일정저장] 클릭 시 DB 저장
  async function saveProductionToDb() {
    const prodDate = state.productionDate;
    if (!prodDate) {
      alert('생산일자를 선택해 주세요.');
      return;
    }

    saveLocalProductionData();

    if (isFirestoreActive && db) {
      try {
        await db.collection('pms_production').doc(prodDate).set({
          date: prodDate,
          selectedVarWorkerIds: state.selectedVarWorkerIds,
          assembly: state.productionData.assembly || {},
          inspection: state.productionData.inspection || {},
          etc: state.productionData.etc || {},
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast(`[${prodDate}] 생산 일정이 DB에 저장되었습니다`);
        markAsDirty(false);
      } catch (err) {
        console.error('생산일정 DB 저장 실패:', err);
        showToast('로컬에 저장되었습니다 (DB 통신 오류)');
      }
    } else {
      showToast(`[${prodDate}] 로컬에 저장되었습니다`);
      markAsDirty(false);
    }

    updateDateStatusPills();
  }

  // =========================================================================
  // 8. [생산현황] 렌더링 로직 (10일+동적열, Sticky 고정컬럼, 합계 우측정렬)
  // =========================================================================
  const INSPECTION_TABLE_CONFIGS = [
    {
      key: 'process',
      tbodyId: 'inspection-process-tbody',
      headersId: 'inspection-process-date-headers',
      groupId: 'th-insp-process-group',
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
      tbodyId: 'inspection-assembly-tbody',
      headersId: 'inspection-assembly-date-headers',
      groupId: 'th-insp-assembly-group',
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
    const baseDate = state.inspectionStartDate;
    const count = state.inspectionDayCount || 10;

    const rangeBadge = document.getElementById('insp-date-range-badge');
    if (rangeBadge) rangeBadge.textContent = `${count}일간 일정`;

    // 10일 초과 시 '-' 버튼 표시
    const subBtns = document.querySelectorAll('.btn-remove-day-trigger');
    subBtns.forEach(btn => {
      btn.style.display = (count > 10) ? 'inline-flex' : 'none';
    });

    INSPECTION_TABLE_CONFIGS.forEach(conf => {
      const headerRow = document.getElementById(conf.headersId);
      const groupTh = document.getElementById(conf.groupId);
      if (groupTh) groupTh.colSpan = count;
      if (!headerRow) return;

      headerRow.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const dateObj = addDays(baseDate, i);
        const dayOfWeekIdx = dateObj.getDay();
        const dayName = DAYS_OF_WEEK[dayOfWeekIdx];
        const mm = dateObj.getMonth() + 1;
        const dd = dateObj.getDate();

        const th = document.createElement('th');
        th.className = 'th-date';
        if (dayOfWeekIdx === 6) th.classList.add('is-sat');
        if (dayOfWeekIdx === 0) th.classList.add('is-sun');

        // 10일 이후의 추가된 날짜에는 삭제 x 버튼 제공
        if (i >= 10) {
          th.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; gap:2px;">
              <span class="date-main">${mm}/${dd}</span>
              <button type="button" class="btn-del-col-x btn-remove-col-click" data-date-idx="${i}" title="이 날짜 삭제">×</button>
            </div>
            <span class="date-sub">(${dayName})</span>
          `;
        } else {
          th.innerHTML = `
            <span class="date-main">${mm}/${dd}</span>
            <span class="date-sub">(${dayName})</span>
          `;
        }

        headerRow.appendChild(th);
      }
    });
  }

  function renderInspectionTable() {
    renderInspectionHeaders();

    const items = state.commonItems;
    const count = state.inspectionDayCount || 10;
    const baseDate = state.inspectionStartDate;

    INSPECTION_TABLE_CONFIGS.forEach(conf => {
      const tbody = document.getElementById(conf.tbodyId);
      if (!tbody) return;

      const secData = state.inspectionData[conf.key] || {};
      tbody.innerHTML = '';

      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${5 + count + 1}" style="text-align: center; padding: 25px; color: #94a3b8;">등록된 품목이 없습니다. [설정]에서 품목을 추가해 주세요.</td></tr>`;
        return;
      }

      items.forEach((item, idx) => {
        const itemRecord = secData[item.id] || { weekly: 0, daily: {} };
        const weekly = itemRecord.weekly || 0;
        const dailyMap = itemRecord.daily || {};

        let completed = 0;
        for (let i = 0; i < count; i++) {
          const dStr = addDaysStr(baseDate, i);
          completed += parseSafeInt(dailyMap[dStr]);
        }
        const balance = weekly - completed;

        const tr = document.createElement('tr');
        tr.dataset.itemId = item.id;
        tr.dataset.section = conf.key;

        // 좌측 고정 열들 (NO, 품명 가운데 정렬, 주간/완료/잔량 헤더 가운데/숫자 우측)
        let html = `
          <td class="col-fixed-no col-no" style="text-align: center;">${idx + 1}</td>
          <td class="col-fixed-item col-item" style="text-align: center;" title="${item.name}">${item.name}</td>
          <td class="col-fixed-weekly col-weekly">
            <input type="text" class="cell-input text-right input-weekly-qty num-cell"
                   data-item-id="${item.id}" data-section="${conf.key}"
                   value="${formatNumberDisplay(weekly)}" placeholder="" inputmode="numeric">
          </td>
          <td class="col-fixed-completed col-completed calc-cell completed num-cell" id="completed-${conf.key}-${item.id}">
            ${formatNumberDisplay(completed)}
          </td>
          <td class="col-fixed-balance col-balance calc-cell num-cell text-danger" id="balance-${conf.key}-${item.id}">
            ${formatNumberDisplay(balance)}
          </td>
        `;

        // 10일+ 날짜별 생산량 입력 셀들
        for (let i = 0; i < count; i++) {
          const curDateObj = addDays(baseDate, i);
          const curDateStr = addDaysStr(baseDate, i);
          const dayIdx = curDateObj.getDay();
          const isWeekend = (dayIdx === 0 || dayIdx === 6);
          const val = dailyMap[curDateStr] || 0;

          const cellClass = dayIdx === 6 ? 'td-sat' : (dayIdx === 0 ? 'td-sun' : '');

          if (isWeekend) {
            html += `
              <td class="num-cell ${cellClass}" style="text-align: center;">
                <input type="text" class="cell-input text-right is-weekend-locked num-cell" disabled value="" title="주말 입력 차단">
              </td>
            `;
          } else {
            html += `
              <td class="num-cell ${cellClass}">
                <input type="text" class="cell-input text-right input-daily-qty num-cell"
                       data-item-id="${item.id}" data-section="${conf.key}" data-date="${curDateStr}"
                       value="${formatNumberDisplay(val)}" placeholder="" inputmode="numeric">
              </td>
            `;
          }
        }

        // '+' 헤더 아래 빈 TD
        html += `<td class="summary-empty" style="background-color: #fafafa;"></td>`;

        tr.innerHTML = html;
        tbody.appendChild(tr);
      });
    });

    updateAllInspectionCalculations();
  }

  function updateAllInspectionCalculations() {
    const count = state.inspectionDayCount || 10;
    const baseDate = state.inspectionStartDate;

    INSPECTION_TABLE_CONFIGS.forEach(conf => {
      const secData = state.inspectionData[conf.key] || {};
      let totalWeekly = 0;
      let totalCompleted = 0;
      const dailyTotals = new Array(count).fill(0);

      state.commonItems.forEach(item => {
        const itemRecord = secData[item.id] || { weekly: 0, daily: {} };
        const weekly = parseSafeInt(itemRecord.weekly);
        totalWeekly += weekly;

        let itemCompleted = 0;
        for (let i = 0; i < count; i++) {
          const dStr = addDaysStr(baseDate, i);
          const val = parseSafeInt((itemRecord.daily || {})[dStr]);
          itemCompleted += val;
          dailyTotals[i] += val;
        }

        totalCompleted += itemCompleted;
        const balance = weekly - itemCompleted;

        const compCell = document.getElementById(`completed-${conf.key}-${item.id}`);
        if (compCell) compCell.textContent = formatNumberDisplay(itemCompleted);

        const balCell = document.getElementById(`balance-${conf.key}-${item.id}`);
        if (balCell) balCell.textContent = formatNumberDisplay(balance);
      });

      const totalBalance = totalWeekly - totalCompleted;

      // 합계 푸터 렌더링
      const sumWeeklyEl = document.getElementById(conf.sumWeeklyId);
      if (sumWeeklyEl) sumWeeklyEl.textContent = formatNumberDisplay(totalWeekly);

      const sumCompletedEl = document.getElementById(conf.sumCompletedId);
      if (sumCompletedEl) sumCompletedEl.textContent = formatNumberDisplay(totalCompleted);

      const sumBalanceEl = document.getElementById(conf.sumBalanceId);
      if (sumBalanceEl) sumBalanceEl.textContent = formatNumberDisplay(totalBalance);

      // 상단 요약 알약 배지
      const pillWk = document.getElementById(conf.pillWeeklyId);
      if (pillWk) pillWk.textContent = formatNumberDisplay(totalWeekly);

      const pillComp = document.getElementById(conf.pillCompletedId);
      if (pillComp) pillComp.textContent = formatNumberDisplay(totalCompleted);

      const pillBal = document.getElementById(conf.pillBalanceId);
      if (pillBal) pillBal.textContent = formatNumberDisplay(totalBalance);

      // 동적 일자별 합계 푸터 행 재구성
      const tfootRow = document.getElementById(conf.tfootId);
      if (tfootRow) {
        const staticCells = tfootRow.querySelectorAll('.col-fixed-no, .col-fixed-item, .col-fixed-weekly, .col-fixed-completed, .col-fixed-balance');
        tfootRow.innerHTML = '';
        staticCells.forEach(c => tfootRow.appendChild(c));

        for (let i = 0; i < count; i++) {
          const curDateObj = addDays(baseDate, i);
          const dayIdx = curDateObj.getDay();
          const cellClass = dayIdx === 6 ? 'td-sat' : (dayIdx === 0 ? 'td-sun' : '');

          const td = document.createElement('td');
          td.className = `num-cell font-bold ${cellClass}`;
          td.style.textAlign = 'right';
          td.style.paddingRight = '8px';
          td.textContent = formatNumberDisplay(dailyTotals[i]);
          tfootRow.appendChild(td);
        }

        const emptyTd = document.createElement('td');
        emptyTd.className = 'summary-empty';
        tfootRow.appendChild(emptyTd);
      }
    });
  }

  // =========================================================================
  // 9. [생산 일정] 렌더링 로직 (조립 / 검사 / 기타 3개 분할 및 고정/변동 작업자)
  // =========================================================================
  const PRODUCTION_SECTIONS = [
    {
      key: 'assembly',
      tableId: 'prod-table-assembly',
      tbodyId: 'prod-tbody-assembly',
      headersId: 'prod-worker-headers-assembly',
      groupId: 'th-workers-assembly',
      tfootId: 'prod-tfoot-assembly',
      sumQtyId: 'sum-prod-assembly-qty',
      sumQtyPillId: 'sum-prod-assembly-qty-pill',
      sumHoursPillId: 'sum-prod-assembly-hours-pill'
    },
    {
      key: 'inspection',
      tableId: 'prod-table-inspection',
      tbodyId: 'prod-tbody-inspection',
      headersId: 'prod-worker-headers-inspection',
      groupId: 'th-workers-inspection',
      tfootId: 'prod-tfoot-inspection',
      sumQtyId: 'sum-prod-inspection-qty',
      sumQtyPillId: 'sum-prod-inspection-qty-pill',
      sumHoursPillId: 'sum-prod-inspection-hours-pill'
    },
    {
      key: 'etc',
      tableId: 'prod-table-etc',
      tbodyId: 'prod-tbody-etc',
      headersId: 'prod-worker-headers-etc',
      groupId: 'th-workers-etc',
      tfootId: 'prod-tfoot-etc',
      sumQtyId: 'sum-prod-etc-qty',
      sumQtyPillId: 'sum-prod-etc-qty-pill',
      sumHoursPillId: 'sum-prod-etc-hours-pill'
    }
  ];

  function getActiveWorkersForProduction() {
    const fixedWorkers = state.workers.filter(w => (w.type || 'fixed') === 'fixed');
    const variableWorkers = state.workers.filter(w => w.type === 'variable' && state.selectedVarWorkerIds.includes(w.id));
    return [...fixedWorkers, ...variableWorkers];
  }

  function renderVariableWorkerSelector() {
    const selectEl = document.getElementById('select-add-var-worker');
    const chipContainer = document.getElementById('variable-workers-chip-container');
    if (!selectEl || !chipContainer) return;

    const allVarWorkers = state.workers.filter(w => w.type === 'variable');
    selectEl.innerHTML = '<option value="">+ 변동 작업자 투입...</option>';
    allVarWorkers.forEach(w => {
      const isSelected = state.selectedVarWorkerIds.includes(w.id);
      if (!isSelected) {
        selectEl.innerHTML += `<option value="${w.id}">${w.name}</option>`;
      }
    });

    chipContainer.innerHTML = '';
    state.selectedVarWorkerIds.forEach(id => {
      const worker = state.workers.find(w => w.id === id);
      if (!worker) return;

      const chip = document.createElement('span');
      chip.className = 'worker-chip';
      chip.innerHTML = `
        <span>${worker.name}</span>
        <button type="button" class="chip-remove-btn" data-worker-id="${worker.id}" title="제거">×</button>
      `;
      chipContainer.appendChild(chip);
    });
  }

  function renderProductionTable() {
    renderVariableWorkerSelector();

    const activeWorkers = getActiveWorkersForProduction();
    const workerCount = Math.max(activeWorkers.length, 1);

    PRODUCTION_SECTIONS.forEach(sec => {
      const groupTh = document.getElementById(sec.groupId);
      if (groupTh) groupTh.colSpan = workerCount;

      const headersRow = document.getElementById(sec.headersId);
      if (headersRow) {
        headersRow.innerHTML = '';
        if (activeWorkers.length === 0) {
          headersRow.innerHTML = '<th class="col-worker-time" style="color:#94a3b8;">작업자 없음</th>';
        } else {
          activeWorkers.forEach(w => {
            const isVar = w.type === 'variable';
            const badge = isVar ? '<span class="worker-badge-var">변동</span>' : '<span class="worker-badge-fixed">고정</span>';
            const th = document.createElement('th');
            th.className = 'col-worker-time';
            th.innerHTML = `${w.name} ${badge}`;
            headersRow.appendChild(th);
          });
        }
      }

      const tbody = document.getElementById(sec.tbodyId);
      if (!tbody) return;

      tbody.innerHTML = '';
      const items = (sec.key === 'etc') ? state.etcItems : state.commonItems;
      const secData = state.productionData[sec.key] || {};

      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${5 + workerCount}" style="text-align: center; padding: 25px; color: #94a3b8;">등록된 품목이 없습니다. [설정]에서 품목을 등록해 주세요.</td></tr>`;
        return;
      }

      items.forEach((item, idx) => {
        const rowData = secData[item.id] || { note: '', lotNo: '', qty: 0, workerHours: {} };
        const tr = document.createElement('tr');
        tr.dataset.itemId = item.id;
        tr.dataset.section = sec.key;

        // 모든 셀의 placeholder를 깨끗한 빈칸("")으로 처리
        let html = `
          <td class="col-no" style="text-align: center;">${idx + 1}</td>
          <td class="col-item-prod font-bold" style="text-align: center;" title="${item.name}">${item.name}</td>
          <td class="col-note">
            <input type="text" class="cell-input input-prod-note"
                   data-section="${sec.key}" data-item-id="${item.id}"
                   value="${rowData.note || ''}" placeholder="">
          </td>
          <td class="col-lot">
            <input type="text" class="cell-input text-center input-prod-lot code-font font-bold text-primary"
                   data-section="${sec.key}" data-item-id="${item.id}"
                   value="${rowData.lotNo || ''}" placeholder="">
          </td>
          <td class="col-qty">
            <input type="text" class="cell-input text-right input-prod-qty num-cell font-bold"
                   data-section="${sec.key}" data-item-id="${item.id}"
                   value="${formatNumberDisplay(rowData.qty)}" placeholder="" inputmode="numeric">
          </td>
        `;

        if (activeWorkers.length === 0) {
          html += '<td class="col-worker-time num-cell" style="background:#fafafa;"></td>';
        } else {
          activeWorkers.forEach(w => {
            const hVal = (rowData.workerHours || {})[w.id] || 0;
            html += `
              <td class="col-worker-time num-cell">
                <input type="text" class="cell-input text-right input-worker-hour num-cell"
                       data-section="${sec.key}" data-item-id="${item.id}" data-worker-id="${w.id}"
                       value="${formatFloatDisplay(hVal)}" placeholder="" inputmode="decimal">
              </td>
            `;
          });
        }

        tr.innerHTML = html;
        tbody.appendChild(tr);
      });
    });

    calculateProductionTotals();
  }

  function calculateProductionTotals() {
    const activeWorkers = getActiveWorkersForProduction();

    PRODUCTION_SECTIONS.forEach(sec => {
      const items = (sec.key === 'etc') ? state.etcItems : state.commonItems;
      const secData = state.productionData[sec.key] || {};

      let totalQty = 0;
      let totalHours = 0;
      const workerHourTotals = {};
      activeWorkers.forEach(w => { workerHourTotals[w.id] = 0; });

      items.forEach(item => {
        const row = secData[item.id] || { qty: 0, workerHours: {} };
        totalQty += parseSafeInt(row.qty);

        activeWorkers.forEach(w => {
          const h = parseSafeFloat((row.workerHours || {})[w.id]);
          workerHourTotals[w.id] += h;
          totalHours += h;
        });
      });

      const sumQtyEl = document.getElementById(sec.sumQtyId);
      if (sumQtyEl) sumQtyEl.textContent = formatNumberDisplay(totalQty);

      const pillQty = document.getElementById(sec.sumQtyPillId);
      if (pillQty) pillQty.textContent = formatNumberDisplay(totalQty);

      const pillHours = document.getElementById(sec.sumHoursPillId);
      if (pillHours) pillHours.textContent = `${totalHours.toFixed(1)}h`;

      const tfootRow = document.getElementById(sec.tfootId);
      if (tfootRow) {
        const staticCells = tfootRow.querySelectorAll('.col-no, .col-item-prod, .col-note, .col-lot, .col-qty');
        tfootRow.innerHTML = '';
        staticCells.forEach(c => tfootRow.appendChild(c));

        if (activeWorkers.length === 0) {
          const td = document.createElement('td');
          td.className = 'summary-empty';
          tfootRow.appendChild(td);
        } else {
          activeWorkers.forEach(w => {
            const td = document.createElement('td');
            td.className = 'col-worker-time num-cell font-bold';
            td.style.textAlign = 'right';
            td.style.paddingRight = '8px';
            td.textContent = formatFloatDisplay(workerHourTotals[w.id]);
            tfootRow.appendChild(td);
          });
        }
      }
    });
  }

  // =========================================================================
  // 10. [설정] 렌더링, 인라인 수정 (그 자리에서 수정) 및 드래그앤드롭
  // =========================================================================
  function renderMasterData() {
    renderMasterCommonItems();
    renderMasterEtcItems();
    renderMasterWorkers();
  }

  function renderMasterCommonItems() {
    const tbody = document.getElementById('master-common-items-tbody');
    const badge = document.getElementById('count-common-items-badge');
    if (badge) badge.textContent = `${state.commonItems.length}개`;
    if (!tbody) return;

    tbody.innerHTML = '';
    state.commonItems.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'draggable-row';
      tr.draggable = true;
      tr.dataset.dragIndex = idx;
      tr.dataset.dragType = 'commonItems';
      tr.dataset.id = item.id;

      tr.innerHTML = `
        <td style="text-align: center; color: #94a3b8; font-weight: 700;">
          <span class="drag-handle" title="끌어서 순서 변경">☰</span>${idx + 1}
        </td>
        <td class="master-name-cell font-bold text-slate-800">${item.name}</td>
        <td style="text-align: center;">
          <div class="action-btn-group">
            <button type="button" class="btn btn-xs btn-outline btn-edit-common" data-id="${item.id}">수정</button>
            <button type="button" class="btn btn-xs btn-ghost text-danger btn-del-common" data-id="${item.id}">삭제</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    bindDragAndDropEvents(tbody, 'commonItems');
  }

  function renderMasterEtcItems() {
    const tbody = document.getElementById('master-etc-items-tbody');
    const badge = document.getElementById('count-etc-items-badge');
    if (badge) badge.textContent = `${state.etcItems.length}개`;
    if (!tbody) return;

    tbody.innerHTML = '';
    state.etcItems.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'draggable-row';
      tr.draggable = true;
      tr.dataset.dragIndex = idx;
      tr.dataset.dragType = 'etcItems';
      tr.dataset.id = item.id;

      tr.innerHTML = `
        <td style="text-align: center; color: #94a3b8; font-weight: 700;">
          <span class="drag-handle" title="끌어서 순서 변경">☰</span>${idx + 1}
        </td>
        <td class="master-name-cell font-bold text-slate-800">${item.name}</td>
        <td style="text-align: center;">
          <div class="action-btn-group">
            <button type="button" class="btn btn-xs btn-outline btn-edit-etc" data-id="${item.id}">수정</button>
            <button type="button" class="btn btn-xs btn-ghost text-danger btn-del-etc" data-id="${item.id}">삭제</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    bindDragAndDropEvents(tbody, 'etcItems');
  }

  function renderMasterWorkers() {
    const tbody = document.getElementById('master-workers-tbody');
    const badge = document.getElementById('count-workers-badge');
    if (badge) badge.textContent = `${state.workers.length}명`;
    if (!tbody) return;

    tbody.innerHTML = '';
    state.workers.forEach((worker, idx) => {
      const isFixed = (worker.type || 'fixed') === 'fixed';
      const tr = document.createElement('tr');
      tr.className = 'draggable-row';
      tr.draggable = true;
      tr.dataset.dragIndex = idx;
      tr.dataset.dragType = 'workers';
      tr.dataset.id = worker.id;

      tr.innerHTML = `
        <td style="text-align: center; color: #94a3b8; font-weight: 700;">
          <span class="drag-handle" title="끌어서 순서 변경">☰</span>${idx + 1}
        </td>
        <td class="master-name-cell font-bold text-slate-800">${worker.name}</td>
        <td style="text-align: center;">
          <select class="worker-type-select ${isFixed ? 'type-fixed' : 'type-variable'}" data-worker-id="${worker.id}">
            <option value="fixed" ${isFixed ? 'selected' : ''}>고정</option>
            <option value="variable" ${!isFixed ? 'selected' : ''}>변동</option>
          </select>
        </td>
        <td style="text-align: center;">
          <div class="action-btn-group">
            <button type="button" class="btn btn-xs btn-outline btn-edit-worker" data-id="${worker.id}">수정</button>
            <button type="button" class="btn btn-xs btn-ghost text-danger btn-del-worker" data-id="${worker.id}">삭제</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    bindDragAndDropEvents(tbody, 'workers');
  }

  // 품명이 등록되어 있는 자리에서 인라인 수정 (팝업창 없이 직접 수정)
  function startMasterInlineEdit(listKey, id, tr) {
    const item = state[listKey].find(x => x.id === id);
    if (!item) return;

    const nameTd = tr.querySelector('.master-name-cell');
    const actionGroup = tr.querySelector('.action-btn-group');
    if (!nameTd || !actionGroup) return;

    const originalName = item.name;
    nameTd.innerHTML = `<input type="text" class="master-edit-input" value="${originalName}">`;
    const input = nameTd.querySelector('input');
    input.focus();
    input.select();

    actionGroup.innerHTML = `
      <button type="button" class="btn btn-xs btn-primary btn-save-inline" data-id="${id}">완료</button>
      <button type="button" class="btn btn-xs btn-ghost btn-cancel-inline" data-id="${id}">취소</button>
    `;

    let isCommitted = false;

    function commit() {
      if (isCommitted) return;
      isCommitted = true;
      const newName = input.value.trim();
      if (newName && newName !== originalName) {
        item.name = newName;
        saveLocalMasterData();
        markAsDirty(true);
        showToast(`'${newName}'(으)로 수정되었습니다`);
      }
      renderMasterData();
      renderInspectionTable();
      renderProductionTable();
    }

    function cancel() {
      if (isCommitted) return;
      isCommitted = true;
      renderMasterData();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    const saveBtn = actionGroup.querySelector('.btn-save-inline');
    if (saveBtn) saveBtn.addEventListener('click', (e) => { e.stopPropagation(); commit(); });

    const cancelBtn = actionGroup.querySelector('.btn-cancel-inline');
    if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
  }

  // 드래그 앤 드롭
  let draggedElement = null;

  function bindDragAndDropEvents(container, listKey) {
    const rows = container.querySelectorAll('.draggable-row');

    rows.forEach(row => {
      row.addEventListener('dragstart', (e) => {
        draggedElement = row;
        row.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.dragIndex);
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetRow = e.currentTarget;
        if (targetRow && targetRow !== draggedElement) {
          const rect = targetRow.getBoundingClientRect();
          const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
          targetRow.classList.toggle('drag-over-bottom', next);
          targetRow.classList.toggle('drag-over-top', !next);
        }
      });

      row.addEventListener('dragleave', (e) => {
        e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
        if (!draggedElement || draggedElement === e.currentTarget) return;

        const fromIdx = parseInt(draggedElement.dataset.dragIndex, 10);
        let toIdx = parseInt(e.currentTarget.dataset.dragIndex, 10);

        const rect = e.currentTarget.getBoundingClientRect();
        const dropBelow = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
        if (dropBelow && toIdx < fromIdx) toIdx++;
        if (!dropBelow && toIdx > fromIdx) toIdx--;

        const targetList = state[listKey];
        if (fromIdx !== toIdx && targetList) {
          const movedItem = targetList.splice(fromIdx, 1)[0];
          targetList.splice(toIdx, 0, movedItem);

          saveLocalMasterData();
          markAsDirty(true);

          if (listKey === 'commonItems') {
            renderMasterCommonItems();
            renderInspectionTable();
            renderProductionTable();
          } else if (listKey === 'etcItems') {
            renderMasterEtcItems();
            renderProductionTable();
          } else if (listKey === 'workers') {
            renderMasterWorkers();
            renderProductionTable();
          }
        }
      });

      row.addEventListener('dragend', () => {
        if (draggedElement) draggedElement.classList.remove('is-dragging');
        rows.forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        draggedElement = null;
      });
    });
  }

  // =========================================================================
  // 11. 사이드바 (연도/월 필터, 최근 일자순, 일정 날짜 수정 및 삭제 기능)
  // =========================================================================
  function renderSidebarSchedules() {
    const listContainer = document.getElementById('inspection-schedule-list');
    const countBadge = document.getElementById('insp-schedule-count');
    const yearSelect = document.getElementById('filter-insp-year');
    const monthSelect = document.getElementById('filter-insp-month');
    if (!listContainer) return;

    const schedules = state.inspectionSchedules || [];
    if (countBadge) countBadge.textContent = `${schedules.length}개`;

    // 1. 연도 드롭다운 필터 옵션 구성
    if (yearSelect) {
      const currentYearVal = yearSelect.value || 'ALL';
      const years = Array.from(new Set(schedules.map(s => s.targetDate.split('-')[0]))).sort().reverse();
      const currentYearStr = String(new Date().getFullYear());
      if (!years.includes(currentYearStr)) years.unshift(currentYearStr);

      yearSelect.innerHTML = '<option value="ALL">전체 연도</option>';
      years.forEach(y => {
        yearSelect.innerHTML += `<option value="${y}" ${y === currentYearVal ? 'selected' : ''}>${y}년</option>`;
      });
    }

    // 2. 필터링 (연도 & 월)
    const selYear = yearSelect ? yearSelect.value : 'ALL';
    const selMonth = monthSelect ? monthSelect.value : 'ALL';

    const filtered = schedules.filter(s => {
      const [y, m] = s.targetDate.split('-');
      if (selYear !== 'ALL' && y !== selYear) return false;
      if (selMonth !== 'ALL' && parseInt(m, 10) !== parseInt(selMonth, 10)) return false;
      return true;
    });

    listContainer.innerHTML = '';
    if (filtered.length === 0) {
      listContainer.innerHTML = `<div class="schedule-empty-msg">해당 기간의 일정이 없습니다.<br>[일정저장]을 눌러 추가하세요.</div>`;
      return;
    }

    const todayStr = getTodayDateString();

    filtered.forEach(item => {
      const btn = document.createElement('div');
      btn.className = `schedule-item-btn ${item.targetDate === state.inspectionTargetDate ? 'active' : ''}`;
      btn.dataset.targetDate = item.targetDate;

      const dateObj = new Date(item.targetDate + 'T00:00:00');
      const dayName = DAYS_OF_WEEK[dateObj.getDay()];
      const isToday = item.targetDate === todayStr;

      btn.innerHTML = `
        <div class="schedule-item-wrap">
          <div class="schedule-item-info">
            <div class="schedule-date-text">
              <span>${item.targetDate} (${dayName})</span>
              ${isToday ? '<span class="schedule-badge-today">오늘</span>' : ''}
            </div>
            <div class="schedule-sub-text">
              시작일: ${item.startDate || '-'} (${item.dayCount || 10}일간)
            </div>
          </div>
          <div class="schedule-item-actions">
            <button type="button" class="btn-schedule-action btn-schedule-edit" data-target-date="${item.targetDate}" title="검정예정일 날짜 수정">수정</button>
            <button type="button" class="btn-schedule-action btn-schedule-del" data-target-date="${item.targetDate}" title="일정 삭제">삭제</button>
          </div>
        </div>
      `;

      // 아이템 본체 클릭 시 일정 불러오기
      btn.addEventListener('click', async (e) => {
        if (e.target.closest('.schedule-item-actions')) return; // 수정/삭제 클릭 시 일정 전환 방지

        if (state.isDirty) {
          const conf = confirm('저장되지 않은 변경사항이 있습니다. 저장하지 않고 다른 일정을 불러오시겠습니까?');
          if (!conf) return;
        }

        state.inspectionTargetDate = item.targetDate;
        state.inspectionStartDate = item.startDate || state.inspectionStartDate;
        state.inspectionDayCount = item.dayCount ? Number(item.dayCount) : 10;

        const dateInput = document.getElementById('inspection-date');
        const targetInput = document.getElementById('inspection-target-date');
        if (dateInput) dateInput.value = state.inspectionStartDate;
        if (targetInput) targetInput.value = state.inspectionTargetDate;

        await loadInspectionDataFromDb(item.targetDate);
        markAsDirty(false);
        renderSidebarSchedules();
        renderInspectionTable();
      });

      listContainer.appendChild(btn);
    });
  }

  // =========================================================================
  // 12. 전체 화면 렌더링
  // =========================================================================
  function renderAll() {
    const inspDateEl = document.getElementById('inspection-date');
    if (inspDateEl) inspDateEl.value = state.inspectionStartDate;

    const inspTargetEl = document.getElementById('inspection-target-date');
    if (inspTargetEl) inspTargetEl.value = state.inspectionTargetDate;

    const prodDateEl = document.getElementById('production-date');
    if (prodDateEl) prodDateEl.value = state.productionDate;

    renderSidebarSchedules();
    renderInspectionTable();
    renderProductionTable();
    renderMasterData();
    updateDateStatusPills();
  }

  // =========================================================================
  // 13. 이벤트 리스너 바인딩
  // =========================================================================
  function initEventListeners() {
    // -------------------------------------------------------------
    // (A) 브라우저 이탈 방지 경고 (beforeunload)
    // -------------------------------------------------------------
    window.addEventListener('beforeunload', (e) => {
      if (state.isDirty) {
        e.preventDefault();
        e.returnValue = '저장되지 않은 변경사항이 있습니다. 나가시겠습니까?';
        return e.returnValue;
      }
    });

    // -------------------------------------------------------------
    // (B) 인풋 포커스 시 자동 전체 선택 (기존 값 즉시 덮어쓰기 지원)
    // -------------------------------------------------------------
    document.addEventListener('focusin', (e) => {
      const target = e.target;
      if (target && target.tagName === 'INPUT' && (
        target.classList.contains('input-daily-qty') ||
        target.classList.contains('input-weekly-qty') ||
        target.classList.contains('input-prod-qty') ||
        target.classList.contains('input-worker-hour') ||
        target.classList.contains('input-prod-lot') ||
        target.classList.contains('input-prod-note')
      )) {
        setTimeout(() => {
          target.select();
        }, 30);
      }
    });

    document.addEventListener('mouseup', (e) => {
      const target = e.target;
      if (target && target.tagName === 'INPUT' && (
        target.classList.contains('input-daily-qty') ||
        target.classList.contains('input-weekly-qty') ||
        target.classList.contains('input-prod-qty') ||
        target.classList.contains('input-worker-hour')
      )) {
        if (document.activeElement === target && target.selectionStart === target.selectionEnd) {
          target.select();
        }
      }
    });

    // -------------------------------------------------------------
    // (C) 탭 네비게이션
    // -------------------------------------------------------------
    const tabBtns = document.querySelectorAll('.nav-tab');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const tabId = btn.getAttribute('data-tab');
        if (state.currentTab === tabId) return;

        if (state.isDirty) {
          const proceed = confirm('저장되지 않은 변경사항이 있습니다. 다른 탭으로 이동하시겠습니까?');
          if (!proceed) return;
        }

        tabBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const targetPane = document.getElementById(tabId);
        if (targetPane) targetPane.classList.add('active');

        state.currentTab = tabId;
        markAsDirty(false);

        if (tabId === 'tab-production') {
          await loadProductionDataFromDb(state.productionDate);
          renderProductionTable();
        } else if (tabId === 'tab-inspection') {
          renderSidebarSchedules();
          renderInspectionTable();
        }
      });
    });

    // -------------------------------------------------------------
    // (D) 뷰 모드 전환
    // -------------------------------------------------------------
    const btnViewDefault = document.getElementById('btn-view-default');
    const btnViewWide = document.getElementById('btn-view-wide');
    if (btnViewDefault && btnViewWide) {
      if (state.viewMode === 'wide') {
        document.body.className = 'view-mode-wide';
        btnViewWide.classList.add('active');
        btnViewDefault.classList.remove('active');
      }

      btnViewDefault.addEventListener('click', () => {
        document.body.className = 'view-mode-default';
        btnViewDefault.classList.add('active');
        btnViewWide.classList.remove('active');
        state.viewMode = 'default';
        localStorage.setItem(STORAGE_KEYS.VIEW_MODE, 'default');
      });

      btnViewWide.addEventListener('click', () => {
        document.body.className = 'view-mode-wide';
        btnViewWide.classList.add('active');
        btnViewDefault.classList.remove('active');
        state.viewMode = 'wide';
        localStorage.setItem(STORAGE_KEYS.VIEW_MODE, 'wide');
      });
    }

    // -------------------------------------------------------------
    // (E) 생산현황 날짜 변경 및 일정 저장
    // -------------------------------------------------------------
    const inspDateInput = document.getElementById('inspection-date');
    if (inspDateInput) {
      inspDateInput.addEventListener('change', (e) => {
        state.inspectionStartDate = e.target.value;
        saveLocalInspectionData();
        markAsDirty(true);
        renderInspectionTable();
      });
    }

    const inspPrevDay = document.getElementById('btn-insp-prev-day');
    if (inspPrevDay) {
      inspPrevDay.addEventListener('click', () => {
        state.inspectionStartDate = addDaysStr(state.inspectionStartDate, -1);
        if (inspDateInput) inspDateInput.value = state.inspectionStartDate;
        saveLocalInspectionData();
        markAsDirty(true);
        renderInspectionTable();
      });
    }

    const inspNextDay = document.getElementById('btn-insp-next-day');
    if (inspNextDay) {
      inspNextDay.addEventListener('click', () => {
        state.inspectionStartDate = addDaysStr(state.inspectionStartDate, 1);
        if (inspDateInput) inspDateInput.value = state.inspectionStartDate;
        saveLocalInspectionData();
        markAsDirty(true);
        renderInspectionTable();
      });
    }

    const inspTodayBtn = document.getElementById('btn-insp-today');
    if (inspTodayBtn) {
      inspTodayBtn.addEventListener('click', () => {
        state.inspectionStartDate = getTodayDateString();
        if (inspDateInput) inspDateInput.value = state.inspectionStartDate;
        saveLocalInspectionData();
        markAsDirty(true);
        renderInspectionTable();
      });
    }

    // 검정예정일 날짜 선택기
    const inspTargetInput = document.getElementById('inspection-target-date');
    if (inspTargetInput) {
      inspTargetInput.addEventListener('change', async (e) => {
        if (state.isDirty) {
          const conf = confirm('저장되지 않은 변경사항이 있습니다. 이동하시겠습니까?');
          if (!conf) {
            e.target.value = state.inspectionTargetDate;
            return;
          }
        }
        state.inspectionTargetDate = e.target.value;
        await loadInspectionDataFromDb(state.inspectionTargetDate);
        markAsDirty(false);
        renderSidebarSchedules();
        renderInspectionTable();
      });
    }

    const inspPrevTarget = document.getElementById('btn-insp-prev-target');
    if (inspPrevTarget) {
      inspPrevTarget.addEventListener('click', async () => {
        const nextVal = addDaysStr(state.inspectionTargetDate, -1);
        state.inspectionTargetDate = nextVal;
        if (inspTargetInput) inspTargetInput.value = nextVal;
        await loadInspectionDataFromDb(nextVal);
        markAsDirty(false);
        renderSidebarSchedules();
        renderInspectionTable();
      });
    }

    const inspNextTarget = document.getElementById('btn-insp-next-target');
    if (inspNextTarget) {
      inspNextTarget.addEventListener('click', async () => {
        const nextVal = addDaysStr(state.inspectionTargetDate, 1);
        state.inspectionTargetDate = nextVal;
        if (inspTargetInput) inspTargetInput.value = nextVal;
        await loadInspectionDataFromDb(nextVal);
        markAsDirty(false);
        renderSidebarSchedules();
        renderInspectionTable();
      });
    }

    // [+] 버튼 클릭 시 일정 1일 추가
    document.addEventListener('click', (e) => {
      if (e.target && e.target.classList.contains('btn-add-day-trigger')) {
        state.inspectionDayCount = (state.inspectionDayCount || 10) + 1;
        saveLocalInspectionData();
        markAsDirty(true);
        renderInspectionTable();
        showToast(`일정이 ${state.inspectionDayCount}일로 확장되었습니다`);
      }

      // [-] 버튼 클릭 시 추가된 일정 1일 축소
      if (e.target && e.target.classList.contains('btn-remove-day-trigger')) {
        removeAddedInspectionDay();
      }

      // 날짜 헤더의 개별 [x] 클릭 시 해당 일자 삭제
      if (e.target && e.target.classList.contains('btn-remove-col-click')) {
        const idx = parseInt(e.target.dataset.dateIdx, 10);
        removeAddedInspectionDay(idx);
      }

      // 사이드바 검정일정 날짜 수정 버튼
      if (e.target && e.target.classList.contains('btn-schedule-edit')) {
        e.stopPropagation();
        const tDate = e.target.dataset.targetDate;
        editScheduleDate(tDate);
      }

      // 사이드바 검정일정 삭제 버튼
      if (e.target && e.target.classList.contains('btn-schedule-del')) {
        e.stopPropagation();
        const tDate = e.target.dataset.targetDate;
        deleteSchedule(tDate);
      }
    });

    // [생산현황] 일정저장 버튼 클릭
    const btnInspSave = document.getElementById('btn-insp-save');
    if (btnInspSave) {
      btnInspSave.addEventListener('click', () => {
        saveInspectionToDb();
      });
    }

    // 생산현황 데이터 초기화
    const btnInspClear = document.getElementById('btn-insp-clear-day');
    if (btnInspClear) {
      btnInspClear.addEventListener('click', () => {
        if (confirm(`[${state.inspectionTargetDate}] 생산현황 데이터를 초기화하시겠습니까?`)) {
          state.inspectionData = { process: {}, assembly: {} };
          state.inspectionDayCount = 10;
          saveLocalInspectionData();
          markAsDirty(true);
          renderInspectionTable();
          showToast('초기화되었습니다 (일정저장을 눌러야 DB에 반영됩니다)');
        }
      });
    }

    // 사이드바 연도/월 필터
    const filterYear = document.getElementById('filter-insp-year');
    if (filterYear) {
      filterYear.addEventListener('change', () => {
        renderSidebarSchedules();
      });
    }

    const filterMonth = document.getElementById('filter-insp-month');
    if (filterMonth) {
      filterMonth.addEventListener('change', () => {
        renderSidebarSchedules();
      });
    }

    // -------------------------------------------------------------
    // (F) 생산현황 테이블 입력 처리
    // -------------------------------------------------------------
    document.addEventListener('input', (e) => {
      const target = e.target;
      if (!target) return;

      if (target.classList.contains('input-weekly-qty')) {
        const itemId = target.dataset.itemId;
        const section = target.dataset.section;
        const rawVal = target.value.replace(/[^0-9]/g, '');
        const numVal = parseSafeInt(rawVal);

        if (!state.inspectionData[section]) state.inspectionData[section] = {};
        if (!state.inspectionData[section][itemId]) state.inspectionData[section][itemId] = { weekly: 0, daily: {} };
        state.inspectionData[section][itemId].weekly = numVal;

        saveLocalInspectionData();
        markAsDirty(true);
        updateAllInspectionCalculations();
      }

      if (target.classList.contains('input-daily-qty')) {
        const itemId = target.dataset.itemId;
        const section = target.dataset.section;
        const dateStr = target.dataset.date;
        const rawVal = target.value.replace(/[^0-9]/g, '');
        const numVal = parseSafeInt(rawVal);

        if (!state.inspectionData[section]) state.inspectionData[section] = {};
        if (!state.inspectionData[section][itemId]) state.inspectionData[section][itemId] = { weekly: 0, daily: {} };
        if (!state.inspectionData[section][itemId].daily) state.inspectionData[section][itemId].daily = {};
        state.inspectionData[section][itemId].daily[dateStr] = numVal;

        saveLocalInspectionData();
        markAsDirty(true);
        updateAllInspectionCalculations();
      }
    });

    // -------------------------------------------------------------
    // (G) 생산 일정 날짜 변경 및 변동 작업자 배정, 일정 저장
    // -------------------------------------------------------------
    const prodDateInput = document.getElementById('production-date');
    if (prodDateInput) {
      prodDateInput.addEventListener('change', async (e) => {
        if (state.isDirty) {
          const conf = confirm('저장되지 않은 변경사항이 있습니다. 다른 날짜로 이동하시겠습니까?');
          if (!conf) {
            e.target.value = state.productionDate;
            return;
          }
        }
        state.productionDate = e.target.value;
        await loadProductionDataFromDb(state.productionDate);
        markAsDirty(false);
        renderProductionTable();
      });
    }

    const prodPrevDay = document.getElementById('btn-prod-prev-day');
    if (prodPrevDay) {
      prodPrevDay.addEventListener('click', async () => {
        const nextVal = addDaysStr(state.productionDate, -1);
        state.productionDate = nextVal;
        if (prodDateInput) prodDateInput.value = nextVal;
        await loadProductionDataFromDb(nextVal);
        markAsDirty(false);
        renderProductionTable();
      });
    }

    const prodNextDay = document.getElementById('btn-prod-next-day');
    if (prodNextDay) {
      prodNextDay.addEventListener('click', async () => {
        const nextVal = addDaysStr(state.productionDate, 1);
        state.productionDate = nextVal;
        if (prodDateInput) prodDateInput.value = nextVal;
        await loadProductionDataFromDb(nextVal);
        markAsDirty(false);
        renderProductionTable();
      });
    }

    const prodTodayBtn = document.getElementById('btn-prod-today');
    if (prodTodayBtn) {
      prodTodayBtn.addEventListener('click', async () => {
        const todayStr = getTodayDateString();
        state.productionDate = todayStr;
        if (prodDateInput) prodDateInput.value = todayStr;
        await loadProductionDataFromDb(todayStr);
        markAsDirty(false);
        renderProductionTable();
      });
    }

    // 변동 작업자 투입 드롭다운
    const selectVarWorker = document.getElementById('select-add-var-worker');
    if (selectVarWorker) {
      selectVarWorker.addEventListener('change', (e) => {
        const wId = e.target.value;
        if (!wId) return;

        if (!state.selectedVarWorkerIds.includes(wId)) {
          state.selectedVarWorkerIds.push(wId);
          saveLocalProductionData();
          markAsDirty(true);
          renderProductionTable();
        }
        e.target.value = '';
      });
    }

    // 변동 작업자 칩 제거 버튼
    document.addEventListener('click', (e) => {
      if (e.target && e.target.classList.contains('chip-remove-btn')) {
        const wId = e.target.dataset.workerId;
        state.selectedVarWorkerIds = state.selectedVarWorkerIds.filter(id => id !== wId);
        saveLocalProductionData();
        markAsDirty(true);
        renderProductionTable();
      }
    });

    // [생산일정] 일정저장 버튼 클릭
    const btnProdSave = document.getElementById('btn-prod-save');
    if (btnProdSave) {
      btnProdSave.addEventListener('click', () => {
        saveProductionToDb();
      });
    }

    // 생산일정 초기화
    const btnProdClear = document.getElementById('btn-prod-clear-day');
    if (btnProdClear) {
      btnProdClear.addEventListener('click', () => {
        if (confirm(`[${state.productionDate}] 생산일정 데이터를 초기화하시겠습니까?`)) {
          state.productionData = { assembly: {}, inspection: {}, etc: {} };
          state.selectedVarWorkerIds = [];
          saveLocalProductionData();
          markAsDirty(true);
          renderProductionTable();
          showToast('초기화되었습니다 (일정저장을 눌러야 DB에 반영됩니다)');
        }
      });
    }

    // -------------------------------------------------------------
    // (H) 생산 일정 입력 처리 (비고, 로트, 수량, 작업시간)
    // -------------------------------------------------------------
    document.addEventListener('input', (e) => {
      const target = e.target;
      if (!target) return;

      const sec = target.dataset.section;
      const itemId = target.dataset.itemId;
      if (!sec || !itemId) return;

      if (!state.productionData[sec]) state.productionData[sec] = {};
      if (!state.productionData[sec][itemId]) {
        state.productionData[sec][itemId] = { note: '', lotNo: '', qty: 0, workerHours: {} };
      }
      const record = state.productionData[sec][itemId];

      if (target.classList.contains('input-prod-note')) {
        record.note = target.value;
        saveLocalProductionData();
        markAsDirty(true);
      }

      if (target.classList.contains('input-prod-lot')) {
        record.lotNo = target.value;
        saveLocalProductionData();
        markAsDirty(true);
      }

      if (target.classList.contains('input-prod-qty')) {
        const rawVal = target.value.replace(/[^0-9]/g, '');
        record.qty = parseSafeInt(rawVal);
        saveLocalProductionData();
        markAsDirty(true);
        calculateProductionTotals();
      }

      if (target.classList.contains('input-worker-hour')) {
        const wId = target.dataset.workerId;
        const rawVal = target.value.replace(/[^0-9.]/g, '');
        if (!record.workerHours) record.workerHours = {};
        record.workerHours[wId] = parseSafeFloat(rawVal);
        saveLocalProductionData();
        markAsDirty(true);
        calculateProductionTotals();
      }
    });

    document.addEventListener('blur', (e) => {
      const target = e.target;
      if (target && target.classList.contains('input-prod-lot')) {
        const formatted = formatSmartLotNumber(target.value);
        target.value = formatted;
        const sec = target.dataset.section;
        const itemId = target.dataset.itemId;
        if (sec && itemId && state.productionData[sec] && state.productionData[sec][itemId]) {
          state.productionData[sec][itemId].lotNo = formatted;
          saveLocalProductionData();
          markAsDirty(true);
        }
      }
    }, true);

    // -------------------------------------------------------------
    // (I) 스프레드시트 키보드 탐색 (Tab, Enter, 방향키)
    // -------------------------------------------------------------
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      if (!target || target.tagName !== 'INPUT') return;

      const isGridInput = target.classList.contains('cell-input');
      if (!isGridInput) return;

      const currentCell = target.closest('td');
      const currentRow = target.closest('tr');
      if (!currentCell || !currentRow) return;

      const table = currentRow.closest('table');
      if (!table) return;

      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'ArrowDown') {
        e.preventDefault();
        const cellIndex = Array.from(currentRow.children).indexOf(currentCell);
        const nextRow = currentRow.nextElementSibling;
        if (nextRow) {
          const nextCell = nextRow.children[cellIndex];
          const nextInput = nextCell ? nextCell.querySelector('input:not([disabled])') : null;
          if (nextInput) nextInput.focus();
        }
      }

      if ((e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowUp') {
        e.preventDefault();
        const cellIndex = Array.from(currentRow.children).indexOf(currentCell);
        const prevRow = currentRow.previousElementSibling;
        if (prevRow) {
          const prevCell = prevRow.children[cellIndex];
          const prevInput = prevCell ? prevCell.querySelector('input:not([disabled])') : null;
          if (prevInput) prevInput.focus();
        }
      }
    });

    // -------------------------------------------------------------
    // (J) 설정 (마스터 관리) 품목 추가, 수정, 삭제 & 저장
    // -------------------------------------------------------------
    const formAddCommon = document.getElementById('form-add-common-item');
    if (formAddCommon) {
      formAddCommon.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('input-new-common-item');
        const name = input ? input.value.trim() : '';
        if (!name) return;

        state.commonItems.push({
          id: generateUniqueId('item'),
          name: name
        });
        input.value = '';
        saveLocalMasterData();
        markAsDirty(true);
        renderMasterCommonItems();
        renderInspectionTable();
        renderProductionTable();
        showToast('품목이 추가되었습니다 (설정 저장을 눌러 DB에 반영하세요)');
      });
    }

    const formAddEtc = document.getElementById('form-add-etc-item');
    if (formAddEtc) {
      formAddEtc.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('input-new-etc-item');
        const name = input ? input.value.trim() : '';
        if (!name) return;

        state.etcItems.push({
          id: generateUniqueId('etc'),
          name: name
        });
        input.value = '';
        saveLocalMasterData();
        markAsDirty(true);
        renderMasterEtcItems();
        renderProductionTable();
        showToast('기타작업이 추가되었습니다 (설정 저장을 눌러 DB에 반영하세요)');
      });
    }

    const formAddWorker = document.getElementById('form-add-worker');
    if (formAddWorker) {
      formAddWorker.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('input-new-worker');
        const name = input ? input.value.trim() : '';
        if (!name) return;

        state.workers.push({
          id: generateUniqueId('worker'),
          name: name,
          type: 'fixed'
        });
        input.value = '';
        saveLocalMasterData();
        markAsDirty(true);
        renderMasterWorkers();
        renderProductionTable();
        showToast('작업자가 추가되었습니다 (설정 저장을 눌러 DB에 반영하세요)');
      });
    }

    document.addEventListener('change', (e) => {
      if (e.target && e.target.classList.contains('worker-type-select')) {
        const wId = e.target.dataset.workerId;
        const newType = e.target.value;
        const worker = state.workers.find(w => w.id === wId);
        if (worker) {
          worker.type = newType;
          e.target.className = `worker-type-select ${newType === 'fixed' ? 'type-fixed' : 'type-variable'}`;
          saveLocalMasterData();
          markAsDirty(true);
          renderProductionTable();
          showToast(`[${worker.name}] 작업자 상태가 '${newType === 'fixed' ? '고정' : '변동'}'으로 변경되었습니다`);
        }
      }
    });

    // 마스터 품목 & 작업자 수정/삭제 (인라인 수정 연계)
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;

      // 1. 공통 품목 인라인 수정
      if (target.classList.contains('btn-edit-common')) {
        const tr = target.closest('tr');
        const id = target.dataset.id;
        startMasterInlineEdit('commonItems', id, tr);
      }

      // 2. 공통 품목 삭제
      if (target.classList.contains('btn-del-common')) {
        const id = target.dataset.id;
        const item = state.commonItems.find(i => i.id === id);
        if (!item) return;
        if (confirm(`'${item.name}' 품목을 삭제하시겠습니까?`)) {
          state.commonItems = state.commonItems.filter(i => i.id !== id);
          saveLocalMasterData();
          markAsDirty(true);
          renderMasterCommonItems();
          renderInspectionTable();
          renderProductionTable();
        }
      }

      // 3. 기타작업 인라인 수정
      if (target.classList.contains('btn-edit-etc')) {
        const tr = target.closest('tr');
        const id = target.dataset.id;
        startMasterInlineEdit('etcItems', id, tr);
      }

      // 4. 기타작업 삭제
      if (target.classList.contains('btn-del-etc')) {
        const id = target.dataset.id;
        const item = state.etcItems.find(i => i.id === id);
        if (!item) return;
        if (confirm(`'${item.name}' 항목을 삭제하시겠습니까?`)) {
          state.etcItems = state.etcItems.filter(i => i.id !== id);
          saveLocalMasterData();
          markAsDirty(true);
          renderMasterEtcItems();
          renderProductionTable();
        }
      }

      // 5. 작업자 인라인 수정
      if (target.classList.contains('btn-edit-worker')) {
        const tr = target.closest('tr');
        const id = target.dataset.id;
        startMasterInlineEdit('workers', id, tr);
      }

      // 6. 작업자 삭제
      if (target.classList.contains('btn-del-worker')) {
        const id = target.dataset.id;
        const worker = state.workers.find(w => w.id === id);
        if (!worker) return;
        if (confirm(`'${worker.name}' 작업자를 삭제하시겠습니까?`)) {
          state.workers = state.workers.filter(w => w.id !== id);
          state.selectedVarWorkerIds = state.selectedVarWorkerIds.filter(wId => wId !== id);
          saveLocalMasterData();
          markAsDirty(true);
          renderMasterWorkers();
          renderProductionTable();
        }
      }
    });

    // [설정 저장] 버튼 클릭
    const btnSaveMaster = document.getElementById('btn-save-master');
    if (btnSaveMaster) {
      btnSaveMaster.addEventListener('click', () => {
        saveMasterToDb();
      });
    }

    // -------------------------------------------------------------
    // (K) CSV 내보내기 & 전체 백업/복원
    // -------------------------------------------------------------
    const btnExportInspCsv = document.getElementById('btn-export-inspection-csv');
    if (btnExportInspCsv) {
      btnExportInspCsv.addEventListener('click', () => exportInspectionToCsv());
    }

    const btnExportProdCsv = document.getElementById('btn-export-production-csv');
    if (btnExportProdCsv) {
      btnExportProdCsv.addEventListener('click', () => exportProductionToCsv());
    }

    const btnExportJson = document.getElementById('btn-export-json');
    if (btnExportJson) {
      btnExportJson.addEventListener('click', () => exportAllToJson());
    }

    const inputImportJson = document.getElementById('input-import-json');
    if (inputImportJson) {
      inputImportJson.addEventListener('change', (e) => importAllFromJson(e));
    }
  }

  // =========================================================================
  // 14. 데이터 내보내기 (CSV, JSON 백업/복원)
  // =========================================================================
  function exportInspectionToCsv() {
    const baseDate = state.inspectionStartDate;
    const count = state.inspectionDayCount || 10;
    let csv = '\uFEFF공정,No,품명,주간물량,생산완료,잔량';

    for (let i = 0; i < count; i++) {
      const dObj = addDays(baseDate, i);
      const mm = dObj.getMonth() + 1;
      const dd = dObj.getDate();
      const day = DAYS_OF_WEEK[dObj.getDay()];
      csv += `,${mm}/${dd}(${day})`;
    }
    csv += '\n';

    INSPECTION_TABLE_CONFIGS.forEach(conf => {
      const secData = state.inspectionData[conf.key] || {};
      const secTitle = conf.key === 'process' ? '공정검사' : '자동화조립';

      state.commonItems.forEach((item, idx) => {
        const row = secData[item.id] || { weekly: 0, daily: {} };
        const weekly = parseSafeInt(row.weekly);
        let completed = 0;
        const dailyVals = [];

        for (let i = 0; i < count; i++) {
          const dStr = addDaysStr(baseDate, i);
          const v = parseSafeInt((row.daily || {})[dStr]);
          completed += v;
          dailyVals.push(v);
        }
        const balance = weekly - completed;

        csv += `"${secTitle}",${idx + 1},"${item.name}",${weekly},${completed},${balance},${dailyVals.join(',')}\n`;
      });
    });

    downloadFile(csv, `생산현황_${state.inspectionTargetDate}.csv`, 'text/csv;charset=utf-8;');
  }

  function exportProductionToCsv() {
    const activeWorkers = getActiveWorkersForProduction();
    let csv = '\uFEFF공정,No,품명,비고,로트번호,생산수량';
    activeWorkers.forEach(w => {
      csv += `,"${w.name}(${w.type === 'variable' ? '변동' : '고정'})"`;
    });
    csv += '\n';

    PRODUCTION_SECTIONS.forEach(sec => {
      const items = (sec.key === 'etc') ? state.etcItems : state.commonItems;
      const secData = state.productionData[sec.key] || {};
      const secTitle = sec.key === 'assembly' ? '조립' : (sec.key === 'inspection' ? '검사' : '기타');

      items.forEach((item, idx) => {
        const row = secData[item.id] || { note: '', lotNo: '', qty: 0, workerHours: {} };
        const hours = activeWorkers.map(w => parseSafeFloat((row.workerHours || {})[w.id]));
        csv += `"${secTitle}",${idx + 1},"${item.name}","${row.note || ''}","${row.lotNo || ''}",${row.qty || 0},${hours.join(',')}\n`;
      });
    });

    downloadFile(csv, `생산일정_${state.productionDate}.csv`, 'text/csv;charset=utf-8;');
  }

  function exportAllToJson() {
    const backup = {
      version: '4.1',
      exportedAt: new Date().toISOString(),
      commonItems: state.commonItems,
      etcItems: state.etcItems,
      workers: state.workers,
      inspectionSchedules: state.inspectionSchedules,
      currentInspection: {
        startDate: state.inspectionStartDate,
        targetDate: state.inspectionTargetDate,
        dayCount: state.inspectionDayCount || 10,
        data: state.inspectionData
      },
      currentProduction: {
        date: state.productionDate,
        selectedVarWorkerIds: state.selectedVarWorkerIds,
        data: state.productionData
      }
    };

    const jsonStr = JSON.stringify(backup, null, 2);
    downloadFile(jsonStr, `PMS_전체데이터백업_${getTodayDateString()}.json`, 'application/json');
  }

  function importAllFromJson(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed.commonItems) state.commonItems = parsed.commonItems;
        if (parsed.etcItems) state.etcItems = parsed.etcItems;
        if (parsed.workers) state.workers = parsed.workers;
        if (parsed.inspectionSchedules) state.inspectionSchedules = parsed.inspectionSchedules;
        if (parsed.currentInspection) {
          state.inspectionStartDate = parsed.currentInspection.startDate || state.inspectionStartDate;
          state.inspectionTargetDate = parsed.currentInspection.targetDate || state.inspectionTargetDate;
          state.inspectionDayCount = parsed.currentInspection.dayCount || 10;
          state.inspectionData = parsed.currentInspection.data || state.inspectionData;
        }
        if (parsed.currentProduction) {
          state.productionDate = parsed.currentProduction.date || state.productionDate;
          state.selectedVarWorkerIds = parsed.currentProduction.selectedVarWorkerIds || [];
          state.productionData = parsed.currentProduction.data || state.productionData;
        }

        saveLocalMasterData();
        saveLocalInspectionSchedules();
        saveLocalInspectionData();
        saveLocalProductionData();
        markAsDirty(true);
        renderAll();
        showToast('데이터가 성공적으로 복원되었습니다 (DB 저장을 눌러 영구 저장하세요)');
      } catch (err) {
        alert('백업 파일 형식이 올바르지 않습니다.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // 상단 시계 갱신
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

  // =========================================================================
  // 15. DOM 준비 완료 및 시스템 기동
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    startClock();
    initFirebase();
  });

})();
