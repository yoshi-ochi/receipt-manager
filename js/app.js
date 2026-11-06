document.addEventListener("DOMContentLoaded", async () => {
  let currentMode = "business";
  let currentFilter = "all";
  let currentWorkingItems = [];
  let confirmedTotalAmount = 0;
  const particleSphere = new ParticleSphere("particle-sphere-canvas");

  const tabBusiness = document.getElementById("tab-business");
  const tabPersonal = document.getElementById("tab-personal");
  const recordsContainer = document.getElementById("records-container");
  const summaryContainer = document.getElementById("summary-container");
  const analyticsBreakdown = document.getElementById("analytics-breakdown-container");
  const skeletonContainer = document.getElementById("skeleton-container");
  const recordCountBadge = document.getElementById("record-count-badge");

  const loaderOverlay = document.getElementById("loader-overlay");
  const cameraInput = document.getElementById("camera-input");

  const editModal = document.getElementById("edit-modal");
  const modalBtnClose = document.getElementById("modal-btn-close");
  const modalBtnCancel = document.getElementById("modal-btn-cancel");
  const modalBtnSave = document.getElementById("modal-btn-save");

  const formDate = document.getElementById("form-date");
  const formStore = document.getElementById("form-store");
  const formMemo = document.getElementById("form-memo");
  const formTotalDisplay = document.getElementById("form-total-display");
  const itemsTableBody = document.getElementById("items-table-body");
  const btnAddItemRow = document.getElementById("btn-add-item-row");

  const formBusinessCategory = document.getElementById("form-business-category");
  const formPaymentMethod = document.getElementById("form-payment-method");

  const btnSyncSettings = document.getElementById("btn-sync-settings");
  const btnSyncSheets = document.getElementById("btn-sync-sheets");
  const settingsModal = document.getElementById("settings-modal");
  const settingsBtnClose = document.getElementById("settings-btn-close");
  const settingsBtnSave = document.getElementById("settings-btn-save");
  const settingGasUrl = document.getElementById("setting-gas-url");
  const settingVisionKey = document.getElementById("setting-vision-key");
  const btnExportCsv = document.getElementById("btn-export-csv");

  function initDropdowns() {
    formBusinessCategory.innerHTML = "";
    APP_CONFIG.BLUE_TAX_COLUMNS.slice(1).forEach(col => {
      const opt = document.createElement("option");
      opt.value = col.name;
      opt.textContent = `${col.name} (${col.type === 'expense' ? '経費' : '収入/原価'})`;
      formBusinessCategory.appendChild(opt);
    });
  }

  function setMode(mode) {
    currentMode = mode;
    if (mode === "business") {
      tabBusiness.className = "py-2 font-semibold rounded-md transition-all duration-200 bg-neutral-800 text-white shadow-sm";
      tabPersonal.className = "py-2 font-semibold rounded-md transition-all duration-200 text-neutral-400 hover:text-white";
    } else {
      tabPersonal.className = "py-2 font-semibold rounded-md transition-all duration-200 bg-neutral-800 text-white shadow-sm";
      tabBusiness.className = "py-2 font-semibold rounded-md transition-all duration-200 text-neutral-400 hover:text-white";
    }
    renderAllViews();
  }

  function formatDisplayDate(rawDate) {
    if (!rawDate) return "日付不明";
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    return String(rawDate).substring(0, 10);
  }

  function renderAllViews() {
    const allRecords = AppStorage.getAll()
      .filter(r => r.mode === currentMode)
      .sort((a, b) => new Date(b.date) - new Date(a.date)); // 日付降順で最新を手前に表示

    const totalAmount = allRecords.reduce((sum, r) => sum + Number(r.total || 0), 0);
    recordCountBadge.textContent = `${allRecords.length}件`;

    // Instagram Card Style Summary
    summaryContainer.innerHTML = `
      <div class="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-[10px] font-semibold tracking-wider uppercase text-neutral-400">
              青色申告 対象総支出
            </p>
            <h2 class="text-2xl font-black text-white mt-1 tracking-tight">¥${totalAmount.toLocaleString()}</h2>
          </div>
          <span class="text-[11px] bg-neutral-800 text-neutral-300 px-2.5 py-1 rounded-full font-medium">
            ${allRecords.length} 投稿 / 仕訳
          </span>
        </div>
      </div>
    `;

    if (currentFilter === "all") {
      analyticsBreakdown.classList.add("hidden");
    } else {
      analyticsBreakdown.classList.remove("hidden");
      renderAnalyticsBreakdown(allRecords);
    }

    if (allRecords.length === 0) {
      recordsContainer.innerHTML = `
        <div class="text-center py-14 px-4 border border-dashed border-neutral-800 rounded-xl bg-neutral-950">
          <i data-lucide="receipt" class="w-8 h-8 text-neutral-600 mx-auto mb-2"></i>
          <p class="text-xs font-medium text-neutral-400">記帳されたレシートがありません</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    // Instagram Feed Style List Item
    recordsContainer.innerHTML = allRecords.map(r => {
      const cleanDate = formatDisplayDate(r.date);
      let displayMemo = (r.memo || "").replace(new RegExp(`^${r.store}\\s*`, "i"), "").trim();
      if (!displayMemo) displayMemo = "内訳なし";

      return `
        <div class="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 hover:border-neutral-700 transition">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0 pr-2">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="text-xs font-bold text-white truncate">${r.store}</span>
                <span class="text-[10px] px-2 py-0.5 rounded font-medium bg-neutral-800 text-neutral-300">
                  ${r.category || '経費'}
                </span>
                <span class="text-[10px] px-2 py-0.5 rounded font-medium bg-neutral-800 text-neutral-400">
                  ${r.paymentMethod || '現金'}
                </span>
              </div>
              <p class="text-xs text-neutral-300 font-medium mt-1 truncate">${displayMemo}</p>
              <div class="text-[10px] text-neutral-500 mt-1.5">${cleanDate}</div>
            </div>
            <div class="text-right flex flex-col justify-between items-end">
              <span class="text-sm font-bold text-white tracking-tight">¥${Number(r.total).toLocaleString()}</span>
              <button class="btn-delete-record text-neutral-500 hover:text-rose-400 p-1 mt-2 transition" data-id="${r.id}" title="削除">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    lucide.createIcons();

    document.querySelectorAll(".btn-delete-record").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        if (confirm("この記録を削除しますか？")) {
          AppStorage.deleteRecord(id);
          renderAllViews();
        }
      });
    });
  }

  function renderAnalyticsBreakdown(records) {
    const grouped = {};
    records.forEach(r => {
      let key = "その他";
      const cleanDate = formatDisplayDate(r.date);
      if (currentFilter === "month") {
        key = cleanDate.substring(0, 7) + "月";
      } else if (currentFilter === "week") {
        const d = new Date(cleanDate);
        const onejan = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
        key = `${d.getFullYear()}年 第${week}週`;
      } else if (currentFilter === "store") {
        key = r.store || "不明店";
      } else if (currentFilter === "category") {
        key = r.category || "未分類";
      }
      grouped[key] = (grouped[key] || 0) + Number(r.total || 0);
    });

    const sortedEntries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    const maxVal = sortedEntries.length > 0 ? sortedEntries[0][1] : 1;

    let html = `
      <div class="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
        <h4 class="text-xs font-bold text-neutral-300 mb-3 flex items-center justify-between">
          <span>集計</span>
          <span class="text-[10px] text-neutral-500 font-normal">合計: ¥${sortedEntries.reduce((s, e) => s + e[1], 0).toLocaleString()}</span>
        </h4>
        <div class="space-y-2.5">
    `;

    sortedEntries.forEach(([label, sum]) => {
      const percentage = Math.round((sum / (maxVal || 1)) * 100);
      html += `
        <div>
          <div class="flex justify-between items-center text-xs mb-1">
            <span class="text-neutral-300 font-medium truncate max-w-[200px]">${label}</span>
            <span class="text-white font-bold tracking-tight">¥${sum.toLocaleString()}</span>
          </div>
          <div class="w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
            <div class="bg-white h-1 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
          </div>
        </div>
      `;
    });
    html += `</div></div>`;
    analyticsBreakdown.innerHTML = html;
  }

  // スプレッドシート同期関数（スケルトン表示を適用）
  async function syncSheetsWithSkeleton() {
    const gasUrl = AppStorage.getGasUrl();
    if (!gasUrl) return;

    skeletonContainer.classList.remove("hidden");
    recordsContainer.classList.add("hidden");

    try {
      const ssRecords = await AppStorage.fetchFromGoogleSheets(currentMode);
      AppStorage.setAll(ssRecords);
      renderAllViews();
    } catch (err) {
      console.warn("Auto-sync failed:", err);
    } finally {
      skeletonContainer.classList.add("hidden");
      recordsContainer.classList.remove("hidden");
    }
  }

  btnSyncSheets.addEventListener("click", async () => {
    await syncSheetsWithSkeleton();
  });

  // レシート撮影（Particle Sphereを適用）
  cameraInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    loaderOverlay.classList.remove("hidden");
    particleSphere.start();
    document.getElementById("loader-text").textContent = "Gemini AIでレシートを解析中...";

    try {
      const extracted = await OCRProcessor.processImage(file);
      particleSphere.stop();
      loaderOverlay.classList.add("hidden");
      openEditModal(extracted);
    } catch (err) {
      particleSphere.stop();
      loaderOverlay.classList.add("hidden");
      alert(err.message || "レシートの読み取りに失敗しました。");
    } finally {
      cameraInput.value = "";
    }
  });

  function openEditModal(data) {
    formDate.value = formatDisplayDate(data.date);
    formStore.value = data.store || "";
    formMemo.value = data.memo || "";
    formPaymentMethod.value = data.paymentMethod || "現金";
    formBusinessCategory.value = data.suggestedCategory || "消耗品費";

    confirmedTotalAmount = Number(data.totalAmount || 0);
    currentWorkingItems = data.items ? [...data.items] : [];

    renderItemsTable();
    formTotalDisplay.textContent = `¥${confirmedTotalAmount.toLocaleString()}`;
    editModal.classList.remove("hidden");
  }

  function closeEditModal() {
    editModal.classList.add("hidden");
    currentWorkingItems = [];
    confirmedTotalAmount = 0;
  }

  function renderItemsTable() {
    itemsTableBody.innerHTML = "";
    currentWorkingItems.forEach((item, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="py-2 px-3">
          <input type="text" class="item-name-input w-full bg-transparent text-white focus:bg-neutral-800 rounded px-1.5 py-0.5 outline-none" value="${item.name}" data-index="${index}">
        </td>
        <td class="py-2 px-3">
          <input type="number" class="item-price-input w-full bg-transparent text-right font-medium text-white focus:bg-neutral-800 rounded px-1.5 py-0.5 outline-none" value="${item.price}" data-index="${index}">
        </td>
        <td class="py-2 px-2 text-center">
          <button type="button" class="btn-remove-item text-neutral-500 hover:text-rose-400 p-1" data-index="${index}">
            <i data-lucide="minus-circle" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      `;
      itemsTableBody.appendChild(tr);
    });

    lucide.createIcons();

    document.querySelectorAll(".item-name-input").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = e.target.getAttribute("data-index");
        currentWorkingItems[idx].name = e.target.value;
        syncMemoFromItems();
      });
    });

    document.querySelectorAll(".item-price-input").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = e.target.getAttribute("data-index");
        currentWorkingItems[idx].price = Number(e.target.value) || 0;
        recalcTotalFromUserAction();
      });
    });

    document.querySelectorAll(".btn-remove-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = btn.getAttribute("data-index");
        currentWorkingItems.splice(idx, 1);
        renderItemsTable();
        recalcTotalFromUserAction();
        syncMemoFromItems();
      });
    });
  }

  function recalcTotalFromUserAction() {
    const sum = currentWorkingItems.reduce((s, it) => s + Number(it.price || 0), 0);
    confirmedTotalAmount = sum;
    formTotalDisplay.textContent = `¥${confirmedTotalAmount.toLocaleString()}`;
  }

  function syncMemoFromItems() {
    formMemo.value = currentWorkingItems.map(it => it.name).filter(n => n.length > 0).join("、");
  }

  btnAddItemRow.addEventListener("click", () => {
    currentWorkingItems.push({ name: "新規品目", price: 0 });
    renderItemsTable();
  });

  modalBtnSave.addEventListener("click", async () => {
    const store = formStore.value.trim() || "不明店";

    const record = {
      mode: currentMode,
      date: formDate.value,
      store: store,
      memo: formMemo.value.trim(),
      items: currentWorkingItems,
      total: confirmedTotalAmount,
      category: formBusinessCategory.value,
      paymentMethod: formPaymentMethod.value
    };

    closeEditModal();
    // 保存中はスケルトンUIを表示して非同期処理
    skeletonContainer.classList.remove("hidden");
    recordsContainer.classList.add("hidden");

    try {
      await AppStorage.saveRecord(record);
      await syncSheetsWithSkeleton();
    } catch (e) {
      alert("保存に失敗しました: " + e.message);
    } finally {
      skeletonContainer.classList.add("hidden");
      recordsContainer.classList.remove("hidden");
      renderAllViews();
    }
  });

  modalBtnClose.addEventListener("click", closeEditModal);
  modalBtnCancel.addEventListener("click", closeEditModal);

  tabBusiness.addEventListener("click", () => setMode("business"));
  tabPersonal.addEventListener("click", () => setMode("personal"));

  btnSyncSettings.addEventListener("click", () => {
    settingGasUrl.value = AppStorage.getGasUrl();
    settingVisionKey.value = AppStorage.getVisionKey();
    settingsModal.classList.remove("hidden");
  });
  settingsBtnClose.addEventListener("click", () => settingsModal.classList.add("hidden"));
  settingsBtnSave.addEventListener("click", () => {
    AppStorage.setGasUrl(settingGasUrl.value);
    AppStorage.setVisionKey(settingVisionKey.value);
    settingsModal.classList.add("hidden");
    alert("設定を保存しました。");
    syncSheetsWithSkeleton();
  });

  btnExportCsv.addEventListener("click", () => {
    AppStorage.exportToCsv(currentMode);
  });

  initDropdowns();
  setMode("business");

  // ★ アプリを開いた時にスプレッドシートから自動同期を実行
  syncSheetsWithSkeleton();
});
