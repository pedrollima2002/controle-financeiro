import { normalizeText } from "./utils.js";

export function sumCents(records, key = "amountCents") {
  return records.reduce((total, record) => total + (Number.isSafeInteger(record[key]) ? record[key] : 0), 0);
}

export function calculateMonth({ salary, salaries, additionalIncomes = [], fixedExpenses = [], oneTimeExpenses = [] }) {
  const salaryRecords = Array.isArray(salaries) ? salaries : salary ? [salary] : [];
  const salaryAmount = sumCents(salaryRecords);
  const otherIncomeAmount = sumCents(additionalIncomes);
  const totalIncome = salaryAmount + otherIncomeAmount;
  const receivedIncome =
    sumCents(salaryRecords.filter((record) => record.status === "received")) +
    sumCents(additionalIncomes.filter((item) => item.status === "received"));
  const fixedAmount = sumCents(fixedExpenses);
  const oneTimeAmount = sumCents(oneTimeExpenses);
  const totalExpenses = fixedAmount + oneTimeAmount;
  const paidExpenses =
    sumCents(fixedExpenses.filter((item) => item.status === "paid")) +
    sumCents(oneTimeExpenses.filter((item) => item.status === "paid"));
  const pendingExpenses = totalExpenses - paidExpenses;
  const forecastBalance = totalIncome - totalExpenses;
  const realizedBalance = receivedIncome - paidExpenses;
  const committedPercent = totalIncome > 0 ? Math.round((totalExpenses / totalIncome) * 1000) / 10 : totalExpenses > 0 ? 100 : 0;

  return {
    salaryAmount,
    otherIncomeAmount,
    totalIncome,
    receivedIncome,
    fixedAmount,
    oneTimeAmount,
    totalExpenses,
    paidExpenses,
    pendingExpenses,
    forecastBalance,
    realizedBalance,
    committedPercent
  };
}

export function groupByCategory(records) {
  return records.reduce((groups, record) => {
    const key = record.categoryId || "uncategorized";
    groups[key] = (groups[key] || 0) + (record.amountCents || 0);
    return groups;
  }, {});
}

export function combineExpenseRecords(fixedExpenses = [], oneTimeExpenses = []) {
  return [
    ...fixedExpenses.map((item) => ({ ...item, expenseType: "fixed" })),
    ...oneTimeExpenses.map((item) => ({ ...item, expenseType: "oneTime" }))
  ];
}

export function balanceState(balanceCents, totalIncomeCents) {
  const nearZeroThreshold = Math.max(Math.round(Math.abs(totalIncomeCents) * 0.05), 5000);
  if (balanceCents < 0) return "negative";
  if (balanceCents <= nearZeroThreshold) return "near-zero";
  return "positive";
}

export function filterMonthlyRecords(records, month) {
  return records.filter((record) => record.month === month || String(record.date || "").startsWith(month));
}

export function filterExpenseRecords(records, filters = {}) {
  const search = normalizeText(filters.search);
  return records.filter((record) => {
    const comparisonDate = record.date || (record.month ? `${record.month}-01` : "");
    const allocations = Array.isArray(record.fundingAllocations) ? record.fundingAllocations : [];
    const hasSalary = allocations.some((allocation) => allocation.sourceType === "salary");
    const hasAdditional = allocations.some((allocation) => allocation.sourceType === "income");
    const isMixed = allocations.length > 1;
    const matchesFundingType =
      !filters.fundingType ||
      (filters.fundingType === "salary" && hasSalary) ||
      (filters.fundingType === "additional" && hasAdditional) ||
      (filters.fundingType === "funded" && allocations.length > 0) ||
      (filters.fundingType === "unassigned" && allocations.length === 0) ||
      (filters.fundingType === "mixed" && isMixed);
    const matchesFundingSource =
      !filters.fundingSource ||
      (filters.fundingSource === "salary" && hasSalary) ||
      (filters.fundingSource.startsWith("income:") && allocations.some((allocation) => allocation.sourceId === filters.fundingSource.slice(7)));
    return (
      (!filters.profileId || filters.profileId === "__all__" || record.profileId === filters.profileId) &&
      (!filters.categoryId || record.categoryId === filters.categoryId) &&
      (!filters.paymentMethodId || record.paymentMethodId === filters.paymentMethodId) &&
      (!filters.expenseType || record.expenseType === filters.expenseType) &&
      (!filters.status || record.status === filters.status) &&
      matchesFundingType &&
      matchesFundingSource &&
      (!search || normalizeText(record.description).includes(search)) &&
      (!filters.startDate || comparisonDate >= filters.startDate) &&
      (!filters.endDate || comparisonDate <= filters.endDate)
    );
  });
}

export function summarizeFunding(records) {
  return records.reduce((summary, record) => {
    const allocations = Array.isArray(record.fundingAllocations) ? record.fundingAllocations : [];
    if (!allocations.length) summary.unassigned += record.amountCents || 0;
    if (allocations.length > 1) summary.mixedExpenses += record.amountCents || 0;
    allocations.forEach((allocation) => {
      const amount = Number.isSafeInteger(allocation.amountCents) ? allocation.amountCents : 0;
      summary.allocated += amount;
      if (allocation.sourceType === "salary") summary.salary += amount;
      if (allocation.sourceType === "income") summary.additional += amount;
    });
    return summary;
  }, { salary: 0, additional: 0, allocated: 0, unassigned: 0, mixedExpenses: 0 });
}

export function summarizeFundingUsage(records) {
  return records.reduce((summary, record) => {
    const allocations = Array.isArray(record.fundingAllocations) ? record.fundingAllocations : [];
    allocations.forEach((allocation) => {
      const amount = Number.isSafeInteger(allocation.amountCents) ? allocation.amountCents : 0;
      if (allocation.sourceType === "salary") {
        summary.salary.used += amount;
        summary.salary[record.status === "paid" ? "paid" : "pending"] += amount;
      }
      if (allocation.sourceType === "income") {
        summary.additional.used += amount;
        const current = summary.byIncome.get(allocation.sourceId) || {
          sourceId: allocation.sourceId,
          label: allocation.sourceLabel || "Receita adicional",
          used: 0,
          paid: 0,
          pending: 0
        };
        current.used += amount;
        current[record.status === "paid" ? "paid" : "pending"] += amount;
        summary.byIncome.set(allocation.sourceId, current);
      }
    });
    if (!allocations.length) summary.unassigned += record.amountCents || 0;
    return summary;
  }, {
    salary: { used: 0, paid: 0, pending: 0 },
    additional: { used: 0 },
    byIncome: new Map(),
    unassigned: 0
  });
}

export function summarizeExpenses(records) {
  const total = sumCents(records);
  const paid = sumCents(records.filter((record) => record.status === "paid"));
  return {
    count: records.length,
    total,
    paid,
    pending: total - paid,
    average: records.length ? Math.round(total / records.length) : 0
  };
}

export function sortLargest(records, limit = 5) {
  return [...records].sort((left, right) => right.amountCents - left.amountCents).slice(0, limit);
}
