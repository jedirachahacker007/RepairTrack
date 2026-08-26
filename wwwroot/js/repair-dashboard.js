/* ===================== STATE ===================== */
let DATA = null;
let ISSUE_KEYS = [];
let PART_KEYS = [];
let activePart = null;

const DATA_URL = '/data/repair-data.json';

/* ===================== LOAD ===================== */
async function loadData() {
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (${res.status})`);
  DATA = await res.json();

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
  renderTabs();
  renderTable();
}

/* ===================== HELPERS ===================== */
function getCurrent(weeks){
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i] !== null) return weeks[i];
  }
  return 0;
}
function getLastDelta(weeks){
  let lastIdx = -1;
  for (let i = weeks.length - 1; i >= 0; i--) { if (weeks[i] !== null) { lastIdx = i; break; } }
  if (lastIdx <= 0) return 0;
  let prevIdx = -1;
  for (let i = lastIdx - 1; i >= 0; i--) { if (weeks[i] !== null) { prevIdx = i; break; } }
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

function renderChain(weeks){
  let html = '<div class="chain">';
  weeks.forEach((val, i) => {
    if (i > 0) html += '<span class="arrow">→</span>';
    if (val === null) {
      html += '<span class="badge badge-empty">–</span>';
      return;
    }
    const prev = i > 0 ? weeks[i - 1] : null;
    const delta = (prev !== null) ? val - prev : null;
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
    html += `<span class="badge ${cls}">${val}${sup}</span>`;
  });
  html += '</div>';
  return html;
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
  document.getElementById('monthChip').textContent = `${DATA.month_name_th} ${DATA.month.split('-')[0]}`;
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

/* ===================== TABLE ===================== */
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
      rows += `<tr class="machine-row">
        <td class="machine-id">${m.machine_id}</td>
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

/* ===================== INIT ===================== */
document.getElementById('searchBox').addEventListener('input', renderTable);
document.getElementById('onlyPending').addEventListener('change', renderTable);

loadData().catch(err => {
  console.error(err);
  document.getElementById('tableBody').innerHTML =
    `<tr class="empty-row"><td colspan="7">โหลดข้อมูลไม่สำเร็จ: ${err.message}</td></tr>`;
});