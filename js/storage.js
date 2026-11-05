const AppStorage = {
  getAll() {
    try {
      const data = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.RECORDS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async saveRecord(record) {
    const list = this.getAll();
    record.id = "rec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
    record.createdAt = new Date().toISOString();
    list.unshift(record);
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.RECORDS, JSON.stringify(list));

    const gasUrl = this.getGasUrl();
    if (gasUrl) {
      this.syncToGoogleSheets(record, gasUrl).catch(err => {
        console.warn("Google Sheets Sync warning:", err);
      });
    }

    return record;
  },

  deleteRecord(id) {
    let list = this.getAll();
    list = list.filter(r => r.id !== id);
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.RECORDS, JSON.stringify(list));
  },

  getGasUrl() {
    return localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GAS_URL) || "";
  },

  setGasUrl(url) {
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.GAS_URL, url.trim());
  },

  getGeminiKey() {
    return localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GEMINI_KEY) || "";
  },

  setGeminiKey(key) {
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.GEMINI_KEY, key.trim());
  },

  async syncToGoogleSheets(record, gasUrl) {
    const payload = {
      type: record.mode,
      date: record.date,
      store: record.store,
      total: record.total,
      category: record.category || "",
      genre: record.genre || "",
      memo: record.memo || "",
      items: record.items || []
    };

    await fetch(gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  },

  exportToCsv(mode = "business") {
    const records = this.getAll().filter(r => r.mode === mode);
    if (records.length === 0) {
      alert("エクスポートするデータがありません。");
      return;
    }

    let csvContent = "\uFEFF";

    if (mode === "business") {
      const headers = ["日付", "店舗/取引先", "摘要", "売上", "雑収入等", "仕入", ...APP_CONFIG.BLUE_TAX_COLUMNS.slice(4).map(c => c.name)];
      csvContent += headers.join(",") + "\n";

      records.forEach(r => {
        const row = [
          r.date,
          `"${r.store.replace(/"/g, '""')}"`,
          `"${(r.memo || "").replace(/"/g, '""')}"`,
          r.category === "売上" ? r.total : "",
          r.category === "雑収入等" ? r.total : "",
          r.category === "仕入" ? r.total : ""
        ];

        APP_CONFIG.BLUE_TAX_COLUMNS.slice(4).forEach(col => {
          row.push(r.category === col.name ? r.total : "");
        });
        csvContent += row.join(",") + "\n";
      });
    } else {
      csvContent += "日付,店舗名,ジャンル,合計金額,購入内訳,メモ\n";
      records.forEach(r => {
        const itemStr = (r.items || []).map(i => `${i.name}(¥${i.price})`).join("; ");
        csvContent += [
          r.date,
          `"${r.store.replace(/"/g, '""')}"`,
          `"${r.genre || ""}"`,
          r.total,
          `"${itemStr.replace(/"/g, '""')}"`,
          `"${(r.memo || "").replace(/"/g, '""')}"`
        ].join(",") + "\n";
      });
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `receipt_${mode}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
