import { nowIso, uid } from "./utils.js";

export const DB_NAME = "meu-controle-financeiro";
export const DB_VERSION = 1;
export const STORES = [
  "settings",
  "categories",
  "paymentMethods",
  "monthlyIncomes",
  "additionalIncomes",
  "recurringExpenses",
  "monthlyExpenseInstances",
  "oneTimeExpenses",
  "appMetadata"
];

const DEFAULT_CATEGORIES = [
  ["Alimentação", "🍴", "#dc7d30"],
  ["Moradia", "⌂", "#4472c4"],
  ["Transporte", "⌁", "#36a17c"],
  ["Saúde", "✚", "#d14f63"],
  ["Lazer", "★", "#8b5fc7"],
  ["Educação", "◆", "#2675a8"],
  ["Assinaturas", "↻", "#6d7380"],
  ["Compras", "▣", "#c46b96"],
  ["Dívidas", "!", "#b5473b"],
  ["Impostos", "§", "#9a7226"],
  ["Trabalho", "▤", "#16818e"],
  ["Outros", "…", "#737f7c"]
];

const DEFAULT_PAYMENT_METHODS = [
  "Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito",
  "Transferência", "Boleto", "Débito automático", "Outro"
];

let databasePromise;

function createStore(database, name, indexes = []) {
  if (database.objectStoreNames.contains(name)) return database.transaction.objectStore(name);
  const store = database.createObjectStore(name, { keyPath: "id" });
  indexes.forEach(([indexName, keyPath, options]) => store.createIndex(indexName, keyPath, options));
  return store;
}

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error(`Não foi possível abrir o banco local: ${request.error?.message || "erro desconhecido"}`));
    request.onblocked = () => reject(new Error("A atualização do banco local foi bloqueada por outra aba aberta."));
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      database.transaction = transaction;
      if (event.oldVersion < 1) {
        createStore(database, "settings");
        createStore(database, "categories", [["active", "active"], ["name", "name"]]);
        createStore(database, "paymentMethods", [["active", "active"], ["name", "name"]]);
        createStore(database, "monthlyIncomes", [["month", "month"], ["status", "status"]]);
        createStore(database, "additionalIncomes", [["month", "month"], ["date", "date"], ["categoryId", "categoryId"], ["status", "status"]]);
        createStore(database, "recurringExpenses", [["active", "active"], ["categoryId", "categoryId"], ["startDate", "startDate"]]);
        createStore(database, "monthlyExpenseInstances", [
          ["month", "month"], ["date", "date"], ["categoryId", "categoryId"], ["status", "status"],
          ["recurringId", "recurringId"], ["occurrenceKey", "occurrenceKey", { unique: true }]
        ]);
        createStore(database, "oneTimeExpenses", [["month", "month"], ["date", "date"], ["categoryId", "categoryId"], ["paymentMethodId", "paymentMethodId"], ["status", "status"]]);
        createStore(database, "appMetadata");
      }
      delete database.transaction;
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha na operação do banco local."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Falha na transação do banco local."));
    transaction.onabort = () => reject(transaction.error || new Error("A transação do banco local foi cancelada."));
  });
}

export async function getRecord(storeName, id) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, "readonly").objectStore(storeName).get(id));
}

export async function getAll(storeName) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

export async function getByIndex(storeName, indexName, value) {
  const database = await openDatabase();
  const index = database.transaction(storeName, "readonly").objectStore(storeName).index(indexName);
  return requestResult(index.getAll(IDBKeyRange.only(value)));
}

export async function putRecord(storeName, record) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const existing = record.id ? await requestResult(transaction.objectStore(storeName).get(record.id)) : null;
  const timestamp = nowIso();
  const value = {
    ...record,
    id: record.id || uid(),
    createdAt: existing?.createdAt || record.createdAt || timestamp,
    updatedAt: timestamp,
    version: record.version || 1
  };
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  return value;
}

export async function addRecord(storeName, record) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const timestamp = nowIso();
  const value = { ...record, id: record.id || uid(), createdAt: record.createdAt || timestamp, updatedAt: timestamp, version: record.version || 1 };
  transaction.objectStore(storeName).add(value);
  await transactionDone(transaction);
  return value;
}

export async function deleteRecord(storeName, id) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(id);
  await transactionDone(transaction);
}

export async function bulkPut(storeName, records) {
  if (!records.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  records.forEach((record) => store.put(record));
  await transactionDone(transaction);
}

export async function exportDatabase() {
  const result = {};
  await Promise.all(STORES.map(async (store) => { result[store] = await getAll(store); }));
  return result;
}

export async function importDatabase(data, mode = "merge") {
  const database = await openDatabase();
  const transaction = database.transaction(STORES, "readwrite");
  for (const storeName of STORES) {
    const store = transaction.objectStore(storeName);
    if (mode === "replace") store.clear();
    for (const record of data[storeName] || []) store.put(record);
  }
  await transactionDone(transaction);
}

export async function clearDatabase() {
  const database = await openDatabase();
  const transaction = database.transaction(STORES, "readwrite");
  STORES.forEach((storeName) => transaction.objectStore(storeName).clear());
  await transactionDone(transaction);
}

export async function seedDefaults() {
  const [categories, methods] = await Promise.all([getAll("categories"), getAll("paymentMethods")]);
  const timestamp = nowIso();
  if (!categories.length) {
    await bulkPut("categories", DEFAULT_CATEGORIES.map(([name, icon, color]) => ({
      id: uid(), name, icon, color, active: true, kind: "both", origin: "system",
      createdAt: timestamp, updatedAt: timestamp, version: 1
    })));
  }
  if (!methods.length) {
    await bulkPut("paymentMethods", DEFAULT_PAYMENT_METHODS.map((name) => ({
      id: uid(), name, active: true, origin: "system",
      createdAt: timestamp, updatedAt: timestamp, version: 1
    })));
  }
  await putRecord("appMetadata", { id: "database", schemaVersion: DB_VERSION, lastOpenedAt: timestamp });
}

const CATEGORY_STORES = ["additionalIncomes", "recurringExpenses", "monthlyExpenseInstances", "oneTimeExpenses"];

export async function countCategoryUsage(categoryId) {
  const counts = await Promise.all(CATEGORY_STORES.map(async (storeName) => {
    const records = await getByIndex(storeName, "categoryId", categoryId);
    return records.length;
  }));
  return counts.reduce((total, count) => total + count, 0);
}

export async function replaceCategoryAndDelete(oldCategoryId, newCategoryId) {
  if (!newCategoryId || oldCategoryId === newCategoryId) throw new Error("Escolha uma categoria de substituição diferente.");
  const database = await openDatabase();
  const transaction = database.transaction([...CATEGORY_STORES, "categories"], "readwrite");
  for (const storeName of CATEGORY_STORES) {
    const store = transaction.objectStore(storeName);
    const index = store.index("categoryId");
    const request = index.openCursor(IDBKeyRange.only(oldCategoryId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.update({ ...cursor.value, categoryId: newCategoryId, updatedAt: nowIso() });
      cursor.continue();
    };
  }
  transaction.objectStore("categories").delete(oldCategoryId);
  await transactionDone(transaction);
}

export async function deleteDemoData() {
  const database = await openDatabase();
  const stores = ["monthlyIncomes", "additionalIncomes", "recurringExpenses", "monthlyExpenseInstances", "oneTimeExpenses"];
  const transaction = database.transaction(stores, "readwrite");
  stores.forEach((storeName) => {
    const request = transaction.objectStore(storeName).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.origin === "demo") cursor.delete();
      cursor.continue();
    };
  });
  await transactionDone(transaction);
}
