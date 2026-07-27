import { BACKUP_VERSION, downloadBlob, formatCurrency, formatDate, localBackupDate, monthFromDate, nowIso } from "./utils.js";
import { STORES, exportDatabase, importDatabase } from "./database.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(password, salt, usage) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
}

export async function encryptBackup(backup, password) {
  if (!crypto?.subtle) throw new Error("Este navegador não oferece criptografia de backup.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, "encrypt");
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(backup)));
  return {
    encrypted: true,
    format: "controle-financeiro-encrypted",
    version: 1,
    algorithm: "AES-GCM",
    keyDerivation: { name: "PBKDF2", hash: "SHA-256", iterations: 250000 },
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function decryptBackup(wrapper, password) {
  try {
    if (wrapper?.format !== "controle-financeiro-encrypted" || wrapper?.version !== 1) throw new Error("Formato criptografado não reconhecido.");
    const salt = base64ToBytes(wrapper.salt);
    const iv = base64ToBytes(wrapper.iv);
    const key = await deriveKey(password, salt, "decrypt");
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(wrapper.data));
    return JSON.parse(decoder.decode(decrypted));
  } catch (error) {
    if (error.message === "Formato criptografado não reconhecido.") throw error;
    throw new Error("Não foi possível abrir o backup. Confira a senha e tente novamente.");
  }
}

export async function createBackup() {
  return {
    format: "controle-financeiro",
    formatVersion: BACKUP_VERSION,
    exportedAt: nowIso(),
    locale: "pt-BR",
    currency: "BRL",
    data: await exportDatabase()
  };
}

export function validateBackup(backup) {
  const errors = [];
  if (!backup || typeof backup !== "object") errors.push("O conteúdo não é um objeto JSON.");
  if (backup?.format !== "controle-financeiro") errors.push("O arquivo não pertence a este aplicativo.");
  if (backup?.formatVersion !== BACKUP_VERSION) errors.push(`A versão ${backup?.formatVersion ?? "desconhecida"} não é compatível com a versão ${BACKUP_VERSION}.`);
  if (!backup?.data || typeof backup.data !== "object") errors.push("A seção de dados está ausente.");
  for (const store of STORES) {
    if (!Array.isArray(backup?.data?.[store])) errors.push(`A coleção ${store} está ausente ou é inválida.`);
  }
  const invalidRecords = STORES.flatMap((store) => (backup?.data?.[store] || []).filter((record) => !record || typeof record.id !== "string"));
  if (invalidRecords.length) errors.push(`${invalidRecords.length} registro(s) não possuem identificador válido.`);
  return { valid: errors.length === 0, errors };
}

export function backupSummary(backup) {
  const labels = {
    categories: "categorias",
    paymentMethods: "pagamentos",
    monthlyIncomes: "salários",
    additionalIncomes: "outras receitas",
    recurringExpenses: "recorrências",
    monthlyExpenseInstances: "ocorrências fixas",
    oneTimeExpenses: "gastos avulsos"
  };
  return Object.entries(labels).map(([store, label]) => ({ store, label, count: backup.data[store]?.length || 0 }));
}

export function mergeRecordsById(currentRecords, incomingRecords) {
  const merged = new Map(currentRecords.map((record) => [record.id, record]));
  incomingRecords.forEach((record) => merged.set(record.id, record));
  return [...merged.values()];
}

export async function saveBackup({ password = "" } = {}) {
  const backup = await createBackup();
  const content = password ? await encryptBackup(backup, password) : backup;
  const suffix = password ? "-protegido" : "";
  downloadBlob(JSON.stringify(content, null, 2), `controle-financeiro-backup-${localBackupDate()}${suffix}.json`, "application/json;charset=utf-8");
}

export async function restoreBackup(backup, mode) {
  const validation = validateBackup(backup);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  await importDatabase(backup.data, mode);
}

function csvEscape(value) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

function rowFor(record, type, categoryNames, paymentNames) {
  return [
    record.month || monthFromDate(record.date),
    formatDate(record.date),
    type,
    record.description || (type === "Salário" ? "Salário líquido" : ""),
    categoryNames.get(record.categoryId) || "",
    paymentNames.get(record.paymentMethodId) || "",
    record.status === "paid" ? "Pago" : record.status === "received" ? "Recebido" : "Pendente",
    formatCurrency(record.amountCents).replace(/\s/g, " "),
    record.notes || ""
  ].map(csvEscape).join(";");
}

export async function saveCsv({ scope = "all", type = "all", month }) {
  const data = await exportDatabase();
  const categoryNames = new Map(data.categories.map((record) => [record.id, record.name]));
  const paymentNames = new Map(data.paymentMethods.map((record) => [record.id, record.name]));
  const rows = [];
  const include = (record) => scope === "all" || (record.month || monthFromDate(record.date)) === month;
  if (type !== "expenses") {
    data.monthlyIncomes.filter(include).forEach((record) => rows.push(rowFor({ ...record, date: `${record.month}-01` }, "Salário", categoryNames, paymentNames)));
    data.additionalIncomes.filter(include).forEach((record) => rows.push(rowFor(record, "Receita", categoryNames, paymentNames)));
  }
  if (type !== "incomes") {
    data.monthlyExpenseInstances.filter(include).forEach((record) => rows.push(rowFor(record, "Despesa fixa", categoryNames, paymentNames)));
    data.oneTimeExpenses.filter(include).forEach((record) => rows.push(rowFor(record, "Despesa avulsa", categoryNames, paymentNames)));
  }
  const header = ["Mês", "Data", "Tipo", "Descrição", "Categoria", "Forma de pagamento", "Status", "Valor", "Observação"].map(csvEscape).join(";");
  const content = `\uFEFF${[header, ...rows].join("\r\n")}`;
  const scopeSuffix = scope === "month" ? `-${month}` : "-todos";
  downloadBlob(content, `controle-financeiro${scopeSuffix}-${localBackupDate()}.csv`, "text/csv;charset=utf-8");
  return rows.length;
}
