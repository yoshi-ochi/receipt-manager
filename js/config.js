/**
 * 青色申告決算書（一般用）ラベル体系＆家計簿設定
 */
const APP_CONFIG = {
  BLUE_TAX_COLUMNS: [
    { id: "desc", name: "摘要" },
    { id: "sales", name: "売上", type: "income" },
    { id: "misc_income", name: "雑収入等", type: "income" },
    { id: "purchases", name: "仕入", type: "cost" },
    { id: "tax_dues", name: "租税公課", type: "expense" },
    { id: "packing_freight", name: "荷造運賃", type: "expense" },
    { id: "utilities", name: "水道光熱費", type: "expense" },
    { id: "travel_transport", name: "旅費交通費", type: "expense" },
    { id: "communication", name: "通信費", type: "expense" },
    { id: "advertising", name: "広告宣伝費", type: "expense" },
    { id: "entertainment", name: "接待交際費", type: "expense" },
    { id: "insurance", name: "損害保険料", type: "expense" },
    { id: "repairs", name: "修繕費", type: "expense" },
    { id: "supplies", name: "消耗品費", type: "expense" },
    { id: "depreciation", name: "減価償却費", type: "expense" },
    { id: "welfare", name: "福利厚生費", type: "expense" },
    { id: "salaries", name: "給料賃金", type: "expense" },
    { id: "outsourcing", name: "外注工賃", type: "expense" },
    { id: "interest_discount", name: "利子割引料", type: "expense" },
    { id: "rent", name: "地代家賃", type: "expense" },
    { id: "bad_debts", name: "貸倒金", type: "expense" },
    { id: "miscellaneous", name: "雑費", type: "expense" }
  ],

  PERSONAL_GENRES: [
    "食料品・スーパー",
    "外食・カフェ",
    "日用品・消耗品",
    "趣味・教養・娯楽",
    "交通費",
    "衣類・美容",
    "医療・健康",
    "その他"
  ],

  STORAGE_KEYS: {
    RECORDS: "receipt_app_records_v1",
    GAS_URL: "receipt_app_gas_url_v1"
  }
};
