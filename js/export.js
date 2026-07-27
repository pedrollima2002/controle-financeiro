import { BACKUP_VERSION, downloadBlob, formatCurrency, formatDate, localBackupDate, monthFromDate, nowIso } from "./utils.js";
import { DEFAULT_PROFILE_ID, STORES, exportDatabase, importDatabase } from "./database.js";

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

const PROFILE_STORES = new Set([
  "categories", "paymentMethods", "monthlyIncomes", "additionalIncomes",
  "recurringExpenses", "monthlyExpenseInstances", "oneTimeExpenses"
]);

export async function createBackup({ profileId = "" } = {}) {
  const data = await exportDatabase();
  if (profileId) {
    PROFILE_STORES.forEach((store) => { data[store] = data[store].filter((record) => record.profileId === profileId); });
    data.profiles = data.profiles.filter((record) => record.id === profileId);
  }
  return {
    format: "controle-financeiro",
    formatVersion: BACKUP_VERSION,
    exportedAt: nowIso(),
    locale: "pt-BR",
    currency: "BRL",
    scope: profileId ? "profile" : "all",
    data
  };
}

export function validateBackup(backup) {
  const errors = [];
  if (!backup || typeof backup !== "object") errors.push("O conteúdo não é um objeto JSON.");
  if (backup?.format !== "controle-financeiro") errors.push("O arquivo não pertence a este aplicativo.");
  if (![1, 2, BACKUP_VERSION].includes(backup?.formatVersion)) errors.push(`A versão ${backup?.formatVersion ?? "desconhecida"} não é compatível com a versão ${BACKUP_VERSION}.`);
  if (!backup?.data || typeof backup.data !== "object") errors.push("A seção de dados está ausente.");
  for (const store of STORES) {
    if (store === "profiles" && backup?.formatVersion === 1) continue;
    if (!Array.isArray(backup?.data?.[store])) errors.push(`A coleção ${store} está ausente ou é inválida.`);
  }
  const invalidRecords = STORES.flatMap((store) => (backup?.data?.[store] || []).filter((record) => !record || typeof record.id !== "string"));
  if (invalidRecords.length) errors.push(`${invalidRecords.length} registro(s) não possuem identificador válido.`);
  return { valid: errors.length === 0, errors };
}

export function normalizeBackup(backup) {
  const validation = validateBackup(backup);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  if (backup.formatVersion === BACKUP_VERSION) return backup;
  const timestamp = backup.exportedAt || nowIso();
  const data = Object.fromEntries(STORES.map((store) => [store, [...(backup.data[store] || [])]]));
  if (backup.formatVersion === 1) {
    data.profiles = [{
      id: DEFAULT_PROFILE_ID, name: "Pessoal", icon: "👤", color: "#0f766e",
      createdAt: timestamp, updatedAt: timestamp, version: 1
    }];
  }
  PROFILE_STORES.forEach((store) => {
    data[store] = data[store].map((record) => ({ ...record, profileId: record.profileId || DEFAULT_PROFILE_ID }));
  });
  data.oneTimeExpenses = data.oneTimeExpenses.map((record) => ({
    ...record, fundingAllocations: Array.isArray(record.fundingAllocations) ? record.fundingAllocations : []
  }));
  data.monthlyExpenseInstances = data.monthlyExpenseInstances.map((record) => ({
    ...record, fundingAllocations: Array.isArray(record.fundingAllocations) ? record.fundingAllocations : []
  }));
  data.recurringExpenses = data.recurringExpenses.map((record) => ({
    ...record, fundingTemplate: Array.isArray(record.fundingTemplate) ? record.fundingTemplate : []
  }));
  return { ...backup, formatVersion: BACKUP_VERSION, migratedFromVersion: backup.formatVersion, data };
}

export function backupSummary(backup) {
  const labels = {
    profiles: "perfis",
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

export async function saveBackup({ password = "", profileId = "", profileName = "" } = {}) {
  const backup = await createBackup({ profileId });
  const content = password ? await encryptBackup(backup, password) : backup;
  const suffix = password ? "-protegido" : "";
  const scope = profileName ? `-${profileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
  downloadBlob(JSON.stringify(content, null, 2), `controle-financeiro-backup${scope}-${localBackupDate()}${suffix}.json`, "application/json;charset=utf-8");
}

export async function restoreBackup(backup, mode) {
  const normalized = normalizeBackup(backup);
  await importDatabase(normalized.data, mode);
}

function csvEscape(value) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

function fundingText(record, incomeNames) {
  const allocations = Array.isArray(record.fundingAllocations) ? record.fundingAllocations : [];
  if (!allocations.length) return "Sem origem definida";
  return allocations.map((allocation) => {
    const label = allocation.sourceType === "salary"
      ? "Salário"
      : incomeNames.get(allocation.sourceId) || allocation.sourceLabel || "Receita removida";
    return `${label}: ${formatCurrency(allocation.amountCents).replace(/\s/g, " ")}`;
  }).join(" | ");
}

function rowFor(record, type, categoryNames, paymentNames, profileNames, incomeNames) {
  return [
    profileNames.get(record.profileId) || "Pessoal",
    record.month || monthFromDate(record.date),
    formatDate(record.date),
    type,
    record.description || (type === "Salário" ? "Salário líquido" : ""),
    categoryNames.get(record.categoryId) || "",
    paymentNames.get(record.paymentMethodId) || "",
    type.startsWith("Despesa") ? fundingText(record, incomeNames) : "",
    record.status === "paid" ? "Pago" : record.status === "received" ? "Recebido" : "Pendente",
    formatCurrency(record.amountCents).replace(/\s/g, " "),
    record.notes || ""
  ].map(csvEscape).join(";");
}

export async function saveCsv({ scope = "all", type = "all", month, profileId = "", expenseRecords = null, filenamePrefix = "controle-financeiro" }) {
  const data = await exportDatabase();
  const categoryNames = new Map(data.categories.map((record) => [record.id, record.name]));
  const paymentNames = new Map(data.paymentMethods.map((record) => [record.id, record.name]));
  const profileNames = new Map(data.profiles.map((record) => [record.id, record.name]));
  const incomeNames = new Map(data.additionalIncomes.map((record) => [record.id, record.description]));
  const rows = [];
  const include = (record) =>
    (!profileId || profileId === "__all__" || record.profileId === profileId) &&
    (scope === "all" || (record.month || monthFromDate(record.date)) === month);
  if (type !== "expenses") {
    data.monthlyIncomes.filter(include).forEach((record) => rows.push(rowFor({ ...record, date: `${record.month}-01` }, "Salário", categoryNames, paymentNames, profileNames, incomeNames)));
    data.additionalIncomes.filter(include).forEach((record) => rows.push(rowFor(record, "Receita", categoryNames, paymentNames, profileNames, incomeNames)));
  }
  if (type !== "incomes") {
    if (Array.isArray(expenseRecords)) {
      expenseRecords.forEach((record) => rows.push(rowFor(record, record.expenseType === "fixed" ? "Despesa fixa" : "Despesa avulsa", categoryNames, paymentNames, profileNames, incomeNames)));
    } else {
      data.monthlyExpenseInstances.filter(include).forEach((record) => rows.push(rowFor(record, "Despesa fixa", categoryNames, paymentNames, profileNames, incomeNames)));
      data.oneTimeExpenses.filter(include).forEach((record) => rows.push(rowFor(record, "Despesa avulsa", categoryNames, paymentNames, profileNames, incomeNames)));
    }
  }
  const header = ["Perfil", "Mês", "Data", "Tipo", "Descrição", "Categoria", "Forma de pagamento", "Origem da renda", "Status", "Valor", "Observação"].map(csvEscape).join(";");
  const content = `\uFEFF${[header, ...rows].join("\r\n")}`;
  const scopeSuffix = scope === "month" ? `-${month}` : "-todos";
  downloadBlob(content, `${filenamePrefix}${scopeSuffix}-${localBackupDate()}.csv`, "text/csv;charset=utf-8");
  return rows.length;
}
