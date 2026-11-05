const OCRProcessor = {
  async processImage(file) {
    // 擬似読取ディレイ
    await new Promise(resolve => setTimeout(resolve, 2400));

    const today = new Date().toISOString().split('T')[0];
    const sampleVendors = ["セブン-イレブン", "ヨドバシカメラ", "スーパーライフ", "無印良品", "スターバックス"];
    const randomStore = sampleVendors[Math.floor(Math.random() * sampleVendors.length)];

    let parsedItems = [];
    let suggestedCategory = "消耗品費";
    let suggestedGenre = "日用品・消耗品";

    if (randomStore.includes("セブン")) {
      parsedItems = [
        { name: "ドリップコーヒー R", price: 150 },
        { name: "サンドイッチ", price: 340 }
      ];
      suggestedCategory = "雑費";
      suggestedGenre = "外食・カフェ";
    } else if (randomStore.includes("ヨドバシ")) {
      parsedItems = [
        { name: "USB Type-C ケーブル 1m", price: 1280 },
        { name: "コピー用紙 A4 500枚", price: 580 }
      ];
      suggestedCategory = "消耗品費";
      suggestedGenre = "趣味・教養・娯楽";
    } else {
      parsedItems = [
        { name: "文房具・事務用品", price: 420 },
        { name: "ノート", price: 280 }
      ];
      suggestedCategory = "消耗品費";
      suggestedGenre = "日用品・消耗品";
    }

    const total = parsedItems.reduce((sum, item) => sum + item.price, 0);

    return {
      date: today,
      store: randomStore,
      items: parsedItems,
      totalAmount: total,
      suggestedCategory: suggestedCategory,
      suggestedGenre: suggestedGenre,
      memo: `${randomStore}にて購入`
    };
  }
};
