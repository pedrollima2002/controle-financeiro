export const APP_NAME = "Meu Controle Financeiro";
export const BACKUP_VERSION = 4;

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function currentLocalDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function monthFromDate(date) {
  return String(date || "").slice(0, 7);
}

export function shiftMonth(month, amount) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month, options = { month: "long", year: "numeric" }) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", options).format(new Date(year, monthNumber - 1, 1));
}

export function formatCurrency(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((Number(cents) || 0) / 100);
}

export function formatMoneyInput(cents) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
}

export function parseMoneyToCents(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const negative = raw.includes("-");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return 0;
  const cents = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(cents)) throw new Error("O valor informado é muito alto.");
  return negative ? -cents : cents;
}

export function formatDate(dateValue) {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return dateValue;
  return new Intl.DateTimeFormat("pt-BR").format(new Date(year, month - 1, day));
}

export function clampDay(month, day) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return Math.min(Math.max(Number(day) || 1, 1), lastDay);
}

export function dateForMonthAndDay(month, day) {
  return `${month}-${String(clampDay(month, day)).padStart(2, "0")}`;
}

export function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function localBackupDate() {
  return currentLocalDate();
}

export function isValidMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value));
}

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function safeInteger(value, fieldName = "valor") {
  if (!Number.isSafeInteger(value)) throw new Error(`O campo ${fieldName} precisa ser um número inteiro seguro.`);
  return value;
}

export function compareMonths(left, right) {
  return String(left).localeCompare(String(right));
}
