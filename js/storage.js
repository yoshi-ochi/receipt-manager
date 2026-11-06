/**
 * Storage & Google Sheets Sync Module (Robust v2.0)
 */
const AppStorage = {
  STORAGE_KEY: "rm_receipt_records",
  GAS_URL_KEY: "rm_gas_url",
  VISION_KEY: "rm_gemini_api_key",

  getAll() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  setAll(records) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(records));
  },

  getGasUrl() {
    return localStorage.getItem(this.GAS_URL_KEY) || "";
  },

  setGasUrl(url) {
    localStorage.setItem(this.GAS_URL_KEY, url.trim());
  },

  getVisionKey() {
    return localStorage.getItem(this.VISION_KEY) || "";
  },

  setVisionKey(key) {
    localStorage.setItem(this.VISION_KEY, key.trim());
  },

  async saveRecord(record) {
    record.id = "local-" + Date.now();
    record.createdAt = new Date().toISOString();

    // ローカルへ先行保存
    const records = this.getAll();
    records.push(record);
    this.setAll(records);

    const gasUrl = this.getGasUrl();
    if (!gasUrl) return;

    try {
      const response = await fetch(gasUrl, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(record)
      });
      const res = await response.json().catch(() => ({}));
      if (res.status !== "success") {
        throw new Error(res.message || "スプレッドシートへの書き込みでエラーが返されました。");
      }
      console.log("[AppStorage] Successfully saved to Google Sheets:", res);
    } catch (err) {
      console.error("[AppStorage] Save error:", err);
      throw err;
    }
  },

  async fetchFromGoogleSheets() {
    const gasUrl = this.getGasUrl();
    if (!gasUrl) return [];

    try {
      const url = gasUrl + (gasUrl.includes("?") ? "&" : "?") + "mode=all&t=" + Date.now();
      const response = await fetch(url, { method: "GET", mode: "cors" });
      const json = await response.json();
      if (json.status === "success" && Array.isArray(json.data)) {
        return json.data;
      }
      return [];
    } catch (err) {
      console.error("[AppStorage] Fetch error:", err);
      return [];
    }
  },

  deleteRecord(id) {
    const records = this.getAll().filter(r => r.id !== id);
    this.setAll(records);
  },

  exportToCsv(mode = "business") {
    const records = this.getAll().filter(r => r.mode === mode);
    if (records.length === 0) {
      alert("エクスポート対象のデータがありません。");
      return;
    }
    const headers = ["取引日", "店舗名", "科目/ジャンル", "支払金額", "決済手段", "摘要・内訳"];
    const rows = records.map(r => [
      r.date,
      `"${(r.store || '').replace(/"/g, '""')}"`,
      r.category || r.genre || '',
      r.total,
      r.paymentMethod,
      `"${(r.memo || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt_records_${mode}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
};

window.AppStorage = AppStorage;
