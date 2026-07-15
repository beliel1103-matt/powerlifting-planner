const STORAGE_KEY = "pl_planner_v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function defaultData() {
  return {
    lifts: [
      { id: uid(), name: "蹲舉", oneRM: 100 },
      { id: uid(), name: "臥推", oneRM: 70 },
      { id: uid(), name: "硬拉", oneRM: 120 },
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
const config531 = document.getElementById("config531");
const configLinear = document.getElementById("configLinear");
const liftCheckboxes = document.getElementById("liftCheckboxes");
const programView = document.getElementById("programView");

templateType.addEventListener("change", () => {
  config531.style.display = templateType.value === "531" ? "block" : "none";
  configLinear.style.display = templateType.value === "linear" ? "block" : "none";
});

function renderLiftCheckboxes() {
  const checkedIds = new Set(
    [...liftCheckboxes.querySelectorAll("input:checked")].map((el) => el.value)
  );
  liftCheckboxes.innerHTML = "";
  data.lifts.forEach((lift, i) => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = lift.id;
    cb.checked = checkedIds.size ? checkedIds.has(lift.id) : true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(lift.name));
    liftCheckboxes.appendChild(label);
  });
}

function selectedLiftIds() {
  return [...liftCheckboxes.querySelectorAll("input:checked")].map((el) => el.value);
}

function generate531(lifts, cfg) {
  const phases = [
    { label: "第1週 · 5s week", percents: [65, 75, 85], reps: [5, 5, "5+"] },
    { label: "第2週 · 3s week", percents: [70, 80, 90], reps: [3, 3, "3+"] },
    { label: "第3週 · 1s week", percents: [75, 85, 95], reps: [5, 3, "1+"] },
    { label: "第4週 · 減量週", percents: [40, 50, 60], reps: [5, 5, 5] },
  ];
  const weeks = [];
  let weekNumber = 1;
  for (let c = 0; c < cfg.cycles; c++) {
    for (const phase of phases) {
      const days = lifts.map((lift) => {
        const tm = lift.oneRM * (cfg.tmPercent / 100);
        const sets = phase.percents.map((p, i) => ({
          percent: p,
          reps: phase.reps[i],
          amrap: typeof phase.reps[i] === "string",
          weight: roundToIncrement(tm * (p / 100), cfg.roundIncrement),
        }));
        return { liftId: lift.id, liftName: lift.name, sets, accessories: [] };
      });
      weeks.push({ weekNumber, phaseLabel: `${phase.label}(循環 ${c + 1})`, days });
      weekNumber++;
    }
  }
  return weeks;
}

function generateLinear(lifts, cfg) {
  const hasDeload = cfg.deload;
  const progressWeeks = hasDeload ? cfg.weeksCount - 1 : cfg.weeksCount;
  const weeks = [];
  for (let w = 0; w < progressWeeks; w++) {
    const t = progressWeeks <= 1 ? 0 : w / (progressWeeks - 1);
    const percent = cfg.startPct + (cfg.endPct - cfg.startPct) * t;
    const reps = Math.round(cfg.startReps + (cfg.endReps - cfg.startReps) * t);
    const days = lifts.map((lift) => {
      const weight = roundToIncrement(lift.oneRM * (percent / 100), cfg.roundIncrement);
      const sets = Array.from({ length: cfg.setsCount }, () => ({
        percent: Math.round(percent),
        reps,
        amrap: false,
        weight,
      }));
      return { liftId: lift.id, liftName: lift.name, sets, accessories: [] };
    });
    weeks.push({ weekNumber: w + 1, phaseLabel: `第${w + 1}週`, days });
  }
  if (hasDeload) {
    const days = lifts.map((lift) => {
      const weight = roundToIncrement(lift.oneRM * 0.5, cfg.roundIncrement);
      const sets = Array.from({ length: 3 }, () => ({ percent: 50, reps: 5, amrap: false, weight }));
      return { liftId: lift.id, liftName: lift.name, sets, accessories: [] };
    });
    weeks.push({ weekNumber: cfg.weeksCount, phaseLabel: `第${cfg.weeksCount}週 · 減量週`, days });
  }
  return weeks;
}

document.getElementById("generateBtn").addEventListener("click", () => {
  const ids = new Set(selectedLiftIds());
  const lifts = data.lifts.filter((l) => ids.has(l.id));
  if (lifts.length === 0) {
    alert("請至少選一個動作");
    return;
  }
  const roundIncrement = Number(document.getElementById("roundIncrement").value) || 2.5;
  let weeks;
  if (templateType.value === "531") {
    weeks = generate531(lifts, {
      tmPercent: Number(document.getElementById("tmPercent").value) || 90,
      cycles: Number(document.getElementById("cycles531").value) || 1,
      roundIncrement,
    });
  } else {
    weeks = generateLinear(lifts, {
      weeksCount: Number(document.getElementById("linearWeeks").value) || 5,
      startPct: Number(document.getElementById("linearStartPct").value) || 70,
      endPct: Number(document.getElementById("linearEndPct").value) || 90,
      startReps: Number(document.getElementById("linearStartReps").value) || 5,
      endReps: Number(document.getElementById("linearEndReps").value) || 2,
      setsCount: Number(document.getElementById("linearSets").value) || 5,
      deload: document.getElementById("linearDeload").checked,
      roundIncrement,
    });
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
      h4.textContent = day.liftName;
      db.appendChild(h4);

      day.sets.forEach((s, i) => {
        const row = document.createElement("div");
        row.className = "set-row";
        row.textContent = `第${i + 1}組 · ${s.weight}kg × ${formatReps(s.reps, s.amrap)}${s.percent ? `(${s.percent}%)` : ""}`;
        db.appendChild(row);
      });

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
