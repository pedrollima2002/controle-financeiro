import { nowIso, uid } from "./utils.js";

export const DB_NAME = "meu-controle-financeiro";
export const DB_VERSION = 3;
export const DEFAULT_PROFILE_ID = "profile-default";
export const STORES = [
  "settings",
  "profiles",
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

const PROFILE_STORES = [
  "categories", "paymentMethods", "monthlyIncomes", "additionalIncomes",
  "recurringExpenses", "monthlyExpenseInstances", "oneTimeExpenses"
];

function createStore(database, transaction, name, indexes = []) {
  if (database.objectStoreNames.contains(name)) return transaction.objectStore(name);
  const store = database.createObjectStore(name, { keyPath: "id" });
  indexes.forEach(([indexName, keyPath, options]) => store.createIndex(indexName, keyPath, options));
  return store;
}

function addIndex(store, indexName, keyPath, options) {
  if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, options);
}

function addProfileIndexesAndMigrate(transaction) {
  const profileIndexes = {
    categories: [["profileId", "profileId"], ["profileActive", ["profileId", "active"]]],
    paymentMethods: [["profileId", "profileId"], ["profileActive", ["profileId", "active"]]],
    monthlyIncomes: [["profileId", "profileId"], ["profileMonth", ["profileId", "month"]]],
    additionalIncomes: [["profileId", "profileId"], ["profileMonth", ["profileId", "month"]]],
    recurringExpenses: [["profileId", "profileId"], ["profileActive", ["profileId", "active"]]],
    monthlyExpenseInstances: [["profileId", "profileId"], ["profileMonth", ["profileId", "month"]]],
    oneTimeExpenses: [["profileId", "profileId"], ["profileMonth", ["profileId", "month"]]]
  };
  PROFILE_STORES.forEach((storeName) => {
    const store = transaction.objectStore(storeName);
    profileIndexes[storeName].forEach(([name, keyPath, options]) => addIndex(store, name, keyPath, options));
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const value = { ...cursor.value, profileId: cursor.value.profileId || DEFAULT_PROFILE_ID };
      if (["monthlyExpenseInstances", "oneTimeExpenses"].includes(storeName) && !Array.isArray(value.fundingAllocations)) {
        value.fundingAllocations = [];
      }
      if (storeName === "recurringExpenses" && !Array.isArray(value.fundingTemplate)) value.fundingTemplate = [];
      cursor.update(value);
      cursor.continue();
    };
  });
}

function migrateFundingAllocations(transaction) {
  [
    ["monthlyExpenseInstances", "fundingAllocations"],
    ["oneTimeExpenses", "fundingAllocations"],
    ["recurringExpenses", "fundingTemplate"]
  ].forEach(([storeName, field]) => {
    const request = transaction.objectStore(storeName).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!Array.isArray(cursor.value[field])) cursor.update({ ...cursor.value, [field]: [] });
      cursor.continue();
    };
  });
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
      if (event.oldVersion < 1) {
        createStore(database, transaction, "settings");
        createStore(database, transaction, "categories", [["active", "active"], ["name", "name"]]);
        createStore(database, transaction, "paymentMethods", [["active", "active"], ["name", "name"]]);
        createStore(database, transaction, "monthlyIncomes", [["month", "month"], ["status", "status"]]);
        createStore(database, transaction, "additionalIncomes", [["month", "month"], ["date", "date"], ["categoryId", "categoryId"], ["status", "status"]]);
        createStore(database, transaction, "recurringExpenses", [["active", "active"], ["categoryId", "categoryId"], ["startDate", "startDate"]]);
        createStore(database, transaction, "monthlyExpenseInstances", [
          ["month", "month"], ["date", "date"], ["categoryId", "categoryId"], ["status", "status"],
          ["recurringId", "recurringId"], ["occurrenceKey", "occurrenceKey", { unique: true }]
        ]);
        createStore(database, transaction, "oneTimeExpenses", [["month", "month"], ["date", "date"], ["categoryId", "categoryId"], ["paymentMethodId", "paymentMethodId"], ["status", "status"]]);
        createStore(database, transaction, "appMetadata");
      }
      if (event.oldVersion < 2) {
        const profiles = createStore(database, transaction, "profiles", [["name", "name"]]);
        const timestamp = nowIso();
        profiles.put({
          id: DEFAULT_PROFILE_ID, name: "Pessoal", icon: "👤", color: "#0f766e",
          createdAt: timestamp, updatedAt: timestamp, version: 1
        });
        addProfileIndexesAndMigrate(transaction);
      }
      if (event.oldVersion >= 2 && event.oldVersion < 3) migrateFundingAllocations(transaction);
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

export async function getByProfile(storeName, profileId) {
  return getByIndex(storeName, "profileId", profileId);
}

export async function getByProfileMonth(storeName, profileId, month) {
  return getByIndex(storeName, "profileMonth", [profileId, month]);
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

export async function seedDefaults(profileId = DEFAULT_PROFILE_ID) {
  let profiles = await getAll("profiles");
  const timestamp = nowIso();
  if (!profiles.length) {
    await putRecord("profiles", {
      id: DEFAULT_PROFILE_ID, name: "Pessoal", icon: "👤", color: "#0f766e"
    });
    profiles = await getAll("profiles");
  }
  const targetProfileId = profiles.some((profile) => profile.id === profileId) ? profileId : profiles[0].id;
  const [categories, methods] = await Promise.all([
    getByProfile("categories", targetProfileId),
    getByProfile("paymentMethods", targetProfileId)
  ]);
  if (!categories.length) {
    await bulkPut("categories", DEFAULT_CATEGORIES.map(([name, icon, color]) => ({
      id: uid(), profileId: targetProfileId, name, icon, color, active: true, kind: "both", origin: "system",
      createdAt: timestamp, updatedAt: timestamp, version: 1
    })));
  }
  if (!methods.length) {
    await bulkPut("paymentMethods", DEFAULT_PAYMENT_METHODS.map((name) => ({
      id: uid(), profileId: targetProfileId, name, active: true, origin: "system",
      createdAt: timestamp, updatedAt: timestamp, version: 1
    })));
  }
  await putRecord("appMetadata", { id: "database", schemaVersion: DB_VERSION, lastOpenedAt: timestamp });
  return targetProfileId;
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

export async function createProfile({ name, icon = "👤", color = "#0f766e", copyFromProfileId = "" }) {
  const profile = await putRecord("profiles", { id: `profile-${uid()}`, name, icon, color });
  if (copyFromProfileId) {
    const [categories, methods] = await Promise.all([
      getByProfile("categories", copyFromProfileId),
      getByProfile("paymentMethods", copyFromProfileId)
    ]);
    await bulkPut("categories", categories.map((record) => ({
      ...record, id: uid(), profileId: profile.id, createdAt: nowIso(), updatedAt: nowIso()
    })));
    await bulkPut("paymentMethods", methods.map((record) => ({
      ...record, id: uid(), profileId: profile.id, createdAt: nowIso(), updatedAt: nowIso()
    })));
  } else {
    await seedDefaults(profile.id);
  }
  return profile;
}

export async function deleteProfile(profileId) {
  const database = await openDatabase();
  const transaction = database.transaction([...PROFILE_STORES, "profiles"], "readwrite");
  PROFILE_STORES.forEach((storeName) => {
    const request = transaction.objectStore(storeName).index("profileId").openCursor(IDBKeyRange.only(profileId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  });
  transaction.objectStore("profiles").delete(profileId);
  await transactionDone(transaction);
}

export async function deleteDemoData(profileId) {
  const database = await openDatabase();
  const stores = ["monthlyIncomes", "additionalIncomes", "recurringExpenses", "monthlyExpenseInstances", "oneTimeExpenses"];
  const transaction = database.transaction(stores, "readwrite");
  stores.forEach((storeName) => {
    const request = transaction.objectStore(storeName).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.origin === "demo" && (!profileId || cursor.value.profileId === profileId)) cursor.delete();
      cursor.continue();
    };
  });
  await transactionDone(transaction);
}
