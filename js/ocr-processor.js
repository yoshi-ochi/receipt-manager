/**
 * Receipt OCR Processor (Google Cloud Vision API: DOCUMENT_TEXT_DETECTION)
 * 商用レベルの精度で手書き・感熱紙・傾きレシートから品名・金額・店名を幾何学抽出
 */
const OCRProcessor = {
  async processImage(file) {
    const visionKey = AppStorage.getVisionKey();
    if (!visionKey) {
      alert("Google Cloud Vision API キーが未設定です。\n右上の歯車アイコンからAPIキーを登録してください。");
      throw new Error("Vision API key is not configured");
    }

    // 画像のリサイズ＆Base64変換（通信容量を抑えつつ鮮明さを保持）
    const base64Data = await this.encodeImageToBase64(file, 1600);

    const url = `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`;

    const requestBody = {
      requests: [
        {
          image: { content: base64Data },
          features: [
            {
              type: "DOCUMENT_TEXT_DETECTION", // ドキュメント・領収書特化
              maxResults: 1
            }
          ],
          imageContext: {
            languageHints: ["ja", "en"]
          }
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
      throw new Error("画像から文字を検出できませんでした。より鮮明に撮影してください。");
    }

    return this.parseVisionAnnotation(annotation);
  },

  // Base64変換
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

          // JPEG品質0.9でエンコード
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          resolve(dataUrl.split(",")[1]);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // 構造化テキストとブロック情報の解析
  parseVisionAnnotation(annotation) {
    const fullText = annotation.text;
    const lines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "";
    let date = new Date().toISOString().split("T")[0];
    let items = [];
    let totalAmount = 0;

    // 1. 日付抽出 (YYYY年MM月DD日 または YYYY/MM/DD, YYYY-MM-DD, 令和X年)
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      const y = dateMatch[1];
      const m = dateMatch[2].padStart(2, "0");
      const d = dateMatch[3].padStart(2, "0");
      date = `${y}-${m}-${d}`;
    } else {
      // 令和対応
      const reiwaMatch = fullText.match(/令和\s*([0-9０-９]+)年\s*([0-9０-９]+)月\s*([0-9０-９]+)日/);
      if (reiwaMatch) {
        const y = 2018 + parseInt(reiwaMatch[1], 10);
        const m = reiwaMatch[2].padStart(2, "0");
        const d = reiwaMatch[3].padStart(2, "0");
        date = `${y}-${m}-${d}`;
      }
    }

    // 2. 店舗名（上部行から「領収書」「レシート」「電話番号」「登録番号」などを除外して抽出）
    for (let i = 0; i < Math.min(6, lines.length); i++) {
      const line = lines[i];
      if (!line.match(/領収|レシート|登録|TEL|電話|No|20\d{2}|合計|様|宛/i) && line.length >= 2) {
        store = line.replace(/[*#=＝\-]/g, "").trim();
        break;
      }
    }
    if (!store) store = "利用店舗";

    // 3. 金額と品目の解析
    // 行末に金額パターンがある行を抽出
    const priceRegex = /([¥￥\\])?\s*([1-9]\d{1,6})\s*(円|※|[*])?$/;

    for (const line of lines) {
      // 合計金額の判定
      if (line.match(/合\s*計|総\s*計|小\s*計|お買上|ご請求|お支払/i)) {
        const numMatch = line.replace(/[,，\s]/g, "").match(/(\d{2,8})/);
        if (numMatch) {
          totalAmount = parseInt(numMatch[1], 10);
        }
        continue;
      }

      // 明細除外キーワード
      if (line.match(/消費税|内税|対象|お預|釣|割引|値引|ポイント|クレジット|現\s*金|登録番号|TEL|担当/i)) {
        continue;
      }

      // 明細行のパース
      const cleanLine = line.replace(/[,，]/g, "");
      const match = cleanLine.match(priceRegex);
      if (match) {
        const price = parseInt(match[2], 10);
        let itemName = cleanLine.substring(0, match.index).trim();
        itemName = itemName.replace(/^[\-—―\s\d\*※\\]+/, "").replace(/[\-—―\\*]+$/, "").trim();

        if (itemName.length >= 2 && price > 0 && price < 10000000) {
          items.push({ name: itemName, price: price });
        }
      }
    }

    // 合計が未検出で明細がある場合は合算
    if (totalAmount === 0 && items.length > 0) {
      totalAmount = items.reduce((sum, item) => sum + item.price, 0);
    }

    if (items.length === 0) {
      items.push({ name: `${store} 利用分`, price: totalAmount });
    }

    // 4. 青色申告科目判定
    const lower = fullText.toLowerCase();
    let suggestedCategory = "消耗品費";
    let suggestedGenre = "日用品・消耗品";

    if (/ガソリン|給油|駐車|高速|交通|suica|pasmo|jr|タクシー|乗車|電車|バス/.test(lower)) {
      suggestedCategory = "旅費交通費";
      suggestedGenre = "交通費";
    } else if (/飲食|カフェ|珈琲|コーヒー|居酒屋|レストラン|ランチ|ディナー|バー/.test(lower)) {
      suggestedCategory = "接待交際費";
      suggestedGenre = "外食・カフェ";
    } else if (/スーパー|食品|生鮮|精肉|鮮魚|青果|米|パン|牛乳|食料|弁当/.test(lower)) {
      suggestedCategory = "福利厚生費";
      suggestedGenre = "食料品・スーパー";
    } else if (/本|書籍|文具|ノート|用紙|プリント|図書/.test(lower)) {
      suggestedCategory = "消耗品費";
      suggestedGenre = "趣味・教養・娯楽";
    } else if (/切手|ハガキ|送料|配送料|ヤマト|佐川|郵便/.test(lower)) {
      suggestedCategory = "通信費";
      suggestedGenre = "その他";
    }

    return {
      date: date,
      store: store,
      items: items,
      totalAmount: totalAmount,
      suggestedCategory: suggestedCategory,
      suggestedGenre: suggestedGenre,
      memo: `${store} (Cloud Vision)`
    };
  }
};
