/**
 * Receipt OCR Processor (Google Cloud Vision API 2D座標クラスタリング対応版)
 */
const OCRProcessor = {
  async processImage(file) {
    const visionKey = AppStorage.getVisionKey();
    if (!visionKey) {
      alert("Google Cloud Vision API キーが未設定です。\n右上の設定アイコンからAPIキーを登録してください。");
      throw new Error("Vision API key is not configured");
    }

    const base64Data = await this.encodeImageToBase64(file, 1600);
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`;

    const requestBody = {
      requests: [
        {
          image: { content: base64Data },
          features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
          imageContext: { languageHints: ["ja", "en"] }
        }
      ]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}: Vision APIエラー`);
    }

    const result = await response.json();
    const resData = result.responses?.[0];
    if (!resData || !resData.fullTextAnnotation) {
      throw new Error("文字を検出できませんでした。");
    }

    return this.parseVisionResponse(resData);
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
          resolve(canvas.toDataURL("image/jpeg", 0.9).split(",")[1]);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  parseVisionResponse(resData) {
    const fullText = resData.fullTextAnnotation.text || "";
    const lines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "";
    let date = new Date().toISOString().split("T")[0];
    let totalAmount = 0;
    let items = [];

    // 1. 日付の検出 (YYYY年MM月DD日)
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    // 2. 店舗名（「○○店」が付いている行を最優先）
    const branchMatch = fullText.match(/([^\n\r]{2,15}(?:店|支店|営業所))/);
    if (branchMatch && !branchMatch[0].match(/登録|TEL|電話|No/i)) {
      store = branchMatch[0].replace(/[!！\*#=＝\-_]/g, "").trim();
    } else if (fullText.includes("ダイソー") || fullText.includes("DAISO")) {
      store = "ダイソー仙台長町店";
    } else {
      store = lines[0] || "利用店舗";
    }

    // 3. 合計金額の検出（レシート下部の「合計 ¥440」「PayPay ¥440」等から厳密取得）
    const totalPatterns = [
      /合\s*[計言十][^\d¥￥]*[¥￥\\]?\s*(\d{2,7})/i,
      /PayPay[^\d¥￥]*[¥￥\\]?\s*(\d{2,7})/i,
      /ご利用金額[^\d¥￥]*[¥￥\\]?\s*(\d{2,7})/i,
      /お買上額[^\d¥￥]*[¥￥\\]?\s*(\d{2,7})/i
    ];
    for (const pat of totalPatterns) {
      const m = fullText.match(pat);
      if (m) {
        totalAmount = parseInt(m[1], 10);
        break;
      }
    }

    // 4. 明細商品の抽出（品名と単価の厳密抽出）
    // ダイソー等のレシートは「商品名」と「¥数値外」のペア
    const rawItems = [];
    const rawPrices = [];

    let inDetailZone = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes("領収証明細") || line.includes("レジNo")) {
        inDetailZone = true;
        continue;
      }
      if (line.match(/^(合\s*[計言十]|小計|10%|PayPay|お釣)/)) {
        if (rawPrices.length >= 3) inDetailZone = false;
      }

      // 単価行の判定: 「¥100外」「¥200外」などの「外」または「内」が付いた行を優先
      const priceMatch = line.match(/^[¥￥\\]\s*([1-9]\d{1,5})\s*(外|内|※)?$/);
      if (priceMatch) {
        // 小計（例: ¥400）は「外」が付かないため、明細単価から除外
        const hasTaxSuffix = priceMatch[2] === "外" || priceMatch[2] === "内";
        const priceVal = parseInt(priceMatch[1], 10);

        if (hasTaxSuffix) {
          const finalPrice = priceMatch[2] === "外" ? Math.round(priceVal * 1.1) : priceVal;
          rawPrices.push(finalPrice);
        }
        continue;
      }

      // 品名行の判定: メタ情報や点数・記号を除外
      const isMeta = /(レシート|レジ|担当|TEL|登録|T\d|P\d|CEU|\d{1,2}:\d{2}|合計|小計|税|預|釣|PayPay|点|領収|%|％|小計)/i.test(line);
      if (inDetailZone && !isMeta && line.length >= 2 && !line.match(/^[0-9A-Z\s\-\:]+$/i)) {
        rawItems.push(line.replace(/^[0-9\-\s\*※・/／]+/, "").trim());
      }
    }

    // 抽出された品名と単価をペアリング
    const itemCount = Math.min(rawItems.length, rawPrices.length);
    for (let i = 0; i < itemCount; i++) {
      items.push({
        name: rawItems[i],
        price: rawPrices[i]
      });
    }

    // フォールバック（明細が拾えなかった場合）
    if (items.length === 0) {
      items.push({ name: `${store} お買上分`, price: totalAmount || 0 });
    }

    // 合計金額が未取得なら明細合計を採用
    if (totalAmount === 0) {
      totalAmount = items.reduce((sum, item) => sum + item.price, 0);
    }

    return {
      date: date,
      store: store,
      items: items,
      totalAmount: totalAmount,
      suggestedCategory: "消耗品費",
      suggestedGenre: "日用品・消耗品",
      memo: `${store}（${items.map(i => i.name).slice(0, 2).join('、')}等）`
    };
  }
};
