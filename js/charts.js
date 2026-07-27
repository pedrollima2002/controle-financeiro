const FALLBACK_COLORS = ["#0f766e", "#dc7d30", "#4472c4", "#8b5fc7", "#d14f63", "#36a17c", "#9a7226", "#16818e"];

function setupCanvas(canvas) {
  const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || canvas.parentElement?.clientWidth || 500));
  const height = Number(canvas.getAttribute("height")) || 280;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    text: style.getPropertyValue("--text").trim() || "#17302c",
    muted: style.getPropertyValue("--muted").trim() || "#61736f",
    line: style.getPropertyValue("--line").trim() || "#dbe5e2",
    surface: style.getPropertyValue("--surface").trim() || "#fff"
  };
}

function emptyChart(context, width, height, message = "Sem dados para exibir") {
  const colors = themeColors();
  context.clearRect(0, 0, width, height);
  context.fillStyle = colors.muted;
  context.textAlign = "center";
  context.font = "13px system-ui";
  context.fillText(message, width / 2, height / 2);
}

export function drawDonut(canvas, entries) {
  const { context, width, height } = setupCanvas(canvas);
  const validEntries = entries.filter((entry) => entry.value > 0);
  if (!validEntries.length) return emptyChart(context, width, height);
  const colors = themeColors();
  const total = validEntries.reduce((sum, entry) => sum + entry.value, 0);
  const centerX = Math.min(width * 0.35, 170);
  const centerY = height / 2;
  const radius = Math.min(centerX - 18, height * 0.32);
  let angle = -Math.PI / 2;
  context.clearRect(0, 0, width, height);
  validEntries.forEach((entry, index) => {
    const next = angle + (entry.value / total) * Math.PI * 2;
    context.beginPath();
    context.arc(centerX, centerY, radius, angle, next);
    context.strokeStyle = entry.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    context.lineWidth = Math.max(22, radius * 0.34);
    context.stroke();
    angle = next;
  });
  context.fillStyle = colors.text;
  context.font = "700 18px system-ui";
  context.textAlign = "center";
  context.fillText(`${Math.round(total / 100).toLocaleString("pt-BR")}`, centerX, centerY - 2);
  context.fillStyle = colors.muted;
  context.font = "11px system-ui";
  context.fillText("reais em despesas", centerX, centerY + 17);

  const legendX = Math.max(centerX * 2 + 20, width * 0.58);
  const maxLegend = Math.min(validEntries.length, 6);
  validEntries.slice(0, maxLegend).forEach((entry, index) => {
    const y = 35 + index * 34;
    context.fillStyle = entry.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    context.fillRect(legendX, y - 8, 10, 10);
    context.fillStyle = colors.text;
    context.textAlign = "left";
    context.font = "600 11px system-ui";
    context.fillText(String(entry.label).slice(0, 18), legendX + 17, y);
    context.fillStyle = colors.muted;
    context.font = "10px system-ui";
    context.fillText(`${Math.round((entry.value / total) * 100)}%`, legendX + 17, y + 14);
  });
}

export function drawBars(canvas, entries) {
  const { context, width, height } = setupCanvas(canvas);
  const validEntries = entries.filter((entry) => Number.isFinite(entry.value));
  if (!validEntries.length || validEntries.every((entry) => entry.value === 0)) return emptyChart(context, width, height);
  const colors = themeColors();
  const padding = { top: 25, right: 20, bottom: 52, left: 52 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(...validEntries.map((entry) => entry.value), 1);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = colors.line;
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (innerHeight / 4) * index;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }
  const groupWidth = innerWidth / validEntries.length;
  validEntries.forEach((entry, index) => {
    const barWidth = Math.min(68, groupWidth * 0.58);
    const barHeight = (entry.value / max) * innerHeight;
    const x = padding.left + groupWidth * index + (groupWidth - barWidth) / 2;
    const y = padding.top + innerHeight - barHeight;
    context.fillStyle = entry.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    context.beginPath();
    context.roundRect(x, y, barWidth, barHeight, [7, 7, 0, 0]);
    context.fill();
    context.fillStyle = colors.muted;
    context.textAlign = "center";
    context.font = "10px system-ui";
    context.fillText(String(entry.label).slice(0, 12), x + barWidth / 2, height - 27);
    context.fillStyle = colors.text;
    context.font = "600 10px system-ui";
    context.fillText(`${Math.round(entry.value / 100).toLocaleString("pt-BR")}`, x + barWidth / 2, Math.max(14, y - 6));
  });
}

export function drawLine(canvas, entries) {
  const { context, width, height } = setupCanvas(canvas);
  if (!entries.length) return emptyChart(context, width, height);
  const colors = themeColors();
  const padding = { top: 28, right: 22, bottom: 48, left: 24 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const values = entries.map((entry) => entry.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(max - min, 1);
  const xFor = (index) => padding.left + (entries.length === 1 ? innerWidth / 2 : (innerWidth * index) / (entries.length - 1));
  const yFor = (value) => padding.top + ((max - value) / range) * innerHeight;
  context.clearRect(0, 0, width, height);
  const zeroY = yFor(0);
  context.strokeStyle = colors.line;
  context.beginPath();
  context.moveTo(padding.left, zeroY);
  context.lineTo(width - padding.right, zeroY);
  context.stroke();
  context.strokeStyle = "#0f766e";
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.beginPath();
  entries.forEach((entry, index) => {
    const x = xFor(index);
    const y = yFor(entry.value);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  entries.forEach((entry, index) => {
    const x = xFor(index);
    const y = yFor(entry.value);
    context.fillStyle = entry.value < 0 ? "#b42318" : "#0f766e";
    context.beginPath();
    context.arc(x, y, 4.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = colors.muted;
    context.font = "10px system-ui";
    context.textAlign = "center";
    context.fillText(entry.label, x, height - 24);
  });
}
