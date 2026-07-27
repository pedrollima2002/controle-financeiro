import {
  DEFAULT_PROFILE_ID, bulkPut, clearDatabase, countCategoryUsage, createProfile,
  deleteDemoData, deleteProfile, deleteRecord, getAll, getByIndex,
  getByProfileMonth, getRecord, putRecord, replaceCategoryAndDelete, seedDefaults
} from "./database.js";
import {
  balanceState, calculateMonth, combineExpenseRecords, filterExpenseRecords, groupByCategory,
  sortLargest, sumCents, summarizeExpenses
} from "./calculations.js";
import { drawBars, drawDonut, drawLine } from "./charts.js";
import { ensureOccurrencesForMonth } from "./recurring.js";
import {
  backupSummary, decryptBackup, restoreBackup, saveBackup, saveCsv, validateBackup
} from "./export.js";
import {
  currentLocalDate, currentMonth, formatCurrency, formatDate, formatMoneyInput, isValidDate,
  monthFromDate, monthLabel, normalizeText, nowIso, parseMoneyToCents, shiftMonth, uid,
  dateForMonthAndDay
} from "./utils.js";

const ALL_PROFILES = "__all__";
const ACTIVE_PROFILE_KEY = "finance-active-profile";
const REPORT_PRESETS_KEY = "finance-report-presets";
const LAST_BACKUP_KEY = "finance-last-backup";

const state = {
  month: currentMonth(),
  view: "dashboard",
  profiles: [],
  activeProfileId: localStorage.getItem(ACTIVE_PROFILE_KEY) || DEFAULT_PROFILE_ID,
  allCategories: [],
  allPaymentMethods: [],
  categories: [],
  paymentMethods: [],
  salaries: [],
  salary: null,
  incomes: [],
  recurring: [],
  instances: [],
  expenses: [],
  allExpenses: [],
  metrics: null,
  editor: null,
  confirmResolve: null,
  pendingImportWrapper: null,
  pendingBackup: null,
  deferredInstallPrompt: null,
  registration: null
};

const dom = {};

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function createElement(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  Object.entries(options).forEach(([key, value]) => {
    if (key === "className") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key === "style") Object.assign(element.style, value);
    else if (key.startsWith("aria")) element.setAttribute(key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`), value);
    else if (value !== undefined && value !== null) element.setAttribute(key, value);
  });
  const list = Array.isArray(children) ? children : [children];
  list.filter(Boolean).forEach((child) => element.append(child));
  return element;
}

function replaceChildren(target, children = []) {
  target.replaceChildren(...(Array.isArray(children) ? children : [children]));
}

function categoryById(id) {
  return state.allCategories.find((category) => category.id === id);
}

function paymentById(id) {
  return state.allPaymentMethods.find((method) => method.id === id);
}

function profileById(id) {
  return state.profiles.find((profile) => profile.id === id);
}

function activeProfile() {
  return profileById(state.activeProfileId);
}

function isAllProfiles() {
  return state.activeProfileId === ALL_PROFILES;
}

function profileName(id) {
  return profileById(id)?.name || "Pessoal";
}

function profileScoped(records, profileId = state.activeProfileId) {
  return profileId === ALL_PROFILES ? records : records.filter((record) => record.profileId === profileId);
}

function categoryInfo(id) {
  return categoryById(id) || { name: "Sem categoria", icon: "…", color: "#737f7c" };
}

function toast(message, type = "success") {
  const item = createElement("div", { className: `toast ${type}`, text: message, role: "status" });
  dom.toastRegion.append(item);
  setTimeout(() => item.remove(), 4200);
}

function showEmpty(target, title, message) {
  target.hidden = false;
  replaceChildren(target, [
    createElement("strong", { text: title }),
    createElement("span", { text: message })
  ]);
}

function hideEmpty(target) {
  target.hidden = true;
  target.replaceChildren();
}

function statusPill(status) {
  const labels = { paid: "Pago", pending: "Pendente", received: "Recebido", active: "Ativo", inactive: "Inativo" };
  return createElement("span", { className: `status-pill ${status}`, text: labels[status] || status });
}

function actionButton(action, id, label, symbol, extraClass = "") {
  return createElement("button", {
    className: `table-action ${extraClass}`.trim(), type: "button", title: label, ariaLabel: label,
    dataset: { action, id }, text: symbol
  });
}

function tableCell(content, className = "") {
  const cell = createElement("td", { className });
  if (content instanceof Node) cell.append(content);
  else cell.textContent = content ?? "";
  return cell;
}

function metricCard(label, value, note = "", emphasis = false) {
  return createElement("article", { className: `metric-card${emphasis ? " emphasis" : ""}` }, [
    createElement("span", { text: label }),
    createElement("strong", { text: value }),
    createElement("small", { text: note })
  ]);
}

function miniMetric(label, value) {
  return createElement("div", { className: "mini-metric" }, [
    createElement("span", { text: label }),
    createElement("strong", { text: value })
  ]);
}

function currentCategoryOptions({ includeInactiveId = "", kind = "" } = {}) {
  return state.categories
    .filter((category) => (category.active || category.id === includeInactiveId) && (!kind || category.kind === "both" || category.kind === kind))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
    .map((category) => ({ value: category.id, label: `${category.icon || "•"} ${category.name}` }));
}

function currentPaymentOptions(includeInactiveId = "") {
  return state.paymentMethods
    .filter((method) => method.active || method.id === includeInactiveId)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
    .map((method) => ({ value: method.id, label: method.name }));
}

async function refreshReferenceData() {
  [state.profiles, state.allCategories, state.allPaymentMethods, state.recurring, state.allExpenses] = await Promise.all([
    getAll("profiles"), getAll("categories"), getAll("paymentMethods"), getAll("recurringExpenses"), getAll("oneTimeExpenses")
  ]);
  state.profiles.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (!isAllProfiles() && !state.profiles.some((profile) => profile.id === state.activeProfileId)) {
    state.activeProfileId = state.profiles[0]?.id || DEFAULT_PROFILE_ID;
    localStorage.setItem(ACTIVE_PROFILE_KEY, state.activeProfileId);
  }
  state.categories = profileScoped(state.allCategories);
  state.paymentMethods = profileScoped(state.allPaymentMethods);
  state.recurring = profileScoped(state.recurring);
  state.allExpenses = profileScoped(state.allExpenses);
  state.categories.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  state.paymentMethods.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

async function loadMonth() {
  if (!state.month) return;
  await ensureOccurrencesForMonth(state.month, isAllProfiles() ? "" : state.activeProfileId);
  await refreshReferenceData();
  const [salaries, incomes, instances, expenses] = await Promise.all([
    getByIndex("monthlyIncomes", "month", state.month),
    getByIndex("additionalIncomes", "month", state.month),
    getByIndex("monthlyExpenseInstances", "month", state.month),
    getByIndex("oneTimeExpenses", "month", state.month)
  ]);
  state.salaries = profileScoped(salaries);
  state.salary = isAllProfiles() ? null : state.salaries[0] || null;
  state.incomes = profileScoped(incomes).sort((left, right) => right.date.localeCompare(left.date));
  state.instances = profileScoped(instances).sort((left, right) => String(left.date || "9999").localeCompare(String(right.date || "9999")));
  state.expenses = profileScoped(expenses).sort((left, right) => right.date.localeCompare(left.date));
  state.metrics = calculateMonth({
    salaries: state.salaries,
    additionalIncomes: state.incomes,
    fixedExpenses: state.instances,
    oneTimeExpenses: state.expenses
  });
  await renderAll();
}

function renderMonthLabels() {
  dom.monthPicker.value = state.month;
  dom.dashboardMonthLabel.textContent = monthLabel(state.month);
}

function renderProfileControls() {
  replaceChildren(dom.profilePicker, [
    ...state.profiles.map((profile) => createElement("option", { value: profile.id, text: `${profile.icon || "👤"} ${profile.name}` })),
    createElement("option", { value: ALL_PROFILES, text: "◉ Todos os perfis" })
  ]);
  dom.profilePicker.value = state.activeProfileId;
}

function renderDashboardNotices() {
  const lastBackup = localStorage.getItem(LAST_BACKUP_KEY);
  const daysSinceBackup = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000) : null;
  dom.backupReminder.hidden = daysSinceBackup !== null && daysSinceBackup < 30;
  dom.backupReminderText.textContent = daysSinceBackup === null
    ? "Faça a primeira cópia dos seus dados para não depender apenas deste navegador."
    : `A última cópia foi feita há ${daysSinceBackup} dia(s).`;
  const undated = state.instances.filter((record) => !record.date && record.status === "pending");
  dom.undatedExpensesPanel.hidden = !undated.length;
  dom.undatedExpensesText.textContent = `${undated.length} pendência(s), somando ${formatCurrency(sumCents(undated))}.`;
}

function renderDashboard() {
  const metrics = state.metrics;
  const status = balanceState(metrics.forecastBalance, metrics.totalIncome);
  const statusContent = {
    positive: ["✓", "Saldo previsto positivo", "Você está dentro do planejamento deste mês."],
    "near-zero": ["!", "Saldo previsto próximo de zero", "Sua margem está curta. Revise os gastos pendentes."],
    negative: ["↓", "Saldo previsto negativo", "As despesas previstas ultrapassam suas receitas."]
  }[status];
  dom.balanceBanner.className = `status-banner ${status}`;
  dom.balanceIcon.textContent = statusContent[0];
  dom.balanceStatus.textContent = statusContent[1];
  dom.balanceMessage.textContent = statusContent[2];
  dom.balanceValue.textContent = formatCurrency(metrics.forecastBalance);
  replaceChildren(dom.dashboardMetrics, [
    metricCard(isAllProfiles() ? "Salários líquidos" : "Salário líquido", formatCurrency(metrics.salaryAmount), isAllProfiles() ? `${state.salaries.length} perfil(is)` : state.salary?.status === "received" ? "Recebido" : "Previsto"),
    metricCard("Outras receitas", formatCurrency(metrics.otherIncomeAmount), `${state.incomes.length} lançamento(s)`),
    metricCard("Total de receitas", formatCurrency(metrics.totalIncome), `${formatCurrency(metrics.receivedIncome)} recebidos`),
    metricCard("Gastos fixos", formatCurrency(metrics.fixedAmount), `${state.instances.filter((item) => item.status === "pending").length} pendente(s)`),
    metricCard("Gastos avulsos", formatCurrency(metrics.oneTimeAmount), `${state.expenses.length} lançamento(s)`),
    metricCard("Despesas totais", formatCurrency(metrics.totalExpenses), `${formatCurrency(metrics.paidExpenses)} pagos`),
    metricCard("Saldo realizado", formatCurrency(metrics.realizedBalance), "Entradas recebidas − despesas pagas"),
    metricCard("Renda comprometida", `${metrics.committedPercent.toLocaleString("pt-BR")}%`, "Sobre as receitas previstas", true)
  ]);

  const grouped = groupByCategory(combineExpenseRecords(state.instances, state.expenses));
  const chartEntries = Object.entries(grouped)
    .map(([categoryId, value]) => ({ label: categoryInfo(categoryId).name, value, color: categoryInfo(categoryId).color }))
    .sort((a, b) => b.value - a.value);
  drawDonut(dom.dashboardChart, chartEntries);
  dom.dashboardChartSummary.textContent = chartEntries.length
    ? `${chartEntries[0].label} é a maior categoria, com ${formatCurrency(chartEntries[0].value)}. Total: ${formatCurrency(metrics.totalExpenses)}.`
    : "Ainda não há despesas neste mês.";

  const transactions = [
    ...state.incomes.map((record) => ({ ...record, transactionType: "income" })),
    ...state.instances.map((record) => ({ ...record, transactionType: "expense" })),
    ...state.expenses.map((record) => ({ ...record, transactionType: "expense" }))
  ].sort((left, right) => String(right.date || `${right.month}-32`).localeCompare(String(left.date || `${left.month}-32`))).slice(0, 6);
  if (!transactions.length) {
    replaceChildren(dom.recentTransactions, createElement("div", { className: "empty-state" }, [
      createElement("strong", { text: "Nenhum lançamento ainda" }),
      createElement("span", { text: "Cadastre uma receita ou despesa para começar." })
    ]));
  } else {
    replaceChildren(dom.recentTransactions, transactions.map((record) => {
      const category = categoryInfo(record.categoryId);
      return createElement("div", { className: "transaction-item" }, [
        createElement("span", { className: "category-icon", text: record.transactionType === "income" ? "↗" : category.icon, style: { borderLeft: `4px solid ${category.color}` } }),
        createElement("div", {}, [
          createElement("strong", { className: "transaction-title", text: record.description || "Salário líquido" }),
          createElement("span", { className: "transaction-meta", text: `${record.date ? formatDate(record.date) : "Sem vencimento"} · ${record.transactionType === "income" ? "Receita" : category.name}${isAllProfiles() ? ` · ${profileName(record.profileId)}` : ""}` })
        ]),
        createElement("strong", { className: `transaction-value ${record.transactionType}`, text: `${record.transactionType === "income" ? "+" : "−"} ${formatCurrency(record.amountCents)}` })
      ]);
    }));
  }
  renderDashboardNotices();
}

function renderIncomes() {
  replaceChildren(dom.incomeMetrics, [
    miniMetric("Previsto", formatCurrency(state.metrics.totalIncome)),
    miniMetric("Recebido", formatCurrency(state.metrics.receivedIncome)),
    miniMetric("Pendente", formatCurrency(state.metrics.totalIncome - state.metrics.receivedIncome))
  ]);
  if (isAllProfiles()) {
    replaceChildren(dom.salaryCard, createElement("div", { className: "salary-display" }, [
      createElement("div", {}, [
        createElement("strong", { text: formatCurrency(state.metrics.salaryAmount) }),
        createElement("span", { text: `Total de ${state.salaries.length} salário(s) no mês. Escolha um perfil para editar.` })
      ])
    ]));
  } else if (state.salary) {
    replaceChildren(dom.salaryCard, createElement("div", { className: "salary-display" }, [
      createElement("div", {}, [
        createElement("strong", { text: formatCurrency(state.salary.amountCents) }),
        createElement("span", { text: `${state.salary.status === "received" ? "Recebido" : "Pendente"} · atualizado em ${new Date(state.salary.updatedAt).toLocaleDateString("pt-BR")}` })
      ]),
      createElement("button", { className: "button secondary", type: "button", dataset: { action: "salary-form" }, text: "Editar" })
    ]));
  } else {
    replaceChildren(dom.salaryCard, createElement("div", { className: "salary-display" }, [
      createElement("div", {}, [createElement("strong", { text: "Não definido" }), createElement("span", { text: "Cadastre o salário líquido deste mês." })]),
      createElement("button", { className: "button primary", type: "button", dataset: { action: "salary-form" }, text: "Definir salário" })
    ]));
  }
  if (!state.incomes.length) {
    dom.incomeTableBody.replaceChildren();
    showEmpty(dom.incomeEmpty, "Sem outras receitas", "Cadastre rendas extras, reembolsos ou qualquer outra entrada.");
    return;
  }
  hideEmpty(dom.incomeEmpty);
  replaceChildren(dom.incomeTableBody, state.incomes.map((record) => {
    const category = categoryInfo(record.categoryId);
    const actions = createElement("div", { className: "row-actions" }, [
      actionButton("toggle-income", record.id, record.status === "received" ? "Marcar como pendente" : "Marcar como recebida", record.status === "received" ? "↶" : "✓"),
      actionButton("edit-income", record.id, "Editar receita", "✎"),
      actionButton("delete-income", record.id, "Excluir receita", "×", "delete")
    ]);
    return createElement("tr", {}, [
      tableCell(formatDate(record.date)), tableCell(record.description), tableCell(`${category.icon} ${category.name}${isAllProfiles() ? ` · ${profileName(record.profileId)}` : ""}`),
      tableCell(statusPill(record.status)), tableCell(formatCurrency(record.amountCents), "numeric"), tableCell(actions)
    ]);
  }));
}

function renderRecurring() {
  replaceChildren(dom.recurringMetrics, [
    miniMetric("Previsto no mês", formatCurrency(state.metrics.fixedAmount)),
    miniMetric("Pago", formatCurrency(sumCents(state.instances.filter((item) => item.status === "paid")))),
    miniMetric("Pendente", formatCurrency(sumCents(state.instances.filter((item) => item.status === "pending"))))
  ]);
  if (!state.instances.length) {
    dom.instanceTableBody.replaceChildren();
    showEmpty(dom.instanceEmpty, "Nenhum gasto fixo neste mês", "Crie uma recorrência ativa para gerar ocorrências mensais.");
  } else {
    hideEmpty(dom.instanceEmpty);
    replaceChildren(dom.instanceTableBody, state.instances.map((record) => {
      const category = categoryInfo(record.categoryId);
      const actions = createElement("div", { className: "row-actions" }, [
        actionButton("toggle-instance", record.id, record.status === "paid" ? "Marcar como pendente" : "Marcar como pago", record.status === "paid" ? "↶" : "✓"),
        actionButton("edit-instance", record.id, "Editar somente este mês", "✎"),
        actionButton("delete-instance", record.id, "Excluir somente esta ocorrência", "×", "delete")
      ]);
      return createElement("tr", {}, [
        tableCell(record.date ? formatDate(record.date) : "Sem vencimento"), tableCell(record.description), tableCell(`${category.icon} ${category.name}${isAllProfiles() ? ` · ${profileName(record.profileId)}` : ""}`),
        tableCell(statusPill(record.status)), tableCell(formatCurrency(record.amountCents), "numeric"), tableCell(actions)
      ]);
    }));
  }
  const recurring = [...state.recurring].sort((left, right) => Number(right.active) - Number(left.active) || left.description.localeCompare(right.description));
  if (!recurring.length) {
    dom.recurringTableBody.replaceChildren();
    showEmpty(dom.recurringEmpty, "Nenhuma recorrência cadastrada", "Use gastos fixos para aluguel, contas e assinaturas.");
  } else {
    hideEmpty(dom.recurringEmpty);
    replaceChildren(dom.recurringTableBody, recurring.map((record) => {
      const category = categoryInfo(record.categoryId);
      const actions = createElement("div", { className: "row-actions" }, [
        actionButton("edit-recurring", record.id, "Editar recorrência", "✎"),
        actionButton("toggle-recurring", record.id, record.active ? "Desativar recorrência" : "Ativar recorrência", record.active ? "◉" : "○"),
        actionButton("delete-recurring", record.id, "Excluir recorrência", "×", "delete")
      ]);
      return createElement("tr", {}, [
        tableCell(record.description), tableCell(record.dueDay ? `Dia ${record.dueDay}` : "Sem vencimento"), tableCell(`${category.icon} ${category.name}${isAllProfiles() ? ` · ${profileName(record.profileId)}` : ""}`),
        tableCell(statusPill(record.active ? "active" : "inactive")), tableCell(formatCurrency(record.amountCents), "numeric"), tableCell(actions)
      ]);
    }));
  }
}

function filteredExpenses() {
  const form = new FormData(dom.expenseFilters);
  const search = normalizeText(form.get("search"));
  const categoryId = form.get("categoryId");
  const paymentMethodId = form.get("paymentMethodId");
  const status = form.get("status");
  const startDate = form.get("startDate");
  const endDate = form.get("endDate");
  const hasCustomPeriod = Boolean(startDate || endDate);
  const source = hasCustomPeriod ? state.allExpenses : state.expenses;
  const filtered = source.filter((record) =>
    (!search || normalizeText(record.description).includes(search)) &&
    (!categoryId || record.categoryId === categoryId) &&
    (!paymentMethodId || record.paymentMethodId === paymentMethodId) &&
    (!status || record.status === status) &&
    (!startDate || record.date >= startDate) &&
    (!endDate || record.date <= endDate)
  );
  const sort = form.get("sort");
  return filtered.sort((left, right) => {
    if (sort === "date-asc") return left.date.localeCompare(right.date);
    if (sort === "value-desc") return right.amountCents - left.amountCents;
    if (sort === "value-asc") return left.amountCents - right.amountCents;
    return right.date.localeCompare(left.date);
  });
}

function fillFilterSelect(select, placeholder, options, currentValue = "") {
  const nodes = [createElement("option", { value: "", text: placeholder })];
  options.forEach((option) => nodes.push(createElement("option", { value: option.value, text: option.label })));
  replaceChildren(select, nodes);
  select.value = currentValue;
}

function renderExpenseFilters() {
  const categoryValue = dom.expenseCategoryFilter.value;
  const paymentValue = dom.expensePaymentFilter.value;
  fillFilterSelect(dom.expenseCategoryFilter, "Todas", currentCategoryOptions(), categoryValue);
  fillFilterSelect(dom.expensePaymentFilter, "Todos", currentPaymentOptions(), paymentValue);
}

function renderExpenses() {
  renderExpenseFilters();
  const records = filteredExpenses();
  replaceChildren(dom.expenseMetrics, [
    miniMetric("Resultados", String(records.length)),
    miniMetric("Total filtrado", formatCurrency(sumCents(records))),
    miniMetric("Pendentes", formatCurrency(sumCents(records.filter((item) => item.status === "pending"))))
  ]);
  if (!records.length) {
    dom.expenseTableBody.replaceChildren();
    showEmpty(dom.expenseEmpty, "Nenhum gasto encontrado", "Ajuste os filtros ou registre um novo gasto.");
    return;
  }
  hideEmpty(dom.expenseEmpty);
  replaceChildren(dom.expenseTableBody, records.map((record) => {
    const category = categoryInfo(record.categoryId);
    const payment = paymentById(record.paymentMethodId)?.name || "—";
    const actions = createElement("div", { className: "row-actions" }, [
      actionButton("toggle-expense", record.id, record.status === "paid" ? "Marcar como pendente" : "Marcar como pago", record.status === "paid" ? "↶" : "✓"),
      actionButton("duplicate-expense", record.id, "Duplicar gasto", "⧉"),
      actionButton("edit-expense", record.id, "Editar gasto", "✎"),
      actionButton("delete-expense", record.id, "Excluir gasto", "×", "delete")
    ]);
    return createElement("tr", {}, [
      tableCell(formatDate(record.date)), tableCell(record.description), tableCell(`${category.icon} ${category.name}`),
      tableCell(payment), tableCell(statusPill(record.status)), tableCell(formatCurrency(record.amountCents), "numeric"), tableCell(actions)
    ]);
  }));
}

function renderManagement() {
  const categories = [...state.categories].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));
  replaceChildren(dom.categoryList, categories.map((category) => createElement("div", { className: "management-item" }, [
    createElement("span", { className: "color-dot", text: category.icon || "•", style: { "--item-color": category.color || "#737f7c" } }),
    createElement("div", {}, [
      createElement("strong", { text: category.name }),
      createElement("span", { text: `${category.kind === "income" ? "Receitas" : category.kind === "expense" ? "Despesas" : "Receitas e despesas"} · ${category.active ? "Ativa" : "Inativa"}${isAllProfiles() ? ` · ${profileName(category.profileId)}` : ""}` })
    ]),
    createElement("div", { className: "row-actions" }, [
      actionButton("edit-category", category.id, "Editar categoria", "✎"),
      actionButton("toggle-category", category.id, category.active ? "Desativar categoria" : "Ativar categoria", category.active ? "◉" : "○"),
      actionButton("delete-category", category.id, "Excluir categoria", "×", "delete")
    ])
  ])));
  const methods = [...state.paymentMethods].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));
  replaceChildren(dom.paymentList, methods.map((method) => createElement("div", { className: "management-item" }, [
    createElement("span", { className: "color-dot", text: "¤", style: { "--item-color": method.active ? "#0f766e" : "#737f7c" } }),
    createElement("div", {}, [createElement("strong", { text: method.name }), createElement("span", { text: `${method.active ? "Ativa" : "Inativa"}${isAllProfiles() ? ` · ${profileName(method.profileId)}` : ""}` })]),
    createElement("div", { className: "row-actions" }, [
      actionButton("edit-payment", method.id, "Editar forma de pagamento", "✎"),
      actionButton("toggle-payment", method.id, method.active ? "Desativar forma de pagamento" : "Ativar forma de pagamento", method.active ? "◉" : "○")
    ])
  ])));
}

function renderProfiles() {
  replaceChildren(dom.profileList, state.profiles.map((profile) => createElement("div", { className: `management-item profile-item${profile.id === state.activeProfileId ? " selected" : ""}` }, [
    createElement("span", { className: "profile-avatar", text: profile.icon || "👤", style: { "--item-color": profile.color || "#0f766e" } }),
    createElement("div", {}, [
      createElement("strong", { text: profile.name }),
      createElement("span", { text: profile.id === state.activeProfileId ? "Perfil atual" : "Dados financeiros separados" })
    ]),
    createElement("div", { className: "row-actions" }, [
      actionButton("switch-profile", profile.id, "Usar este perfil", "✓"),
      actionButton("edit-profile", profile.id, "Editar perfil", "✎"),
      actionButton("delete-profile", profile.id, "Excluir perfil e seus dados", "×", "delete")
    ])
  ])));
}

function renderReportFilterOptions() {
  const selectedProfile = dom.reportProfile.value || state.activeProfileId;
  replaceChildren(dom.reportProfile, [
    createElement("option", { value: ALL_PROFILES, text: "Todos os perfis" }),
    ...state.profiles.map((profile) => createElement("option", { value: profile.id, text: `${profile.icon || "👤"} ${profile.name}` }))
  ]);
  dom.reportProfile.value = [...dom.reportProfile.options].some((option) => option.value === selectedProfile)
    ? selectedProfile
    : state.activeProfileId;
  const profileId = dom.reportProfile.value;
  const categories = profileId === ALL_PROFILES
    ? state.allCategories
    : state.allCategories.filter((record) => record.profileId === profileId);
  const methods = profileId === ALL_PROFILES
    ? state.allPaymentMethods
    : state.allPaymentMethods.filter((record) => record.profileId === profileId);
  const categoryValue = dom.reportCategory.value;
  const paymentValue = dom.reportPayment.value;
  fillFilterSelect(dom.reportCategory, "Todas", categories
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((record) => ({ value: record.id, label: `${record.icon || "•"} ${record.name}${record.active ? "" : " (inativa)"}${profileId === ALL_PROFILES ? ` · ${profileName(record.profileId)}` : ""}` })), categoryValue);
  fillFilterSelect(dom.reportPayment, "Todos", methods
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((record) => ({ value: record.id, label: `${record.name}${record.active ? "" : " (inativa)"}${profileId === ALL_PROFILES ? ` · ${profileName(record.profileId)}` : ""}` })), paymentValue);
}

function reportPeriodBounds(period) {
  if (period === "all") return {};
  if (period === "custom") return {
    startDate: dom.reportStart.value || "",
    endDate: dom.reportEnd.value || ""
  };
  const length = period === "month" ? 1 : Number(period);
  return {
    startDate: `${shiftMonth(state.month, -(length - 1))}-01`,
    endDate: `${state.month}-31`
  };
}

function reportFilterValues() {
  const form = new FormData(dom.reportFilters);
  return {
    profileId: String(form.get("profileId") || state.activeProfileId),
    categoryId: String(form.get("categoryId") || ""),
    paymentMethodId: String(form.get("paymentMethodId") || ""),
    expenseType: String(form.get("expenseType") || ""),
    status: String(form.get("status") || ""),
    search: String(form.get("search") || ""),
    ...reportPeriodBounds(String(form.get("period") || "month"))
  };
}

function monthsBetween(startDate, endDate, availableMonths = []) {
  const normalizedAvailable = [...new Set(availableMonths)].filter(Boolean).sort();
  if (!startDate && !endDate) return normalizedAvailable;
  if (!startDate || !endDate) {
    const startMonth = startDate ? monthFromDate(startDate) : "";
    const endMonth = endDate ? monthFromDate(endDate) : "";
    return normalizedAvailable.filter((month) => (!startMonth || month >= startMonth) && (!endMonth || month <= endMonth));
  }
  const start = monthFromDate(startDate || endDate);
  const end = monthFromDate(endDate || startDate);
  const result = [];
  let cursor = start;
  while (cursor && cursor <= end && result.length < 240) {
    result.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return result;
}

async function reportData() {
  const period = dom.reportPeriod.value;
  const bounds = reportPeriodBounds(period);
  if (["month", "3", "6", "12"].includes(period)) {
    const months = monthsBetween(bounds.startDate, bounds.endDate);
    await Promise.all(months.map((month) => ensureOccurrencesForMonth(
      month,
      dom.reportProfile.value === ALL_PROFILES ? "" : dom.reportProfile.value
    )));
  }
  const [fixed, oneTime, salaries, incomes] = await Promise.all([
    getAll("monthlyExpenseInstances"), getAll("oneTimeExpenses"), getAll("monthlyIncomes"), getAll("additionalIncomes")
  ]);
  return { fixed, oneTime, salaries, incomes };
}

async function getFilteredReportRecords() {
  renderReportFilterOptions();
  const filters = reportFilterValues();
  const data = await reportData();
  const records = filterExpenseRecords(combineExpenseRecords(data.fixed, data.oneTime), filters)
    .sort((left, right) => String(right.date || `${right.month}-32`).localeCompare(String(left.date || `${left.month}-32`)));
  return { filters, data, records };
}

async function renderReports() {
  const { filters, data, records: combined } = await getFilteredReportRecords();
  const summary = summarizeExpenses(combined);
  replaceChildren(dom.reportMetrics, [
    miniMetric("Gastos encontrados", String(summary.count)),
    miniMetric("Total", formatCurrency(summary.total)),
    miniMetric("Pago", formatCurrency(summary.paid)),
    miniMetric("Pendente", formatCurrency(summary.pending)),
    miniMetric("Média por gasto", formatCurrency(summary.average))
  ]);
  const grouped = groupByCategory(combined);
  const categoryEntries = Object.entries(grouped)
    .map(([categoryId, value]) => {
      const category = categoryInfo(categoryId);
      return {
        label: `${category.name}${filters.profileId === ALL_PROFILES ? ` · ${profileName(category.profileId)}` : ""}`,
        value,
        color: category.color
      };
    })
    .sort((a, b) => b.value - a.value);
  drawDonut(dom.categoryReportChart, categoryEntries);
  dom.categoryReportSummary.textContent = categoryEntries.length
    ? `${categoryEntries.length} categoria(s). Maior: ${categoryEntries[0].label}, ${formatCurrency(categoryEntries[0].value)}.`
    : "Sem despesas no período selecionado.";

  const typeEntries = [
    { label: "Fixas", value: sumCents(combined.filter((record) => record.expenseType === "fixed")), color: "#0f766e" },
    { label: "Avulsas", value: sumCents(combined.filter((record) => record.expenseType === "oneTime")), color: "#dc7d30" }
  ];
  drawBars(dom.expenseTypeChart, typeEntries);
  dom.expenseTypeSummary.textContent = `Fixas: ${formatCurrency(typeEntries[0].value)}. Avulsas: ${formatCurrency(typeEntries[1].value)}.`;

  const incomeInPeriod = (record) => {
    const date = record.date || `${record.month}-01`;
    return (filters.profileId === ALL_PROFILES || record.profileId === filters.profileId) &&
      (!filters.startDate || date >= filters.startDate) &&
      (!filters.endDate || date <= filters.endDate);
  };
  const totalIncome = sumCents(data.salaries.filter(incomeInPeriod)) + sumCents(data.incomes.filter(incomeInPeriod));
  const comparisonEntries = [
    { label: "Receitas", value: totalIncome, color: "#177245" },
    { label: "Despesas filtradas", value: summary.total, color: "#b42318" }
  ];
  drawBars(dom.incomeExpenseChart, comparisonEntries);
  dom.incomeExpenseSummary.textContent = `Receitas do período: ${formatCurrency(totalIncome)}. Despesas filtradas: ${formatCurrency(summary.total)}.`;

  const availableMonths = [
    ...combined.map((record) => record.month || monthFromDate(record.date)),
    ...data.salaries.filter(incomeInPeriod).map((record) => record.month),
    ...data.incomes.filter(incomeInPeriod).map((record) => record.month || monthFromDate(record.date))
  ].filter(Boolean);
  let months = monthsBetween(filters.startDate, filters.endDate, availableMonths);
  if (!months.length && dom.reportPeriod.value === "month") months = [state.month];
  const history = months.map((month) => {
    const income = sumCents(data.salaries.filter((record) => incomeInPeriod(record) && record.month === month)) +
      sumCents(data.incomes.filter((record) => incomeInPeriod(record) && (record.month || monthFromDate(record.date)) === month));
    const expenses = sumCents(combined.filter((record) => (record.month || monthFromDate(record.date)) === month));
    return { month, income, expenses, balance: income - expenses };
  });
  const historyEntries = history.map(({ month, balance }) => ({
    label: monthLabel(month, { month: "short" }).replace(".", ""),
    value: balance
  }));
  drawLine(dom.balanceHistoryChart, historyEntries);
  dom.balanceHistorySummary.textContent = history.length
    ? `${history.map(({ month, balance }) => `${monthLabel(month, { month: "short", year: "2-digit" })}: ${formatCurrency(balance)}`).join(" · ")}. O saldo considera apenas as despesas filtradas.`
    : "Sem meses com movimentações no período.";

  const statusEntries = [
    { label: "Pagas", value: summary.paid, color: "#177245" },
    { label: "Pendentes", value: summary.pending, color: "#d97706" }
  ];
  drawDonut(dom.paymentStatusChart, statusEntries);
  dom.paymentStatusSummary.textContent = `Pagas: ${formatCurrency(summary.paid)}. Pendentes: ${formatCurrency(summary.pending)}.`;

  const expenseHistory = history.map(({ month, expenses }) => ({
    label: monthLabel(month, { month: "short" }).replace(".", ""),
    value: expenses
  }));
  drawLine(dom.expenseHistoryChart, expenseHistory);
  dom.expenseHistorySummary.textContent = history.length
    ? history.map(({ month, expenses }) => `${monthLabel(month, { month: "short", year: "2-digit" })}: ${formatCurrency(expenses)}`).join(" · ")
    : "Sem despesas no período.";

  const largest = sortLargest(combined, 8);
  replaceChildren(dom.largestExpenses, largest.length ? largest.map((record) => createElement("li", {}, [
    createElement("span", { text: `${record.description} · ${categoryInfo(record.categoryId).name}` }),
    createElement("strong", { text: formatCurrency(record.amountCents) })
  ])) : [createElement("li", {}, [createElement("span", { text: "Sem despesas para classificar." }), createElement("strong", { text: "—" })])]);

  if (!combined.length) {
    dom.reportExpenseBody.replaceChildren();
    showEmpty(dom.reportExpenseEmpty, "Nenhum gasto encontrado", "Ajuste os filtros para consultar outro período.");
  } else {
    hideEmpty(dom.reportExpenseEmpty);
    replaceChildren(dom.reportExpenseBody, combined.map((record) => {
      const category = categoryInfo(record.categoryId);
      return createElement("tr", {}, [
        tableCell(profileName(record.profileId)),
        tableCell(record.date ? formatDate(record.date) : "Sem vencimento"),
        tableCell(record.description),
        tableCell(`${category.icon} ${category.name}`),
        tableCell(paymentById(record.paymentMethodId)?.name || "—"),
        tableCell(record.expenseType === "fixed" ? "Fixo" : "Avulso"),
        tableCell(statusPill(record.status)),
        tableCell(formatCurrency(record.amountCents), "numeric")
      ]);
    }));
  }
}

function renderThemeControls() {
  const theme = localStorage.getItem("finance-theme") || "system";
  $$("[data-theme-value]").forEach((button) => button.classList.toggle("active", button.dataset.themeValue === theme));
}

function readReportPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORT_PRESETS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderReportPresets(selectedId = dom.reportPreset?.value || "") {
  const presets = readReportPresets();
  replaceChildren(dom.reportPreset, [
    createElement("option", { value: "", text: "Nenhum" }),
    ...presets.map((preset) => createElement("option", { value: preset.id, text: preset.name }))
  ]);
  dom.reportPreset.value = presets.some((preset) => preset.id === selectedId) ? selectedId : "";
  dom.deleteReportPreset.disabled = !dom.reportPreset.value;
}

function reportFormSnapshot() {
  return Object.fromEntries([...new FormData(dom.reportFilters).entries()].map(([key, value]) => [key, String(value)]));
}

async function saveReportPreset() {
  const name = window.prompt("Nome para este filtro:");
  if (!name?.trim()) return;
  const presets = readReportPresets();
  const preset = { id: uid(), name: name.trim().slice(0, 50), filters: reportFormSnapshot() };
  presets.push(preset);
  localStorage.setItem(REPORT_PRESETS_KEY, JSON.stringify(presets));
  renderReportPresets(preset.id);
  toast("Filtro salvo neste navegador.");
}

async function applyReportPreset(id) {
  const preset = readReportPresets().find((item) => item.id === id);
  if (!preset) return;
  Object.entries(preset.filters || {}).forEach(([name, value]) => {
    const control = dom.reportFilters.elements.namedItem(name);
    if (control) control.value = value;
  });
  renderReportFilterOptions();
  $$(".report-custom-date").forEach((field) => { field.hidden = dom.reportPeriod.value !== "custom"; });
  await renderReports();
}

function deleteReportPreset() {
  const id = dom.reportPreset.value;
  if (!id) return;
  const presets = readReportPresets().filter((preset) => preset.id !== id);
  localStorage.setItem(REPORT_PRESETS_KEY, JSON.stringify(presets));
  renderReportPresets();
  toast("Filtro salvo excluído.");
}

async function renderAll() {
  renderMonthLabels();
  renderProfileControls();
  renderDashboard();
  renderIncomes();
  renderRecurring();
  renderExpenses();
  renderManagement();
  renderProfiles();
  renderThemeControls();
  renderReportPresets();
  if (state.view === "reports") await renderReports();
}

function showView(view) {
  state.view = view;
  $$(".view").forEach((section) => {
    const active = section.id === `view-${view}`;
    section.hidden = !active;
    section.classList.toggle("active", active);
  });
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const activeSection = $(`#view-${view}`);
  document.title = `${activeSection?.dataset.title || "Meu Controle"} · Meu Controle Financeiro`;
  closeMenu();
  if (view === "reports") renderReports();
  requestAnimationFrame(() => $("#conteudo").focus({ preventScroll: true }));
}

function closeMenu() {
  dom.sidebar.classList.remove("open");
  dom.scrim.hidden = true;
  dom.menuButton.setAttribute("aria-expanded", "false");
}

function openMenu() {
  dom.sidebar.classList.add("open");
  dom.scrim.hidden = false;
  dom.menuButton.setAttribute("aria-expanded", "true");
}

function setTheme(value) {
  localStorage.setItem("finance-theme", value);
  const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = value === "system" ? (systemDark ? "dark" : "light") : value;
  renderThemeControls();
  if (state.metrics) requestAnimationFrame(() => renderAll());
}

const EDITOR_SCHEMAS = {
  salary(record = {}) {
    return {
      kind: "salary", record, kicker: "Receita principal", title: record.id ? "Editar salário líquido" : "Definir salário líquido",
      fields: [
        { name: "amount", label: "Valor líquido", type: "money", value: record.amountCents, required: true, span: 2 },
        { name: "status", label: "Status", type: "select", value: record.status || "pending", options: [{ value: "pending", label: "Pendente" }, { value: "received", label: "Recebido" }], required: true },
        { name: "notes", label: "Observação", type: "textarea", value: record.notes || "", span: 2 }
      ]
    };
  },
  income(record = {}) {
    return {
      kind: "income", record, kicker: "Entrada", title: record.id ? "Editar receita" : "Nova receita",
      fields: [
        { name: "description", label: "Descrição", type: "text", value: record.description || "", required: true, span: 2, maxlength: 80 },
        { name: "amount", label: "Valor", type: "money", value: record.amountCents, required: true },
        { name: "date", label: "Data", type: "date", value: record.date || `${state.month}-01`, required: true },
        { name: "categoryId", label: "Categoria", type: "select", value: record.categoryId || "", options: currentCategoryOptions({ includeInactiveId: record.categoryId, kind: "income" }), required: true },
        { name: "status", label: "Status", type: "select", value: record.status || "pending", options: [{ value: "pending", label: "Pendente" }, { value: "received", label: "Recebida" }], required: true },
        { name: "notes", label: "Observação", type: "textarea", value: record.notes || "", span: 2, maxlength: 300 }
      ]
    };
  },
  expense(record = {}) {
    return {
      kind: "expense", record, kicker: "Despesa do dia a dia", title: record.id ? "Editar gasto avulso" : "Novo gasto avulso",
      fields: [
        { name: "description", label: "Descrição", type: "text", value: record.description || "", required: true, span: 2, maxlength: 80 },
        { name: "amount", label: "Valor", type: "money", value: record.amountCents, required: true },
        { name: "date", label: "Data", type: "date", value: record.date || currentLocalDate(), required: true },
        { name: "categoryId", label: "Categoria", type: "select", value: record.categoryId || "", options: currentCategoryOptions({ includeInactiveId: record.categoryId, kind: "expense" }), required: true },
        { name: "paymentMethodId", label: "Forma de pagamento", type: "select", value: record.paymentMethodId || "", options: currentPaymentOptions(record.paymentMethodId), required: true },
        { name: "status", label: "Status", type: "select", value: record.status || "paid", options: [{ value: "paid", label: "Pago" }, { value: "pending", label: "Pendente" }], required: true },
        { name: "notes", label: "Observação", type: "textarea", value: record.notes || "", span: 2, maxlength: 300 }
      ]
    };
  },
  recurring(record = {}) {
    return {
      kind: "recurring", record, kicker: "Recorrência", title: record.id ? "Editar gasto fixo" : "Novo gasto fixo",
      fields: [
        { name: "description", label: "Descrição", type: "text", value: record.description || "", required: true, span: 2, maxlength: 80 },
        { name: "amount", label: "Valor", type: "money", value: record.amountCents, required: true },
        { name: "dueDay", label: "Dia do vencimento (opcional)", type: "number", value: record.dueDay ?? "", min: 1, max: 31 },
        { name: "categoryId", label: "Categoria", type: "select", value: record.categoryId || "", options: currentCategoryOptions({ includeInactiveId: record.categoryId, kind: "expense" }), required: true },
        { name: "paymentMethodId", label: "Forma de pagamento", type: "select", value: record.paymentMethodId || "", options: currentPaymentOptions(record.paymentMethodId), required: true },
        { name: "startDate", label: "Data inicial", type: "date", value: record.startDate || `${state.month}-01`, required: true },
        { name: "endDate", label: "Data final (opcional)", type: "date", value: record.endDate || "" },
        { name: "active", label: "Recorrência ativa", type: "checkbox", value: record.id ? record.active : true, span: 2 },
        ...(record.id ? [{ name: "applyCurrent", label: "Aplicar valores também à ocorrência do mês selecionado", type: "checkbox", value: false, span: 2 }] : []),
        { name: "notes", label: "Observação", type: "textarea", value: record.notes || "", span: 2, maxlength: 300 }
      ]
    };
  },
  instance(record = {}) {
    return {
      kind: "instance", record, kicker: "Somente este mês", title: "Editar ocorrência mensal",
      fields: [
        { name: "description", label: "Descrição", type: "text", value: record.description || "", required: true, span: 2, maxlength: 80 },
        { name: "amount", label: "Valor", type: "money", value: record.amountCents, required: true },
        { name: "date", label: "Vencimento (opcional)", type: "date", value: record.date || "" },
        { name: "categoryId", label: "Categoria", type: "select", value: record.categoryId, options: currentCategoryOptions({ includeInactiveId: record.categoryId, kind: "expense" }), required: true },
        { name: "paymentMethodId", label: "Forma de pagamento", type: "select", value: record.paymentMethodId, options: currentPaymentOptions(record.paymentMethodId), required: true },
        { name: "status", label: "Status", type: "select", value: record.status, options: [{ value: "paid", label: "Pago" }, { value: "pending", label: "Pendente" }], required: true },
        { name: "paidDate", label: "Data do pagamento", type: "date", value: record.paidDate || "" },
        { name: "notes", label: "Observação", type: "textarea", value: record.notes || "", span: 2, maxlength: 300 }
      ]
    };
  },
  category(record = {}) {
    return {
      kind: "category", record, kicker: "Organização", title: record.id ? "Editar categoria" : "Nova categoria",
      fields: [
        { name: "name", label: "Nome", type: "text", value: record.name || "", required: true, span: 2, maxlength: 40 },
        { name: "icon", label: "Ícone", type: "select", value: record.icon || "●", options: ["🍴", "⌂", "⌁", "✚", "★", "◆", "↻", "▣", "!", "§", "▤", "●", "…"].map((icon) => ({ value: icon, label: icon })), required: true },
        { name: "color", label: "Cor", type: "color", value: record.color || "#0f766e", required: true },
        { name: "kind", label: "Disponível em", type: "select", value: record.kind || "both", options: [{ value: "both", label: "Receitas e despesas" }, { value: "income", label: "Somente receitas" }, { value: "expense", label: "Somente despesas" }], required: true },
        { name: "active", label: "Categoria ativa", type: "checkbox", value: record.id ? record.active : true }
      ]
    };
  },
  payment(record = {}) {
    return {
      kind: "payment", record, kicker: "Pagamento", title: record.id ? "Editar forma de pagamento" : "Nova forma de pagamento",
      fields: [
        { name: "name", label: "Nome", type: "text", value: record.name || "", required: true, span: 2, maxlength: 50 },
        { name: "active", label: "Forma de pagamento ativa", type: "checkbox", value: record.id ? record.active : true, span: 2 }
      ]
    };
  },
  profile(record = {}) {
    return {
      kind: "profile", record, kicker: "Finanças separadas", title: record.id ? "Editar perfil" : "Novo perfil financeiro",
      fields: [
        { name: "name", label: "Nome do perfil", type: "text", value: record.name || "", required: true, span: 2, maxlength: 40 },
        { name: "icon", label: "Ícone", type: "select", value: record.icon || "👤", options: ["👤", "👩", "👨", "👪", "🏠", "💼", "🎯", "🐾"].map((icon) => ({ value: icon, label: icon })), required: true },
        { name: "color", label: "Cor", type: "color", value: record.color || "#0f766e", required: true },
        ...(!record.id ? [{
          name: "copyFromProfileId", label: "Copiar categorias e pagamentos de", type: "select",
          value: activeProfile()?.id || "", options: [
            { value: "", label: "Usar cadastros padrão" },
            ...state.profiles.map((profile) => ({ value: profile.id, label: `${profile.icon || "👤"} ${profile.name}` }))
          ], span: 2
        }] : [])
      ]
    };
  }
};

function fieldControl(field) {
  let control;
  if (field.type === "select") {
    control = createElement("select", { id: `editor-${field.name}`, name: field.name });
    replaceChildren(control, [
      ...(field.required && !field.value ? [createElement("option", { value: "", text: "Selecione", disabled: "" })] : []),
      ...(field.options || []).map((option) => createElement("option", { value: option.value, text: option.label }))
    ]);
    control.value = String(field.value ?? "");
  } else if (field.type === "textarea") {
    control = createElement("textarea", { id: `editor-${field.name}`, name: field.name, maxlength: field.maxlength, rows: 3 });
    control.value = field.value || "";
  } else if (field.type === "checkbox") {
    control = createElement("input", { id: `editor-${field.name}`, name: field.name, type: "checkbox" });
    control.checked = Boolean(field.value);
  } else {
    const type = field.type === "money" ? "text" : field.type;
    control = createElement("input", {
      id: `editor-${field.name}`, name: field.name, type, min: field.min, max: field.max,
      maxlength: field.maxlength, inputmode: field.type === "money" ? "decimal" : undefined,
      placeholder: field.type === "money" ? "0,00" : undefined
    });
    control.value = field.type === "money" && Number.isSafeInteger(field.value) ? formatMoneyInput(field.value) : field.value ?? "";
    if (field.type === "money") control.dataset.money = "true";
  }
  if (field.required) control.required = true;
  return control;
}

function openEditor(schema) {
  state.editor = schema;
  dom.editorKicker.textContent = schema.kicker;
  dom.editorTitle.textContent = schema.title;
  dom.editorError.hidden = true;
  replaceChildren(dom.editorFields, schema.fields.map((field) => {
    const control = fieldControl(field);
    if (field.type === "checkbox") {
      return createElement("div", { className: `field ${field.span === 2 ? "span-2" : ""}` }, [
        createElement("label", { className: "check-row", for: control.id }, [control, document.createTextNode(field.label)])
      ]);
    }
    return createElement("div", { className: `field ${field.span === 2 ? "span-2" : ""}` }, [
      createElement("label", { for: control.id, text: `${field.label}${field.required ? " *" : ""}` }),
      control
    ]);
  }));
  dom.editorDialog.showModal();
  requestAnimationFrame(() => $("input:not([type=checkbox]), select, textarea", dom.editorFields)?.focus());
}

function editorValues() {
  const form = new FormData(dom.editorForm);
  const values = {};
  state.editor.fields.forEach((field) => {
    if (field.type === "checkbox") values[field.name] = form.has(field.name);
    else if (field.type === "money") values[field.name] = parseMoneyToCents(form.get(field.name));
    else if (field.type === "number") values[field.name] = String(form.get(field.name) || "").trim() === "" ? null : Number(form.get(field.name));
    else values[field.name] = String(form.get(field.name) || "").trim();
  });
  return values;
}

function validateEditor(values) {
  const { kind, record } = state.editor;
  if ("amount" in values && values.amount <= 0) throw new Error("Informe um valor maior que zero.");
  if (values.date && !isValidDate(values.date)) throw new Error("Informe uma data válida.");
  if (values.startDate && !isValidDate(values.startDate)) throw new Error("Informe uma data inicial válida.");
  if (values.endDate && !isValidDate(values.endDate)) throw new Error("Informe uma data final válida.");
  if (values.startDate && values.endDate && values.endDate < values.startDate) throw new Error("A data final não pode ser anterior à data inicial.");
  if (kind === "recurring" && values.dueDay !== null && (!Number.isInteger(values.dueDay) || values.dueDay < 1 || values.dueDay > 31)) throw new Error("Quando informado, o vencimento deve ficar entre os dias 1 e 31.");
  if (kind === "instance" && values.status === "paid" && !values.paidDate) values.paidDate = values.date || currentLocalDate();
  if (kind === "instance" && values.status === "pending") values.paidDate = "";
  if ((kind === "category" || kind === "payment") && !values.name) throw new Error("Informe um nome.");
  if (kind === "category") {
    const duplicate = state.categories.find((category) => category.id !== record.id && normalizeText(category.name) === normalizeText(values.name));
    if (duplicate) throw new Error("Já existe uma categoria com esse nome.");
  }
  if (kind === "payment") {
    const duplicate = state.paymentMethods.find((method) => method.id !== record.id && normalizeText(method.name) === normalizeText(values.name));
    if (duplicate) throw new Error("Já existe uma forma de pagamento com esse nome.");
  }
  if (kind === "profile") {
    const duplicate = state.profiles.find((profile) => profile.id !== record.id && normalizeText(profile.name) === normalizeText(values.name));
    if (duplicate) throw new Error("Já existe um perfil com esse nome.");
  }
}

async function saveEditor(values) {
  const { kind, record } = state.editor;
  const base = { ...record, profileId: record.profileId || state.activeProfileId, origin: record.origin || "user" };
  if (kind === "salary") {
    await putRecord("monthlyIncomes", { ...base, id: record.id || `salary-${state.activeProfileId}-${state.month}`, month: state.month, amountCents: values.amount, status: values.status, notes: values.notes });
  } else if (kind === "income") {
    await putRecord("additionalIncomes", { ...base, description: values.description, amountCents: values.amount, date: values.date, month: monthFromDate(values.date), categoryId: values.categoryId, status: values.status, notes: values.notes });
  } else if (kind === "expense") {
    await putRecord("oneTimeExpenses", { ...base, description: values.description, amountCents: values.amount, date: values.date, month: monthFromDate(values.date), categoryId: values.categoryId, paymentMethodId: values.paymentMethodId, status: values.status, notes: values.notes });
  } else if (kind === "recurring") {
    const saved = await putRecord("recurringExpenses", {
      ...base, description: values.description, amountCents: values.amount, dueDay: values.dueDay,
      categoryId: values.categoryId, paymentMethodId: values.paymentMethodId, startDate: values.startDate,
      endDate: values.endDate || null, active: values.active, notes: values.notes
    });
    if (values.applyCurrent && record.id) {
      const instance = state.instances.find((item) => item.recurringId === record.id);
      if (instance) {
        await putRecord("monthlyExpenseInstances", {
          ...instance, description: saved.description, amountCents: saved.amountCents, categoryId: saved.categoryId,
          paymentMethodId: saved.paymentMethodId, dueDay: saved.dueDay,
          date: saved.dueDay ? dateForMonthAndDay(state.month, saved.dueDay) : null, notes: saved.notes
        });
      }
    }
  } else if (kind === "instance") {
    await putRecord("monthlyExpenseInstances", {
      ...base, description: values.description, amountCents: values.amount, date: values.date,
      dueDay: values.date ? Number(values.date.slice(-2)) : null,
      categoryId: values.categoryId, paymentMethodId: values.paymentMethodId, status: values.status,
      paidDate: values.paidDate || null, notes: values.notes
    });
  } else if (kind === "category") {
    await putRecord("categories", { ...base, name: values.name, icon: values.icon, color: values.color, kind: values.kind, active: values.active });
  } else if (kind === "payment") {
    await putRecord("paymentMethods", { ...base, name: values.name, active: values.active });
  } else if (kind === "profile") {
    if (record.id) {
      await putRecord("profiles", { ...record, name: values.name, icon: values.icon, color: values.color });
    } else {
      const profile = await createProfile({
        name: values.name, icon: values.icon, color: values.color,
        copyFromProfileId: values.copyFromProfileId
      });
      state.activeProfileId = profile.id;
      localStorage.setItem(ACTIVE_PROFILE_KEY, profile.id);
    }
  }
}

function confirmAction({ title, message, confirmLabel = "Confirmar", extra = null, validate = null }) {
  dom.confirmTitle.textContent = title;
  dom.confirmMessage.textContent = message;
  dom.confirmSubmit.textContent = confirmLabel;
  replaceChildren(dom.confirmExtra, extra ? [extra] : []);
  dom.confirmDialog.showModal();
  return new Promise((resolve) => {
    state.confirmResolve = { resolve, validate };
  });
}

async function deleteWithConfirmation(store, id, label) {
  const confirmed = await confirmAction({
    title: `Excluir ${label}?`,
    message: "Esta ação não pode ser desfeita e afetará somente este registro.",
    confirmLabel: "Excluir"
  });
  if (!confirmed) return;
  await deleteRecord(store, id);
  toast("Registro excluído.");
  await loadMonth();
}

async function handleAction(action, id) {
  try {
    const profileActions = new Set(["profile-form", "edit-profile", "switch-profile", "delete-profile"]);
    if (isAllProfiles() && !profileActions.has(action)) {
      toast("Escolha um perfil específico para incluir ou alterar dados.", "error");
      return;
    }
    if (action === "profile-form") return openEditor(EDITOR_SCHEMAS.profile());
    if (action === "edit-profile") return openEditor(EDITOR_SCHEMAS.profile(await getRecord("profiles", id)));
    if (action === "switch-profile") {
      state.activeProfileId = id;
      localStorage.setItem(ACTIVE_PROFILE_KEY, id);
      toast(`Perfil “${profileName(id)}” selecionado.`);
      await loadMonth();
      return;
    }
    if (action === "delete-profile") return handleProfileDelete(id);
    if (action === "salary-form") return openEditor(EDITOR_SCHEMAS.salary(state.salary || {}));
    if (action === "income-form") return openEditor(EDITOR_SCHEMAS.income());
    if (action === "expense-form") return openEditor(EDITOR_SCHEMAS.expense({ date: state.month === currentMonth() ? currentLocalDate() : `${state.month}-01` }));
    if (action === "recurring-form") return openEditor(EDITOR_SCHEMAS.recurring());
    if (action === "category-form") return openEditor(EDITOR_SCHEMAS.category());
    if (action === "payment-form") return openEditor(EDITOR_SCHEMAS.payment());
    if (action === "edit-income") return openEditor(EDITOR_SCHEMAS.income(await getRecord("additionalIncomes", id)));
    if (action === "edit-expense") return openEditor(EDITOR_SCHEMAS.expense(await getRecord("oneTimeExpenses", id)));
    if (action === "edit-recurring") return openEditor(EDITOR_SCHEMAS.recurring(await getRecord("recurringExpenses", id)));
    if (action === "edit-instance") return openEditor(EDITOR_SCHEMAS.instance(await getRecord("monthlyExpenseInstances", id)));
    if (action === "edit-category") return openEditor(EDITOR_SCHEMAS.category(await getRecord("categories", id)));
    if (action === "edit-payment") return openEditor(EDITOR_SCHEMAS.payment(await getRecord("paymentMethods", id)));
    if (action === "delete-income") return deleteWithConfirmation("additionalIncomes", id, "esta receita");
    if (action === "delete-expense") return deleteWithConfirmation("oneTimeExpenses", id, "este gasto");
    if (action === "delete-instance") return deleteWithConfirmation("monthlyExpenseInstances", id, "somente esta ocorrência");
    if (action === "delete-recurring") {
      const confirmed = await confirmAction({
        title: "Excluir a recorrência?",
        message: "As ocorrências mensais já geradas permanecerão no histórico. Para apenas interromper os próximos meses, prefira desativar.",
        confirmLabel: "Excluir recorrência"
      });
      if (confirmed) { await deleteRecord("recurringExpenses", id); toast("Recorrência excluída; histórico preservado."); await loadMonth(); }
      return;
    }
    if (action === "duplicate-expense") {
      const record = await getRecord("oneTimeExpenses", id);
      openEditor(EDITOR_SCHEMAS.expense({ ...record, id: "", description: `${record.description} (cópia)`, createdAt: "", updatedAt: "" }));
      return;
    }
    if (action === "toggle-income") {
      const record = await getRecord("additionalIncomes", id);
      await putRecord("additionalIncomes", { ...record, status: record.status === "received" ? "pending" : "received" });
    } else if (action === "toggle-expense") {
      const record = await getRecord("oneTimeExpenses", id);
      await putRecord("oneTimeExpenses", { ...record, status: record.status === "paid" ? "pending" : "paid" });
    } else if (action === "toggle-instance") {
      const record = await getRecord("monthlyExpenseInstances", id);
      const paid = record.status !== "paid";
      await putRecord("monthlyExpenseInstances", { ...record, status: paid ? "paid" : "pending", paidDate: paid ? currentLocalDate() : null });
    } else if (action === "toggle-recurring") {
      const record = await getRecord("recurringExpenses", id);
      await putRecord("recurringExpenses", { ...record, active: !record.active });
    } else if (action === "toggle-category") {
      const record = await getRecord("categories", id);
      await putRecord("categories", { ...record, active: !record.active });
    } else if (action === "toggle-payment") {
      const record = await getRecord("paymentMethods", id);
      await putRecord("paymentMethods", { ...record, active: !record.active });
    } else if (action === "delete-category") {
      await handleCategoryDelete(id);
      return;
    } else return;
    toast("Alteração salva.");
    await loadMonth();
  } catch (error) {
    console.error(error);
    toast(error.message || "Não foi possível concluir a ação.", "error");
  }
}

async function handleProfileDelete(id) {
  if (state.profiles.length <= 1) {
    toast("Crie outro perfil antes de excluir o único perfil existente.", "error");
    return;
  }
  const profile = await getRecord("profiles", id);
  const input = createElement("input", { id: "profile-delete-confirmation", type: "text", autocomplete: "off", placeholder: profile.name });
  const wrapper = createElement("div", { className: "field" }, [
    createElement("label", { for: "profile-delete-confirmation", text: `Digite ${profile.name} para confirmar` }),
    input
  ]);
  const confirmed = await confirmAction({
    title: `Excluir o perfil “${profile.name}”?`,
    message: "Todas as receitas, despesas, recorrências, categorias e formas de pagamento desse perfil serão apagadas. Faça um backup antes, se quiser preservar os dados.",
    confirmLabel: "Excluir perfil e dados",
    extra: wrapper,
    validate: () => input.value.trim() === profile.name
  });
  if (!confirmed) return;
  await deleteProfile(id);
  if (state.activeProfileId === id) {
    const remaining = state.profiles.find((item) => item.id !== id);
    state.activeProfileId = remaining.id;
    localStorage.setItem(ACTIVE_PROFILE_KEY, remaining.id);
  }
  toast("Perfil e dados associados foram excluídos.");
  await loadMonth();
}

async function handleCategoryDelete(id) {
  const category = await getRecord("categories", id);
  const usage = await countCategoryUsage(id);
  let extra = null;
  let select = null;
  if (usage > 0) {
    const wrapper = createElement("div", { className: "field" });
    const label = createElement("label", { for: "replacement-category", text: "Categoria de substituição *" });
    select = createElement("select", { id: "replacement-category" });
    replaceChildren(select, [
      createElement("option", { value: "", text: "Selecione", disabled: "" }),
      ...state.categories.filter((item) => item.id !== id && item.active).map((item) => createElement("option", { value: item.id, text: `${item.icon} ${item.name}` }))
    ]);
    wrapper.append(label, select);
    extra = wrapper;
  }
  const confirmed = await confirmAction({
    title: `Excluir “${category.name}”?`,
    message: usage
      ? `Esta categoria é usada em ${usage} lançamento(s). Escolha outra categoria para preservar os registros.`
      : "A categoria não está associada a lançamentos e pode ser excluída.",
    confirmLabel: "Excluir categoria",
    extra,
    validate: () => !usage || Boolean(select.value)
  });
  if (!confirmed) return;
  if (usage) await replaceCategoryAndDelete(id, select.value);
  else await deleteRecord("categories", id);
  toast("Categoria excluída com segurança.");
  await loadMonth();
}

async function copyPreviousSalary() {
  if (isAllProfiles()) return toast("Escolha um perfil específico para copiar o salário.", "error");
  const previousMonth = shiftMonth(state.month, -1);
  const previous = (await getByProfileMonth("monthlyIncomes", state.activeProfileId, previousMonth))[0];
  if (!previous) return toast(`Não há salário cadastrado em ${monthLabel(previousMonth)}.`, "error");
  if (state.salary) {
    const confirmed = await confirmAction({
      title: "Substituir o salário atual?",
      message: `O valor deste mês será substituído por ${formatCurrency(previous.amountCents)}.`,
      confirmLabel: "Copiar salário"
    });
    if (!confirmed) return;
  }
  await putRecord("monthlyIncomes", {
    id: state.salary?.id || `salary-${state.activeProfileId}-${state.month}`, profileId: state.activeProfileId,
    month: state.month, amountCents: previous.amountCents,
    status: "pending", notes: `Copiado de ${previousMonth}`, origin: "user"
  });
  toast("Salário copiado do mês anterior.");
  await loadMonth();
}

async function loadDemo() {
  if (isAllProfiles()) return toast("Escolha um perfil específico para carregar a demonstração.", "error");
  const confirmed = await confirmAction({
    title: "Carregar dados de demonstração?",
    message: "Os exemplos serão identificados e não substituirão seus registros. Você poderá apagá-los separadamente.",
    confirmLabel: "Carregar demonstração"
  });
  if (!confirmed) return;
  const category = (name) => state.categories.find((item) => item.name === name)?.id || state.categories[0]?.id;
  const payment = (name) => state.paymentMethods.find((item) => item.name === name)?.id || state.paymentMethods[0]?.id;
  const timestamp = nowIso();
  const records = {
    salary: { id: `demo-salary-${state.activeProfileId}-${state.month}`, profileId: state.activeProfileId, month: state.month, amountCents: 400000, status: "received", notes: "Dado de demonstração", origin: "demo", createdAt: timestamp, updatedAt: timestamp, version: 1 },
    recurring: [
      { id: `demo-rec-rent-${state.activeProfileId}`, profileId: state.activeProfileId, description: "Aluguel", amountCents: 100000, categoryId: category("Moradia"), paymentMethodId: payment("Pix"), dueDay: 5, startDate: `${state.month}-01`, endDate: null, active: true, notes: "Dado de demonstração", origin: "demo", createdAt: timestamp, updatedAt: timestamp, version: 1 },
      { id: `demo-rec-internet-${state.activeProfileId}`, profileId: state.activeProfileId, description: "Internet", amountCents: 10000, categoryId: category("Assinaturas"), paymentMethodId: payment("Débito automático"), dueDay: 12, startDate: `${state.month}-01`, endDate: null, active: true, notes: "Dado de demonstração", origin: "demo", createdAt: timestamp, updatedAt: timestamp, version: 1 },
      { id: `demo-rec-energy-${state.activeProfileId}`, profileId: state.activeProfileId, description: "Energia", amountCents: 25000, categoryId: category("Moradia"), paymentMethodId: payment("Boleto"), dueDay: 18, startDate: `${state.month}-01`, endDate: null, active: true, notes: "Dado de demonstração", origin: "demo", createdAt: timestamp, updatedAt: timestamp, version: 1 }
    ],
    expenses: [
      { id: `demo-food-${state.activeProfileId}-${state.month}`, profileId: state.activeProfileId, month: state.month, description: "Alimentação do mês", amountCents: 50000, categoryId: category("Alimentação"), paymentMethodId: payment("Cartão de débito"), date: `${state.month}-08`, status: "paid", notes: "Dado de demonstração", origin: "demo", createdAt: timestamp, updatedAt: timestamp, version: 1 },
      { id: `demo-transport-${state.activeProfileId}-${state.month}`, profileId: state.activeProfileId, month: state.month, description: "Transporte", amountCents: 30000, categoryId: category("Transporte"), paymentMethodId: payment("Pix"), date: `${state.month}-10`, status: "paid", notes: "Dado de demonstração", origin: "demo", createdAt: timestamp, updatedAt: timestamp, version: 1 }
    ]
  };
  await putRecord("monthlyIncomes", records.salary);
  await bulkPut("recurringExpenses", records.recurring);
  await bulkPut("oneTimeExpenses", records.expenses);
  await ensureOccurrencesForMonth(state.month);
  toast("Dados de demonstração carregados.");
  await loadMonth();
}

async function removeDemo() {
  if (isAllProfiles()) return toast("Escolha um perfil específico para remover a demonstração.", "error");
  const confirmed = await confirmAction({
    title: "Apagar dados de demonstração?",
    message: "Somente os registros identificados como demonstração serão removidos.",
    confirmLabel: "Apagar demonstração"
  });
  if (!confirmed) return;
  await deleteDemoData(state.activeProfileId);
  toast("Dados de demonstração removidos.");
  await loadMonth();
}

async function deleteAllData() {
  const input = createElement("input", { id: "delete-confirmation", type: "text", autocomplete: "off", placeholder: "Digite APAGAR" });
  const wrapper = createElement("div", { className: "field" }, [
    createElement("label", { for: "delete-confirmation", text: "Confirmação explícita" }), input
  ]);
  const confirmed = await confirmAction({
    title: "Apagar todos os dados locais?",
    message: "Não será possível desfazer. Recomendamos exportar um backup antes. Para continuar, digite APAGAR.",
    confirmLabel: "Apagar definitivamente",
    extra: wrapper,
    validate: () => input.value.trim() === "APAGAR"
  });
  if (!confirmed) return;
  await clearDatabase();
  state.activeProfileId = DEFAULT_PROFILE_ID;
  localStorage.setItem(ACTIVE_PROFILE_KEY, DEFAULT_PROFILE_ID);
  await seedDefaults(DEFAULT_PROFILE_ID);
  toast("Todos os dados financeiros foram apagados.");
  await loadMonth();
}

async function updateStorageStatus() {
  if (!navigator.storage?.persisted) {
    dom.storageStatus.textContent = "Este navegador não informa o status de armazenamento persistente.";
    dom.persistStorageButton.disabled = true;
    return;
  }
  const persisted = await navigator.storage.persisted();
  dom.storageStatus.textContent = persisted
    ? "O navegador concedeu armazenamento persistente para este aplicativo."
    : "O navegador ainda pode remover dados locais em situações de pouco espaço. A decisão final pertence ao navegador.";
  dom.persistStorageButton.disabled = persisted;
  dom.persistStorageButton.textContent = persisted ? "Proteção concedida" : "Solicitar proteção";
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return toast("Este navegador não oferece solicitação de armazenamento persistente.", "error");
  const granted = await navigator.storage.persist();
  toast(granted ? "Armazenamento persistente concedido." : "O navegador não concedeu a proteção. Seus dados continuam funcionando localmente.", granted ? "success" : "error");
  await updateStorageStatus();
}

function renderImportSummary(backup) {
  const validation = validateBackup(backup);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  state.pendingBackup = backup;
  const intro = createElement("p", { text: `Backup criado em ${new Date(backup.exportedAt).toLocaleString("pt-BR")}. Revise os totais antes de confirmar.` });
  const counts = createElement("div", { className: "import-counts" }, backupSummary(backup).map((item) =>
    createElement("div", {}, [createElement("strong", { text: String(item.count) }), createElement("span", { text: item.label })])
  ));
  const warning = createElement("p", { className: "form-error", text: "Ao substituir, todos os dados atuais serão apagados. Exporte um backup antes, se necessário." });
  replaceChildren(dom.importSummary, [intro, counts, warning]);
  dom.importPasswordField.hidden = true;
  dom.importModeField.hidden = false;
  dom.importSubmit.textContent = "Importar dados";
}

async function reviewImportFile() {
  const file = dom.importFile.files[0];
  if (!file) return toast("Selecione um arquivo JSON de backup.", "error");
  if (file.size > 25 * 1024 * 1024) return toast("O arquivo excede o limite de 25 MB.", "error");
  try {
    const parsed = JSON.parse(await file.text());
    state.pendingBackup = null;
    state.pendingImportWrapper = null;
    dom.importError.hidden = true;
    if (parsed.encrypted) {
      state.pendingImportWrapper = parsed;
      replaceChildren(dom.importSummary, createElement("p", { text: "Este backup está protegido. Informe a senha para abrir e revisar o conteúdo antes da importação." }));
      dom.importPasswordField.hidden = false;
      dom.importPassword.value = "";
      dom.importModeField.hidden = true;
      dom.importSubmit.textContent = "Abrir backup";
    } else {
      renderImportSummary(parsed);
    }
    dom.importDialog.showModal();
  } catch (error) {
    toast(error instanceof SyntaxError ? "O arquivo não contém um JSON válido." : error.message, "error");
  }
}

async function submitImport() {
  dom.importError.hidden = true;
  try {
    if (!state.pendingBackup && state.pendingImportWrapper) {
      if (!dom.importPassword.value) throw new Error("Informe a senha do backup.");
      const backup = await decryptBackup(state.pendingImportWrapper, dom.importPassword.value);
      renderImportSummary(backup);
      toast("Backup aberto. Revise o resumo e confirme a importação.");
      return;
    }
    if (!state.pendingBackup) throw new Error("Nenhum backup válido foi carregado.");
    const mode = new FormData(dom.importForm).get("import-mode") || "merge";
    await restoreBackup(state.pendingBackup, mode);
    dom.importDialog.close();
    state.pendingBackup = null;
    state.pendingImportWrapper = null;
    await seedDefaults();
    toast(mode === "replace" ? "Backup restaurado. Os dados anteriores foram substituídos." : "Backup mesclado sem criar IDs duplicados.");
    await loadMonth();
  } catch (error) {
    dom.importError.textContent = error.message;
    dom.importError.hidden = false;
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    state.registration = registration;
    if (registration.waiting) dom.updateBanner.hidden = false;
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) dom.updateBanner.hidden = false;
      });
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  } catch (error) {
    console.error("Service Worker:", error);
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) handleAction(actionTarget.dataset.action, actionTarget.dataset.id);
    const nav = event.target.closest("[data-view]");
    if (nav) showView(nav.dataset.view);
    const viewLink = event.target.closest("[data-view-link]");
    if (viewLink) showView(viewLink.dataset.viewLink);
  });
  dom.menuButton.addEventListener("click", () => dom.sidebar.classList.contains("open") ? closeMenu() : openMenu());
  dom.scrim.addEventListener("click", closeMenu);
  dom.profilePicker.addEventListener("change", async () => {
    state.activeProfileId = dom.profilePicker.value;
    localStorage.setItem(ACTIVE_PROFILE_KEY, state.activeProfileId);
    if (dom.reportProfile) dom.reportProfile.value = state.activeProfileId;
    await loadMonth();
  });
  dom.monthPicker.addEventListener("change", async () => {
    if (!dom.monthPicker.value) return;
    state.month = dom.monthPicker.value;
    await loadMonth();
  });
  dom.previousMonth.addEventListener("click", async () => { state.month = shiftMonth(state.month, -1); await loadMonth(); });
  dom.nextMonth.addEventListener("click", async () => { state.month = shiftMonth(state.month, 1); await loadMonth(); });
  dom.copySalaryButton.addEventListener("click", copyPreviousSalary);
  dom.expenseFilters.addEventListener("input", renderExpenses);
  dom.expenseFilters.addEventListener("change", renderExpenses);
  dom.clearExpenseFilters.addEventListener("click", () => { dom.expenseFilters.reset(); renderExpenses(); });
  let reportRenderTimer;
  const updateReport = () => {
    clearTimeout(reportRenderTimer);
    reportRenderTimer = setTimeout(() => {
      $$(".report-custom-date").forEach((field) => { field.hidden = dom.reportPeriod.value !== "custom"; });
      renderReports().catch((error) => toast(error.message, "error"));
    }, 120);
  };
  dom.reportFilters.addEventListener("input", updateReport);
  dom.reportFilters.addEventListener("change", (event) => {
    if (event.target === dom.reportProfile) {
      dom.reportCategory.value = "";
      dom.reportPayment.value = "";
      renderReportFilterOptions();
    }
    updateReport();
  });
  dom.clearReportFilters.addEventListener("click", () => {
    dom.reportFilters.reset();
    dom.reportProfile.value = state.activeProfileId;
    dom.reportStart.value = "";
    dom.reportEnd.value = "";
    renderReportFilterOptions();
    updateReport();
  });
  dom.saveReportPreset.addEventListener("click", saveReportPreset);
  dom.reportPreset.addEventListener("change", () => {
    dom.deleteReportPreset.disabled = !dom.reportPreset.value;
    if (dom.reportPreset.value) applyReportPreset(dom.reportPreset.value);
  });
  dom.deleteReportPreset.addEventListener("click", deleteReportPreset);
  dom.exportReportCsv.addEventListener("click", async () => {
    try {
      const { records } = await getFilteredReportRecords();
      const count = await saveCsv({
        scope: "all", type: "expenses", month: state.month,
        expenseRecords: records, filenamePrefix: "relatorio-financeiro-filtrado"
      });
      toast(`Relatório exportado com ${count} gasto(s).`);
    } catch (error) {
      toast(error.message, "error");
    }
  });
  dom.editorFields.addEventListener("blur", (event) => {
    if (event.target.dataset.money) {
      try { event.target.value = formatMoneyInput(parseMoneyToCents(event.target.value)); } catch { /* validation happens on submit */ }
    }
  }, true);
  dom.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") { dom.editorDialog.close(); return; }
    dom.editorSubmit.disabled = true;
    dom.editorError.hidden = true;
    try {
      const values = editorValues();
      validateEditor(values);
      await saveEditor(values);
      dom.editorDialog.close();
      toast("Dados salvos com sucesso.");
      await loadMonth();
    } catch (error) {
      dom.editorError.textContent = error.message || "Revise os campos e tente novamente.";
      dom.editorError.hidden = false;
    } finally {
      dom.editorSubmit.disabled = false;
    }
  });
  dom.confirmForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const confirmed = event.submitter?.value === "confirm";
    if (confirmed && state.confirmResolve?.validate && !state.confirmResolve.validate()) {
      toast("Preencha a confirmação solicitada.", "error");
      return;
    }
    dom.confirmDialog.close();
    state.confirmResolve?.resolve(confirmed);
    state.confirmResolve = null;
  });
  dom.encryptBackup.addEventListener("change", () => { dom.backupPasswordField.hidden = !dom.encryptBackup.checked; });
  dom.exportJsonButton.addEventListener("click", async () => {
    try {
      const password = dom.encryptBackup.checked ? dom.backupPassword.value : "";
      if (password && password.length < 8) throw new Error("Use pelo menos 8 caracteres na senha do backup.");
      const currentOnly = dom.backupScope.value === "current";
      if (currentOnly && isAllProfiles()) throw new Error("Escolha um perfil específico ou exporte todos os perfis.");
      dom.exportJsonButton.disabled = true;
      await saveBackup({
        password,
        profileId: currentOnly ? state.activeProfileId : "",
        profileName: currentOnly ? activeProfile()?.name || "" : ""
      });
      localStorage.setItem(LAST_BACKUP_KEY, nowIso());
      renderDashboardNotices();
      toast(password ? "Backup protegido exportado." : "Backup exportado.");
      dom.backupPassword.value = "";
    } catch (error) { toast(error.message, "error"); }
    finally { dom.exportJsonButton.disabled = false; }
  });
  dom.reviewImportButton.addEventListener("click", reviewImportFile);
  dom.importForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") { dom.importDialog.close(); return; }
    dom.importSubmit.disabled = true;
    await submitImport();
    dom.importSubmit.disabled = false;
  });
  dom.exportCsvButton.addEventListener("click", async () => {
    try {
      const count = await saveCsv({ scope: dom.csvScope.value, type: dom.csvType.value, month: state.month, profileId: state.activeProfileId });
      toast(`CSV exportado com ${count} lançamento(s).`);
    } catch (error) { toast(error.message, "error"); }
  });
  $$("[data-theme-value]").forEach((button) => button.addEventListener("click", () => setTheme(button.dataset.themeValue)));
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if ((localStorage.getItem("finance-theme") || "system") === "system") setTheme("system");
  });
  dom.persistStorageButton.addEventListener("click", requestPersistentStorage);
  dom.loadDemoButton.addEventListener("click", loadDemo);
  dom.removeDemoButton.addEventListener("click", removeDemo);
  dom.deleteAllButton.addEventListener("click", deleteAllData);
  dom.updateButton.addEventListener("click", () => state.registration?.waiting?.postMessage({ type: "SKIP_WAITING" }));
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    dom.installButton.hidden = false;
  });
  dom.installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    dom.installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => { dom.installButton.hidden = true; toast("Aplicativo instalado."); });
  const updateOnlineStatus = () => { dom.offlineIndicator.hidden = navigator.onLine; };
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();
  window.addEventListener("resize", () => {
    if (!state.metrics) return;
    if (state.view === "dashboard") renderDashboard();
    if (state.view === "reports") renderReports();
  });
}

function mapDom() {
  Object.assign(dom, {
    sidebar: $("#sidebar"), menuButton: $("#menu-button"), scrim: $("#scrim"),
    profilePicker: $("#profile-picker"),
    monthPicker: $("#month-picker"), previousMonth: $("#previous-month"), nextMonth: $("#next-month"),
    dashboardMonthLabel: $("#dashboard-month-label"), balanceBanner: $("#balance-banner"),
    balanceIcon: $("#balance-icon"), balanceStatus: $("#balance-status"), balanceMessage: $("#balance-message"),
    balanceValue: $("#balance-value"), dashboardMetrics: $("#dashboard-metrics"),
    dashboardChart: $("#dashboard-chart"), dashboardChartSummary: $("#dashboard-chart-summary"),
    backupReminder: $("#backup-reminder"), backupReminderText: $("#backup-reminder-text"),
    undatedExpensesPanel: $("#undated-expenses-panel"), undatedExpensesText: $("#undated-expenses-text"),
    recentTransactions: $("#recent-transactions"), incomeMetrics: $("#income-metrics"), salaryCard: $("#salary-card"),
    copySalaryButton: $("#copy-salary-button"), incomeTableBody: $("#income-table-body"), incomeEmpty: $("#income-empty"),
    recurringMetrics: $("#recurring-metrics"), instanceTableBody: $("#instance-table-body"), instanceEmpty: $("#instance-empty"),
    recurringTableBody: $("#recurring-table-body"), recurringEmpty: $("#recurring-empty"),
    expenseFilters: $("#expense-filters"), expenseCategoryFilter: $("#expense-category-filter"),
    expensePaymentFilter: $("#expense-payment-filter"), expenseMetrics: $("#expense-metrics"),
    expenseTableBody: $("#expense-table-body"), expenseEmpty: $("#expense-empty"), clearExpenseFilters: $("#clear-expense-filters"),
    categoryList: $("#category-list"), paymentList: $("#payment-list"), profileList: $("#profile-list"),
    reportFilters: $("#report-filters"), reportPeriod: $("#report-period"), reportProfile: $("#report-profile"),
    reportCategory: $("#report-category"), reportPayment: $("#report-payment"), reportStart: $("#report-start"), reportEnd: $("#report-end"),
    clearReportFilters: $("#clear-report-filters"), reportPreset: $("#report-preset"),
    saveReportPreset: $("#save-report-preset"), deleteReportPreset: $("#delete-report-preset"),
    exportReportCsv: $("#export-report-csv"), reportMetrics: $("#report-metrics"),
    categoryReportChart: $("#category-report-chart"), categoryReportSummary: $("#category-report-summary"),
    expenseTypeChart: $("#expense-type-chart"), expenseTypeSummary: $("#expense-type-summary"),
    incomeExpenseChart: $("#income-expense-chart"), incomeExpenseSummary: $("#income-expense-summary"),
    balanceHistoryChart: $("#balance-history-chart"), balanceHistorySummary: $("#balance-history-summary"),
    paymentStatusChart: $("#payment-status-chart"), paymentStatusSummary: $("#payment-status-summary"),
    expenseHistoryChart: $("#expense-history-chart"), expenseHistorySummary: $("#expense-history-summary"),
    largestExpenses: $("#largest-expenses"), reportExpenseBody: $("#report-expense-body"), reportExpenseEmpty: $("#report-expense-empty"),
    editorDialog: $("#editor-dialog"), editorForm: $("#editor-form"), editorKicker: $("#editor-kicker"),
    editorTitle: $("#editor-title"), editorFields: $("#editor-fields"), editorError: $("#editor-error"), editorSubmit: $("#editor-submit"),
    confirmDialog: $("#confirm-dialog"), confirmForm: $("#confirm-form"), confirmTitle: $("#confirm-title"),
    confirmMessage: $("#confirm-message"), confirmExtra: $("#confirm-extra"), confirmSubmit: $("#confirm-submit"),
    backupScope: $("#backup-scope"), encryptBackup: $("#encrypt-backup"), backupPasswordField: $("#backup-password-field"), backupPassword: $("#backup-password"),
    exportJsonButton: $("#export-json-button"), importFile: $("#import-file"), reviewImportButton: $("#review-import-button"),
    importDialog: $("#import-dialog"), importForm: $("#import-form"), importSummary: $("#import-summary"),
    importPasswordField: $("#import-password-field"), importPassword: $("#import-password"),
    importModeField: $("#import-mode-field"), importError: $("#import-error"), importSubmit: $("#import-submit"),
    csvScope: $("#csv-scope"), csvType: $("#csv-type"), exportCsvButton: $("#export-csv-button"),
    storageStatus: $("#storage-status"), persistStorageButton: $("#persist-storage-button"),
    loadDemoButton: $("#load-demo-button"), removeDemoButton: $("#remove-demo-button"), deleteAllButton: $("#delete-all-button"),
    toastRegion: $("#toast-region"), updateBanner: $("#update-banner"), updateButton: $("#update-button"),
    offlineIndicator: $("#offline-indicator"), installButton: $("#install-button")
  });
}

async function initialize() {
  mapDom();
  const savedTheme = localStorage.getItem("finance-theme") || "system";
  setTheme(savedTheme);
  dom.monthPicker.value = state.month;
  bindEvents();
  try {
    await seedDefaults();
    await loadMonth();
    await updateStorageStatus();
    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    toast(`Não foi possível iniciar o aplicativo: ${error.message}`, "error");
  }
}

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  toast("Ocorreu um erro inesperado. Seus dados já salvos permanecem no dispositivo.", "error");
});

initialize();
