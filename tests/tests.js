import {
  calculateMonth, filterExpenseRecords, filterMonthlyRecords, groupByCategory, summarizeExpenses, summarizeFunding
} from "../js/calculations.js";
import {
  formatCurrency, parseMoneyToCents
} from "../js/utils.js";
import {
  createOccurrence, generateMissingOccurrences, occurrenceFundingAllocations, shouldGenerateForMonth
} from "../js/recurring.js";
import {
  mergeRecordsById, normalizeBackup, validateBackup
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

test("soma salários de vários perfis no consolidado", () => {
  const result = calculateMonth({
    salaries: [
      { amountCents: 400000, status: "received" },
      { amountCents: 250000, status: "pending" }
    ]
  });
  equal(result.salaryAmount, 650000);
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

test("gera gasto fixo sem data quando o vencimento é opcional", () => {
  const occurrence = createOccurrence({
    id: "r2", profileId: "p1", active: true, description: "Valor variável",
    amountCents: 1000, dueDay: null, categoryId: "c1", paymentMethodId: "p1",
    startDate: "2026-01-01"
  }, "2026-07");
  equal(occurrence.date, null);
  equal(occurrence.dueDay, null);
  equal(occurrence.profileId, "p1");
});

test("não duplica recorrências já existentes", () => {
  const recurring = {
    id: "r1", active: true, description: "Conta", amountCents: 1000, dueDay: 10,
    categoryId: "c1", paymentMethodId: "p1", startDate: "2026-01-01"
  };
  const generated = generateMissingOccurrences([recurring], [{ occurrenceKey: "r1:2026-07" }], "2026-07");
  equal(generated.length, 0);
});

test("repete desconto do salário nas próximas ocorrências", () => {
  const recurring = {
    amountCents: 25000,
    fundingTemplate: [{ id: "a1", sourceType: "salary", sourceMonth: "2026-07", amountCents: 20000 }]
  };
  const allocations = occurrenceFundingAllocations(recurring, "2026-08");
  equal(allocations.length, 1);
  equal(allocations[0].sourceType, "salary");
  equal(allocations[0].amountCents, 25000);
  equal(allocations[0].sourceMonth, "2026-08");
});

test("não leva receita adicional específica para outro mês", () => {
  const recurring = {
    amountCents: 25000,
    fundingTemplate: [{ id: "a1", sourceType: "income", sourceId: "i1", sourceMonth: "2026-07", amountCents: 25000 }]
  };
  equal(occurrenceFundingAllocations(recurring, "2026-07").length, 1);
  equal(occurrenceFundingAllocations(recurring, "2026-08").length, 0);
});

test("valida a estrutura completa de backup", () => {
  const data = Object.fromEntries(STORES.map((store) => [store, []]));
  const result = validateBackup({ format: "controle-financeiro", formatVersion: 3, data });
  equal(result.valid, true);
  equal(validateBackup({ format: "inválido", formatVersion: 3, data }).valid, false);
});

test("migra backup antigo para o perfil Pessoal", () => {
  const oldStores = STORES.filter((store) => store !== "profiles");
  const data = Object.fromEntries(oldStores.map((store) => [store, []]));
  data.oneTimeExpenses = [{ id: "g1", amountCents: 1000 }];
  const oldBackup = { format: "controle-financeiro", formatVersion: 1, exportedAt: "2026-01-01T00:00:00.000Z", data };
  equal(validateBackup(oldBackup).valid, true);
  const migrated = normalizeBackup(oldBackup);
  equal(migrated.formatVersion, 3);
  equal(migrated.data.profiles[0].name, "Pessoal");
  equal(migrated.data.oneTimeExpenses[0].profileId, "profile-default");
  deepEqual(migrated.data.oneTimeExpenses[0].fundingAllocations, []);
});

test("migra backup da versão de perfis sem alterar os perfis", () => {
  const data = Object.fromEntries(STORES.map((store) => [store, []]));
  data.profiles = [{ id: "p1", name: "Casa" }];
  data.monthlyExpenseInstances = [{ id: "f1", profileId: "p1", amountCents: 1000 }];
  const migrated = normalizeBackup({ format: "controle-financeiro", formatVersion: 2, data });
  equal(migrated.formatVersion, 3);
  equal(migrated.data.profiles[0].name, "Casa");
  deepEqual(migrated.data.monthlyExpenseInstances[0].fundingAllocations, []);
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

test("combina filtros de perfil, categoria, pagamento e status", () => {
  const records = [
    { id: "1", profileId: "p1", categoryId: "c1", paymentMethodId: "pix", expenseType: "fixed", status: "paid", description: "Internet", date: "2026-07-10", amountCents: 10000 },
    { id: "2", profileId: "p1", categoryId: "c1", paymentMethodId: "card", expenseType: "oneTime", status: "pending", description: "Mercado", date: "2026-07-12", amountCents: 20000 },
    { id: "3", profileId: "p2", categoryId: "c1", paymentMethodId: "pix", expenseType: "fixed", status: "paid", description: "Internet", date: "2026-07-10", amountCents: 30000 }
  ];
  const filtered = filterExpenseRecords(records, {
    profileId: "p1", categoryId: "c1", paymentMethodId: "pix", expenseType: "fixed", status: "paid"
  });
  deepEqual(filtered.map((item) => item.id), ["1"]);
});

test("resume o total filtrado, pago, pendente e média", () => {
  const summary = summarizeExpenses([
    { amountCents: 10000, status: "paid" },
    { amountCents: 30000, status: "pending" }
  ]);
  deepEqual(summary, { count: 2, total: 40000, paid: 10000, pending: 30000, average: 20000 });
});

test("filtra gastos pela origem da renda", () => {
  const records = [
    { id: "s", description: "Salário", fundingAllocations: [{ sourceType: "salary", amountCents: 1000 }] },
    { id: "i", description: "Extra", fundingAllocations: [{ sourceType: "income", sourceId: "r1", amountCents: 2000 }] },
    { id: "m", description: "Dividido", fundingAllocations: [{ sourceType: "salary", amountCents: 1000 }, { sourceType: "income", sourceId: "r1", amountCents: 1000 }] },
    { id: "u", description: "Antigo", fundingAllocations: [] }
  ];
  deepEqual(filterExpenseRecords(records, { fundingType: "salary" }).map((item) => item.id), ["s", "m"]);
  deepEqual(filterExpenseRecords(records, { fundingType: "additional" }).map((item) => item.id), ["i", "m"]);
  deepEqual(filterExpenseRecords(records, { fundingType: "mixed" }).map((item) => item.id), ["m"]);
  deepEqual(filterExpenseRecords(records, { fundingType: "unassigned" }).map((item) => item.id), ["u"]);
  deepEqual(filterExpenseRecords(records, { fundingSource: "income:r1" }).map((item) => item.id), ["i", "m"]);
});

test("resume salário, receitas adicionais e gastos sem origem", () => {
  const summary = summarizeFunding([
    { amountCents: 4000, fundingAllocations: [{ sourceType: "salary", amountCents: 3000 }, { sourceType: "income", sourceId: "r1", amountCents: 1000 }] },
    { amountCents: 2000, fundingAllocations: [{ sourceType: "income", sourceId: "r1", amountCents: 2000 }] },
    { amountCents: 500, fundingAllocations: [] }
  ]);
  deepEqual(summary, { salary: 3000, additional: 3000, allocated: 6000, unassigned: 500, mixedExpenses: 4000 });
});

export async function executeTests() {
  const outcomes = [];
  for (const item of tests) {
    try {
      await item.callback();
      outcomes.push({ name: item.name, passed: true });
    } catch (error) {
      outcomes.push({ name: item.name, passed: false, error: error.message });
    }
  }
  return outcomes;
}

async function run() {
  const results = document.querySelector("#results");
  const outcomes = await executeTests();
  outcomes.forEach((item) => {
    const row = document.createElement("li");
    if (item.passed) {
      row.className = "pass";
      row.textContent = `PASSOU — ${item.name}`;
    } else {
      row.className = "fail";
      row.textContent = `FALHOU — ${item.name}: ${item.error}`;
    }
    results.append(row);
  });
  const passed = outcomes.filter((item) => item.passed).length;
  const summary = document.querySelector("#summary");
  summary.textContent = `${passed} de ${outcomes.length} testes passaram.`;
  summary.dataset.passed = String(passed);
  summary.dataset.total = String(outcomes.length);
}

if (typeof document !== "undefined") run();
