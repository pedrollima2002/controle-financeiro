import { monthFromDate, uid } from "./utils.js";

export function fundingMonthFor(record = {}, fallbackMonth = "") {
  return record.month || monthFromDate(record.date) || monthFromDate(record.startDate) || fallbackMonth;
}

export function salaryFundingAllocation(amountCents, month, id = uid()) {
  return {
    id,
    sourceType: "salary",
    sourceId: null,
    sourceLabel: "Salário principal",
    sourceMonth: month,
    amountCents
  };
}

export function isValidFundingAllocation(allocation) {
  if (!allocation || !Number.isSafeInteger(allocation.amountCents) || allocation.amountCents <= 0) return false;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(allocation.sourceMonth || ""))) return false;
  if (allocation.sourceType === "salary") return true;
  return allocation.sourceType === "income" && typeof allocation.sourceId === "string" && allocation.sourceId.length > 0;
}

export function hasValidFundingAllocations(allocations) {
  return Array.isArray(allocations) && allocations.length > 0 && allocations.every(isValidFundingAllocation);
}

export function fundingAllocationsTotal(allocations) {
  return Array.isArray(allocations)
    ? allocations.reduce((total, allocation) => total + (Number.isSafeInteger(allocation?.amountCents) ? allocation.amountCents : 0), 0)
    : 0;
}

export function fundingMatchesAmount(allocations, amountCents) {
  return hasValidFundingAllocations(allocations) && fundingAllocationsTotal(allocations) === amountCents;
}

export function normalizeExpenseFunding(record, fallbackMonth = "") {
  if (hasValidFundingAllocations(record?.fundingAllocations)) return record;
  const month = fundingMonthFor(record, fallbackMonth);
  return {
    ...record,
    fundingAllocations: [salaryFundingAllocation(record.amountCents || 0, month)],
    fundingUnassignedExplicit: false
  };
}

export function normalizeRecurringFunding(record, fallbackMonth = "") {
  if (hasValidFundingAllocations(record?.fundingTemplate)) return record;
  const month = fundingMonthFor(record, fallbackMonth);
  return {
    ...record,
    fundingTemplate: [salaryFundingAllocation(record.amountCents || 0, month)],
    fundingUnassignedExplicit: false
  };
}
