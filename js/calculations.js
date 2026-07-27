export function sumCents(records, key = "amountCents") {
  return records.reduce((total, record) => total + (Number.isSafeInteger(record[key]) ? record[key] : 0), 0);
}

export function calculateMonth({ salary, additionalIncomes = [], fixedExpenses = [], oneTimeExpenses = [] }) {
  const salaryAmount = salary?.amountCents || 0;
  const otherIncomeAmount = sumCents(additionalIncomes);
  const totalIncome = salaryAmount + otherIncomeAmount;
  const receivedIncome =
    (salary?.status === "received" ? salaryAmount : 0) +
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

export function sortLargest(records, limit = 5) {
  return [...records].sort((left, right) => right.amountCents - left.amountCents).slice(0, limit);
}
