const STORAGE_KEY = "pl_planner_v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function defaultData() {
  return {
    lifts: [
      { id: uid(), name: "蹲舉", oneRM: 100 },
      { id: uid(), name: "臥推", oneRM: 70 },
      { id: uid(), name: "硬舉", oneRM: 120 },
    ],
    program: null,
    logs: [],
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.lifts) || parsed.lifts.length === 0) throw new Error("bad");
    parsed.logs = Array.isArray(parsed.logs) ? parsed.logs : [];
    parsed.program = parsed.program || null;
    return parsed;
  } catch {
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let data = loadData();

function roundToIncrement(value, inc) {
  if (!inc || inc <= 0) return Math.round(value * 2) / 2;
  return Math.round(value / inc) * inc;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Tabs ----------
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
  const tab = btn.dataset.tab;
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  if (tab === "progress") renderProgress();
});

// ---------- Setup: lifts / 1RM ----------
const liftsList = document.getElementById("liftsList");
const newLiftName = document.getElementById("newLiftName");
const newLiftOneRM = document.getElementById("newLiftOneRM");

function renderLifts() {
  liftsList.innerHTML = "";
  for (const lift of data.lifts) {
    const row = document.createElement("div");
    row.className = "lift-row";

    const name = document.createElement("span");
    name.className = "lift-name";
    name.textContent = lift.name;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "0.5";
    input.value = lift.oneRM;
    input.addEventListener("change", () => {
      lift.oneRM = Number(input.value) || 0;
      saveData();
      renderLiftCheckboxes();
      populateLogLiftSelect();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-lift";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `移除 ${lift.name}`);
    removeBtn.addEventListener("click", () => {
      data.lifts = data.lifts.filter((l) => l.id !== lift.id);
      saveData();
      renderLifts();
      renderLiftCheckboxes();
      populateLogLiftSelect();
    });

    row.appendChild(name);
    row.appendChild(input);
    row.appendChild(document.createTextNode("kg"));
    row.appendChild(removeBtn);
    liftsList.appendChild(row);
  }
}

document.getElementById("addLiftBtn").addEventListener("click", () => {
  const name = newLiftName.value.trim();
  const oneRM = Number(newLiftOneRM.value) || 0;
  if (!name) return;
  data.lifts.push({ id: uid(), name, oneRM });
  saveData();
  newLiftName.value = "";
  newLiftOneRM.value = "";
  renderLifts();
  renderLiftCheckboxes();
  populateLogLiftSelect();
});

// ---------- Program generator ----------
const templateType = document.getElementById("templateType");
const configPanels = {
  "531": document.getElementById("config531"),
  linear: document.getElementById("configLinear"),
  block: document.getElementById("configBlock"),
  advancedBlock: document.getElementById("configAdvancedBlock"),
  dup: document.getElementById("configDUP"),
  conjugate: document.getElementById("configConjugate"),
};
const liftCheckboxes = document.getElementById("liftCheckboxes");
const conjugateCategoryList = document.getElementById("conjugateCategoryList");
const programView = document.getElementById("programView");
const blockUsePeakDate = document.getElementById("blockUsePeakDate");
const blockPeakDate = document.getElementById("blockPeakDate");
const peakDateRow = document.getElementById("peakDateRow");
const peakDateSummary = document.getElementById("peakDateSummary");
const blockWeekInputIds = ["blockAccWeeks", "blockIntWeeks", "blockRealWeeks"];
const advBlockUsePeakDate = document.getElementById("advBlockUsePeakDate");
const advBlockPeakDate = document.getElementById("advBlockPeakDate");
const advPeakDateRow = document.getElementById("advPeakDateRow");
const advPeakDateSummary = document.getElementById("advPeakDateSummary");
const advBlockWeekInputIds = ["advBlockAccWeeks", "advBlockIntWeeks"];

templateType.addEventListener("change", () => {
  for (const [key, panel] of Object.entries(configPanels)) {
    panel.style.display = key === templateType.value ? "block" : "none";
  }
});

function recalcPeakDateSplit() {
  if (!blockPeakDate.value) {
    peakDateSummary.textContent = "";
    return;
  }
  const total = weeksUntil(blockPeakDate.value);
  const { acc, int: int_, real } = splitBlockWeeks(total - 1);
  document.getElementById("blockAccWeeks").value = acc;
  document.getElementById("blockIntWeeks").value = int_;
  document.getElementById("blockRealWeeks").value = real;
  peakDateSummary.textContent =
    `距離巔峰測試日約 ${total} 週:積累 ${acc} 週 · 轉化 ${int_} 週 · 實現 ${real} 週 · 巔峰測試週 1 週`;
}

blockUsePeakDate.addEventListener("change", () => {
  peakDateRow.style.display = blockUsePeakDate.checked ? "block" : "none";
  for (const id of blockWeekInputIds) document.getElementById(id).disabled = blockUsePeakDate.checked;
  if (blockUsePeakDate.checked) recalcPeakDateSplit();
});

blockPeakDate.addEventListener("change", () => {
  if (blockUsePeakDate.checked) recalcPeakDateSplit();
});

// Advanced Block: accumulation capped at 4 weeks, remainder goes to the combined
// intensification+realization-touch phase (that phase is the bulk of the program).
function splitAdvBlockWeeks(remaining) {
  if (remaining <= 0) return { acc: 0, combined: 0 };
  if (remaining === 1) return { acc: 0, combined: 1 };
  let acc = Math.min(4, Math.round(remaining * 0.3));
  acc = Math.min(acc, remaining - 1);
  return { acc, combined: remaining - acc };
}

function recalcAdvPeakDateSplit() {
  if (!advBlockPeakDate.value) {
    advPeakDateSummary.textContent = "";
    return;
  }
  const total = weeksUntil(advBlockPeakDate.value);
  const { acc, combined } = splitAdvBlockWeeks(total - 1);
  document.getElementById("advBlockAccWeeks").value = acc;
  document.getElementById("advBlockIntWeeks").value = combined;
  advPeakDateSummary.textContent =
    `距離巔峰測試日約 ${total} 週:積累 ${acc} 週 · 轉化＋實現 ${combined} 週 · 巔峰測試週 1 週`;
}

advBlockUsePeakDate.addEventListener("change", () => {
  advPeakDateRow.style.display = advBlockUsePeakDate.checked ? "block" : "none";
  for (const id of advBlockWeekInputIds) document.getElementById(id).disabled = advBlockUsePeakDate.checked;
  if (advBlockUsePeakDate.checked) recalcAdvPeakDateSplit();
});

advBlockPeakDate.addEventListener("change", () => {
  if (advBlockUsePeakDate.checked) recalcAdvPeakDateSplit();
});

const advBlockUseTargetRM = document.getElementById("advBlockUseTargetRM");
const advTargetRMRow = document.getElementById("advTargetRMRow");
advBlockUseTargetRM.addEventListener("change", () => {
  advTargetRMRow.style.display = advBlockUseTargetRM.checked ? "block" : "none";
});

function renderLiftCheckboxes() {
  const checkedIds = new Set(
    [...liftCheckboxes.querySelectorAll("input:checked")].map((el) => el.value)
  );
  liftCheckboxes.innerHTML = "";
  data.lifts.forEach((lift) => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = lift.id;
    cb.checked = checkedIds.size ? checkedIds.has(lift.id) : true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(lift.name));
    liftCheckboxes.appendChild(label);
  });
  renderConjugateCategoryList();
}

function renderConjugateCategoryList() {
  const prevValues = new Map(
    [...conjugateCategoryList.querySelectorAll("select")].map((el) => [el.dataset.liftId, el.value])
  );
  conjugateCategoryList.innerHTML = "";
  data.lifts.forEach((lift) => {
    const label = document.createElement("label");
    label.appendChild(document.createTextNode(lift.name + " "));
    const select = document.createElement("select");
    select.dataset.liftId = lift.id;
    select.style.width = "auto";
    select.style.padding = "2px 6px";
    for (const [value, text] of [["lower", "下肢"], ["upper", "上肢"], ["none", "不參與"]]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      select.appendChild(opt);
    }
    select.value = prevValues.get(lift.id) || "none";
    label.appendChild(select);
    conjugateCategoryList.appendChild(label);
  });
}

function selectedLiftIds() {
  return [...liftCheckboxes.querySelectorAll("input:checked")].map((el) => el.value);
}

// Pairs main lifts into 1-2-per-day training groups, evenly distributed.
function groupLiftsPairs(lifts) {
  const groups = [];
  for (let i = 0; i < lifts.length; i += 2) {
    groups.push(lifts.slice(i, i + 2));
  }
  return groups;
}

function mainLiftsFromGroup(group, computeSets) {
  return group.map((lift) => ({ liftId: lift.id, liftName: lift.name, sets: computeSets(lift) }));
}

function generate531(lifts, cfg) {
  const phases = [
    { label: "第1週 · 5s week", percents: [65, 75, 85], reps: [5, 5, "5+"] },
    { label: "第2週 · 3s week", percents: [70, 80, 90], reps: [3, 3, "3+"] },
    { label: "第3週 · 1s week", percents: [75, 85, 95], reps: [5, 3, "1+"] },
    { label: "第4週 · 減量週", percents: [40, 50, 60], reps: [5, 5, 5] },
  ];
  const groups = groupLiftsPairs(lifts);
  const weeks = [];
  let weekNumber = 1;
  for (let c = 0; c < cfg.cycles; c++) {
    for (const phase of phases) {
      const days = groups.map((group) => ({
        mainLifts: mainLiftsFromGroup(group, (lift) => {
          const tm = lift.oneRM * (cfg.tmPercent / 100);
          return phase.percents.map((p, i) => ({
            percent: p,
            reps: phase.reps[i],
            amrap: typeof phase.reps[i] === "string",
            weight: roundToIncrement(tm * (p / 100), cfg.roundIncrement),
          }));
        }),
        accessories: [],
      }));
      weeks.push({ weekNumber, phaseLabel: `${phase.label}(循環 ${c + 1})`, days });
      weekNumber++;
    }
  }
  return weeks;
}

// Shared ramp generator: percent/reps interpolate linearly across `weeksCount` weeks.
// Used directly by block periodization, and wrapped by linear periodization (with deload).
function generateRampWeeks(lifts, cfg, weekNumberOffset, phaseLabelFn) {
  const groups = groupLiftsPairs(lifts);
  const weeks = [];
  for (let w = 0; w < cfg.weeksCount; w++) {
    const t = cfg.weeksCount <= 1 ? 0 : w / (cfg.weeksCount - 1);
    const percent = cfg.startPct + (cfg.endPct - cfg.startPct) * t;
    const reps = Math.round(cfg.startReps + (cfg.endReps - cfg.startReps) * t);
    const days = groups.map((group) => ({
      mainLifts: mainLiftsFromGroup(group, (lift) => {
        const weight = roundToIncrement(lift.oneRM * (percent / 100), cfg.roundIncrement);
        return Array.from({ length: cfg.setsCount }, () => ({
          percent: Math.round(percent),
          reps,
          amrap: false,
          weight,
        }));
      }),
      accessories: [],
    }));
    weeks.push({ weekNumber: weekNumberOffset + w + 1, phaseLabel: phaseLabelFn(w), days });
  }
  return weeks;
}

function generateLinear(lifts, cfg) {
  const hasDeload = cfg.deload;
  const progressWeeksCount = hasDeload ? cfg.weeksCount - 1 : cfg.weeksCount;
  const weeks = generateRampWeeks(
    lifts,
    { ...cfg, weeksCount: progressWeeksCount },
    0,
    (w) => `第${w + 1}週`
  );
  if (hasDeload) {
    const groups = groupLiftsPairs(lifts);
    const days = groups.map((group) => ({
      mainLifts: mainLiftsFromGroup(group, (lift) => {
        const weight = roundToIncrement(lift.oneRM * 0.5, cfg.roundIncrement);
        return Array.from({ length: 3 }, () => ({ percent: 50, reps: 5, amrap: false, weight }));
      }),
      accessories: [],
    }));
    weeks.push({ weekNumber: cfg.weeksCount, phaseLabel: `第${cfg.weeksCount}週 · 減量週`, days });
  }
  return weeks;
}

// A single taper + 3-attempt "meet day" week, based on the current 1RM entered in Setup.
function generatePeakWeek(lifts, cfg, weekNumber) {
  const groups = groupLiftsPairs(lifts);
  const ramp = [
    { percent: 50, reps: 3, warmup: true },
    { percent: 70, reps: 2, warmup: true },
    { percent: 85, reps: 1, warmup: true },
    { percent: 92, reps: 1, attemptLabel: "第一次試舉(Opener)" },
    { percent: 97, reps: 1, attemptLabel: "第二次試舉" },
    { percent: 102, reps: 1, attemptLabel: "第三次試舉(挑戰新紀錄)" },
  ];
  const days = groups.map((group) => ({
    mainLifts: mainLiftsFromGroup(group, (lift) =>
      ramp.map((r) => ({
        percent: r.percent,
        reps: r.reps,
        amrap: false,
        warmup: r.warmup || false,
        attemptLabel: r.attemptLabel || null,
        weight: roundToIncrement(lift.oneRM * (r.percent / 100), cfg.roundIncrement),
      }))
    ),
    accessories: [],
  }));
  const dateLabel = cfg.peakDate ? ` · ${cfg.peakDate}` : "";
  return { weekNumber, phaseLabel: `巔峰測試週${dateLabel}`, days };
}

function generateBlock(lifts, cfg) {
  let weekOffset = 0;
  const acc = cfg.acc.weeksCount > 0 ? generateRampWeeks(lifts, cfg.acc, weekOffset, (w) => `積累期 · 第${w + 1}週`) : [];
  weekOffset += cfg.acc.weeksCount;
  const int_ = cfg.int.weeksCount > 0 ? generateRampWeeks(lifts, cfg.int, weekOffset, (w) => `轉化期 · 第${w + 1}週`) : [];
  weekOffset += cfg.int.weeksCount;
  const real = cfg.real.weeksCount > 0 ? generateRampWeeks(lifts, cfg.real, weekOffset, (w) => `實現期 · 第${w + 1}週`) : [];
  weekOffset += cfg.real.weeksCount;
  const weeks = [...acc, ...int_, ...real];
  if (cfg.peakWeek) {
    weeks.push(generatePeakWeek(lifts, cfg.peakWeek, weekOffset + 1));
  }
  return weeks;
}

// Advanced Block: accumulation (capped 4 weeks) into a single long intensification
// phase that periodically "touches" realization-level intensity every 2-3 weeks,
// instead of saving all the intensity for one block at the end (conjugate-style
// frequent exposure to near-max rather than a single late peak).
// Shared week-progression math for the three modes:
// "load" (a): reps/sets fixed at the start values, weight climbs additively (weeklyKg/week).
// "volume" (b): % 1RM fixed at startPct, reps and/or sets ramp start->end.
// "both" (c): % 1RM, reps, and sets all ramp start->end.
function progressionValues(w, weeksCount, cfg) {
  if (cfg.progression === "load") {
    return { percent: null, reps: cfg.startReps, setsCount: Math.round(cfg.startSets) };
  }
  const t = weeksCount <= 1 ? 0 : w / (weeksCount - 1);
  const percent = cfg.progression === "volume" ? cfg.startPct : cfg.startPct + (cfg.endPct - cfg.startPct) * t;
  const reps = Math.round(cfg.startReps + (cfg.endReps - cfg.startReps) * t);
  const setsCount = Math.round(cfg.startSets + (cfg.endSets - cfg.startSets) * t);
  return { percent, reps, setsCount };
}

function generateDeloadWeek(lifts, cfg, weekNumber) {
  const groups = groupLiftsPairs(lifts);
  const days = groups.map((group) => ({
    mainLifts: mainLiftsFromGroup(group, (lift) => {
      const weight = roundToIncrement(lift.oneRM * (cfg.pct / 100), cfg.roundIncrement);
      return Array.from({ length: cfg.sets }, () => ({
        percent: cfg.pct,
        reps: cfg.reps,
        amrap: false,
        weight,
      }));
    }),
    accessories: [],
  }));
  return { weekNumber, phaseLabel: "減量週(Deload)", days };
}

// Splices an extra deload week in after every `ratio` build weeks (e.g. 4:1 = 4 weeks
// on, 1 week deload), renumbering everything. Deloads are additive — they don't
// consume any of the accumulation/intensification weeks the user configured.
function insertDeloads(weeks, deloadCfg, lifts) {
  const result = [];
  let buildCount = 0;
  let weekNumber = 1;
  for (const week of weeks) {
    result.push({ ...week, weekNumber });
    weekNumber++;
    buildCount++;
    if (buildCount === deloadCfg.ratio) {
      result.push(generateDeloadWeek(lifts, deloadCfg, weekNumber));
      weekNumber++;
      buildCount = 0;
    }
  }
  return { weeks: result, nextWeekNumber: weekNumber };
}

// Reference weekly set ceilings per lift per phase (per the user's own programming
// notes), used as an optional override in place of the generic ramped set counts.
const LIFT_WEEKLY_SETS = {
  "蹲舉": { hypertrophy: 14, strength: 9, peaking: 6 },
  "臥推": { hypertrophy: 17, strength: 11, peaking: 8.5 },
  "硬舉": { hypertrophy: 11, strength: 7, peaking: 4.5 },
};

function standardWeeklySets(liftName, phase) {
  const row = LIFT_WEEKLY_SETS[liftName];
  return row ? Math.floor(row[phase]) : null;
}

function generateAdvancedBlock(lifts, cfg) {
  const accWeeksCount = Math.min(4, cfg.acc.weeksCount);
  const groups = groupLiftsPairs(lifts);
  const weeks = [];
  let weekNumber = 1;

  for (let w = 0; w < accWeeksCount; w++) {
    const { percent, reps, setsCount: genericSetsCount } = progressionValues(w, accWeeksCount, cfg.acc);
    const days = groups.map((group) => ({
      mainLifts: mainLiftsFromGroup(group, (lift) => {
        const setsCount = cfg.useStandardSets
          ? standardWeeklySets(lift.name, "hypertrophy") ?? genericSetsCount
          : genericSetsCount;
        const weight = cfg.acc.progression === "load"
          ? roundToIncrement(lift.oneRM * (cfg.acc.startPct / 100) + w * cfg.acc.weeklyKg, cfg.acc.roundIncrement)
          : roundToIncrement(lift.oneRM * (percent / 100), cfg.acc.roundIncrement);
        return Array.from({ length: setsCount }, () => ({
          percent: percent !== null ? Math.round(percent) : null,
          reps,
          amrap: false,
          weight,
        }));
      }),
      accessories: [],
    }));
    weeks.push({ weekNumber, phaseLabel: `肌肥大期 · 第${w + 1}週`, days });
    weekNumber++;
  }

  const totalTouches = Math.floor(cfg.combined.totalWeeks / cfg.combined.touchEvery);
  let touchIndex = 0;
  for (let w = 0; w < cfg.combined.totalWeeks; w++) {
    const isTouch = (w + 1) % cfg.combined.touchEvery === 0;
    let percent, reps, genericSetsCount, label;
    if (isTouch) {
      const t = totalTouches <= 1 ? 1 : touchIndex / (totalTouches - 1);
      percent = cfg.combined.realStartPct + (cfg.combined.realEndPct - cfg.combined.realStartPct) * t;
      reps = Math.round(cfg.combined.realStartReps + (cfg.combined.realEndReps - cfg.combined.realStartReps) * t);
      genericSetsCount = cfg.combined.realSets;
      label = `力量期 · 第${w + 1}週(觸及高峰期強度)`;
      touchIndex++;
    } else {
      ({ percent, reps, setsCount: genericSetsCount } = progressionValues(w, cfg.combined.totalWeeks, {
        progression: cfg.combined.intProgression,
        startPct: cfg.combined.intStartPct,
        endPct: cfg.combined.intEndPct,
        startReps: cfg.combined.intStartReps,
        endReps: cfg.combined.intEndReps,
        startSets: cfg.combined.intStartSets,
        endSets: cfg.combined.intEndSets,
      }));
      label = `力量期 · 第${w + 1}週`;
    }
    const days = groups.map((group) => ({
      mainLifts: mainLiftsFromGroup(group, (lift) => {
        const setsCount = cfg.useStandardSets
          ? standardWeeklySets(lift.name, isTouch ? "peaking" : "strength") ?? genericSetsCount
          : genericSetsCount;
        const weight = (!isTouch && cfg.combined.intProgression === "load")
          ? roundToIncrement(lift.oneRM * (cfg.combined.intStartPct / 100) + w * cfg.combined.intWeeklyKg, cfg.combined.roundIncrement)
          : roundToIncrement(lift.oneRM * (percent / 100), cfg.combined.roundIncrement);
        return Array.from({ length: setsCount }, () => ({
          percent: percent !== null ? Math.round(percent) : null,
          reps,
          amrap: false,
          weight,
        }));
      }),
      accessories: [],
    }));
    weeks.push({ weekNumber, phaseLabel: label, days });
    weekNumber++;
  }

  let finalWeeks = weeks;
  let nextWeekNumber = weekNumber;
  if (cfg.deload) {
    const inserted = insertDeloads(weeks, cfg.deload, lifts);
    finalWeeks = inserted.weeks;
    nextWeekNumber = inserted.nextWeekNumber;
  }

  if (cfg.peakWeek) {
    finalWeeks.push(generatePeakWeek(lifts, cfg.peakWeek, nextWeekNumber));
  }
  return finalWeeks;
}

// Weeks remaining until a target date (rounded to the nearest whole week, minimum 1).
function weeksUntil(dateStr) {
  const target = new Date(dateStr);
  const today = new Date(todayStr());
  const diffDays = (target - today) / (24 * 60 * 60 * 1000);
  return Math.max(1, Math.round(diffDays / 7));
}

// Splits the weeks available before the peak week across Acc/Int/Real (~40/35/25%),
// prioritizing the later (higher-intensity) phases when time is short.
function splitBlockWeeks(remaining) {
  if (remaining <= 0) return { acc: 0, int: 0, real: 0 };
  if (remaining === 1) return { acc: 0, int: 0, real: 1 };
  if (remaining === 2) return { acc: 0, int: 1, real: 1 };
  let acc = Math.max(1, Math.round(remaining * 0.4));
  let int_ = Math.max(1, Math.round(remaining * 0.35));
  let real = remaining - acc - int_;
  if (real < 1) {
    const deficit = 1 - real;
    if (acc - deficit >= 1) acc -= deficit;
    else int_ -= deficit;
    real = 1;
  }
  return { acc, int: int_, real };
}

function generateDUP(lifts, cfg) {
  const groups = groupLiftsPairs(lifts);
  const dayTypes = [
    { label: "重(Heavy)", ...cfg.heavy },
    { label: "中(Moderate)", ...cfg.moderate },
    { label: "輕(Light)", ...cfg.light },
  ];
  const weeks = [];
  for (let w = 0; w < cfg.weeksCount; w++) {
    const t = cfg.weeksCount <= 1 ? 0 : w / (cfg.weeksCount - 1);
    const days = [];
    for (const group of groups) {
      for (const dt of dayTypes) {
        const percent = dt.startPct + (dt.endPct - dt.startPct) * t;
        const reps = Math.round(dt.startReps + (dt.endReps - dt.startReps) * t);
        days.push({
          sessionLabel: dt.label,
          mainLifts: mainLiftsFromGroup(group, (lift) => {
            const weight = roundToIncrement(lift.oneRM * (percent / 100), cfg.roundIncrement);
            return Array.from({ length: cfg.setsCount }, () => ({
              percent: Math.round(percent),
              reps,
              amrap: false,
              weight,
            }));
          }),
          accessories: [],
        });
      }
    }
    weeks.push({ weekNumber: w + 1, phaseLabel: `第${w + 1}週`, days });
  }
  return weeks;
}

function generateConjugate(lifts, cfg) {
  const lowerLifts = lifts.filter((l) => cfg.categories.get(l.id) === "lower");
  const upperLifts = lifts.filter((l) => cfg.categories.get(l.id) === "upper");
  const weeks = [];
  for (let w = 0; w < cfg.weeksCount; w++) {
    const dePercent = cfg.deStartPct + cfg.deIncrement * (w % 3);
    const days = [];
    if (lowerLifts.length) {
      days.push({
        sessionLabel: "ME Lower",
        mainLifts: mainLiftsFromGroup(lowerLifts, () => [{
          instruction: cfg.meLowerNote
            ? `${cfg.meLowerNote} — 漸進上重至當日最高強度單次(RPE 9-10)`
            : "漸進上重至當日最高強度單次(RPE 9-10)",
        }]),
        accessories: [],
      });
      days.push({
        sessionLabel: "DE Lower",
        mainLifts: mainLiftsFromGroup(lowerLifts, (lift) => {
          const weight = roundToIncrement(lift.oneRM * (dePercent / 100), cfg.roundIncrement);
          return Array.from({ length: cfg.deSets }, () => ({
            percent: dePercent,
            reps: cfg.deReps,
            amrap: false,
            weight,
          }));
        }),
        accessories: [],
      });
    }
    if (upperLifts.length) {
      days.push({
        sessionLabel: "ME Upper",
        mainLifts: mainLiftsFromGroup(upperLifts, () => [{
          instruction: cfg.meUpperNote
            ? `${cfg.meUpperNote} — 漸進上重至當日最高強度單次(RPE 9-10)`
            : "漸進上重至當日最高強度單次(RPE 9-10)",
        }]),
        accessories: [],
      });
      days.push({
        sessionLabel: "DE Upper",
        mainLifts: mainLiftsFromGroup(upperLifts, (lift) => {
          const weight = roundToIncrement(lift.oneRM * (dePercent / 100), cfg.roundIncrement);
          return Array.from({ length: cfg.deSets }, () => ({
            percent: dePercent,
            reps: cfg.deReps,
            amrap: false,
            weight,
          }));
        }),
        accessories: [],
      });
    }
    weeks.push({ weekNumber: w + 1, phaseLabel: `第${w + 1}週(DE ${dePercent}%)`, days });
  }
  return weeks;
}

function numVal(id, fallback) {
  const v = Number(document.getElementById(id).value);
  return Number.isFinite(v) && document.getElementById(id).value !== "" ? v : fallback;
}

document.getElementById("generateBtn").addEventListener("click", () => {
  const ids = new Set(selectedLiftIds());
  const lifts = data.lifts.filter((l) => ids.has(l.id));
  if (lifts.length === 0) {
    alert("請至少選一個動作");
    return;
  }
  const roundIncrement = numVal("roundIncrement", 2.5);
  let weeks;
  if (templateType.value === "531") {
    weeks = generate531(lifts, {
      tmPercent: numVal("tmPercent", 90),
      cycles: numVal("cycles531", 1),
      roundIncrement,
    });
  } else if (templateType.value === "linear") {
    weeks = generateLinear(lifts, {
      weeksCount: numVal("linearWeeks", 4),
      startPct: numVal("linearStartPct", 70),
      endPct: numVal("linearEndPct", 90),
      startReps: numVal("linearStartReps", 5),
      endReps: numVal("linearEndReps", 2),
      setsCount: numVal("linearSets", 5),
      deload: document.getElementById("linearDeload").checked,
      roundIncrement,
    });
  } else if (templateType.value === "block") {
    weeks = generateBlock(lifts, {
      acc: {
        weeksCount: numVal("blockAccWeeks", 3),
        startPct: numVal("blockAccStartPct", 65),
        endPct: numVal("blockAccEndPct", 75),
        startReps: numVal("blockAccStartReps", 8),
        endReps: numVal("blockAccEndReps", 6),
        setsCount: numVal("blockAccSets", 4),
        roundIncrement,
      },
      int: {
        weeksCount: numVal("blockIntWeeks", 3),
        startPct: numVal("blockIntStartPct", 78),
        endPct: numVal("blockIntEndPct", 88),
        startReps: numVal("blockIntStartReps", 5),
        endReps: numVal("blockIntEndReps", 3),
        setsCount: numVal("blockIntSets", 4),
        roundIncrement,
      },
      real: {
        weeksCount: numVal("blockRealWeeks", 2),
        startPct: numVal("blockRealStartPct", 90),
        endPct: numVal("blockRealEndPct", 97),
        startReps: numVal("blockRealStartReps", 3),
        endReps: numVal("blockRealEndReps", 1),
        setsCount: numVal("blockRealSets", 3),
        roundIncrement,
      },
      peakWeek: document.getElementById("blockIncludePeakWeek").checked
        ? { roundIncrement, peakDate: document.getElementById("blockUsePeakDate").checked ? document.getElementById("blockPeakDate").value : null }
        : null,
    });
  } else if (templateType.value === "advancedBlock") {
    weeks = generateAdvancedBlock(lifts, {
      useStandardSets: document.getElementById("advBlockUseStandardSets").checked,
      acc: {
        weeksCount: Math.min(4, numVal("advBlockAccWeeks", 3)),
        progression: document.getElementById("advBlockAccProgression").value,
        weeklyKg: numVal("advBlockAccWeeklyKg", 2.5),
        startPct: Math.max(60, numVal("advBlockAccStartPct", 65)),
        endPct: Math.max(60, numVal("advBlockAccEndPct", 75)),
        startReps: numVal("advBlockAccStartReps", 8),
        endReps: numVal("advBlockAccEndReps", 6),
        startSets: numVal("advBlockAccStartSets", 4),
        endSets: numVal("advBlockAccEndSets", 4),
        roundIncrement,
      },
      combined: {
        totalWeeks: numVal("advBlockIntWeeks", 8),
        touchEvery: numVal("advBlockTouchEvery", 3),
        intProgression: document.getElementById("advBlockIntProgression").value,
        intWeeklyKg: numVal("advBlockIntWeeklyKg", 2.5),
        intStartPct: Math.max(75, numVal("advBlockIntStartPct", 78)),
        intEndPct: Math.max(75, numVal("advBlockIntEndPct", 88)),
        intStartReps: advBlockUseTargetRM.checked ? numVal("advBlockTargetRM", 5) : numVal("advBlockIntStartReps", 5),
        intEndReps: advBlockUseTargetRM.checked ? numVal("advBlockTargetRM", 5) : numVal("advBlockIntEndReps", 3),
        intStartSets: numVal("advBlockIntStartSets", 4),
        intEndSets: numVal("advBlockIntEndSets", 4),
        realStartPct: Math.max(85, numVal("advBlockRealStartPct", 90)),
        realEndPct: Math.max(85, numVal("advBlockRealEndPct", 97)),
        realStartReps: numVal("advBlockRealStartReps", 3),
        realEndReps: numVal("advBlockRealEndReps", 1),
        realSets: numVal("advBlockRealSets", 3),
        roundIncrement,
      },
      deload: document.getElementById("advBlockUseDeload").checked
        ? {
            ratio: numVal("advBlockDeloadRatio", 4),
            pct: numVal("advBlockDeloadPct", 55),
            sets: numVal("advBlockDeloadSets", 3),
            reps: numVal("advBlockDeloadReps", 5),
            roundIncrement,
          }
        : null,
      peakWeek: document.getElementById("advBlockIncludePeakWeek").checked
        ? { roundIncrement, peakDate: advBlockUsePeakDate.checked ? advBlockPeakDate.value : null }
        : null,
    });
  } else if (templateType.value === "dup") {
    weeks = generateDUP(lifts, {
      weeksCount: numVal("dupWeeks", 4),
      setsCount: numVal("dupSets", 4),
      roundIncrement,
      heavy: {
        startPct: numVal("dupHeavyStartPct", 80),
        endPct: numVal("dupHeavyEndPct", 90),
        startReps: numVal("dupHeavyStartReps", 5),
        endReps: numVal("dupHeavyEndReps", 3),
      },
      moderate: {
        startPct: numVal("dupModerateStartPct", 70),
        endPct: numVal("dupModerateEndPct", 78),
        startReps: numVal("dupModerateStartReps", 8),
        endReps: numVal("dupModerateEndReps", 6),
      },
      light: {
        startPct: numVal("dupLightStartPct", 60),
        endPct: numVal("dupLightEndPct", 68),
        startReps: numVal("dupLightStartReps", 10),
        endReps: numVal("dupLightEndReps", 8),
      },
    });
  } else if (templateType.value === "conjugate") {
    const categories = new Map(
      [...conjugateCategoryList.querySelectorAll("select")].map((el) => [el.dataset.liftId, el.value])
    );
    weeks = generateConjugate(lifts, {
      weeksCount: numVal("conjugateWeeks", 6),
      categories,
      meLowerNote: document.getElementById("conjugateMELowerNote").value.trim(),
      meUpperNote: document.getElementById("conjugateMEUpperNote").value.trim(),
      deSets: numVal("conjugateDESets", 8),
      deReps: numVal("conjugateDEReps", 3),
      deStartPct: numVal("conjugateDEStartPct", 50),
      deIncrement: numVal("conjugateDEIncrement", 5),
      roundIncrement,
    });
    if (weeks.every((w) => w.days.length === 0)) {
      alert("共軛法需要至少把一個動作分類為「下肢」或「上肢」");
      return;
    }
  }
  data.program = { templateType: templateType.value, generatedAt: todayStr(), weeks };
  saveData();
  renderProgram();
});

function formatReps(reps, amrap) {
  return amrap ? `${reps}(盡力做)` : `${reps}下`;
}

function renderProgram() {
  programView.innerHTML = "";
  if (!data.program) {
    programView.innerHTML = '<p class="note">還沒有課表,設定好上面的選項後按「產生課表」。</p>';
    return;
  }
  for (const week of data.program.weeks) {
    const wb = document.createElement("div");
    wb.className = "week-block";
    const h3 = document.createElement("h3");
    h3.textContent = week.phaseLabel;
    wb.appendChild(h3);

    for (const day of week.days) {
      const db = document.createElement("div");
      db.className = "day-block";
      const h4 = document.createElement("h4");
      const liftNames = day.mainLifts.map((m) => m.liftName).join(" + ");
      h4.textContent = day.sessionLabel ? `${day.sessionLabel} · ${liftNames}` : liftNames;
      db.appendChild(h4);

      const showSubHeading = day.mainLifts.length > 1;
      for (const main of day.mainLifts) {
        if (showSubHeading) {
          const subHeading = document.createElement("div");
          subHeading.className = "main-lift-heading";
          subHeading.textContent = main.liftName;
          db.appendChild(subHeading);
        }
        main.sets.forEach((s, i) => {
          const row = document.createElement("div");
          row.className = "set-row";
          const tag = s.attemptLabel ? `${s.attemptLabel} · ` : s.warmup ? "熱身 · " : "";
          row.textContent = s.instruction
            ? `第${i + 1}組 · ${s.instruction}`
            : `第${i + 1}組 · ${tag}${s.weight}kg × ${formatReps(s.reps, s.amrap)}${s.percent ? `(${s.percent}%)` : ""}`;
          db.appendChild(row);
        });
      }

      const accList = document.createElement("div");
      accList.className = "accessory-list";
      day.accessories.forEach((a, ai) => {
        const item = document.createElement("div");
        item.className = "accessory-item";
        const span = document.createElement("span");
        span.textContent = `${a.name} · ${a.sets}組 × ${a.reps}下${a.weight ? ` @ ${a.weight}kg` : ""}${a.notes ? ` (${a.notes})` : ""}`;
        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = "×";
        del.addEventListener("click", () => {
          day.accessories.splice(ai, 1);
          saveData();
          renderProgram();
        });
        item.appendChild(span);
        item.appendChild(del);
        accList.appendChild(item);
      });
      db.appendChild(accList);

      const addRow = document.createElement("div");
      addRow.className = "add-accessory-row";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "輔助動作名稱";
      const setsInput = document.createElement("input");
      setsInput.type = "number";
      setsInput.placeholder = "組數";
      setsInput.min = "1";
      const repsInput = document.createElement("input");
      repsInput.type = "number";
      repsInput.placeholder = "次數";
      repsInput.min = "1";
      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.placeholder = "重量(選填)";
      weightInput.step = "0.5";
      const addBtn = document.createElement("button");
      addBtn.className = "btn-secondary";
      addBtn.textContent = "加入";
      addBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) return;
        day.accessories.push({
          id: uid(),
          name,
          sets: Number(setsInput.value) || 1,
          reps: Number(repsInput.value) || 1,
          weight: Number(weightInput.value) || 0,
          notes: "",
        });
        saveData();
        renderProgram();
      });
      addRow.appendChild(nameInput);
      addRow.appendChild(setsInput);
      addRow.appendChild(repsInput);
      addRow.appendChild(weightInput);
      addRow.appendChild(addBtn);
      db.appendChild(addRow);

      wb.appendChild(db);
    }
    programView.appendChild(wb);
  }
}

// ---------- Log ----------
const logDate = document.getElementById("logDate");
const logLiftSelect = document.getElementById("logLiftSelect");
const logCustomName = document.getElementById("logCustomName");
const logTableBody = document.getElementById("logTableBody");

function populateLogLiftSelect() {
  const prev = logLiftSelect.value;
  logLiftSelect.innerHTML = "";
  for (const lift of data.lifts) {
    const opt = document.createElement("option");
    opt.value = lift.id;
    opt.textContent = lift.name;
    logLiftSelect.appendChild(opt);
  }
  const customOpt = document.createElement("option");
  customOpt.value = "__custom__";
  customOpt.textContent = "自訂動作…";
  logLiftSelect.appendChild(customOpt);
  if ([...logLiftSelect.options].some((o) => o.value === prev)) logLiftSelect.value = prev;
}

logLiftSelect.addEventListener("change", () => {
  logCustomName.style.display = logLiftSelect.value === "__custom__" ? "block" : "none";
});

document.getElementById("addLogBtn").addEventListener("click", () => {
  const date = logDate.value || todayStr();
  const isCustom = logLiftSelect.value === "__custom__";
  const liftId = isCustom ? null : logLiftSelect.value;
  const lift = data.lifts.find((l) => l.id === liftId);
  const exerciseName = isCustom ? logCustomName.value.trim() : lift ? lift.name : "";
  const weight = Number(document.getElementById("logWeight").value) || 0;
  const sets = Number(document.getElementById("logSets").value) || 1;
  const reps = Number(document.getElementById("logReps").value) || 1;
  const rpeRaw = document.getElementById("logRpe").value;
  const rpe = rpeRaw === "" ? null : Number(rpeRaw);
  const notes = document.getElementById("logNotes").value.trim();

  if (!exerciseName) {
    alert("請選擇或輸入動作名稱");
    return;
  }

  data.logs.push({ id: uid(), date, liftId, exerciseName, weight, sets, reps, rpe, notes });
  saveData();
  document.getElementById("logWeight").value = "";
  document.getElementById("logNotes").value = "";
  renderLogTable();
});

function renderLogTable() {
  logTableBody.innerHTML = "";
  const sorted = [...data.logs].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const entry of sorted) {
    const tr = document.createElement("tr");
    const cells = [
      entry.date,
      entry.exerciseName,
      `${entry.weight}kg`,
      `${entry.sets}x${entry.reps}`,
      entry.rpe ?? "-",
      entry.notes || "-",
    ];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => {
      data.logs = data.logs.filter((l) => l.id !== entry.id);
      saveData();
      renderLogTable();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    logTableBody.appendChild(tr);
  }
}

// ---------- Progress chart ----------
function epley1RM(weight, reps) {
  return weight * (1 + reps / 30);
}

function computeSeries() {
  return data.lifts.map((lift, i) => {
    const byDate = new Map();
    for (const entry of data.logs) {
      if (entry.liftId !== lift.id) continue;
      const e1rm = epley1RM(entry.weight, entry.reps);
      const cur = byDate.get(entry.date);
      if (!cur || e1rm > cur) byDate.set(entry.date, e1rm);
    }
    const points = [...byDate.entries()]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return { id: lift.id, name: lift.name, colorVar: `--series-${(i % 6) + 1}`, points };
  });
}

function renderProgress() {
  const series = computeSeries();
  renderLineChart(document.getElementById("progressChart"), series);
}

function renderLineChart(container, series) {
  container.innerHTML = "";
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) {
    container.innerHTML = '<p class="chart-empty">還沒有足夠的訓練紀錄可以畫趨勢圖,先去「訓練紀錄」新增幾筆吧。</p>';
    return;
  }

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  for (const s of withData) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = `var(${s.colorVar})`;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(s.name));
    legend.appendChild(item);
  }
  container.appendChild(legend);

  const W = 640, H = 320, padL = 46, padR = 16, padT = 16, padB = 30;
  const allPoints = withData.flatMap((s) => s.points);
  const times = allPoints.map((p) => new Date(p.date).getTime());
  const values = allPoints.map((p) => p.value);
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const vMinRaw = Math.min(...values), vMaxRaw = Math.max(...values);
  const vPad = Math.max((vMaxRaw - vMinRaw) * 0.15, 5);
  const vMin = Math.floor(vMinRaw - vPad);
  const vMax = Math.ceil(vMaxRaw + vPad);

  const xScale = (t) => (tMax === tMin ? padL + (W - padL - padR) / 2 : padL + ((t - tMin) / (tMax - tMin)) * (W - padL - padR));
  const yScale = (v) => padT + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - padT - padB);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.display = "block";

  // gridlines + y labels
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const v = vMin + ((vMax - vMin) * i) / gridCount;
    const y = yScale(v);
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", padL);
    line.setAttribute("x2", W - padR);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "var(--grid)");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", padL - 8);
    label.setAttribute("y", y + 3);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "var(--muted)");
    label.textContent = Math.round(v);
    svg.appendChild(label);
  }

  // x labels (up to 5 ticks)
  const tickCount = Math.min(5, allPoints.length);
  for (let i = 0; i < tickCount; i++) {
    const t = tMin + ((tMax - tMin) * i) / Math.max(tickCount - 1, 1);
    const x = xScale(t);
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", H - padB + 16);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "var(--muted)");
    const d = new Date(t);
    label.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
    svg.appendChild(label);
  }

  const crosshair = document.createElementNS(svgNS, "line");
  crosshair.setAttribute("y1", padT);
  crosshair.setAttribute("y2", H - padB);
  crosshair.setAttribute("stroke", "var(--muted)");
  crosshair.setAttribute("stroke-width", "1");
  crosshair.setAttribute("stroke-dasharray", "3,3");
  crosshair.style.display = "none";
  svg.appendChild(crosshair);

  for (const s of withData) {
    if (s.points.length === 1) {
      const p = s.points[0];
      const c = document.createElementNS(svgNS, "circle");
      c.setAttribute("cx", xScale(new Date(p.date).getTime()));
      c.setAttribute("cy", yScale(p.value));
      c.setAttribute("r", 4);
      c.setAttribute("fill", `var(${s.colorVar})`);
      svg.appendChild(c);
    } else {
      const d = s.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(new Date(p.date).getTime())},${yScale(p.value)}`)
        .join(" ");
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", `var(${s.colorVar})`);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
      for (const p of s.points) {
        const c = document.createElementNS(svgNS, "circle");
        c.setAttribute("cx", xScale(new Date(p.date).getTime()));
        c.setAttribute("cy", yScale(p.value));
        c.setAttribute("r", 4);
        c.setAttribute("fill", `var(${s.colorVar})`);
        svg.appendChild(c);
      }
    }
    // selective direct label at last point
    const last = s.points[s.points.length - 1];
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", xScale(new Date(last.date).getTime()) + 6);
    label.setAttribute("y", yScale(last.value) - 6);
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", `var(${s.colorVar})`);
    label.textContent = `${s.name} ${Math.round(last.value)}`;
    svg.appendChild(label);
  }

  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.appendChild(svg);

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  wrap.appendChild(tooltip);

  const overlay = document.createElementNS(svgNS, "rect");
  overlay.setAttribute("x", padL);
  overlay.setAttribute("y", padT);
  overlay.setAttribute("width", W - padL - padR);
  overlay.setAttribute("height", H - padT - padB);
  overlay.setAttribute("fill", "transparent");
  svg.appendChild(overlay);

  overlay.addEventListener("mousemove", (evt) => {
    const rect = svg.getBoundingClientRect();
    const cssX = evt.clientX - rect.left; // actual CSS pixel offset, for positioning the HTML tooltip
    const px = (cssX / rect.width) * W; // same point in SVG viewBox units, for drawing the crosshair
    const t = tMin + ((px - padL) / (W - padL - padR)) * (tMax - tMin);
    crosshair.setAttribute("x1", px);
    crosshair.setAttribute("x2", px);
    crosshair.style.display = "block";

    let rows = "";
    let nearestDate = null;
    for (const s of withData) {
      let closest = s.points[0];
      let minDiff = Infinity;
      for (const p of s.points) {
        const diff = Math.abs(new Date(p.date).getTime() - t);
        if (diff < minDiff) { minDiff = diff; closest = p; }
      }
      if (!nearestDate || Math.abs(new Date(closest.date).getTime() - t) < Math.abs(new Date(nearestDate).getTime() - t)) {
        nearestDate = closest.date;
      }
      rows += `<div class="tt-row"><span class="swatch" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(${s.colorVar})"></span>${s.name}: ${Math.round(closest.value)}kg</div>`;
    }
    tooltip.innerHTML = `<div class="tt-date">${nearestDate}</div>${rows}`;
    tooltip.style.display = "block";
    tooltip.style.left = `${Math.min(cssX + 12, rect.width - 160)}px`;
    tooltip.style.top = `${padT}px`;
  });

  overlay.addEventListener("mouseleave", () => {
    crosshair.style.display = "none";
    tooltip.style.display = "none";
  });

  container.appendChild(wrap);
}

// ---------- Init ----------
function init() {
  logDate.value = todayStr();
  renderLifts();
  renderLiftCheckboxes();
  populateLogLiftSelect();
  renderProgram();
  renderLogTable();
}

init();
