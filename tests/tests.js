import {
  calculateMonth, filterExpenseRecords, filterMonthlyRecords, groupByCategory, summarizeExpenses,
  summarizeFunding, summarizeFundingUsage
} from "../js/calculations.js";
import {
  formatCurrency, parseMoneyToCents
} from "../js/utils.js";
import {
  createOccurrence, filterValidOccurrences, generateMissingOccurrences, occurrenceFundingAllocations,
  planOccurrenceSynchronization, shouldGenerateForMonth
} from "../js/recurring.js";
import {
  fundingMatchesAmount, normalizeExpenseFunding, normalizeRecurringFunding
} from "../js/funding.js";
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

test("inclui em dezembro recorrência encerrada em qualquer dia de dezembro", () => {
  const recurring = { active: true, startDate: "2026-01-20", endDate: "2026-12-03" };
  equal(shouldGenerateForMonth(recurring, "2026-12"), true);
});

test("não inclui em janeiro recorrência encerrada em dezembro", () => {
  const recurring = { active: true, startDate: "2026-01-20", endDate: "2026-12-29" };
  equal(shouldGenerateForMonth(recurring, "2027-01"), false);
});

test("continua gerando recorrência sem data final", () => {
  equal(shouldGenerateForMonth({ active: true, startDate: "2026-01-01", endDate: null }, "2030-08"), true);
});

test("antecipa encerramento removendo somente ocorrências futuras pendentes", () => {
  const recurring = { id: "r1", active: true, startDate: "2026-01-01", endDate: "2026-06-15" };
  const plan = planOccurrenceSynchronization(recurring, [
    { id: "jun", recurringId: "r1", month: "2026-06", status: "pending" },
    { id: "jul", recurringId: "r1", month: "2026-07", status: "pending" },
    { id: "other", recurringId: "r2", month: "2026-07", status: "pending" }
  ], "2026-06");
  deepEqual(plan.deleteIds, ["jul"]);
});

test("preserva ocorrência paga fora do novo período sem contabilizá-la", () => {
  const recurring = { id: "r1", active: true, startDate: "2026-01-01", endDate: "2026-06-30" };
  const paid = { id: "jul", recurringId: "r1", month: "2026-07", status: "paid" };
  const plan = planOccurrenceSynchronization(recurring, [paid], "2026-06");
  deepEqual(plan.deleteIds, []);
  equal(plan.updateRecords[0].scheduleInvalid, true);
  equal(filterValidOccurrences([paid], [recurring]).length, 0);
});

test("remover a data final permite gerar meses novamente", () => {
  const recurring = { active: true, startDate: "2026-01-01", endDate: "2026-06-30" };
  equal(shouldGenerateForMonth(recurring, "2026-09"), false);
  equal(shouldGenerateForMonth({ ...recurring, endDate: null }, "2026-09"), true);
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

test("nova ocorrência sem escolha manual recebe salário como origem", () => {
  const occurrence = createOccurrence({
    id: "r-default", profileId: "p1", active: true, description: "Aluguel",
    amountCents: 15000, dueDay: 5, categoryId: "c1", paymentMethodId: "pix",
    startDate: "2026-07-01"
  }, "2026-07");
  equal(occurrence.fundingAllocations[0].sourceType, "salary");
  equal(occurrence.fundingAllocations[0].sourceMonth, "2026-07");
  equal(occurrence.fundingAllocations[0].amountCents, 15000);
});

test("não leva receita adicional específica para outro mês e volta ao salário padrão", () => {
  const recurring = {
    amountCents: 25000,
    fundingTemplate: [{ id: "a1", sourceType: "income", sourceId: "i1", sourceMonth: "2026-07", amountCents: 25000 }]
  };
  equal(occurrenceFundingAllocations(recurring, "2026-07").length, 1);
  const nextMonth = occurrenceFundingAllocations(recurring, "2026-08");
  equal(nextMonth.length, 1);
  equal(nextMonth[0].sourceType, "salary");
});

test("mantém receita adicional escolhida no mês correspondente", () => {
  const allocation = { id: "a1", sourceType: "income", sourceId: "i1", sourceLabel: "Extra", sourceMonth: "2026-07", amountCents: 25000 };
  const result = occurrenceFundingAllocations({ amountCents: 25000, fundingTemplate: [allocation] }, "2026-07");
  deepEqual(result, [allocation]);
});

test("novo gasto sem escolha manual recebe salário como origem", () => {
  const migrated = normalizeExpenseFunding({ id: "g1", profileId: "p1", month: "2026-07", amountCents: 15000 });
  equal(migrated.fundingAllocations[0].sourceType, "salary");
  equal(migrated.fundingAllocations[0].sourceMonth, "2026-07");
  equal(migrated.fundingAllocations[0].amountCents, 15000);
});

test("nova recorrência sem escolha manual recebe salário como origem", () => {
  const migrated = normalizeRecurringFunding({ id: "r1", startDate: "2026-07-01", amountCents: 22000, fundingTemplate: [] });
  equal(migrated.fundingTemplate[0].sourceType, "salary");
  equal(migrated.fundingTemplate[0].amountCents, 22000);
});

test("divisão entre salário e receita soma exatamente o gasto", () => {
  const allocations = [
    { sourceType: "salary", sourceMonth: "2026-07", amountCents: 12000 },
    { sourceType: "income", sourceId: "i1", sourceMonth: "2026-07", amountCents: 8000 }
  ];
  equal(fundingMatchesAmount(allocations, 20000), true);
  equal(fundingMatchesAmount(allocations, 21000), false);
});

test("migração não modifica gasto que já possui origem", () => {
  const record = {
    id: "g1", month: "2026-07", amountCents: 10000,
    fundingAllocations: [{ sourceType: "income", sourceId: "i1", sourceMonth: "2026-07", amountCents: 10000 }]
  };
  equal(normalizeExpenseFunding(record), record);
});

test("valida a estrutura completa de backup", () => {
  const data = Object.fromEntries(STORES.map((store) => [store, []]));
  const result = validateBackup({ format: "controle-financeiro", formatVersion: 4, data });
  equal(result.valid, true);
  equal(validateBackup({ format: "inválido", formatVersion: 4, data }).valid, false);
});

test("migra backup antigo para o perfil Pessoal", () => {
  const oldStores = STORES.filter((store) => store !== "profiles");
  const data = Object.fromEntries(oldStores.map((store) => [store, []]));
  data.oneTimeExpenses = [{ id: "g1", amountCents: 1000 }];
  const oldBackup = { format: "controle-financeiro", formatVersion: 1, exportedAt: "2026-01-01T00:00:00.000Z", data };
  equal(validateBackup(oldBackup).valid, true);
  const migrated = normalizeBackup(oldBackup);
  equal(migrated.formatVersion, 4);
  equal(migrated.data.profiles[0].name, "Pessoal");
  equal(migrated.data.oneTimeExpenses[0].profileId, "profile-default");
  equal(migrated.data.oneTimeExpenses[0].fundingAllocations[0].sourceType, "salary");
});

test("migra backup da versão de perfis sem alterar os perfis", () => {
  const data = Object.fromEntries(STORES.map((store) => [store, []]));
  data.profiles = [{ id: "p1", name: "Casa" }];
  data.monthlyExpenseInstances = [{ id: "f1", profileId: "p1", amountCents: 1000 }];
  const migrated = normalizeBackup({ format: "controle-financeiro", formatVersion: 2, data });
  equal(migrated.formatVersion, 4);
  equal(migrated.data.profiles[0].name, "Casa");
  equal(migrated.data.monthlyExpenseInstances[0].fundingAllocations[0].sourceType, "salary");
});

test("importação de backup da versão 3 aplica salário sem perder dados", () => {
  const data = Object.fromEntries(STORES.map((store) => [store, []]));
  data.profiles = [{ id: "p1", name: "Pessoal" }];
  data.oneTimeExpenses = [{
    id: "g1", profileId: "p1", month: "2026-07", date: "2026-07-10",
    amountCents: 33000, status: "paid", fundingAllocations: []
  }];
  const migrated = normalizeBackup({ format: "controle-financeiro", formatVersion: 3, data });
  const expense = migrated.data.oneTimeExpenses[0];
  equal(migrated.formatVersion, 4);
  equal(expense.id, "g1");
  equal(expense.date, "2026-07-10");
  equal(expense.status, "paid");
  equal(expense.fundingAllocations[0].sourceType, "salary");
  equal(expense.fundingAllocations[0].amountCents, 33000);
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

test("relatório contabiliza somente a parte usada de cada renda", () => {
  const usage = summarizeFundingUsage([
    {
      amountCents: 20000, status: "paid",
      fundingAllocations: [
        { sourceType: "salary", sourceMonth: "2026-07", amountCents: 12000 },
        { sourceType: "income", sourceId: "i1", sourceLabel: "Trabalho extra", sourceMonth: "2026-07", amountCents: 8000 }
      ]
    },
    {
      amountCents: 5000, status: "pending",
      fundingAllocations: [{ sourceType: "salary", sourceMonth: "2026-07", amountCents: 5000 }]
    }
  ]);
  equal(usage.salary.used, 17000);
  equal(usage.salary.paid, 12000);
  equal(usage.salary.pending, 5000);
  equal(usage.additional.used, 8000);
  equal(usage.byIncome.get("i1").used, 8000);
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
