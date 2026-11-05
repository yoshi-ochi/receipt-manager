/**
 * Receipt OCR Processor
 */
const OCRProcessor = {
  async processImage(file) {
    const apiKey = AppStorage.getVisionKey();
    if (!apiKey) {
      alert("Gemini API キーが未設定です。\n右上の歯車設定からGoogle AI Studioで取得したAPIキーを入力してください。");
      throw new Error("Gemini API key is not configured");
    }

    const base64Data = await this.encodeImageToBase64(file, 1600);

    // 新設モジュール GeminiClient を呼び出し
    const result = await GeminiClient.analyzeReceipt(base64Data, apiKey);

    return {
      date: result.date || new Date().toISOString().split("T")[0],
      store: result.store || "不明店",
      totalAmount: Number(result.totalAmount) || 0,
      paymentMethod: result.paymentMethod || "現金",
      suggestedCategory: result.suggestedCategory || "消耗品費",
      suggestedGenre: "日用品・消耗品",
      items: Array.isArray(result.items) ? result.items : [],
      memo: result.memo || ""
    };
  },

  encodeImageToBase64(file, maxDimension) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxDimension || h > maxDimension) {
            if (w > h) {
              h = Math.round((h * maxDimension) / w);
              w = maxDimension;
            } else {
              w = Math.round((w * maxDimension) / h);
              h = maxDimension;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82).split(",")[1]);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};
window.OCRProcessor = OCRProcessor;
