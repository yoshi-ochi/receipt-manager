document.addEventListener("DOMContentLoaded", () => {
  let currentMode = "business";
  let currentWorkingItems = [];
  const particleSphere = new ParticleSphere("particle-sphere-canvas");

  const tabBusiness = document.getElementById("tab-business");
  const tabPersonal = document.getElementById("tab-personal");
  const recordsContainer = document.getElementById("records-container");
  const summaryContainer = document.getElementById("summary-container");
  const skeletonContainer = document.getElementById("skeleton-container");

  const loaderOverlay = document.getElementById("loader-overlay");
  const cameraInput = document.getElementById("camera-input");

  const editModal = document.getElementById("edit-modal");
  const modalBtnClose = document.getElementById("modal-btn-close");
  const modalBtnCancel = document.getElementById("modal-btn-cancel");
  const modalBtnSave = document.getElementById("modal-btn-save");
  const modalSubtitle = document.getElementById("modal-mode-subtitle");

  const formDate = document.getElementById("form-date");
  const formStore = document.getElementById("form-store");
  const formMemo = document.getElementById("form-memo");
  const formTotalDisplay = document.getElementById("form-total-display");
  const itemsTableBody = document.getElementById("items-table-body");
  const btnAddItemRow = document.getElementById("btn-add-item-row");

  const businessCategoryGroup = document.getElementById("business-category-group");
  const personalGenreGroup = document.getElementById("personal-genre-group");
  const formBusinessCategory = document.getElementById("form-business-category");
  const formPersonalGenre = document.getElementById("form-personal-genre");

  const btnSyncSettings = document.getElementById("btn-sync-settings");
  const settingsModal = document.getElementById("settings-modal");
  const settingsBtnClose = document.getElementById("settings-btn-close");
  const settingsBtnSave = document.getElementById("settings-btn-save");
  const settingGasUrl = document.getElementById("setting-gas-url");
  const btnExportCsv = document.getElementById("btn-export-csv");

  function initDropdowns() {
    formBusinessCategory.innerHTML = "";
    APP_CONFIG.BLUE_TAX_COLUMNS.slice(1).forEach(col => {
      const opt = document.createElement("option");
      opt.value = col.name;
      opt.textContent = `${col.name} (${col.type === 'expense' ? '経費' : '収入/原価'})`;
      formBusinessCategory.appendChild(opt);
    });

    formPersonalGenre.innerHTML = "";
    APP_CONFIG.PERSONAL_GENRES.forEach(g => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      formPersonalGenre.appendChild(opt);
    });
  }

  function setMode(mode) {
    currentMode = mode;
    if (mode === "business") {
      tabBusiness.className = "py-2 text-xs font-semibold rounded-lg transition-all duration-200 bg-indigo-600 text-white shadow-md";
      tabPersonal.className = "py-2 text-xs font-semibold rounded-lg transition-all duration-200 text-slate-400 hover:text-slate-200";
    } else {
      tabPersonal.className = "py-2 text-xs font-semibold rounded-lg transition-all duration-200 bg-cyan-600 text-white shadow-md";
      tabBusiness.className = "py-2 text-xs font-semibold rounded-lg transition-all duration-200 text-slate-400 hover:text-slate-200";
    }

    recordsContainer.classList.add("hidden");
    skeletonContainer.classList.remove("hidden");

    setTimeout(() => {
      skeletonContainer.classList.add("hidden");
      recordsContainer.classList.remove("hidden");
      renderRecords();
    }, 400);
  }

  function renderRecords() {
    const allRecords = AppStorage.getAll().filter(r => r.mode === currentMode);
    const totalAmount = allRecords.reduce((sum, r) => sum + Number(r.total || 0), 0);
    const count = allRecords.length;

    summaryContainer.innerHTML = `
      <div class="bg-gradient-to-br ${currentMode === 'business' ? 'from-indigo-900/40 via-slate-900 to-slate-900 border-indigo-500/30' : 'from-cyan-900/40 via-slate-900 to-slate-900 border-cyan-500/30'} border rounded-2xl p-4 shadow-xl">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-[11px] font-medium tracking-wide uppercase ${currentMode === 'business' ? 'text-indigo-400' : 'text-cyan-400'}">
              ${currentMode === 'business' ? '青色申告 対象経費・仕入合計' : '今月の支出合計 (個人用)'}
            </p>
            <h2 class="text-2xl font-black text-white mt-1">¥${totalAmount.toLocaleString()}</h2>
          </div>
          <span class="text-[11px] bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full border border-slate-700 font-medium">
            ${count} 件の記録
          </span>
        </div>
      </div>
    `;

    if (allRecords.length === 0) {
      recordsContainer.innerHTML = `
        <div class="text-center py-12 px-4 border border-dashed border-slate-800 rounded-2xl bg-slate-900/40">
          <i data-lucide="receipt" class="w-10 h-10 text-slate-600 mx-auto mb-2"></i>
          <p class="text-sm font-semibold text-slate-400">記録がまだありません</p>
          <p class="text-xs text-slate-500 mt-1">下のボタンからレシートを撮影して自動記帳を始めましょう</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    recordsContainer.innerHTML = allRecords.map(r => {
      const itemsPreview = (r.items || []).map(i => `${i.name} (¥${i.price})`).join(", ");
      return `
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-3.5 hover:border-slate-700 transition">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0 pr-2">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs font-bold text-white truncate">${r.store}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  currentMode === 'business' ? 'bg-indigo-950 text-indigo-300 border border-indigo-800/60' : 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                }">
                  ${currentMode === 'business' ? r.category : r.genre}
                </span>
              </div>
              <p class="text-[11px] text-slate-400 truncate">${itemsPreview || '明細なし'}</p>
              ${r.memo ? `<p class="text-[10px] text-slate-500 mt-0.5 italic">摘要: ${r.memo}</p>` : ''}
              <div class="text-[10px] text-slate-500 mt-1.5">${r.date}</div>
            </div>
            <div class="text-right flex flex-col justify-between items-end">
              <span class="text-base font-bold text-white tracking-tight">¥${Number(r.total).toLocaleString()}</span>
              <button class="btn-delete-record text-slate-500 hover:text-rose-400 p-1 mt-2 transition" data-id="${r.id}" title="削除">
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
          renderRecords();
        }
      });
    });
  }

  cameraInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    loaderOverlay.classList.remove("hidden");
    particleSphere.start();

    try {
      const extracted = await OCRProcessor.processImage(file);
      particleSphere.stop();
      loaderOverlay.classList.add("hidden");
      openEditModal(extracted);
    } catch (err) {
      particleSphere.stop();
      loaderOverlay.classList.add("hidden");
      alert(err.message || "レシートの読み取りに失敗しました。");
      console.error(err);
    } finally {
      cameraInput.value = "";
    }
  });

  function openEditModal(data) {
    formDate.value = data.date || new Date().toISOString().split('T')[0];
    formStore.value = data.store || "";
    formMemo.value = data.memo || "";
    currentWorkingItems = data.items ? [...data.items] : [];

    if (currentMode === "business") {
      businessCategoryGroup.classList.remove("hidden");
      personalGenreGroup.classList.add("hidden");
      formBusinessCategory.value = data.suggestedCategory || "消耗品費";
      modalSubtitle.textContent = "青色申告決算科目への割り当て";
    } else {
      businessCategoryGroup.classList.add("hidden");
      personalGenreGroup.classList.remove("hidden");
      formPersonalGenre.value = data.suggestedGenre || "食料品・スーパー";
      modalSubtitle.textContent = "個人用家計簿ジャンルの設定";
    }

    renderItemsTable();
    editModal.classList.remove("hidden");
  }

  function closeEditModal() {
    editModal.classList.add("hidden");
    currentWorkingItems = [];
  }

  function renderItemsTable() {
    itemsTableBody.innerHTML = "";
    let total = 0;

    currentWorkingItems.forEach((item, index) => {
      total += Number(item.price || 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="py-1.5 px-3">
          <input type="text" class="item-name-input w-full bg-transparent text-white focus:bg-slate-800 rounded px-1.5 py-0.5 outline-none" value="${item.name}" data-index="${index}">
        </td>
        <td class="py-1.5 px-3">
          <input type="number" class="item-price-input w-full bg-transparent text-right font-medium text-white focus:bg-slate-800 rounded px-1.5 py-0.5 outline-none" value="${item.price}" data-index="${index}">
        </td>
        <td class="py-1.5 px-2 text-center">
          <button type="button" class="btn-remove-item text-slate-500 hover:text-rose-400 p-1" data-index="${index}">
            <i data-lucide="minus-circle" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      `;
      itemsTableBody.appendChild(tr);
    });

    formTotalDisplay.textContent = `¥${total.toLocaleString()}`;
    lucide.createIcons();

    document.querySelectorAll(".item-name-input").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = e.target.getAttribute("data-index");
        currentWorkingItems[idx].name = e.target.value;
      });
    });

    document.querySelectorAll(".item-price-input").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = e.target.getAttribute("data-index");
        currentWorkingItems[idx].price = Number(e.target.value) || 0;
        recalcTotal();
      });
    });

    document.querySelectorAll(".btn-remove-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = btn.getAttribute("data-index");
        currentWorkingItems.splice(idx, 1);
        renderItemsTable();
      });
    });
  }

  function recalcTotal() {
    const total = currentWorkingItems.reduce((sum, item) => sum + Number(item.price || 0), 0);
    formTotalDisplay.textContent = `¥${total.toLocaleString()}`;
  }

  btnAddItemRow.addEventListener("click", () => {
    currentWorkingItems.push({ name: "新規品目", price: 0 });
    renderItemsTable();
  });

  modalBtnSave.addEventListener("click", async () => {
    const total = currentWorkingItems.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const store = formStore.value.trim() || "不明店";

    const record = {
      mode: currentMode,
      date: formDate.value,
      store: store,
      memo: formMemo.value.trim(),
      items: currentWorkingItems,
      total: total,
      category: currentMode === "business" ? formBusinessCategory.value : null,
      genre: currentMode === "personal" ? formPersonalGenre.value : null
    };

    await AppStorage.saveRecord(record);
    closeEditModal();
    renderRecords();
  });

  modalBtnClose.addEventListener("click", closeEditModal);
  modalBtnCancel.addEventListener("click", closeEditModal);

  tabBusiness.addEventListener("click", () => setMode("business"));
  tabPersonal.addEventListener("click", () => setMode("personal"));

  btnSyncSettings.addEventListener("click", () => {
    settingGasUrl.value = AppStorage.getGasUrl();
    settingsModal.classList.remove("hidden");
  });
  settingsBtnClose.addEventListener("click", () => settingsModal.classList.add("hidden"));
  settingsBtnSave.addEventListener("click", () => {
    AppStorage.setGasUrl(settingGasUrl.value);
    settingsModal.classList.add("hidden");
    alert("スプレッドシート連携URLを保存しました。");
  });

  btnExportCsv.addEventListener("click", () => {
    AppStorage.exportToCsv(currentMode);
  });

  initDropdowns();
  setMode("business");
});
