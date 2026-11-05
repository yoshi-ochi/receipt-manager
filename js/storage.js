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

  setAll(records) {
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.RECORDS, JSON.stringify(records));
  },

  async saveRecord(record) {
    const list = this.getAll();
    record.id = "rec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
    record.createdAt = new Date().toISOString();
    list.unshift(record);
    this.setAll(list);

    const gasUrl = this.getGasUrl();
    if (gasUrl) {
      await this.syncToGoogleSheets(record, gasUrl);
    }
    return record;
  },

  deleteRecord(id) {
    let list = this.getAll();
    list = list.filter(r => r.id !== id);
    this.setAll(list);
  },

  getGasUrl() {
    return localStorage.getItem(APP_CONFIG.STORAGE_KEYS.GAS_URL) || "";
  },

  setGasUrl(url) {
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.GAS_URL, url.trim());
  },

  getVisionKey() {
    return localStorage.getItem(APP_CONFIG.STORAGE_KEYS.VISION_KEY) || "";
  },

  setVisionKey(key) {
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.VISION_KEY, key.trim());
  },

  async syncToGoogleSheets(record, gasUrl) {
    const payload = {
      action: "save",
      mode: record.mode,
      date: record.date,
      store: record.store,
      total: record.total,
      category: record.category || "消耗品費",
      paymentMethod: record.paymentMethod || "現金",
      memo: record.memo || "",
      items: record.items || []
    };

    try {
      await fetch(gasUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      console.log("Successfully sent to GAS via no-cors.");
    } catch (err) {
      console.warn("GAS Sync fetch warning:", err);
    }
  },

  async fetchFromGoogleSheets(mode = "business") {
    const gasUrl = this.getGasUrl();
    if (!gasUrl) {
      throw new Error("スプレッドシート（GAS）のURLが未設定です。");
    }

    const sep = gasUrl.includes("?") ? "&" : "?";
    const fetchUrl = `${gasUrl}${sep}mode=${mode}&_t=${Date.now()}`;

    const response = await fetch(fetchUrl, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: スプレッドシートからの取得に失敗しました`);
    }

    const result = await response.json();
    if (result.status !== "success") {
      throw new Error(result.message || "データ取得に失敗しました");
    }

    return result.records || [];
  },

  exportToCsv(mode = "business") {
    const records = this.getAll().filter(r => r.mode === mode);
    if (records.length === 0) {
      alert("エクスポートするデータがありません。");
      return;
    }

    let csvContent = "\uFEFF";
    csvContent += "取引日,借方科目（費用）,決済手段,金額,取引先/店舗,摘要/内訳\n";

    records.forEach(r => {
      csvContent += [
        r.date,
        `"${r.category || ""}"`,
        `"${r.paymentMethod || "現金"}"`,
        r.total,
        `"${r.store.replace(/"/g, '""')}"`,
        `"${(r.memo || "").replace(/"/g, '""')}"`
      ].join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `journal_${mode}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
