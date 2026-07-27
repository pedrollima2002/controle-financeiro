import { addRecord, getAll, getByIndex, getByProfile } from "./database.js";
import { compareMonths, dateForMonthAndDay, monthFromDate, nowIso, uid } from "./utils.js";

export function shouldGenerateForMonth(recurring, month) {
  if (!recurring.active) return false;
  const startMonth = monthFromDate(recurring.startDate);
  const endMonth = recurring.endDate ? monthFromDate(recurring.endDate) : null;
  return compareMonths(month, startMonth) >= 0 && (!endMonth || compareMonths(month, endMonth) <= 0);
}

export function createOccurrence(recurring, month) {
  const dueDay = Number.isInteger(recurring.dueDay) ? recurring.dueDay : null;
  const date = dueDay ? dateForMonthAndDay(month, dueDay) : null;
  const timestamp = nowIso();
  return {
    id: uid(),
    profileId: recurring.profileId,
    recurringId: recurring.id,
    occurrenceKey: `${recurring.id}:${month}`,
    month,
    description: recurring.description,
    amountCents: recurring.amountCents,
    categoryId: recurring.categoryId,
    paymentMethodId: recurring.paymentMethodId,
    date,
    dueDay,
    status: "pending",
    paidDate: null,
    fundingAllocations: occurrenceFundingAllocations(recurring, month),
    notes: recurring.notes || "",
    origin: recurring.origin || "recurring",
    sourceSnapshotUpdatedAt: recurring.updatedAt || timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1
  };
}

export function occurrenceFundingAllocations(recurring, month) {
  const template = Array.isArray(recurring.fundingTemplate) ? recurring.fundingTemplate : [];
  if (template.length === 1 && template[0].sourceType === "salary") {
    return [{ ...template[0], amountCents: recurring.amountCents, sourceMonth: month }];
  }
  if (template.length && template.every((allocation) => allocation.sourceMonth === month)) {
    return template.map((allocation) => ({ ...allocation }));
  }
  return [];
}

export function generateMissingOccurrences(recurringExpenses, existingInstances, month) {
  const existingKeys = new Set(existingInstances.map((instance) => instance.occurrenceKey));
  return recurringExpenses
    .filter((recurring) => shouldGenerateForMonth(recurring, month))
    .map((recurring) => createOccurrence(recurring, month))
    .filter((instance) => !existingKeys.has(instance.occurrenceKey));
}

export async function ensureOccurrencesForMonth(month, profileId = "") {
  const [recurringExpenses, existingInstances] = await Promise.all([
    profileId ? getByProfile("recurringExpenses", profileId) : getAll("recurringExpenses"),
    getByIndex("monthlyExpenseInstances", "month", month)
  ]);
  const scopedInstances = profileId
    ? existingInstances.filter((record) => record.profileId === profileId)
    : existingInstances;
  const missing = generateMissingOccurrences(recurringExpenses, scopedInstances, month);
  let created = 0;
  for (const occurrence of missing) {
    try {
      await addRecord("monthlyExpenseInstances", occurrence);
      created += 1;
    } catch (error) {
      if (error?.name !== "ConstraintError") throw error;
    }
  }
  return created;
}
