import { addRecord, deleteRecord, getAll, getByIndex, getByProfile, putRecord } from "./database.js";
import { salaryFundingAllocation } from "./funding.js";
import { compareMonths, dateForMonthAndDay, monthFromDate, nowIso, uid } from "./utils.js";

export function isMonthWithinRecurrence(recurring, month) {
  const startMonth = monthFromDate(recurring.startDate);
  const endMonth = recurring.endDate ? monthFromDate(recurring.endDate) : null;
  return compareMonths(month, startMonth) >= 0 && (!endMonth || compareMonths(month, endMonth) <= 0);
}

export function shouldGenerateForMonth(recurring, month) {
  return Boolean(recurring.active) && isMonthWithinRecurrence(recurring, month);
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
  if (recurring.fundingUnassignedExplicit) return [];
  return [salaryFundingAllocation(recurring.amountCents, month)];
}

export function planOccurrenceSynchronization(recurring, instances, referenceMonth) {
  const deleteIds = [];
  const updateRecords = [];
  instances
    .filter((instance) => instance.recurringId === recurring.id)
    .forEach((instance) => {
      const outsidePeriod = !isMonthWithinRecurrence(recurring, instance.month);
      const inactiveFuture = !recurring.active && compareMonths(instance.month, referenceMonth) > 0;
      if ((outsidePeriod || inactiveFuture) && instance.status === "pending") {
        deleteIds.push(instance.id);
        return;
      }
      if (outsidePeriod && instance.status === "paid") {
        if (!instance.scheduleInvalid) {
          updateRecords.push({
            ...instance,
            scheduleInvalid: true,
            scheduleInvalidReason: "outside-recurrence"
          });
        }
        return;
      }
      if (!outsidePeriod && instance.scheduleInvalid) {
        const { scheduleInvalid, scheduleInvalidReason, ...restored } = instance;
        updateRecords.push(restored);
      }
    });
  return { deleteIds, updateRecords };
}

export function filterValidOccurrences(instances, recurringExpenses) {
  const recurringById = new Map(recurringExpenses.map((recurring) => [recurring.id, recurring]));
  return instances.filter((instance) => {
    const recurring = recurringById.get(instance.recurringId);
    return !recurring || isMonthWithinRecurrence(recurring, instance.month);
  });
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

export async function synchronizeRecurringOccurrences(recurring, referenceMonth) {
  const instances = await getByIndex("monthlyExpenseInstances", "recurringId", recurring.id);
  const plan = planOccurrenceSynchronization(recurring, instances, referenceMonth);
  for (const id of plan.deleteIds) await deleteRecord("monthlyExpenseInstances", id);
  for (const record of plan.updateRecords) await putRecord("monthlyExpenseInstances", record);
  if (shouldGenerateForMonth(recurring, referenceMonth)) {
    await ensureOccurrencesForMonth(referenceMonth, recurring.profileId);
  }
  return {
    removed: plan.deleteIds.length,
    preservedPaid: plan.updateRecords.filter((record) => record.scheduleInvalid).length,
    restored: plan.updateRecords.filter((record) => !record.scheduleInvalid).length
  };
}

export async function synchronizeAllRecurringOccurrences(referenceMonth) {
  const recurringExpenses = await getAll("recurringExpenses");
  const results = [];
  for (const recurring of recurringExpenses) {
    results.push(await synchronizeRecurringOccurrences(recurring, referenceMonth));
  }
  return results.reduce((summary, result) => ({
    removed: summary.removed + result.removed,
    preservedPaid: summary.preservedPaid + result.preservedPaid,
    restored: summary.restored + result.restored
  }), { removed: 0, preservedPaid: 0, restored: 0 });
}
