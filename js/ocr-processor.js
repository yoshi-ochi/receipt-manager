/**
 * Receipt OCR Processor (Google Cloud Vision API + 日本レシート・ブロック分離対応パーサー)
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
    const annotation = result.responses?.[0]?.fullTextAnnotation;
    if (!annotation || !annotation.text) {
      throw new Error("文字を検出できませんでした。");
    }

    return this.parseSmartReceipt(annotation.text);
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

  parseSmartReceipt(fullText) {
    const lines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "";
    let date = new Date().toISOString().split("T")[0];
    let totalAmount = 0;
    let items = [];

    // 1. 日付の検出
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    // 2. 店舗名の抽出
    const storeMatch = fullText.match(/(ダイソー[^\n\r]*店|DAISO[^\n\r]*|だんぜん!ダイソー)/i);
    if (storeMatch) {
      store = storeMatch[0].trim();
    } else {
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        if (!lines[i].match(/領収|レシート|No|TEL|電話|登録|20\d{2}/i) && lines[i].length >= 2) {
          store = lines[i];
          break;
        }
      }
    }
    if (!store) store = "利用店舗";

    // 3. 合計金額の検出（合計、PayPay、ご利用金額の直後の「¥440」等）
    const totalRegex = /(合\s*[計言十]|ご利用金額|PayPay|クレジット|現\s*金|お買上額|ご請求)[^\d¥￥]*[¥￥\\]\s*(\d{2,7})/i;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const m = line.match(totalRegex);
      if (m && !line.match(/対象|税/)) {
        totalAmount = parseInt(m[2], 10);
        break;
      }
    }
    // 単体の「¥440」で合計近くにあるものをフォールバック
    if (totalAmount === 0) {
      const allYen = [...fullText.matchAll(/[¥￥\\]\s*(\d{2,7})/g)];
      if (allYen.length > 0) {
        // 末尾付近の代表値を採用
        totalAmount = parseInt(allYen[allYen.length - 1][1], 10);
      }
    }

    // 4. 明細・品名と金額の抽出（同一行パターン ＋ 別行分離パターンの両方に対応）
    // メタ情報・管理番号・時刻のフィルター
    const isMeta = (str) => {
      return /(レシート\s*No|レジ\s*No|伝票|端末|取引|係|担当|TEL|電話|登録番号|T\d{7,13}|P\d{6,}|CEU\d|\d{1,2}:\d{2}|合計|小計|税|預|釣|PayPay|点|領収)/i.test(str);
    };

    // (A) 同一行に品名と「¥金額」がある場合
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isMeta(line)) continue;

      const m = line.match(/^(.*?)[¥￥\\]\s*([1-9]\d{1,5})\s*(外|内|円|※)?$/);
      if (m) {
        let name = m[1].replace(/^[0-9\-\s\*※・/／]+/, "").trim();
        let price = parseInt(m[2], 10);
        if (m[3] === "外") price = Math.round(price * 1.1); // 税抜→税込10%換算
        if (name.length >= 2) {
          items.push({ name: name, price: price });
        }
      }
    }

    // (B) 品名リストと金額リストが別行に分かれている場合（ダイソーの認識パターン）
    if (items.length === 0) {
      const candidateNames = [];
      const candidatePrices = [];

      // <領収証明細> 以降の行を走査
      let inDetailZone = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("領収証明細") || line.includes("レジNo")) {
          inDetailZone = true;
          continue;
        }
        if (line.match(/^(合計|合言十|小計|PayPay)/)) {
          // 合計行に達したら終了
          if (candidatePrices.length > 0) break;
        }

        // 金額行（「¥100外」「¥200外」など）
        const priceMatch = line.match(/^[¥￥\\]\s*([1-9]\d{1,5})\s*(外|内|円)?$/);
        if (priceMatch) {
          let price = parseInt(priceMatch[1], 10);
          if (priceMatch[2] === "外") price = Math.round(price * 1.1);
          candidatePrices.push(price);
          continue;
        }

        // 品名行（管理番号や税・点数ではない日本語文字列）
        if (inDetailZone && !isMeta(line) && line.length >= 2 && !line.match(/^[0-9A-Z\s\-\:]+$/i)) {
          candidateNames.push(line.replace(/^[0-9\-\s\*※・/／]+/, "").trim());
        }
      }

      // 品名と金額を上から順に1対1でペアリング
      const count = Math.min(candidateNames.length, candidatePrices.length);
      for (let i = 0; i < count; i++) {
        items.push({ name: candidateNames[i], price: candidatePrices[i] });
      }
    }

    // 明細合計から合計額を補完
    if (totalAmount === 0 && items.length > 0) {
      totalAmount = items.reduce((sum, item) => sum + item.price, 0);
    }
    if (items.length === 0) {
      items.push({ name: `${store} お買上分`, price: totalAmount });
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
