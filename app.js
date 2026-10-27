/**
 * 감지기 생산현황 관리 시스템 - 프런트엔드 애플리케이션 코어 로직
 * (검정 일정, 생산 일정, 마스터 설정, 일별 독립 자동저장, 로트 마스킹, 실시간 Toast)
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 초기 상수 및 마스터 기본 데이터
  // =========================================================================
  const STORAGE_KEYS = {
    MASTER_ITEMS: 'pms_master_items_v1',
    MASTER_WORKERS: 'pms_master_workers_v1',
    INSPECTION_PREFIX: 'pms_inspection_v1_',
    PRODUCTION_PREFIX: 'pms_production_v1_'
  };

  // 초기 기본 품목 (감지기 전문 품목)
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

  // 초기 기본 작업자
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
  // 2. 애플리케이션 전역 상태 (State)
  // =========================================================================
  const state = {
    currentTab: 'tab-inspection',
    inspectionDate: getTodayDateString(),
    productionDate: getTodayDateString(),
    items: [],
    workers: [],
    inspectionData: {}, // { itemId: { weeklyQty: number, dailyQuantities: [11] } }
    productionRows: []  // [ { id, itemId, lotNo, qty, workerHours: { [workerId]: number } } ]
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

  function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num) || num === '') return '0';
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

  // =========================================================================
  // 4. Toast 알림 매니저 (1.5초 노출 후 부드러운 퇴장)
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
      toastTimestamp.textContent = `${timeStr} 자동저장 완료`;
    }

    toast.classList.add('show');

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      toastTimer = null;
    }, 1500);
  }

  // =========================================================================
  // 5. 로컬스토리지 영속성 관리
  // =========================================================================
  function loadMasterData() {
    try {
      const rawItems = localStorage.getItem(STORAGE_KEYS.MASTER_ITEMS);
      state.items = rawItems ? JSON.parse(rawItems) : [...DEFAULT_ITEMS];

      const rawWorkers = localStorage.getItem(STORAGE_KEYS.MASTER_WORKERS);
      state.workers = rawWorkers ? JSON.parse(rawWorkers) : [...DEFAULT_WORKERS];
    } catch (e) {
      console.error('마스터 데이터 로드 오류:', e);
      state.items = [...DEFAULT_ITEMS];
      state.workers = [...DEFAULT_WORKERS];
    }
    saveMasterData(false);
  }

  function saveMasterData(triggerToast = true) {
    try {
      localStorage.setItem(STORAGE_KEYS.MASTER_ITEMS, JSON.stringify(state.items));
      localStorage.setItem(STORAGE_KEYS.MASTER_WORKERS, JSON.stringify(state.workers));
      if (triggerToast) showToast('마스터 설정이 저장되었습니다');
    } catch (e) {
      console.error('마스터 데이터 저장 오류:', e);
    }
  }

  function loadInspectionData(dateStr) {
    try {
      const key = STORAGE_KEYS.INSPECTION_PREFIX + dateStr;
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // 이전 단일 테이블 버전 호환 마이그레이션 처리
        if (parsed && !parsed.process && !parsed.assembly) {
          state.inspectionData = {
            process: parsed,
            assembly: {}
          };
        } else {
          state.inspectionData = {
            process: parsed.process || {},
            assembly: parsed.assembly || {}
          };
        }
      } else {
        state.inspectionData = { process: {}, assembly: {} };
      }
    } catch (e) {
      console.error('검정 일정 로드 오류:', e);
      state.inspectionData = { process: {}, assembly: {} };
    }
  }

  function saveInspectionData(triggerToast = true) {
    try {
      const key = STORAGE_KEYS.INSPECTION_PREFIX + state.inspectionDate;
      localStorage.setItem(key, JSON.stringify(state.inspectionData));
      if (triggerToast) showToast('저장되었습니다');
    } catch (e) {
      console.error('검정 일정 저장 오류:', e);
    }
  }

  function loadProductionData(dateStr) {
    try {
      const key = STORAGE_KEYS.PRODUCTION_PREFIX + dateStr;
      const raw = localStorage.getItem(key);
      if (raw) {
        state.productionRows = JSON.parse(raw);
      } else {
        // 기본 1행 생성
        state.productionRows = [createDefaultProductionRow()];
      }
    } catch (e) {
      console.error('생산 일정 로드 오류:', e);
      state.productionRows = [createDefaultProductionRow()];
    }
  }

  function saveProductionData(triggerToast = true) {
    try {
      const key = STORAGE_KEYS.PRODUCTION_PREFIX + state.productionDate;
      localStorage.setItem(key, JSON.stringify(state.productionRows));
      if (triggerToast) showToast('저장되었습니다');
    } catch (e) {
      console.error('생산 일정 저장 오류:', e);
    }
  }

  function createDefaultProductionRow() {
    const firstItemId = state.items.length > 0 ? state.items[0].id : '';
    const currentYear = new Date().getFullYear();
    const yy = String(currentYear).slice(-2);
    return {
      id: generateUniqueId('prod_row'),
      itemId: firstItemId,
      lotNo: `${yy}-001`,
      qty: 0,
      workerHours: {}
    };
  }

  // =========================================================================
  // 6. 탭 1: [검정 일정] 렌더링 및 계산 로직 (공정검사 / 자동화조립 2단 분할)
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

    // 공정검사 및 자동화조립 두 테이블의 날짜 헤더 동시 렌더링
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

    // 툴바 뱃지 업데이트
    const rangeBadge = document.getElementById('insp-date-range-badge');
    if (rangeBadge) {
      const startDate = addDays(baseDate, 0);
      const endDate = addDays(baseDate, 10);
      const sStr = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
      const eStr = `${endDate.getMonth() + 1}/${endDate.getDate()}`;
      rangeBadge.textContent = `작업일정 11일간: ${sStr} ~ ${eStr}`;
    }
  }

  function renderInspectionTable() {
    renderInspectionHeaders();

    const badge = document.getElementById('badge-inspection-items');
    if (badge) badge.textContent = state.items.length;

    // 공정검사와 자동화조립 두 섹션 각각 렌더링
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

    if (state.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="16" style="text-align:center; padding: 24px; color: var(--text-muted);">
        [설정] 탭에서 품목을 먼저 등록해주세요.
      </td></tr>`;
      calculateSectionTotals(sec);
      return;
    }

    const baseDate = state.inspectionDate;

    state.items.forEach((item, index) => {
      if (!sectionData[item.id]) {
        sectionData[item.id] = {
          weeklyQty: 0,
          dailyQuantities: new Array(11).fill(0)
        };
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

      let html = `
        <td class="col-no">${index + 1}</td>
        <td class="col-item" title="${item.name}">${escapeHtml(item.name)}</td>
        <td class="col-weekly">
          <input type="text" class="cell-input text-right num-cell input-weekly-qty"
                 value="${weeklyQty === 0 ? '' : weeklyQty}" placeholder="0"
                 data-section="${sec.key}"
                 data-item-id="${item.id}" />
        </td>
        <td class="col-completed calc-cell completed font-bold num-cell" id="calc-completed-${sec.key}-${item.id}">
          ${formatNumber(completedQty)}
        </td>
        <td class="col-balance calc-cell num-cell font-bold ${getBalanceClass(balance)}" id="calc-balance-${sec.key}-${item.id}">
          ${formatNumber(balance)}
        </td>
      `;

      // 11일간 일자별 생산량 셀
      for (let dayIdx = 0; dayIdx < 11; dayIdx++) {
        const dateObj = addDays(baseDate, dayIdx);
        const dayOfWeekIdx = dateObj.getDay();
        let weekendClass = '';
        if (dayOfWeekIdx === 6) weekendClass = 'td-sat';
        if (dayOfWeekIdx === 0) weekendClass = 'td-sun';

        const dayVal = itemRowData.dailyQuantities[dayIdx];
        const displayVal = (dayVal === 0 || dayVal === '0' || !dayVal) ? '' : dayVal;

        html += `
          <td class="${weekendClass}">
            <input type="text" class="cell-input text-right num-cell input-daily-qty"
                   value="${displayVal}" placeholder="0"
                   data-section="${sec.key}"
                   data-item-id="${item.id}"
                   data-day-index="${dayIdx}" />
          </td>
        `;
      }

      tr.innerHTML = html;
      tbody.appendChild(tr);
    });

    calculateSectionTotals(sec);
  }

  function getBalanceClass(balance) {
    if (balance === 0) return 'balance-ok';
    if (balance < 0) return 'balance-over';
    return 'balance-remain';
  }

  function calculateSectionTotals(sec) {
    let totalWeekly = 0;
    let totalCompleted = 0;
    let totalBalance = 0;
    const dailyTotals = new Array(11).fill(0);

    const sectionData = state.inspectionData[sec.key] || {};

    state.items.forEach(item => {
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

    // 푸터 엘리먼트 갱신
    const sumWeeklyEl = document.getElementById(sec.sumWeeklyId);
    const sumCompletedEl = document.getElementById(sec.sumCompletedId);
    const sumBalanceEl = document.getElementById(sec.sumBalanceId);

    if (sumWeeklyEl) sumWeeklyEl.textContent = formatNumber(totalWeekly);
    if (sumCompletedEl) sumCompletedEl.textContent = formatNumber(totalCompleted);
    if (sumBalanceEl) {
      sumBalanceEl.textContent = formatNumber(totalBalance);
      sumBalanceEl.className = `num-cell font-bold ${getBalanceClass(totalBalance)}`;
    }

    // 섹션 헤더 요약 뱃지 갱신
    const pillWeekly = document.getElementById(sec.pillWeeklyId);
    const pillCompleted = document.getElementById(sec.pillCompletedId);
    const pillBalance = document.getElementById(sec.pillBalanceId);

    if (pillWeekly) pillWeekly.textContent = formatNumber(totalWeekly);
    if (pillCompleted) pillCompleted.textContent = formatNumber(totalCompleted);
    if (pillBalance) {
      pillBalance.textContent = formatNumber(totalBalance);
      pillBalance.className = getBalanceClass(totalBalance) === 'balance-over' ? 'text-danger font-bold' : '';
    }

    // 11일간 푸터 셀 렌더링
    const tfootRow = document.getElementById(sec.tfootId);
    if (tfootRow) {
      while (tfootRow.children.length > 5) {
        tfootRow.removeChild(tfootRow.lastChild);
      }

      for (let dayIdx = 0; dayIdx < 11; dayIdx++) {
        const td = document.createElement('td');
        td.className = 'num-cell text-right font-bold';
        td.textContent = formatNumber(dailyTotals[dayIdx]);
        tfootRow.appendChild(td);
      }
    }
  }

  function attachInspectionEventListeners() {
    // 모든 주간물량 인풋 제어
    document.querySelectorAll('.input-weekly-qty').forEach(input => {
      // 기존 리스너 중복 방지를 위해 cloneNode 또는 oninput 사용
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

    // 모든 일자별 생산량 인풋 제어
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

    if (compEl) compEl.textContent = formatNumber(completedQty);
    if (balEl) {
      balEl.textContent = formatNumber(balance);
      balEl.className = `col-balance calc-cell num-cell font-bold ${getBalanceClass(balance)}`;
    }
  }

  // =========================================================================
  // 7. 탭 2: [생산 일정] 렌더링 및 로직 (로트번호 마스킹 & 작업시간 소수점)
  // =========================================================================
  function renderProductionWorkerHeaders() {
    const headerRow = document.getElementById('production-worker-headers');
    const groupHeader = document.getElementById('th-workers-group-header');
    if (!headerRow) return;

    headerRow.innerHTML = '';
    const workerCount = state.workers.length;

    if (groupHeader) {
      groupHeader.setAttribute('colspan', Math.max(1, workerCount));
      groupHeader.textContent = `작업자별 작업시간 (시간/소수점 1자리) (E~M열 - 총 ${workerCount}명)`;
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
    if (badge) badge.textContent = state.productionRows.length;

    if (state.productionRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${5 + Math.max(1, state.workers.length)}" style="text-align:center; padding: 24px; color: var(--text-muted);">
        생산 일정이 없습니다. 우측 상단의 [생산 행 추가] 버튼을 눌러 행을 추가하세요.
      </td></tr>`;
      calculateProductionTotals();
      return;
    }

    state.productionRows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;

      // 품목 셀렉트 옵션들 생성
      let itemOptions = '';
      if (state.items.length === 0) {
        itemOptions = '<option value="">품목 없음 (설정에서 등록)</option>';
      } else {
        itemOptions = state.items.map(item => {
          const selected = item.id === row.itemId ? 'selected' : '';
          return `<option value="${item.id}" ${selected}>${escapeHtml(item.name)}</option>`;
        }).join('');
      }

      // 기본 열들 (No, 품명 Select, 로트번호, 생산수량)
      let html = `
        <td class="col-no">${index + 1}</td>
        <td class="col-item-prod">
          <select class="cell-select select-prod-item" data-row-id="${row.id}">
            ${itemOptions}
          </select>
        </td>
        <td class="col-lot">
          <input type="text" class="cell-input code-font input-prod-lot"
                 value="${escapeHtml(row.lotNo || '')}"
                 placeholder="26-000"
                 maxlength="10"
                 data-row-id="${row.id}" />
        </td>
        <td class="col-qty">
          <input type="text" class="cell-input text-right num-cell input-prod-qty"
                 value="${row.qty === 0 || !row.qty ? '' : row.qty}"
                 placeholder="0"
                 data-row-id="${row.id}" />
        </td>
      `;

      // 작업자별 작업시간 입력 필드들 (E~M열)
      if (state.workers.length === 0) {
        html += `<td style="text-align:center; color: var(--text-muted);">-</td>`;
      } else {
        state.workers.forEach(worker => {
          const hours = row.workerHours && row.workerHours[worker.id] !== undefined ? row.workerHours[worker.id] : '';
          const displayHours = (hours === 0 || hours === '0' || hours === '') ? '' : hours;

          html += `
            <td class="col-worker-time">
              <input type="text" class="cell-input text-right num-cell input-worker-hour"
                     value="${displayHours}"
                     placeholder="0.0"
                     maxlength="5"
                     data-row-id="${row.id}"
                     data-worker-id="${worker.id}" />
            </td>
          `;
        });
      }

      // 관리 (삭제)
      html += `
        <td class="col-action">
          <button type="button" class="btn btn-sm btn-danger-ghost btn-delete-prod-row" data-row-id="${row.id}" title="행 삭제">
            <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
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

    state.workers.forEach(w => {
      workerTotals[w.id] = 0;
    });

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

    // 푸터 수량 합계 갱신
    const sumQtyEl = document.getElementById('sum-prod-qty');
    if (sumQtyEl) sumQtyEl.textContent = formatNumber(totalQty);

    // 푸터 작업자별 합계 갱신
    const tfootRow = document.getElementById('production-tfoot');
    if (tfootRow) {
      // 기존 합계 td들 (앞 2개 td 제외하고 마지막 1개 빈 td 직전까지) 재구성
      while (tfootRow.children.length > 2) {
        tfootRow.removeChild(tfootRow.children[1]);
      }

      // index 0: 일일 합계 레이블, index 1: 총 수량
      // 그 뒤에 작업자별 합계 td들 삽입
      if (state.workers.length === 0) {
        const td = document.createElement('td');
        td.className = 'summary-empty';
        tfootRow.insertBefore(td, tfootRow.lastChild);
      } else {
        state.workers.forEach(w => {
          const td = document.createElement('td');
          td.className = 'num-cell text-right font-bold';
          const sum = workerTotals[w.id] || 0;
          // 소수점 1자리 포맷
          td.textContent = sum % 1 === 0 ? sum.toFixed(0) : sum.toFixed(1);
          tfootRow.insertBefore(td, tfootRow.lastChild);
        });
      }
    }
  }

  function attachProductionEventListeners() {
    const tbody = document.getElementById('production-tbody');
    if (!tbody) return;

    // 품명 선택 드롭다운 변경
    tbody.querySelectorAll('.select-prod-item').forEach(select => {
      select.addEventListener('change', function () {
        const rowId = this.dataset.rowId;
        const row = state.productionRows.find(r => r.id === rowId);
        if (row) {
          row.itemId = this.value;
          saveProductionData(true);
        }
      });
    });

    // 로트번호 입력 및 마스킹 (현재 연도 기준 YY-000 형태 유지 & String 고정 저장)
    tbody.querySelectorAll('.input-prod-lot').forEach(input => {
      input.addEventListener('focus', function () {
        if (!this.value.trim()) {
          const currentYear = new Date().getFullYear();
          const yy = String(currentYear).slice(-2);
          this.value = `${yy}-`;
        }
      });

      input.addEventListener('input', function () {
        let val = this.value.toUpperCase();
        
        // 연도 2자리 - 숫자 규칙 마스킹 로직
        // 허용 문자: 숫자와 하이픈
        val = val.replace(/[^0-9\-]/g, '');

        // 하이픈이 없고 길이가 2자 이상이면 자동으로 하이픈 삽입
        if (val.length === 2 && !val.includes('-')) {
          val = val + '-';
        } else if (val.length > 2 && val.charAt(2) !== '-') {
          val = val.slice(0, 2) + '-' + val.slice(2).replace(/-/g, '');
        }

        this.value = val;

        const rowId = this.dataset.rowId;
        const row = state.productionRows.find(r => r.id === rowId);
        if (row) {
          row.lotNo = String(val); // 연도가 바뀌어도 과거 기록이 불변하도록 텍스트(String) 고정값 저장
          saveProductionData(true);
        }
      });
    });

    // 생산수량 (정수 숫자만 허용)
    tbody.querySelectorAll('.input-prod-qty').forEach(input => {
      input.addEventListener('input', function () {
        const cleaned = this.value.replace(/[^0-9]/g, '');
        this.value = cleaned;

        const rowId = this.dataset.rowId;
        const row = state.productionRows.find(r => r.id === rowId);
        if (row) {
          row.qty = parseSafeInt(cleaned);
          calculateProductionTotals();
          saveProductionData(true);
        }
      });
    });

    // 작업자별 작업시간 (숫자 및 소수점 1자리까지 입력 가능, 예: 7.5, 8.0)
    tbody.querySelectorAll('.input-worker-hour').forEach(input => {
      input.addEventListener('input', function () {
        let val = this.value;

        // 소수점 1자리까지 허용 정규식 필터링
        // 숫자와 점 하나만 허용
        val = val.replace(/[^0-9.]/g, '');

        // 점(.)이 여러 개 들어간 경우 첫 번째 점만 유지
        const parts = val.split('.');
        if (parts.length > 2) {
          val = parts[0] + '.' + parts.slice(1).join('');
        }

        // 소수점 이하 최대 1자리까지만 허용
        if (parts.length === 2 && parts[1].length > 1) {
          val = parts[0] + '.' + parts[1].slice(0, 1);
        }

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
      });
    });

    // 행 삭제 버튼
    tbody.querySelectorAll('.btn-delete-prod-row').forEach(btn => {
      btn.addEventListener('click', function () {
        const rowId = this.dataset.rowId;
        if (state.productionRows.length <= 1) {
          // 마지막 1행은 초기화로 대응
          state.productionRows = [createDefaultProductionRow()];
        } else {
          state.productionRows = state.productionRows.filter(r => r.id !== rowId);
        }
        renderProductionTable();
        saveProductionData(true);
      });
    });
  }

  // =========================================================================
  // 8. 탭 3: [설정] 마스터 데이터 관리 로직
  // =========================================================================
  function renderMasterItems() {
    const tbody = document.getElementById('master-items-tbody');
    const badge = document.getElementById('count-items-badge');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (badge) badge.textContent = `총 ${state.items.length}개 등록`;

    if (state.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 16px; color: var(--text-muted);">
        등록된 품목이 없습니다. 상단에서 품명을 추가하세요.
      </td></tr>`;
      return;
    }

    state.items.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:center; color: var(--text-muted); font-weight: 600;">${index + 1}</td>
        <td>
          <span class="item-name-text" data-id="${item.id}">${escapeHtml(item.name)}</span>
          <input type="text" class="master-edit-input" style="display:none;" value="${escapeHtml(item.name)}" data-id="${item.id}">
        </td>
        <td style="text-align:center; white-space: nowrap;">
          <button type="button" class="btn btn-sm btn-ghost btn-edit-item" data-id="${item.id}">수정</button>
          <button type="button" class="btn btn-sm btn-danger-ghost btn-delete-item" data-id="${item.id}">삭제</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    attachMasterItemEvents();
  }

  function attachMasterItemEvents() {
    const tbody = document.getElementById('master-items-tbody');
    if (!tbody) return;

    // 품목 수정
    tbody.querySelectorAll('.btn-edit-item').forEach(btn => {
      btn.addEventListener('click', function () {
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
            const item = state.items.find(i => i.id === itemId);
            if (item) item.name = newName;
            saveMasterData(true);
            renderMasterItems();
            renderInspectionTable();
            renderProductionTable();
          }
        }
      });
    });

    // 품목 인풋 엔터키 처리
    tbody.querySelectorAll('.master-edit-input').forEach(input => {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          const tr = this.closest('tr');
          const editBtn = tr.querySelector('.btn-edit-item');
          if (editBtn) editBtn.click();
        }
      });
    });

    // 품목 삭제
    tbody.querySelectorAll('.btn-delete-item').forEach(btn => {
      btn.addEventListener('click', function () {
        const itemId = this.dataset.id;
        const item = state.items.find(i => i.id === itemId);
        if (!item) return;

        if (confirm(`'${item.name}' 품목을 마스터에서 삭제하시겠습니까?\n(검정 일정 및 생산 일정의 목록에서도 제외됩니다)`)) {
          state.items = state.items.filter(i => i.id !== itemId);
          saveMasterData(true);
          renderMasterItems();
          renderInspectionTable();
          renderProductionTable();
        }
      });
    });
  }

  function renderMasterWorkers() {
    const tbody = document.getElementById('master-workers-tbody');
    const badge = document.getElementById('count-workers-badge');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (badge) badge.textContent = `총 ${state.workers.length}명 등록`;

    if (state.workers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 16px; color: var(--text-muted);">
        등록된 작업자가 없습니다. 상단에서 작업자를 추가하세요.
      </td></tr>`;
      return;
    }

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

    // 작업자 수정
    tbody.querySelectorAll('.btn-edit-worker').forEach(btn => {
      btn.addEventListener('click', function () {
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
            saveMasterData(true);
            renderMasterWorkers();
            renderProductionTable();
          }
        }
      });
    });

    // 작업자 인풋 엔터키 처리
    tbody.querySelectorAll('.master-edit-input').forEach(input => {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          const tr = this.closest('tr');
          const editBtn = tr.querySelector('.btn-edit-worker');
          if (editBtn) editBtn.click();
        }
      });
    });

    // 작업자 삭제
    tbody.querySelectorAll('.btn-delete-worker').forEach(btn => {
      btn.addEventListener('click', function () {
        const workerId = this.dataset.id;
        const worker = state.workers.find(w => w.id === workerId);
        if (!worker) return;

        if (confirm(`'${worker.name}' 작업자를 마스터에서 삭제하시겠습니까?\n(생산 일정의 컬럼 헤더에서도 제외됩니다)`)) {
          state.workers = state.workers.filter(w => w.id !== workerId);
          saveMasterData(true);
          renderMasterWorkers();
          renderProductionTable();
        }
      });
    });
  }

  // =========================================================================
  // 9. CSV 내보내기 및 데이터 백업/복원
  // =========================================================================
  function exportInspectionToCsv() {
    let csv = '\uFEFF'; // Excel 한글 인코딩 방지를 위한 BOM
    csv += `감지기 생산현황 관리 시스템 - 검정 일정\n`;
    csv += `기준일자(검정예정일):,${state.inspectionDate}\n\n`;

    // 11일간 날짜 헤더 생성
    const dateHeaders = [];
    for (let i = 0; i < 11; i++) {
      const d = addDays(state.inspectionDate, i);
      dateHeaders.push(`"${d.getMonth() + 1}/${d.getDate()}(${DAYS_OF_WEEK[d.getDay()]})"`);
    }

    // [1] 공정검사 섹션
    csv += `[공정검사]\n`;
    csv += `No,품명,주간물량,생산완료,잔량,${dateHeaders.join(',')}\n`;

    const processData = state.inspectionData.process || {};
    state.items.forEach((item, idx) => {
      const row = processData[item.id] || { weeklyQty: 0, dailyQuantities: new Array(11).fill(0) };
      const completed = (row.dailyQuantities || []).reduce((a, b) => a + parseSafeInt(b), 0);
      const weekly = parseSafeInt(row.weeklyQty);
      const balance = weekly - completed;
      const dailyVals = (row.dailyQuantities || []).map(v => parseSafeInt(v));

      csv += `${idx + 1},"${item.name.replace(/"/g, '""')}",${weekly},${completed},${balance},${dailyVals.join(',')}\n`;
    });

    csv += `\n`;

    // [2] 자동화조립 섹션
    csv += `[자동화조립]\n`;
    csv += `No,품명,주간물량,생산완료,잔량,${dateHeaders.join(',')}\n`;

    const assemblyData = state.inspectionData.assembly || {};
    state.items.forEach((item, idx) => {
      const row = assemblyData[item.id] || { weeklyQty: 0, dailyQuantities: new Array(11).fill(0) };
      const completed = (row.dailyQuantities || []).reduce((a, b) => a + parseSafeInt(b), 0);
      const weekly = parseSafeInt(row.weeklyQty);
      const balance = weekly - completed;
      const dailyVals = (row.dailyQuantities || []).map(v => parseSafeInt(v));

      csv += `${idx + 1},"${item.name.replace(/"/g, '""')}",${weekly},${completed},${balance},${dailyVals.join(',')}\n`;
    });

    downloadCsvFile(csv, `검정일정(공정검사_자동화조립)_${state.inspectionDate}.csv`);
  }

  function exportProductionToCsv() {
    let csv = '\uFEFF';
    csv += `감지기 생산현황 관리 시스템 - 생산 일정\n`;
    csv += `기준일자(생산일자):,${state.productionDate}\n\n`;

    const workerHeaders = state.workers.map(w => `"${w.name.replace(/"/g, '""')}"`);
    csv += `No,품명,로트번호,생산수량,${workerHeaders.join(',')}\n`;

    state.productionRows.forEach((row, idx) => {
      const item = state.items.find(i => i.id === row.itemId);
      const itemName = item ? item.name : '미지정';
      const hours = state.workers.map(w => (row.workerHours && row.workerHours[w.id]) || 0);

      csv += `${idx + 1},"${itemName.replace(/"/g, '""')}","${row.lotNo || ''}",${row.qty || 0},${hours.join(',')}\n`;
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
      version: '1.0',
      exportedAt: new Date().toISOString(),
      masterItems: state.items,
      masterWorkers: state.workers,
      localStorageDump: {}
    };

    // 로컬스토리지 내 모든 PMS 데이터 덤프
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('pms_')) {
        allData.localStorageDump[key] = localStorage.getItem(key);
      }
    }

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
        if (imported.localStorageDump) {
          Object.entries(imported.localStorageDump).forEach(([key, val]) => {
            localStorage.setItem(key, val);
          });
        }
        loadMasterData();
        loadInspectionData(state.inspectionDate);
        loadProductionData(state.productionDate);
        renderMasterItems();
        renderMasterWorkers();
        renderInspectionTable();
        renderProductionTable();
        showToast('데이터 복원이 완료되었습니다');
      } catch (err) {
        alert('올바른 백업 JSON 파일이 아닙니다: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // =========================================================================
  // 10. 전역 이벤트 및 컨트롤 초기화
  // =========================================================================
  function initEventHandlers() {
    // 탭 전환 이벤트
    document.querySelectorAll('.nav-tab').forEach(tabBtn => {
      tabBtn.addEventListener('click', function () {
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

        // 탭 이동 시 최신 마스터 동기화 렌더링
        if (targetTabId === 'tab-inspection') {
          renderInspectionTable();
        } else if (targetTabId === 'tab-production') {
          renderProductionTable();
        } else if (targetTabId === 'tab-settings') {
          renderMasterItems();
          renderMasterWorkers();
        }
      });
    });

    // 검정 일정 날짜 컨트롤
    const inspDateInput = document.getElementById('inspection-date');
    if (inspDateInput) {
      inspDateInput.value = state.inspectionDate;
      inspDateInput.addEventListener('change', function () {
        state.inspectionDate = this.value || getTodayDateString();
        loadInspectionData(state.inspectionDate);
        renderInspectionTable();
        showToast(`${state.inspectionDate} 검정일정 불러옴`);
      });
    }

    document.getElementById('btn-insp-prev-day')?.addEventListener('click', () => {
      const prevDate = addDays(state.inspectionDate, -1);
      state.inspectionDate = formatDateObj(prevDate);
      if (inspDateInput) inspDateInput.value = state.inspectionDate;
      loadInspectionData(state.inspectionDate);
      renderInspectionTable();
      showToast(`${state.inspectionDate} 검정일정 불러옴`);
    });

    document.getElementById('btn-insp-next-day')?.addEventListener('click', () => {
      const nextDate = addDays(state.inspectionDate, 1);
      state.inspectionDate = formatDateObj(nextDate);
      if (inspDateInput) inspDateInput.value = state.inspectionDate;
      loadInspectionData(state.inspectionDate);
      renderInspectionTable();
      showToast(`${state.inspectionDate} 검정일정 불러옴`);
    });

    document.getElementById('btn-insp-today')?.addEventListener('click', () => {
      state.inspectionDate = getTodayDateString();
      if (inspDateInput) inspDateInput.value = state.inspectionDate;
      loadInspectionData(state.inspectionDate);
      renderInspectionTable();
      showToast('오늘 검정일정으로 이동');
    });

    document.getElementById('btn-insp-clear-day')?.addEventListener('click', () => {
      if (confirm(`기준일자 [${state.inspectionDate}]의 검정 일정(공정검사 및 자동화조립) 데이터를 모두 초기화하시겠습니까?`)) {
        state.inspectionData = { process: {}, assembly: {} };
        saveInspectionData(true);
        renderInspectionTable();
      }
    });

    // 생산 일정 날짜 컨트롤
    const prodDateInput = document.getElementById('production-date');
    if (prodDateInput) {
      prodDateInput.value = state.productionDate;
      prodDateInput.addEventListener('change', function () {
        state.productionDate = this.value || getTodayDateString();
        loadProductionData(state.productionDate);
        renderProductionTable();
        showToast(`${state.productionDate} 생산일정 불러옴`);
      });
    }

    document.getElementById('btn-prod-prev-day')?.addEventListener('click', () => {
      const prevDate = addDays(state.productionDate, -1);
      state.productionDate = formatDateObj(prevDate);
      if (prodDateInput) prodDateInput.value = state.productionDate;
      loadProductionData(state.productionDate);
      renderProductionTable();
      showToast(`${state.productionDate} 생산일정 불러옴`);
    });

    document.getElementById('btn-prod-next-day')?.addEventListener('click', () => {
      const nextDate = addDays(state.productionDate, 1);
      state.productionDate = formatDateObj(nextDate);
      if (prodDateInput) prodDateInput.value = state.productionDate;
      loadProductionData(state.productionDate);
      renderProductionTable();
      showToast(`${state.productionDate} 생산일정 불러옴`);
    });

    document.getElementById('btn-prod-today')?.addEventListener('click', () => {
      state.productionDate = getTodayDateString();
      if (prodDateInput) prodDateInput.value = state.productionDate;
      loadProductionData(state.productionDate);
      renderProductionTable();
      showToast('오늘 생산일정으로 이동');
    });

    document.getElementById('btn-prod-clear-day')?.addEventListener('click', () => {
      if (confirm(`기준일자 [${state.productionDate}]의 생산 일정 데이터를 초기화하시겠습니까?`)) {
        state.productionRows = [createDefaultProductionRow()];
        saveProductionData(true);
        renderProductionTable();
      }
    });

    // 생산 행 추가 버튼
    document.getElementById('btn-add-production-row')?.addEventListener('click', () => {
      const newRow = createDefaultProductionRow();
      // 이전 마지막 행의 로트번호를 참조하여 자동 증가
      if (state.productionRows.length > 0) {
        const lastRow = state.productionRows[state.productionRows.length - 1];
        if (lastRow.lotNo && lastRow.lotNo.includes('-')) {
          const parts = lastRow.lotNo.split('-');
          const prefix = parts[0];
          const seq = parseInt(parts[1], 10);
          if (!isNaN(seq)) {
            newRow.lotNo = `${prefix}-${String(seq + 1).padStart(parts[1].length, '0')}`;
          }
        }
      }
      state.productionRows.push(newRow);
      renderProductionTable();
      saveProductionData(true);

      // 추가된 행의 첫 번째 입력으로 포커스 이동
      const newlyAddedRowEl = document.querySelector(`tr[data-row-id="${newRow.id}"] .input-prod-lot`);
      if (newlyAddedRowEl) newlyAddedRowEl.focus();
    });

    // 마스터 품목 추가 폼
    document.getElementById('form-add-item')?.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = document.getElementById('input-new-item');
      const name = input.value.trim();
      if (!name) return;

      const newItem = {
        id: generateUniqueId('item'),
        name: name
      };
      state.items.push(newItem);
      input.value = '';
      saveMasterData(true);
      renderMasterItems();
      renderInspectionTable();
      renderProductionTable();
    });

    // 마스터 작업자 추가 폼
    document.getElementById('form-add-worker')?.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = document.getElementById('input-new-worker');
      const name = input.value.trim();
      if (!name) return;

      const newWorker = {
        id: generateUniqueId('worker'),
        name: name
      };
      state.workers.push(newWorker);
      input.value = '';
      saveMasterData(true);
      renderMasterWorkers();
      renderProductionTable();
    });

    // CSV 및 백업 내보내기 버튼들
    document.getElementById('btn-export-inspection-csv')?.addEventListener('click', exportInspectionToCsv);
    document.getElementById('btn-export-production-csv')?.addEventListener('click', exportProductionToCsv);
    document.getElementById('btn-export-json')?.addEventListener('click', exportAllDataAsJson);

    // JSON 복원 파일 인풋
    const importInput = document.getElementById('input-import-json');
    if (importInput) {
      importInput.addEventListener('change', function (e) {
        if (this.files && this.files[0]) {
          importAllDataFromJson(this.files[0]);
          this.value = '';
        }
      });
    }

    // 실시간 시계 업데이트 (1초 주기)
    startClock();
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

  // =========================================================================
  // 11. 애플리케이션 부트스트랩 (시작점)
  // =========================================================================
  function initApp() {
    // 1. 마스터 데이터 로드 (없으면 기본값 생성)
    loadMasterData();

    // 2. 현재 날짜의 검정 일정 & 생산 일정 로드
    loadInspectionData(state.inspectionDate);
    loadProductionData(state.productionDate);

    // 3. UI 렌더링
    renderInspectionTable();
    renderProductionTable();
    renderMasterItems();
    renderMasterWorkers();

    // 4. 이벤트 핸들러 바인딩
    initEventHandlers();
  }

  // DOMContentLoaded 완료 후 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
