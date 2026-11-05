/**
 * LocalStorage & Google Sheets Data Synchronization (Standard JSON API)
 */
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

  clearRecords() {
    localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.RECORDS);
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

  /**
   * スプレッドシートへJSONデータをPOST保存
   * ※CORSプリフライト（OPTIONS）遮断を回避するためtext/plainでJSON文字列を送信
   */
  async syncToGoogleSheets(record, gasUrl) {
    const payload = {
      action: "save",
      mode: record.mode,
      type: record.mode,
      date: record.date,
      store: record.store,
      total: record.total,
      category: record.category || "",
      genre: record.genre || "",
      memo: record.memo || "",
      items: record.items || []
    };

    try {
      const response = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      console.log("Record synced to Google Sheets.");
      return response;
    } catch (err) {
      console.warn("Google Sheets Sync fetch warning:", err);
    }
  },

  /**
   * スプレッドシートから全履歴を標準JSON形式でGET取得
   */
  async fetchFromGoogleSheets(mode = "business") {
    const gasUrl = this.getGasUrl();
    if (!gasUrl) {
      throw new Error("スプレッドシート（GAS）のURLが未設定です。右上の設定からURLを登録してください。");
    }

    const sep = gasUrl.includes("?") ? "&" : "?";
    const fetchUrl = `${gasUrl}${sep}mode=${mode}&_t=${Date.now()}`;

    const response = await fetch(fetchUrl, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: スプレッドシートからのデータ取得に失敗しました`);
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
