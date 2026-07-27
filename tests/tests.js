import {
  calculateMonth, filterMonthlyRecords, groupByCategory
} from "../js/calculations.js";
import {
  formatCurrency, parseMoneyToCents
} from "../js/utils.js";
import {
  createOccurrence, generateMissingOccurrences, shouldGenerateForMonth
} from "../js/recurring.js";
import {
  mergeRecordsById, validateBackup
} from "../js/export.js";
import { STORES } from "../js/database.js";

const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

function equal(actual, expected) {
  if (actual !== expected) throw new Error(`esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
}

function deepEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
}

test("converte reais com separador brasileiro para centavos", () => {
  equal(parseMoneyToCents("R$ 1.234,56"), 123456);
  equal(parseMoneyToCents("32,50"), 3250);
});

test("formata centavos como moeda brasileira", () => {
  equal(formatCurrency(123456).replace(/\s/g, " "), "R$ 1.234,56");
});

test("calcula total de receitas", () => {
  const result = calculateMonth({
    salary: { amountCents: 400000, status: "received" },
    additionalIncomes: [{ amountCents: 25000, status: "pending" }],
    fixedExpenses: [],
    oneTimeExpenses: []
  });
  equal(result.totalIncome, 425000);
  equal(result.receivedIncome, 400000);
});

test("calcula total de despesas", () => {
  const result = calculateMonth({
    salary: null,
    additionalIncomes: [],
    fixedExpenses: [{ amountCents: 100000, status: "paid" }],
    oneTimeExpenses: [{ amountCents: 25000, status: "pending" }]
  });
  equal(result.totalExpenses, 125000);
  equal(result.paidExpenses, 100000);
  equal(result.pendingExpenses, 25000);
});

test("calcula saldo previsto e realizado", () => {
  const result = calculateMonth({
    salary: { amountCents: 400000, status: "received" },
    additionalIncomes: [{ amountCents: 50000, status: "pending" }],
    fixedExpenses: [{ amountCents: 100000, status: "paid" }],
    oneTimeExpenses: [{ amountCents: 30000, status: "pending" }]
  });
  equal(result.forecastBalance, 320000);
  equal(result.realizedBalance, 300000);
});

test("agrupa despesas por categoria", () => {
  deepEqual(groupByCategory([
    { categoryId: "a", amountCents: 1000 },
    { categoryId: "b", amountCents: 2000 },
    { categoryId: "a", amountCents: 500 }
  ]), { a: 1500, b: 2000 });
});

test("identifica recorrência aplicável ao mês", () => {
  const recurring = { active: true, startDate: "2026-01-01", endDate: "2026-12-31" };
  equal(shouldGenerateForMonth(recurring, "2026-07"), true);
  equal(shouldGenerateForMonth(recurring, "2027-01"), false);
});

test("gera ocorrência com vencimento ajustado ao fim do mês", () => {
  const occurrence = createOccurrence({
    id: "r1", active: true, description: "Conta", amountCents: 1000, dueDay: 31,
    categoryId: "c1", paymentMethodId: "p1", startDate: "2026-01-01"
  }, "2026-02");
  equal(occurrence.date, "2026-02-28");
  equal(occurrence.occurrenceKey, "r1:2026-02");
});

test("não duplica recorrências já existentes", () => {
  const recurring = {
    id: "r1", active: true, description: "Conta", amountCents: 1000, dueDay: 10,
    categoryId: "c1", paymentMethodId: "p1", startDate: "2026-01-01"
  };
  const generated = generateMissingOccurrences([recurring], [{ occurrenceKey: "r1:2026-07" }], "2026-07");
  equal(generated.length, 0);
});

test("valida a estrutura completa de backup", () => {
  const data = Object.fromEntries(STORES.map((store) => [store, []]));
  const result = validateBackup({ format: "controle-financeiro", formatVersion: 1, data });
  equal(result.valid, true);
  equal(validateBackup({ format: "inválido", formatVersion: 1, data }).valid, false);
});

test("mescla registros por identificador sem duplicar", () => {
  const merged = mergeRecordsById([{ id: "1", value: "antigo" }], [{ id: "1", value: "novo" }, { id: "2", value: "outro" }]);
  equal(merged.length, 2);
  equal(merged.find((item) => item.id === "1").value, "novo");
});

test("filtra registros pelo mês", () => {
  const records = [
    { month: "2026-07", id: 1 },
    { date: "2026-07-20", id: 2 },
    { month: "2026-08", id: 3 }
  ];
  deepEqual(filterMonthlyRecords(records, "2026-07").map((item) => item.id), [1, 2]);
});

async function run() {
  const results = document.querySelector("#results");
  let passed = 0;
  for (const item of tests) {
    const row = document.createElement("li");
    try {
      await item.callback();
      row.className = "pass";
      row.textContent = `PASSOU — ${item.name}`;
      passed += 1;
    } catch (error) {
      row.className = "fail";
      row.textContent = `FALHOU — ${item.name}: ${error.message}`;
    }
    results.append(row);
  }
  const summary = document.querySelector("#summary");
  summary.textContent = `${passed} de ${tests.length} testes passaram.`;
  summary.dataset.passed = String(passed);
  summary.dataset.total = String(tests.length);
}

run();
