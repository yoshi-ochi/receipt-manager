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

  // mode: "no-cors" で送信し、CORSエラーを完全に回避してスプシに保存
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
      await fetch(gasUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      console.log("Successfully sent data to Google Sheets via no-cors mode.");
    } catch (err) {
      console.warn("GAS Sync fetch error:", err);
    }
  },

  // JSONP方式でCORS制限を受けずにスプシ履歴を全件取得
  fetchFromGoogleSheets(mode = "business") {
    const gasUrl = this.getGasUrl();
    if (!gasUrl) {
      return Promise.reject(new Error("スプレッドシート（GAS）のURLが未設定です。"));
    }

    return new Promise((resolve, reject) => {
      const callbackName = "gas_callback_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("スプレッドシートの取得がタイムアウトしました。"));
      }, 15000);

      function cleanup() {
        clearTimeout(timeout);
        if (script.parentNode) script.parentNode.removeChild(script);
        delete window[callbackName];
      }

      window[callbackName] = (res) => {
        cleanup();
        if (res && res.status === "success") {
          resolve(res.records || []);
        } else {
          reject(new Error(res ? res.message : "データ取得に失敗しました。"));
        }
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("GASスクリプトの読み込みに失敗しました。URLまたはアクセス権限をご確認ください。"));
      };

      const sep = gasUrl.includes("?") ? "&" : "?";
      script.src = `${gasUrl}${sep}mode=${mode}&callback=${callbackName}&_=${Date.now()}`;
      document.body.appendChild(script);
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
