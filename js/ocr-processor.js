/**
 * Receipt OCR & Data Extraction Pipeline (GAS + Gemini API 連動版)
 */
const OCRProcessor = {
  async processImage(file) {
    const gasUrl = AppStorage.getGasUrl();
    if (!gasUrl) {
      alert("Googleスプレッドシート（GAS）のURLが設定されていません。\n右上のシート設定アイコンからURLを登録してください。");
      throw new Error("GAS URL is not configured");
    }

    // 画像のリサイズ・Base64変換（通信負荷軽減のため長辺1200pxに圧縮）
    const { base64, mimeType } = await this.resizeAndEncode(file, 1200);

    const payload = {
      action: "ocr",
      base64Image: base64,
      mimeType: mimeType
    };

    const response = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // GASのCORSプリフライト回避のためtext/plain指定
      body: JSON.stringify(payload)
    });

    const resJson = await response.json();
    if (resJson.status !== "success") {
      throw new Error(resJson.message || "OCR解析に失敗しました");
    }

    const data = resJson.data;

    return {
      date: data.date || new Date().toISOString().split('T')[0],
      store: data.store || "不明店",
      items: data.items && data.items.length > 0 ? data.items : [{ name: "合算品目", price: data.totalAmount || 0 }],
      totalAmount: Number(data.totalAmount || 0),
      suggestedCategory: data.suggestedCategory || "消耗品費",
      suggestedGenre: data.suggestedGenre || "その他",
      memo: data.memo || `${data.store || ""} レシート`
    };
  },

  // クライアント側で画像を縮小してBase64を抽出
  resizeAndEncode(file, maxDimension) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          const mimeType = "image/jpeg";
          const dataUrl = canvas.toDataURL(mimeType, 0.85);
          const base64 = dataUrl.split(",")[1];
          resolve({ base64, mimeType });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};
