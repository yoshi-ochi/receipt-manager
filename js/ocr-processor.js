/**
 * Receipt OCR Processor (Google Cloud Vision API + 日本レシート・ダイソー特化パーサー)
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
      throw new Error("文字を検出できませんでした。もう少し明るい場所で正面から撮影してください。");
    }

    console.log("=== Cloud Vision Raw Text ===");
    console.log(annotation.text);

    return this.parseDaisoReceipt(annotation.text);
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
              w = Math.round((width * maxDimension) / height);
              height = maxDimension;
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

  parseDaisoReceipt(fullText) {
    const lines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "ダイソー";
    let date = new Date().toISOString().split("T")[0];
    let totalAmount = 0;
    let items = [];

    // 1. 日付の検出 (2026年10月26日 など)
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    // 2. 店舗名（DAISO / だんぜん!ダイソー / 支店名）
    const storeBranchMatch = fullText.match(/ダイソー[^\n\r]*店/);
    if (storeBranchMatch) {
      store = storeBranchMatch[0].trim();
    } else if (fullText.includes("ダイソー") || fullText.includes("DAISO")) {
      store = "ダイソー";
    }

    // 3. 合計金額の検出（「合計」「合言十」「ご請求」「ご利用金額」「PayPay... ¥440」等）
    const totalRegex = /(合\s*[計言十]|ご利用金額|PayPay|クレジット|現\s*金)[^\d¥￥]*[¥￥\\]?\s*(\d{2,7})/i;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const m = line.match(totalRegex);
      if (m && !line.match(/対象|税/)) {
        const val = parseInt(m[2], 10);
        if (val > 0 && val < 500000) {
          totalAmount = val;
          break;
        }
      }
    }

    // 「¥440-」などの手書き・領収証金額表記からのフォールバック
    if (totalAmount === 0) {
      const markMatch = fullText.match(/[¥￥\\]\s*(\d{2,7})\s*[\-ー]/);
      if (markMatch) {
        totalAmount = parseInt(markMatch[1], 10);
      }
    }

    // 4. 明細商品の検出
    // パターン: 「ガラスキャニスター (ステ ¥100外」や「ワイヤーネットかご (横型 ¥100外」
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // 管理番号行、バーコード、インボイス番号、上部領収書エリアの遮断
      if (line.match(/(No\.|レジ|担当|TEL|電話|登録番号|T\d{7,13}|P\d{6,}|CEU\d|伝票|小計|合計|合言十|対象|お釣|お預|PayPay|売上)/i)) {
        continue;
      }

      // 金額を含む明細行マッチング（「¥100外」「¥200」「100円」など）
      const itemMatch = line.match(/^(.*?)[¥￥\\]?\s*([1-9]\d{1,5})\s*(外|内|円|※)?$/);

      if (itemMatch) {
        let name = itemMatch[1].trim();
        let price = parseInt(itemMatch[2], 10);

        // 不要記号の除去
        name = name.replace(/^[\-—―\*※・/／\s\d]+/, "").replace(/[\-—―\*※/／\s]+$/, "").trim();

        // 品名として妥当（2文字以上かつ管理英数字でない）
        if (name.length >= 2 && !name.match(/^[A-Z0-9\-\.\:]+$/i)) {
          // 税抜表記の場合は10%税込に補正（ダイソーの100外→110円、200外→220円）
          if (line.includes("外")) {
            price = Math.round(price * 1.1);
          }
          items.push({ name: name, price: price });
        }
      }
    }

    // 合計金額が拾えていて明細合計と一致しない場合や、明細が空の場合の補完
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
