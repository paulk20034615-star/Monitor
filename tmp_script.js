
(function () {
  "use strict";

  /* ============================================================
     CONSTANTS & STATE
  ============================================================ */
  const STORAGE_KEY = "mbm_data_v1";
  const CATEGORIES = ["Petty Cash", "Medical Expenses", "Other Expenses"];
  const CATEGORY_COLOR = {
    "Petty Cash": "#3B7DC4",
    "Medical Expenses": "#C4573B",
    "Other Expenses": "#8A6FBF"
  };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const monthKeyOf = (dateStr) => dateStr.slice(0, 7); // YYYY-MM
  const currentMonthKey = () => monthKeyOf(todayISO());

  // Some sandboxed previews or unusual browser modes block localStorage.
  // Fall back to sessionStorage when possible, and keep working in memory otherwise.
  function isStorageAvailable(type) {
    try {
      const testKey = "__mbm_storage_test__";
      window[type].setItem(testKey, "1");
      window[type].removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  const STORAGE_TYPE = isStorageAvailable("localStorage")
    ? "localStorage"
    : isStorageAvailable("sessionStorage")
      ? "sessionStorage"
      : null;
  const STORAGE_OK = Boolean(STORAGE_TYPE);
  const STORAGE_PERSISTENT = STORAGE_TYPE === "localStorage";

  function getStorage() {
    return STORAGE_OK ? window[STORAGE_TYPE] : null;
  }

  function loadState() {
    if (!STORAGE_OK) return { balance: 0, transactions: [] };
    try {
      const raw = getStorage().getItem(STORAGE_KEY);
      if (!raw) return { balance: 0, transactions: [] };
      const parsed = JSON.parse(raw);
      if (typeof parsed.balance !== "number" || !Array.isArray(parsed.transactions)) {
        return { balance: 0, transactions: [] };
      }
      return parsed;
    } catch (e) {
      console.error("Failed to load saved data", e);
      return { balance: 0, transactions: [] };
    }
  }

  function saveState() {
    // Always keep working in-memory for the current session even if persistence fails.
    if (!STORAGE_OK) return;
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to save data locally", e);
    }
  }

  let state = loadState();
  let dashboardMonth = currentMonthKey();
  let reportMonth = currentMonthKey();
  let activeExpenseCategory = null;

  let historyFilters = {
    search: "",
    type: "all",   // all | income | Petty Cash | Medical Expenses | Other Expenses
    from: "",
    to: ""
  };

  /* ============================================================
     FORMATTERS
  ============================================================ */
  const fmtMoney = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: n % 1 !== 0 ? 2 : 0 });

  function fmtMonthLabel(monthKey) {
    const [y, m] = monthKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }

  function fmtDateNice(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  function shiftMonth(monthKey, delta) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  /* ============================================================
     TOASTS
  ============================================================ */
  function showToast(message, type) {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    const isError = type === "error";
    el.className = "toast pointer-events-auto absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-4 py-3 rounded-2xl shadow-pop font-semibold text-sm flex items-center gap-2 " +
      (isError ? "bg-expense text-white" : "bg-ink text-white");
    el.innerHTML = (isError
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
    ) + '<span>' + message + '</span>';
    container.appendChild(el);
    setTimeout(() => el.remove(), 3100);
  }

  /* ============================================================
     PAGE NAVIGATION
  ============================================================ */
  function gotoPage(pageName) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.getElementById("page-" + pageName).classList.add("active");
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.dataset.active = String(btn.dataset.page === pageName);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (pageName === "expenses") renderHistory();
    if (pageName === "reports") renderReports();
    if (pageName === "dashboard") renderDashboard();
  }

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => gotoPage(btn.dataset.page));
  });
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => gotoPage(btn.dataset.goto));
  });
  document.getElementById("btn-open-settings").addEventListener("click", () => gotoPage("settings"));

  /* ============================================================
     MODAL / SHEET HELPERS
  ============================================================ */
  function openSheet(sheetId, backdropId) {
    const sheet = document.getElementById(sheetId);
    const backdrop = document.getElementById(backdropId);
    backdrop.classList.remove("hidden");
    requestAnimationFrame(() => {
      backdrop.classList.remove("opacity-0");
      sheet.classList.remove("translate-y-full");
    });
    document.body.style.overflow = "hidden";
  }
  function closeSheet(sheetId, backdropId) {
    const sheet = document.getElementById(sheetId);
    const backdrop = document.getElementById(backdropId);
    backdrop.classList.add("opacity-0");
    sheet.classList.add("translate-y-full");
    document.body.style.overflow = "";
    setTimeout(() => backdrop.classList.add("hidden"), 300);
  }

  function openCenterModal() {
    document.getElementById("backdrop-confirm").classList.remove("hidden");
    requestAnimationFrame(() => {
      document.getElementById("backdrop-confirm").classList.remove("opacity-0");
      document.getElementById("modal-confirm").classList.remove("opacity-0", "scale-95");
    });
  }
  function closeCenterModal() {
    document.getElementById("backdrop-confirm").classList.add("opacity-0");
    document.getElementById("modal-confirm").classList.add("opacity-0", "scale-95");
    setTimeout(() => document.getElementById("backdrop-confirm").classList.add("hidden"), 250);
  }

  function confirmAction(title, body, onConfirm) {
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-body").textContent = body;
    openCenterModal();
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");
    if (!okBtn || !cancelBtn) {
      if (window.confirm(body)) onConfirm();
      return;
    }
    const onOk = () => {
      closeCenterModal();
      onConfirm();
    };
    const onCancel = () => {
      closeCenterModal();
    };
    okBtn.addEventListener("click", onOk, { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
  }

  // FAB sheet wiring
  document.getElementById("btn-fab").addEventListener("click", () => openSheet("sheet-fab", "sheet-backdrop"));
  document.getElementById("sheet-backdrop").addEventListener("click", () => closeSheet("sheet-fab", "sheet-backdrop"));
  document.getElementById("sheet-add-balance").addEventListener("click", () => { closeSheet("sheet-fab", "sheet-backdrop"); setTimeout(openBalanceModal, 260); });
  document.getElementById("sheet-add-expense").addEventListener("click", () => { closeSheet("sheet-fab", "sheet-backdrop"); setTimeout(openExpenseModal, 260); });

  document.getElementById("btn-quick-add-balance").addEventListener("click", openBalanceModal);
  document.getElementById("btn-quick-add-expense").addEventListener("click", openExpenseModal);

  /* ---------- Balance modal ---------- */
  function openBalanceModal() {
    document.getElementById("form-balance").reset();
    document.getElementById("err-balance-amount").classList.add("hidden");
    openSheet("modal-balance", "backdrop-balance");
    setTimeout(() => document.getElementById("input-balance-amount").focus(), 350);
  }
  document.getElementById("backdrop-balance").addEventListener("click", () => closeSheet("modal-balance", "backdrop-balance"));
  document.querySelectorAll('[data-close="balance"]').forEach(b => b.addEventListener("click", () => closeSheet("modal-balance", "backdrop-balance")));

  document.getElementById("form-balance").addEventListener("submit", (e) => {
    e.preventDefault();
    const amountInput = document.getElementById("input-balance-amount");
    const amount = parseFloat(amountInput.value);
    const errEl = document.getElementById("err-balance-amount");
    if (isNaN(amount) || amount <= 0) {
      errEl.classList.remove("hidden");
      amountInput.focus();
      return;
    }
    errEl.classList.add("hidden");
    const note = document.getElementById("input-balance-note").value.trim();

    state.balance = Math.round((state.balance + amount) * 100) / 100;
    state.transactions.push({
      id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      type: "income",
      amount: amount,
      category: null,
      date: todayISO(),
      description: note || "Balance added",
      timestamp: Date.now()
    });
    saveState();
    closeSheet("modal-balance", "backdrop-balance");
    showToast("₹" + amount.toLocaleString("en-IN") + " added to wallet");
    refreshAll();
  });

  /* ---------- Expense modal ---------- */
  function openExpenseModal() {
    document.getElementById("form-expense").reset();
    document.getElementById("err-expense-amount").classList.add("hidden");
    document.getElementById("err-expense-cat").classList.add("hidden");
    document.getElementById("input-expense-date").value = todayISO();
    document.getElementById("input-expense-date").max = todayISO();
    document.getElementById("expense-balance-hint").textContent = "Available balance: " + fmtMoney(state.balance);
    activeExpenseCategory = null;
    document.querySelectorAll(".cat-option").forEach(b => {
      b.classList.remove("border-primary", "bg-primary-light", "text-primary-dark");
      b.classList.add("border-line", "text-ink-muted");
    });
    openSheet("modal-expense", "backdrop-expense");
    setTimeout(() => document.getElementById("input-expense-amount").focus(), 350);
  }
  document.getElementById("backdrop-expense").addEventListener("click", () => closeSheet("modal-expense", "backdrop-expense"));
  document.querySelectorAll('[data-close="expense"]').forEach(b => b.addEventListener("click", () => closeSheet("modal-expense", "backdrop-expense")));

  document.querySelectorAll(".cat-option").forEach(btn => {
    btn.addEventListener("click", () => {
      activeExpenseCategory = btn.dataset.cat;
      document.querySelectorAll(".cat-option").forEach(b => {
        b.classList.remove("border-primary", "bg-primary-light", "text-primary-dark");
        b.classList.add("border-line", "text-ink-muted");
      });
      btn.classList.remove("border-line", "text-ink-muted");
      btn.classList.add("border-primary", "bg-primary-light", "text-primary-dark");
      document.getElementById("err-expense-cat").classList.add("hidden");
    });
  });

  document.getElementById("form-expense").addEventListener("submit", (e) => {
    e.preventDefault();
    const amountInput = document.getElementById("input-expense-amount");
    const amount = parseFloat(amountInput.value);
    const errAmt = document.getElementById("err-expense-amount");
    const errCat = document.getElementById("err-expense-cat");
    let hasError = false;

    if (isNaN(amount) || amount <= 0 || amount > state.balance) {
      errAmt.classList.remove("hidden");
      hasError = true;
    } else {
      errAmt.classList.add("hidden");
    }
    if (!activeExpenseCategory) {
      errCat.classList.remove("hidden");
      hasError = true;
    } else {
      errCat.classList.add("hidden");
    }
    if (hasError) return;

    const date = document.getElementById("input-expense-date").value || todayISO();
    const desc = document.getElementById("input-expense-desc").value.trim();

    state.balance = Math.round((state.balance - amount) * 100) / 100;
    state.transactions.push({
      id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      type: "expense",
      amount: amount,
      category: activeExpenseCategory,
      date: date,
      description: desc,
      timestamp: Date.now()
    });
    saveState();
    closeSheet("modal-expense", "backdrop-expense");
    showToast(fmtMoney(amount) + " logged under " + activeExpenseCategory);
    refreshAll();
  });

  /* ============================================================
     DASHBOARD RENDER
  ============================================================ */
  function monthTransactions(monthKey) {
    return state.transactions.filter(t => monthKeyOf(t.date) === monthKey);
  }

  function computeMonthStats(monthKey) {
    const txs = monthTransactions(monthKey);
    const income = txs.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expenses = txs.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const count = txs.filter(t => t.type === "expense").length;
    const byCategory = {};
    CATEGORIES.forEach(c => byCategory[c] = 0);
    txs.filter(t => t.type === "expense").forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; });
    const pct = income > 0 ? Math.min(100, Math.round((expenses / income) * 100)) : (expenses > 0 ? 100 : 0);
    return { income, expenses, count, byCategory, pct, txs };
  }

  function renderDashboard() {
    document.getElementById("dash-month-label").textContent = fmtMonthLabel(dashboardMonth);
    const stats = computeMonthStats(dashboardMonth);

    document.getElementById("wallet-balance").textContent = fmtMoney(state.balance);
    document.getElementById("stat-income").textContent = fmtMoney(stats.income);
    document.getElementById("stat-expenses").textContent = fmtMoney(stats.expenses);
    document.getElementById("stat-count").textContent = stats.count;

    const todayExpenses = state.transactions
      .filter(t => t.type === "expense" && t.date === todayISO())
      .reduce((s, t) => s + t.amount, 0);
    document.getElementById("stat-today").textContent = fmtMoney(todayExpenses);

    // Dial
    const circumference = 326.7;
    const offset = circumference - (stats.pct / 100) * circumference;
    document.getElementById("dial-fg").style.strokeDashoffset = offset;
    document.getElementById("dial-pct").textContent = stats.pct + "%";

    const noteEl = document.getElementById("dial-remaining-note");
    if (state.balance <= 0) {
      noteEl.textContent = "Add funds to get started";
    } else if (stats.pct >= 90) {
      noteEl.textContent = "You're close to this month's budget";
    } else {
      noteEl.textContent = fmtMoney(state.balance) + " ready to spend";
    }

    // Category summary
    renderCategoryBars("category-summary", "category-empty", stats.byCategory, stats.expenses);

    // Recent transactions (last 5, all time)
    renderTransactionList(
      "recent-transactions",
      [...state.transactions].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5),
      "No transactions yet. Tap “Add Balance” to begin."
    );
  }

  function renderCategoryBars(containerId, emptyId, byCategory, total) {
    const container = document.getElementById(containerId);
    const emptyEl = document.getElementById(emptyId);
    container.innerHTML = "";
    if (total <= 0) {
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
    CATEGORIES.forEach(cat => {
      const amt = byCategory[cat] || 0;
      const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
      const row = document.createElement("div");
      row.innerHTML = `
        <div class="flex items-center justify-between text-xs mb-1.5">
          <span class="flex items-center gap-2 font-medium text-ink">
            <span class="w-2.5 h-2.5 rounded-full" style="background:${CATEGORY_COLOR[cat]}"></span>
            ${cat}
          </span>
          <span class="tabular text-ink-muted font-semibold">${fmtMoney(amt)} <span class="text-ink-faint">(${pct}%)</span></span>
        </div>
        <div class="h-2 w-full bg-line rounded-full overflow-hidden">
          <div class="h-full rounded-full" style="width:${pct}%; background:${CATEGORY_COLOR[cat]}; transition: width .6s cubic-bezier(.32,.72,0,1);"></div>
        </div>`;
      container.appendChild(row);
    });
  }

  function transactionIcon(t) {
    if (t.type === "income") {
      return `<div class="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0E7C66" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
      </div>`;
    }
    const color = CATEGORY_COLOR[t.category] || "#8A6FBF";
    return `<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background:${color}1A">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
    </div>`;
  }

  function renderTransactionList(containerId, txs, emptyMessage) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    if (txs.length === 0) {
      container.innerHTML = `<p class="text-center text-sm text-ink-faint py-8">${emptyMessage}</p>`;
      return;
    }
    txs.forEach(t => {
      const row = document.createElement("div");
      row.className = "bg-surface rounded-2xl p-3.5 shadow-soft flex items-center gap-3";
      const title = t.type === "income" ? (t.description || "Balance added") : (t.description || t.category);
      const subtitle = t.type === "income" ? fmtDateNice(t.date) : `${t.category} · ${fmtDateNice(t.date)}`;
      const amountText = (t.type === "income" ? "+" : "−") + fmtMoney(t.amount);
      const amountColor = t.type === "income" ? "text-primary-dark" : "text-expense";
      row.innerHTML = `
        ${transactionIcon(t)}
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate">${escapeHTML(title)}</p>
          <p class="text-[11px] text-ink-muted truncate">${escapeHTML(subtitle)}</p>
        </div>
        <p class="font-display font-bold text-sm tabular shrink-0 ${amountColor}">${amountText}</p>`;
      container.appendChild(row);
    });
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  document.querySelectorAll("[data-month-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      dashboardMonth = shiftMonth(dashboardMonth, parseInt(btn.dataset.monthNav, 10));
      renderDashboard();
    });
  });

  /* ============================================================
     HISTORY PAGE
  ============================================================ */
  const searchInput = document.getElementById("search-input");
  searchInput.addEventListener("input", () => { historyFilters.search = searchInput.value.trim().toLowerCase(); renderHistory(); });

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => {
        c.classList.remove("bg-ink", "text-white");
        c.classList.add("bg-surface", "text-ink-muted");
      });
      chip.classList.remove("bg-surface", "text-ink-muted");
      chip.classList.add("bg-ink", "text-white");

      if (chip.dataset.filterType) historyFilters.type = chip.dataset.filterType;
      else if (chip.dataset.filterCat) historyFilters.type = chip.dataset.filterCat;
      renderHistory();
    });
  });

  document.getElementById("filter-date-from").addEventListener("change", (e) => { historyFilters.from = e.target.value; renderHistory(); });
  document.getElementById("filter-date-to").addEventListener("change", (e) => { historyFilters.to = e.target.value; renderHistory(); });
  document.getElementById("btn-clear-filters").addEventListener("click", () => {
    historyFilters = { search: "", type: "all", from: "", to: "" };
    searchInput.value = "";
    document.getElementById("filter-date-from").value = "";
    document.getElementById("filter-date-to").value = "";
    document.querySelectorAll(".filter-chip").forEach((c, i) => {
      c.classList.remove("bg-ink", "text-white");
      c.classList.add("bg-surface", "text-ink-muted");
    });
    document.querySelector('[data-filter-type="all"]').classList.remove("bg-surface", "text-ink-muted");
    document.querySelector('[data-filter-type="all"]').classList.add("bg-ink", "text-white");
    renderHistory();
  });

  function filteredTransactions() {
    return [...state.transactions]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter(t => {
        if (historyFilters.type === "income" && t.type !== "income") return false;
        if (CATEGORIES.includes(historyFilters.type) && t.category !== historyFilters.type) return false;
        if (historyFilters.from && t.date < historyFilters.from) return false;
        if (historyFilters.to && t.date > historyFilters.to) return false;
        if (historyFilters.search) {
          const haystack = ((t.description || "") + " " + (t.category || "") + " " + (t.type === "income" ? "balance added" : "")).toLowerCase();
          if (!haystack.includes(historyFilters.search)) return false;
        }
        return true;
      });
  }

  function renderHistory() {
    const txs = filteredTransactions();
    const container = document.getElementById("full-history");
    const emptyEl = document.getElementById("history-empty");
    if (txs.length === 0) {
      container.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
    renderTransactionList("full-history", txs, "No transactions yet.");
  }

  /* ============================================================
     REPORTS PAGE
  ============================================================ */
  document.querySelectorAll("[data-month-nav-r]").forEach(btn => {
    btn.addEventListener("click", () => {
      reportMonth = shiftMonth(reportMonth, parseInt(btn.dataset.monthNavR, 10));
      renderReports();
    });
  });

  function renderReports() {
    document.getElementById("report-month-label").textContent = fmtMonthLabel(reportMonth);
    const stats = computeMonthStats(reportMonth);

    document.getElementById("report-pct").textContent = stats.pct + "%";
    document.getElementById("report-bar").style.width = stats.pct + "%";
    document.getElementById("report-income").textContent = fmtMoney(stats.income);
    document.getElementById("report-spent").textContent = fmtMoney(stats.expenses);
    document.getElementById("report-left").textContent = fmtMoney(Math.max(0, stats.income - stats.expenses));

    renderCategoryBars("report-category", "report-category-empty", stats.byCategory, stats.expenses);

    // Daily history
    const dailyMap = {};
    stats.txs.filter(t => t.type === "expense").forEach(t => {
      dailyMap[t.date] = (dailyMap[t.date] || 0) + t.amount;
    });
    const days = Object.keys(dailyMap).sort((a, b) => b.localeCompare(a));
    const dailyContainer = document.getElementById("report-daily");
    const dailyEmpty = document.getElementById("report-daily-empty");
    dailyContainer.innerHTML = "";
    if (days.length === 0) {
      dailyEmpty.classList.remove("hidden");
    } else {
      dailyEmpty.classList.add("hidden");
      const maxVal = Math.max(...days.map(d => dailyMap[d]));
      days.forEach(d => {
        const barPct = maxVal > 0 ? Math.round((dailyMap[d] / maxVal) * 100) : 0;
        const row = document.createElement("div");
        row.className = "flex items-center gap-3";
        row.innerHTML = `
          <span class="text-[11px] text-ink-muted w-16 shrink-0 tabular">${fmtDateNice(d).replace(/,.*/, "")}</span>
          <div class="flex-1 h-2 bg-line rounded-full overflow-hidden">
            <div class="h-full bg-primary rounded-full" style="width:${barPct}%"></div>
          </div>
          <span class="text-xs font-semibold tabular w-16 text-right shrink-0">${fmtMoney(dailyMap[d])}</span>`;
        dailyContainer.appendChild(row);
      });
    }
  }

  /* ============================================================
     EXPORTS: CSV & PDF (print)
  ============================================================ */
  function buildCSV(txs) {
    const rows = [["Date", "Type", "Category", "Description", "Amount (INR)"]];
    txs.forEach(t => {
      rows.push([
        t.date,
        t.type === "income" ? "Balance Added" : "Expense",
        t.category || "-",
        (t.description || "").replace(/,/g, ";"),
        t.amount.toFixed(2)
      ]);
    });
    return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportCSVForMonth(monthKey) {
    const txs = monthTransactions(monthKey).sort((a, b) => a.timestamp - b.timestamp);
    if (txs.length === 0) { showToast("Nothing to export for this month", "error"); return; }
    const csv = buildCSV(txs);
    downloadFile(`budget_${monthKey}.csv`, csv, "text/csv");
    showToast("CSV downloaded");
  }

  function exportAllCSV() {
    const txs = [...state.transactions].sort((a, b) => a.timestamp - b.timestamp);
    if (txs.length === 0) { showToast("No history to export yet", "error"); return; }
    const csv = buildCSV(txs);
    downloadFile("budget_full_history.csv", csv, "text/csv");
    showToast("CSV downloaded");
  }

  document.getElementById("btn-export-csv").addEventListener("click", () => exportCSVForMonth(reportMonth));
  document.getElementById("btn-export-csv-2").addEventListener("click", exportAllCSV);

  document.getElementById("btn-export-pdf").addEventListener("click", () => {
    const stats = computeMonthStats(reportMonth);
    const txs = stats.txs.filter(t => t.type === "expense").sort((a, b) => a.timestamp - b.timestamp);
    if (stats.txs.length === 0) { showToast("Nothing to export for this month", "error"); return; }

    let rowsHTML = txs.map(t => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${fmtDateNice(t.date)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHTML(t.category)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHTML(t.description || "-")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmtMoney(t.amount)}</td>
      </tr>`).join("");

    document.getElementById("print-report").innerHTML = `
      <h1 style="font-family:sans-serif;font-size:22px;margin-bottom:2px;">Monthly Budget Maintainer</h1>
      <p style="font-family:sans-serif;color:#555;margin-top:0;">Report for ${fmtMonthLabel(reportMonth)}</p>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;margin-bottom:20px;">
        <tr><td style="padding:4px 0;color:#555;">Total Added</td><td style="text-align:right;font-weight:bold;">${fmtMoney(stats.income)}</td></tr>
        <tr><td style="padding:4px 0;color:#555;">Total Spent</td><td style="text-align:right;font-weight:bold;">${fmtMoney(stats.expenses)}</td></tr>
        <tr><td style="padding:4px 0;color:#555;">Remaining</td><td style="text-align:right;font-weight:bold;">${fmtMoney(Math.max(0, stats.income - stats.expenses))}</td></tr>
        <tr><td style="padding:4px 0;color:#555;">Budget Used</td><td style="text-align:right;font-weight:bold;">${stats.pct}%</td></tr>
        <tr><td style="padding:4px 0;color:#555;">Expenses Logged</td><td style="text-align:right;font-weight:bold;">${stats.count}</td></tr>
      </table>
      <h2 style="font-family:sans-serif;font-size:16px;">Expense Detail</h2>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:12px;">
        <thead>
          <tr style="background:#f2f2f2;">
            <th style="padding:6px 8px;text-align:left;">Date</th>
            <th style="padding:6px 8px;text-align:left;">Category</th>
            <th style="padding:6px 8px;text-align:left;">Description</th>
            <th style="padding:6px 8px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>`;

    window.print();
  });

  /* ============================================================
     SETTINGS: RESET
  ============================================================ */
  document.getElementById("btn-reset-month").addEventListener("click", () => {
    const panel = document.getElementById("reset-month-panel");
    const picker = document.getElementById("reset-month-picker");
    picker.value = reportMonth || currentMonthKey();
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      picker.focus();
    }
  });

  document.getElementById("btn-reset-month-cancel").addEventListener("click", () => {
    document.getElementById("reset-month-panel").classList.add("hidden");
  });

  document.getElementById("btn-reset-month-confirm").addEventListener("click", () => {
    const monthKey = document.getElementById("reset-month-picker").value;
    if (!monthKey) {
      showToast("Choose a month first", "error");
      return;
    }
    confirmAction(
      `Reset ${fmtMonthLabel(monthKey)}?`,
      `This deletes every transaction logged in ${fmtMonthLabel(monthKey)} and adjusts your wallet balance to undo their effect. This cannot be undone.`,
      () => {
        const keep = [];
        let balanceAdjust = 0;
        state.transactions.forEach(t => {
          if (monthKeyOf(t.date) === monthKey) {
            balanceAdjust += t.type === "income" ? -t.amount : t.amount;
          } else {
            keep.push(t);
          }
        });
        if (keep.length === state.transactions.length) {
          showToast(`No data found for ${fmtMonthLabel(monthKey)}`, "error");
          document.getElementById("reset-month-panel").classList.add("hidden");
          return;
        }
        state.transactions = keep;
        state.balance = Math.max(0, Math.round((state.balance + balanceAdjust) * 100) / 100);
        saveState();
        showToast(`${fmtMonthLabel(monthKey)} data reset`);
        document.getElementById("reset-month-panel").classList.add("hidden");
        refreshAll();
      }
    );
  });

  document.getElementById("btn-reset-all").addEventListener("click", () => {
    confirmAction(
      "Erase all data?",
      "This permanently deletes your wallet balance and every transaction you've ever logged. This cannot be undone.",
      () => {
        state = { balance: 0, transactions: [] };
        saveState();
        showToast("All data erased");
        refreshAll();
      }
    );
  });

  /* ============================================================
     REFRESH
  ============================================================ */
  function refreshAll() {
    renderDashboard();
    renderHistory();
    renderReports();
  }

  if (!STORAGE_OK) {
    document.getElementById("storage-banner").classList.remove("hidden");
  } else if (!STORAGE_PERSISTENT) {
    const bannerText = document.querySelector("#storage-banner span");
    if (bannerText) {
      bannerText.textContent = "This browser session can save data temporarily, but it will be lost when you close the tab. Open the file directly in a normal browser tab for permanent storage.";
    }
    document.getElementById("storage-banner").classList.remove("hidden");
  }

  // Initial render
  refreshAll();
})();
