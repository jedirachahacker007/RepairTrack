/* ===================== STATE ===================== */
let ALL_MONTHS = null;      // full file: { months: { "2026-08": {...}, ... } }
let MONTH_KEYS = [];        // sorted "YYYY-MM" keys, ascending
let currentMonthKey = null; // which month is currently loaded into DATA
let DATA = null;            // = ALL_MONTHS.months[currentMonthKey] (same reference, so edits apply directly)
let ISSUE_KEYS = [];
let PART_KEYS = [];
let activePart = null;
let modalMachineId = null; // machine currently open in the edit card
let modalWeekIdx = null;   // which week column is selected for editing in the card
let pickerSelectedKey = null; // "YYYY-MM" (Gregorian, internal) chosen in the new-month picker
let pickerViewYear = null;    // Gregorian year currently shown in the new-month picker's grid

const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const THAI_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const DEFAULT_ISSUE_KEYS = ['แกนหัก', 'ไม่หมุน', 'ส่าย', 'แกนเอียง', 'ถอดออก'];
const DEFAULT_WEEK_COUNT = 4;
function thaiMonthLabel(monthKey){
  const idx = parseInt(monthKey.split('-')[1], 10) - 1;
  return THAI_MONTHS[idx] || monthKey;
}
function nextMonthKey(key){
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 1); // m is already 1-indexed, so this rolls forward one month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const DATA_URL = '/api/repair-data';
const SAVE_URL = '/api/repair-data';

let saveTimer = null;
let saveInFlight = false;
let pendingSaveResolvers = [];

/* ===================== SAVE TO SERVER ===================== */
function setSaveStatus(state){
  const el = document.getElementById('saveStatus');
  if (!el) return;
  const map = {
    idle:    { text: '', cls: '' },
    pending: { text: '● มีการแก้ไขที่ยังไม่บันทึก', cls: 'save-pending' },
    saving:  { text: '⏳ กำลังบันทึก…', cls: 'save-saving' },
    saved:   { text: '✓ บันทึกแล้ว', cls: 'save-ok' },
    error:   { text: '⚠ บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง', cls: 'save-err' },
  };
  const s = map[state] || map.idle;
  el.textContent = s.text;
  el.className = 'save-status ' + s.cls;
}

// Debounce so a burst of clicks results in one write instead of many.
function scheduleSave(){
  setSaveStatus('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistData, 450);
}

// Returns a Promise<boolean> (true = saved ok) so callers — like the manual
// save button — can await the actual result. Calls that arrive while a
// save is already in flight are queued and resolved together by the next
// fetch, so a burst of edits still costs just one round trip.
function persistData(){
  return new Promise((resolve) => {
    pendingSaveResolvers.push(resolve);
    runSaveLoop();
  });
}

async function runSaveLoop(){
  if (saveInFlight) return;
  saveInFlight = true;
  while (pendingSaveResolvers.length) {
    setSaveStatus('saving');
    let ok = true;
    try {
      const res = await fetch(SAVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ALL_MONTHS),
      });
      if (!res.ok) throw new Error(`บันทึกไม่สำเร็จ (${res.status})`);
      setSaveStatus('saved');
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      ok = false;
    }
    const resolvers = pendingSaveResolvers;
    pendingSaveResolvers = [];
    resolvers.forEach(r => r(ok));
  }
  saveInFlight = false;
}

/* ===================== LOAD ===================== */
async function loadData() {
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (${res.status})`);
  const json = await res.json();
  ALL_MONTHS = normalizeToMultiMonth(json);
  MONTH_KEYS = Object.keys(ALL_MONTHS.months).sort(); // "YYYY-MM" sorts correctly as text
  applyMonth(MONTH_KEYS[MONTH_KEYS.length - 1]); // start on the most recent month
}

// Accepts either the new { months: {...} } file, or an old single-month
// file (just { month, month_name_th, parts }), so an older data file on
// disk still loads fine the first time.
function normalizeToMultiMonth(json){
  const data = json && json.months ? json : { months: { [json?.month]: json } };
  if (!data.months || typeof data.months !== 'object') {
    throw new Error('รูปแบบข้อมูล repair-data ไม่ถูกต้อง');
  }

  // Firebase omits properties whose value is null. That means a machine with
  // no current repairs arrives without an `issues` property, and sparse week
  // arrays can arrive as objects such as { "3": 1 }. Restore the dashboard's
  // fixed shape before anything tries to render it.
  const issueKeys = new Set(DEFAULT_ISSUE_KEYS);
  Object.values(data.months).forEach(month => {
    Object.values(month?.parts || {}).forEach(part => {
      (part.groups || []).forEach(group => {
        (group.machines || []).forEach(machine => {
          Object.keys(machine.issues || {}).forEach(key => issueKeys.add(key));
        });
      });
    });
  });

  Object.values(data.months).forEach(month => {
    Object.values(month?.parts || {}).forEach(part => {
      (part.groups || []).forEach(group => {
        (group.machines || []).forEach(machine => {
          const sourceIssues = machine.issues || {};
          machine.issues = {};
          issueKeys.forEach(key => {
            machine.issues[key] = normalizeWeeks(sourceIssues[key]);
          });
        });
      });
    });
  });

  return data;
}

function normalizeWeeks(source){
  const weeks = new Array(DEFAULT_WEEK_COUNT).fill(null);
  if (Array.isArray(source)) {
    source.forEach((value, index) => {
      if (index < weeks.length) weeks[index] = value;
    });
  } else if (source && typeof source === 'object') {
    Object.entries(source).forEach(([index, value]) => {
      const weekIndex = Number(index);
      if (Number.isInteger(weekIndex) && weekIndex >= 0 && weekIndex < weeks.length) {
        weeks[weekIndex] = value;
      }
    });
  }
  return weeks;
}

function applyMonth(monthKey){
  currentMonthKey = monthKey;
  DATA = ALL_MONTHS.months[monthKey];

  PART_KEYS = Object.keys(DATA.parts);
  activePart = PART_KEYS[0];
  // Collect the full, ordered set of issue keys from whichever part has them
  ISSUE_KEYS = Array.from(
    PART_KEYS.reduce((set, pk) => {
      DATA.parts[pk].groups.forEach(g => g.machines.forEach(m => {
        Object.keys(m.issues).forEach(k => set.add(k));
      }));
      return set;
    }, new Set())
  );

  computeGlobalSummary();
  renderMonthSelector();
  renderTabs();
  renderTable();
}

/* ===================== HELPERS ===================== */
function getCurrent(weeks){
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i] !== null) return weeks[i] < 0 ? 0 : weeks[i];
  }
  return 0;
}
function getLastDelta(weeks){
  let lastIdx = -1;
  for (let i = weeks.length - 1; i >= 0; i--) { if (weeks[i] !== null && weeks[i] >= 0) { lastIdx = i; break; } }
  if (lastIdx <= 0) return 0;
  let prevIdx = -1;
  for (let i = lastIdx - 1; i >= 0; i--) { if (weeks[i] !== null && weeks[i] >= 0) { prevIdx = i; break; } }
  if (prevIdx === -1) return 0;
  return weeks[lastIdx] - weeks[prevIdx];
}
function machineCurrentTotal(machine){
  return ISSUE_KEYS.reduce((sum, k) => sum + getCurrent(machine.issues[k]), 0);
}
function currentClass(v){
  if (v <= 0) return 'good';
  if (v <= 3) return 'warn';
  return 'crit';
}

// Read-only timeline chain for the main table — no buttons, just history.
function renderChain(weeks){
  let html = '<div class="chain">';
  weeks.forEach((val, i) => {
    const prev = i > 0 ? weeks[i - 1] : null;
    const delta = (val !== null && prev !== null) ? val - prev : null;

    if (i > 0) {
      let arrowCls = 'arrow-flat';
      let arrowChar = '→';
      if (delta !== null && delta > 0) { arrowCls = 'arrow-up'; arrowChar = '↗'; }
      else if (delta !== null && delta < 0) { arrowCls = 'arrow-down'; arrowChar = '↘'; }
      html += `<span class="arrow ${arrowCls}">${arrowChar}</span>`;
    }

    if (val === null || val < 0) {
      html += `<div class="badge-col"><span class="badge badge-empty">–</span></div>`;
      return;
    }
    let cls = 'badge-neutral';
    if (delta === null) {
      cls = val === 0 ? 'badge-neutral' : 'badge-warn';
    } else if (delta > 0) {
      cls = delta >= 3 ? 'badge-crit' : 'badge-warn';
    } else if (delta < 0) {
      cls = val === 0 ? 'badge-good' : 'badge-improve';
    } else {
      cls = val === 0 ? 'badge-neutral' : 'badge-stable';
    }
    let sup = '';
    if (delta !== null && delta !== 0) {
      sup = `<sup class="${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? '+' : ''}${delta}</sup>`;
    }
    html += `<div class="badge-col"><span class="badge ${cls}">${val}${sup}</span></div>`;
  });
  html += '</div>';
  return html;
}

// Smaller version of the same chain, used inside the edit card. Each badge
// is tappable so a technician can jump straight to that week by touching
// its number, and the selected week gets a visible ring around it.
function renderMiniChain(weeks, activeIdx){
  let html = '<div class="mini-chain">';
  weeks.forEach((val, i) => {
    const activeCls = i === activeIdx ? ' mini-active' : '';
    if (val === null || val < 0) {
      html += `<button type="button" class="mini-badge mini-empty${activeCls}" data-week-select="${i}">–</button>`;
      return;
    }
    const prev = i > 0 ? weeks[i - 1] : null;
    const delta = (val !== null && prev !== null) ? val - prev : null;
    let cls = 'mini-neutral';
    if (delta !== null && delta > 0) cls = 'mini-warn';
    else if (delta !== null && delta < 0) cls = val === 0 ? 'mini-good' : 'mini-improve';
    html += `<button type="button" class="mini-badge ${cls}${activeCls}" data-week-select="${i}">${val}</button>`;
  });
  html += '</div>';
  return html;
}

/* ===================== EDIT DATA ===================== */
function findMachine(partKey, machineId){
  let found = null;
  DATA.parts[partKey].groups.some(g => {
    const m = g.machines.find(mm => mm.machine_id === machineId);
    if (m) { found = m; return true; }
    return false;
  });
  return found;
}

// Edits the specific week column the technician has selected in the card.
function stepWeekValue(partKey, machineId, issueKey, weekIdx, dir){
  const machine = findMachine(partKey, machineId);
  if (!machine) return;
  const arr = machine.issues[issueKey];
  const cur = arr[weekIdx];
  const before = cur === null ? 0 : cur;

  if (cur === null) {
    // Starting from empty: ▲ begins at 1, ▼ begins at -1 (a correction/offset)
    // instead of being blocked, so the total still nets out correctly.
    arr[weekIdx] = dir > 0 ? 1 : -1;
  } else {
    arr[weekIdx] = cur + dir; // no floor at 0 — can go negative
  }
  const after = arr[weekIdx];
  const actualDir = after === before ? 0 : (after > before ? 1 : -1);

  // Recompute everything so totals, deltas, tabs, and the hot-issue banner
  // reflect the change immediately.
  computeGlobalSummary();
  renderTabs();
  renderTable();
  refreshModalIssueRow(issueKey);

  if (actualDir !== 0) {
    flashModalValue(issueKey, actualDir);
    scheduleSave(); // write the edit back into Firebase's repair-data node
  }
}

/* ===================== VISUAL FEEDBACK ===================== */
function flashModalValue(issueKey, dir){
  const sel = `.modal-issue-value[data-issue="${cssEscape(issueKey)}"]`;
  const el = document.querySelector(sel);
  const flashClass = dir > 0 ? 'flash-up' : 'flash-down';
  if (el) {
    el.classList.add(flashClass);
    setTimeout(() => el.classList.remove(flashClass), 700);
  }
}

function cssEscape(str){
  return (window.CSS && CSS.escape) ? CSS.escape(str) : String(str).replace(/["\\]/g, '\\$&');
}

/* ===================== GLOBAL SUMMARY ===================== */
function computeGlobalSummary(){
  const machineTotals = {};
  const issueHotSum = {};
  ISSUE_KEYS.forEach(k => issueHotSum[k] = 0);

  PART_KEYS.forEach(pk => {
    DATA.parts[pk].groups.forEach(g => {
      g.machines.forEach(m => {
        const total = machineCurrentTotal(m);
        machineTotals[m.machine_id] = (machineTotals[m.machine_id] || 0) + total;
        ISSUE_KEYS.forEach(k => {
          const d = getLastDelta(m.issues[k]);
          if (d > 0) issueHotSum[k] += d;
        });
      });
    });
  });

  const pendingMachineCount = Object.values(machineTotals).filter(v => v > 0).length;
  let hotIssue = '–', hotVal = 0;
  ISSUE_KEYS.forEach(k => { if (issueHotSum[k] > hotVal) { hotVal = issueHotSum[k]; hotIssue = k; } });

  document.getElementById('statPendingMachines').textContent = pendingMachineCount;
  document.getElementById('statHotIssue').textContent = hotVal > 0 ? `${hotIssue} (+${hotVal})` : 'ไม่มี — ทุกอาการทรงตัว';
}

/* ===================== MONTH SELECTOR ===================== */
function renderMonthSelector(){
  const sel = document.getElementById('monthSelect');
  // newest month first in the dropdown list
  sel.innerHTML = MONTH_KEYS.slice().reverse().map(k => {
    const m = ALL_MONTHS.months[k];
    const buddhistYear = parseInt(k.split('-')[0], 10) + 543;
    const label = `${m.month_name_th} ${buddhistYear}`;
    return `<option value="${k}"${k === currentMonthKey ? ' selected' : ''}>${label}</option>`;
  }).join('');
}

/* ===================== TABS ===================== */
function renderTabs(){
  const wrap = document.getElementById('partTabs');
  wrap.innerHTML = '';
  PART_KEYS.forEach(pk => {
    const count = DATA.parts[pk].groups.reduce((s, g) => s + g.machines.filter(m => machineCurrentTotal(m) > 0).length, 0);
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (pk === activePart ? ' active' : '');
    btn.innerHTML = `${DATA.parts[pk].part_name_th}<span class="n">${count}</span>`;
    btn.onclick = () => { activePart = pk; renderTabs(); renderTable(); };
    wrap.appendChild(btn);
  });
}

/* ===================== TABLE (READ-ONLY) ===================== */
function renderTable(){
  const head = document.getElementById('tableHead');
  head.innerHTML = `<th>เครื่อง</th>` +
    ISSUE_KEYS.map(k => `<th>${k}</th>`).join('') +
    `<th class="current-col">🎯 ยอดปัจจุบัน</th>`;

  const body = document.getElementById('tableBody');
  const search = document.getElementById('searchBox').value.trim().toUpperCase();
  const onlyPending = document.getElementById('onlyPending').checked;

  let rows = '';
  let anyVisible = false;

  DATA.parts[activePart].groups.forEach(g => {
    const visibleMachines = g.machines.filter(m => {
      if (search && !m.machine_id.toUpperCase().includes(search)) return false;
      if (onlyPending && machineCurrentTotal(m) <= 0) return false;
      return true;
    });
    if (visibleMachines.length === 0) return;
    anyVisible = true;

    rows += `<tr class="group-row"><td colspan="${ISSUE_KEYS.length + 2}"><span class="size-chip">${g.group_name}</span>${visibleMachines.length} เครื่อง</td></tr>`;

    visibleMachines.forEach(m => {
      const total = machineCurrentTotal(m);
      const cls = currentClass(total);
      const sub = total === 0 ? 'เคลียร์' : `ค้าง ${total}`;
      rows += `<tr class="machine-row" data-machine="${m.machine_id}" tabindex="0" role="button">
        <td class="machine-id">${m.machine_id}<span class="row-tap-hint">แตะเพื่อแก้ไข</span></td>
        ${ISSUE_KEYS.map(k => `<td>${renderChain(m.issues[k])}</td>`).join('')}
        <td class="current-cell">
          <span class="current-num ${cls}">${total}</span>
          <span class="current-sub">${sub}</span>
        </td>
      </tr>`;
    });
  });

  if (!anyVisible) {
    rows = `<tr class="empty-row"><td colspan="${ISSUE_KEYS.length + 2}">ไม่พบเครื่องที่ตรงกับเงื่อนไข</td></tr>`;
  }

  body.innerHTML = rows;
}

/* ===================== EDIT CARD (MODAL) ===================== */
function openMachineModal(machineId){
  const machine = findMachine(activePart, machineId);
  if (!machine) return;
  modalMachineId = machineId;
  modalWeekIdx = machine.issues[ISSUE_KEYS[0]].length - 1; // default to the most recent week

  document.getElementById('modalPartName').textContent = DATA.parts[activePart].part_name_th;
  document.getElementById('modalMachineId').textContent = machineId;
  renderModalBody();
  resetSaveButton();

  const backdrop = document.getElementById('machineModalBackdrop');
  backdrop.hidden = false;
  requestAnimationFrame(() => backdrop.classList.add('open'));
  document.body.classList.add('modal-open');
}

function closeMachineModal(){
  const backdrop = document.getElementById('machineModalBackdrop');
  backdrop.classList.remove('open');
  document.body.classList.remove('modal-open');
  modalMachineId = null;
  setTimeout(() => { backdrop.hidden = true; }, 200);
}

function renderModalBody(){
  const machine = findMachine(activePart, modalMachineId);
  if (!machine) return;
  const total = machineCurrentTotal(machine);
  const cls = currentClass(total);
  document.getElementById('modalTotal').innerHTML =
    `<span class="modal-total-num ${cls}">${total}</span><span class="modal-total-label">${total === 0 ? 'เคลียร์แล้ว ✓' : 'จุดที่ยังค้างซ่อม'}</span>`;

  const weeksLen = machine.issues[ISSUE_KEYS[0]].length;
  document.getElementById('modalWeekPicker').innerHTML = renderWeekPicker(weeksLen);

  document.getElementById('modalIssues').innerHTML = ISSUE_KEYS.map(k => {
    const weeks = machine.issues[k];
    return renderModalIssueRowHtml(k, weeks);
  }).join('');
}

// One week-picker tab per column — big and explicit about which week is
// about to be edited, e.g. "สัปดาห์ 3".
function renderWeekPicker(weeksLen){
  let tabs = '';
  for (let i = 0; i < weeksLen; i++) {
    tabs += `<button type="button" class="week-picker-btn${i === modalWeekIdx ? ' active' : ''}" data-week-select="${i}">สัปดาห์ ${i + 1}</button>`;
  }
  return `<div class="week-picker-label">🖊️ กำลังแก้ไข: <strong>สัปดาห์ที่ ${modalWeekIdx + 1}</strong></div>
    <div class="week-picker-tabs">${tabs}</div>`;
}

function renderModalIssueRowHtml(issueKey, weeks){
  const val = weeks[modalWeekIdx];
  const isEmpty = val === null || val === undefined;
  const displayVal = isEmpty ? '–' : val;
  const cls2 = isEmpty ? 'empty' : currentClass(val < 0 ? 0 : val);
  return `<div class="modal-issue-row" data-issue-row="${issueKey}">
    <div class="modal-issue-top">
      <div class="modal-issue-name">${issueKey}</div>
      ${renderMiniChain(weeks, modalWeekIdx)}
    </div>
    <div class="modal-issue-controls">
      <button type="button" class="stepper-btn stepper-minus" data-issue="${issueKey}" data-dir="-1" aria-label="ลด ${issueKey} สัปดาห์ ${modalWeekIdx + 1}">−</button>
      <span class="modal-issue-value ${cls2}" data-issue="${issueKey}">${displayVal}</span>
      <button type="button" class="stepper-btn stepper-plus" data-issue="${issueKey}" data-dir="1" aria-label="เพิ่ม ${issueKey} สัปดาห์ ${modalWeekIdx + 1}">+</button>
    </div>
  </div>`;
}

// Switches which week column is being edited, then redraws the whole card
// body so the picker tab, every badge highlight, and every value line up.
function selectModalWeek(weekIdx){
  modalWeekIdx = weekIdx;
  renderModalBody();
}

// After a step, refresh just this one row's number/history/total without
// tearing down the whole card (keeps focus + avoids flicker).
function refreshModalIssueRow(issueKey){
  if (!modalMachineId) return;
  const machine = findMachine(activePart, modalMachineId);
  if (!machine) return;

  const total = machineCurrentTotal(machine);
  const clsTotal = currentClass(total);
  const totalEl = document.getElementById('modalTotal');
  if (totalEl) {
    totalEl.innerHTML = `<span class="modal-total-num ${clsTotal}">${total}</span><span class="modal-total-label">${total === 0 ? 'เคลียร์แล้ว ✓' : 'จุดที่ยังค้างซ่อม'}</span>`;
  }

  const row = document.querySelector(`.modal-issue-row[data-issue-row="${cssEscape(issueKey)}"]`);
  if (!row) return;
  const weeks = machine.issues[issueKey];
  row.outerHTML = renderModalIssueRowHtml(issueKey, weeks);
}

/* ===================== MANUAL SAVE BUTTON ===================== */
function resetSaveButton(){
  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = false;
  btn.classList.remove('save-btn-saving', 'save-btn-saved', 'save-btn-error');
  btn.innerHTML = '<span class="save-icon">💾</span> บันทึก';
}

async function saveNowFromModal(){
  clearTimeout(saveTimer); // skip the debounce, save right away
  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = true;
  btn.classList.remove('save-btn-saved', 'save-btn-error');
  btn.classList.add('save-btn-saving');
  btn.innerHTML = '<span class="save-icon">⏳</span> กำลังบันทึก…';

  const ok = await persistData();

  btn.classList.remove('save-btn-saving');
  if (ok) {
    btn.classList.add('save-btn-saved');
    btn.innerHTML = '<span class="save-icon">✓</span> บันทึกแล้ว';
    setTimeout(closeMachineModal, 550);
  } else {
    btn.disabled = false;
    btn.classList.add('save-btn-error');
    btn.innerHTML = '<span class="save-icon">⚠</span> ไม่สำเร็จ กดอีกครั้ง';
  }
}

/* ===================== ADD NEW MONTH ===================== */
// Deep-copies the part/group/machine structure from an existing month but
// blanks out every issue's weekly numbers, so a new month starts with the
// same machine list and a clean slate of data.
function cloneMonthSkeleton(sourceKey){
  const partsClone = JSON.parse(JSON.stringify(ALL_MONTHS.months[sourceKey].parts));
  Object.values(partsClone).forEach(part => {
    part.groups.forEach(g => {
      g.machines.forEach(m => {
        Object.keys(m.issues).forEach(k => {
          m.issues[k] = new Array(m.issues[k].length).fill(null);
        });
      });
    });
  });
  return partsClone;
}

function openNewMonthModal(){
  const latest = MONTH_KEYS[MONTH_KEYS.length - 1];
  pickerSelectedKey = nextMonthKey(latest);
  pickerViewYear = parseInt(pickerSelectedKey.split('-')[0], 10);
  renderThaiMonthPicker();
  document.getElementById('newMonthHint').textContent =
    `ระบบจะคัดลอกรายชื่อเครื่องทั้งหมดจากเดือน ${ALL_MONTHS.months[latest].month_name_th} ${parseInt(latest.split('-')[0], 10) + 543} แต่ล้างตัวเลขอาการเสียให้ว่างเริ่มต้นใหม่`;

  const backdrop = document.getElementById('newMonthModalBackdrop');
  backdrop.hidden = false;
  requestAnimationFrame(() => backdrop.classList.add('open'));
  document.body.classList.add('modal-open');
}

// Thai year/month grid picker — shows พ.ศ. and full Thai month names, and
// greys out months that already have data so a technician can't pick a
// duplicate by accident.
function renderThaiMonthPicker(){
  document.getElementById('tmpYearLabel').textContent = `พ.ศ. ${pickerViewYear + 543}`;
  const grid = document.getElementById('tmpMonthGrid');
  grid.innerHTML = THAI_MONTHS_FULL.map((name, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const key = `${pickerViewYear}-${mm}`;
    const exists = !!ALL_MONTHS.months[key];
    const isSelected = key === pickerSelectedKey;
    return `<button type="button"
      class="tmp-month-btn${isSelected ? ' active' : ''}${exists ? ' exists' : ''}"
      data-month="${mm}" ${exists ? 'disabled' : ''} aria-pressed="${isSelected}">
      ${name}${exists ? '<span class="tmp-exists-dot" title="มีข้อมูลเดือนนี้แล้ว"></span>' : ''}
    </button>`;
  }).join('');
}

function closeNewMonthModal(){
  const backdrop = document.getElementById('newMonthModalBackdrop');
  backdrop.classList.remove('open');
  document.body.classList.remove('modal-open');
  setTimeout(() => { backdrop.hidden = true; }, 200);
}

async function createNewMonth(){
  const val = pickerSelectedKey; // "YYYY-MM"
  if (!val) return;
  if (ALL_MONTHS.months[val]) {
    alert('มีข้อมูลเดือนนี้อยู่แล้ว — เลือกจากรายการเดือนด้านบนแทนได้เลย');
    return;
  }

  const btn = document.getElementById('createMonthBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="save-icon">⏳</span> กำลังสร้าง…';

  const sourceKey = MONTH_KEYS[MONTH_KEYS.length - 1];
  ALL_MONTHS.months[val] = {
    month: val,
    month_name_th: thaiMonthLabel(val),
    parts: cloneMonthSkeleton(sourceKey),
  };
  MONTH_KEYS = Object.keys(ALL_MONTHS.months).sort();

  const ok = await persistData();

  btn.disabled = false;
  btn.innerHTML = '<span class="save-icon">🗓️</span> สร้างเดือนนี้';

  if (!ok) {
    alert('สร้างเดือนใหม่ไม่สำเร็จ (บันทึกไม่ได้) ลองอีกครั้ง');
    delete ALL_MONTHS.months[val];
    MONTH_KEYS = Object.keys(ALL_MONTHS.months).sort();
    return;
  }

  closeNewMonthModal();
  applyMonth(val);
}

/* ===================== INIT ===================== */
document.getElementById('searchBox').addEventListener('input', renderTable);
document.getElementById('onlyPending').addEventListener('change', renderTable);

document.getElementById('monthSelect').addEventListener('change', (e) => {
  applyMonth(e.target.value);
});
document.getElementById('addMonthBtn').addEventListener('click', openNewMonthModal);
document.getElementById('newMonthCloseBtn').addEventListener('click', closeNewMonthModal);
document.getElementById('newMonthModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'newMonthModalBackdrop') closeNewMonthModal();
});
document.getElementById('createMonthBtn').addEventListener('click', createNewMonth);

document.getElementById('tmpYearPrev').addEventListener('click', () => {
  pickerViewYear--;
  pickerSelectedKey = `${pickerViewYear}-${pickerSelectedKey.split('-')[1]}`;
  renderThaiMonthPicker();
});
document.getElementById('tmpYearNext').addEventListener('click', () => {
  pickerViewYear++;
  pickerSelectedKey = `${pickerViewYear}-${pickerSelectedKey.split('-')[1]}`;
  renderThaiMonthPicker();
});
document.getElementById('tmpMonthGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('.tmp-month-btn');
  if (!btn || btn.disabled) return;
  pickerSelectedKey = `${pickerViewYear}-${btn.dataset.month}`;
  renderThaiMonthPicker();
});

// Any click on a machine row opens the edit card for that machine.
document.getElementById('tableBody').addEventListener('click', (e) => {
  const row = e.target.closest('.machine-row');
  if (!row) return;
  openMachineModal(row.dataset.machine);
});
document.getElementById('tableBody').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.machine-row');
  if (!row) return;
  e.preventDefault();
  openMachineModal(row.dataset.machine);
});

// Modal close interactions
document.getElementById('modalCloseBtn').addEventListener('click', closeMachineModal);
document.getElementById('machineModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'machineModalBackdrop') closeMachineModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modalMachineId) closeMachineModal();
  else if (!document.getElementById('newMonthModalBackdrop').hidden) closeNewMonthModal();
});

// Stepper buttons inside the modal (event-delegated since rows re-render)
document.getElementById('modalIssues').addEventListener('click', (e) => {
  const stepBtn = e.target.closest('.stepper-btn');
  if (stepBtn && modalMachineId) {
    stepWeekValue(activePart, modalMachineId, stepBtn.dataset.issue, modalWeekIdx, parseInt(stepBtn.dataset.dir, 10));
    return;
  }
  // Tapping a week bubble inside a row's history also jumps the whole
  // card to that week — same effect as using the picker tabs above.
  const weekBtn = e.target.closest('[data-week-select]');
  if (weekBtn) selectModalWeek(parseInt(weekBtn.dataset.weekSelect, 10));
});

document.getElementById('modalWeekPicker').addEventListener('click', (e) => {
  const weekBtn = e.target.closest('[data-week-select]');
  if (!weekBtn) return;
  selectModalWeek(parseInt(weekBtn.dataset.weekSelect, 10));
});

document.getElementById('modalSaveBtn').addEventListener('click', saveNowFromModal);

loadData().catch(err => {
  console.error(err);
  document.getElementById('tableBody').innerHTML =
    `<tr class="empty-row"><td colspan="7">โหลดข้อมูลไม่สำเร็จ: ${err.message}</td></tr>`;
});
