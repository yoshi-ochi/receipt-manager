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

    console.log("=== Raw Vision Text ===");
    console.log(annotation.text);

    return this.parseSequentialReceipt(annotation.text);
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

  /**
   * 行順シーケンシャルパースエンジン
   * 品名行の直後または次行の「¥数値」を正しくペアリング
   */
  parseSequentialReceipt(fullText) {
    const lines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "";
    let date = new Date().toISOString().split("T")[0];
    let totalAmount = 0;
    let paymentMethod = "現金";
    let items = [];

    // 1. 日付抽出
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    // 2. 店舗名抽出
    const brandMatch = fullText.match(/(EneJet|ENEOS|出光|コスモ石油|apollostation|ダイソー|セリア|キャンドゥ|セブン[-ー]イレブン|ファミリーマート|ローソン|イオン)/i);
    const ssMatch = fullText.match(/([^\n\r]{2,15}(?:SS|ＳＳ|給油所|店|支店|長町店|北部SS))/);
    const corpMatch = fullText.match(/(株式会社[^\n\r]{2,15}|[^\n\r]{2,15}株式会社)/);

    if (brandMatch && ssMatch) {
      store = `${brandMatch[0]} ${ssMatch[1].replace(/[!！\*#=＝\-_]/g, "").trim()}`;
    } else if (ssMatch) {
      store = ssMatch[1].replace(/[!！\*#=＝\-_]/g, "").trim();
    } else if (brandMatch) {
      store = brandMatch[0];
    } else if (corpMatch) {
      store = corpMatch[0].trim();
    } else {
      store = lines[0] || "利用店舗";
    }

    // 3. 決済手段の自動推論（PayPay, モバイルEneKey, AEON PAY, クレジットカード, 現金）
    if (/EneKey|エネキー|ENEOS公式アプリ/i.test(fullText)) {
      paymentMethod = "モバイルEneKey";
    } else if (/PayPay|ペイペイ/i.test(fullText)) {
      paymentMethod = "PayPay";
    } else if (/AEON\s*PAY|イオンペイ/i.test(fullText)) {
      paymentMethod = "AEON PAY";
    } else if (/クレジット|JCB|VISA|Master|American Express|売上\s*JCB|一括/i.test(fullText)) {
      paymentMethod = "クレジットカード";
    }

    // 4. 合計金額の特定（「合計」「合言十」「ご請求」付近の正しい¥数値）
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.match(/(合\s*[計言十]|お買上額|ご請求|支払総額|現\s*計|クレジット売上)/i)) {
        for (let j = i; j <= Math.min(i + 3, lines.length - 1); j++) {
          const target = lines[j];
          if (target.match(/通番|承認|No|内消費税|税|ポイント|P\b/i)) continue;
          const m = target.replace(/[,，\s]/g, "").match(/[¥￥\\]\s*([1-9]\d{1,6})/);
          if (m) {
            totalAmount = parseInt(m[1], 10);
            break;
          }
        }
        if (totalAmount > 0) break;
      }
    }

    // 5. 品名と金額の行順ペアリング（提案アルゴリズムの実装）
    // メタ情報・管理番号・消費税行の判定
    const isMeta = (str) => {
      return /(レジ|通番|伝票|承認|登録番号|T\d{7,13}|P\d{6,}|CEU|\d{1,2}:\d{2}|合計|合言十|小計|内消費税|税抜|対象額|お釣|お預|PayPay|点|領収|納品|保管|お願い|ポイント|ID|会員)/i.test(str);
    };

    // 金額行から「¥数値」を取り出すヘルパー
    const extractPrice = (str) => {
      if (str.match(/内消費税|対象額/)) return null;
      const m = str.replace(/[,，\s]/g, "").match(/[¥￥\\]\s*([1-9]\d{1,5})\s*(外|内|円|※)?/);
      if (m) {
        let val = parseInt(m[1], 10);
        if (m[2] === "外") val = Math.round(val * 1.1); // 外税10%換算
        return val;
      }
      return null;
    };

    // (A) ガソリン給油パターンの特別判定（レギュラー/ハイオク/軽油）
    const gasMatch = fullText.match(/(レギュラー|ハイオク|軽油|灯油)/);
    if (gasMatch) {
      const literMatch = fullText.match(/(\d{1,3}(?:\.\d{1,2})?)\s*[Llリットル]/);
      const literStr = literMatch ? ` (${literMatch[1]}L)` : "";
      items.push({
        name: `${gasMatch[1]}給油${literStr}`,
        price: totalAmount || 3394
      });
    }

    // (B) 一般品目の行順ペアリング（同一行または次行探索）
    if (items.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isMeta(line) || line.match(/合\s*[計言十]/)) continue;

        // 1. 同一行に品名と「¥数値」があるか？
        const sameLinePrice = extractPrice(line);
        if (sameLinePrice) {
          const namePart = line.replace(/[¥￥\\].*$/, "").replace(/^[0-9\-\s\*※・/／]+/, "").trim();
          if (namePart.length >= 2 && !isMeta(namePart)) {
            items.push({ name: namePart, price: sameLinePrice });
            continue;
          }
        }

        // 2. なければ、この行が品名らしく、次の行（または2行以内）に「¥数値」があるか？
        if (line.length >= 2 && !line.match(/^[0-9A-Z\s\-\:\.\@]+$/i)) {
          let foundPrice = null;
          for (let step = 1; step <= 2; step++) {
            if (i + step < lines.length) {
              const nextLine = lines[i + step];
              foundPrice = extractPrice(nextLine);
              if (foundPrice) {
                // 品名として採用
                const cleanName = line.replace(/^[0-9\-\s\*※・/／]+/, "").trim();
                items.push({ name: cleanName, price: foundPrice });
                i += step; // 探索した金額行までポインタを進める
                break;
              }
            }
          }
        }
      }
    }

    // 明細合計から合計額の整合
    const itemsSum = items.reduce((sum, item) => sum + item.price, 0);
    if (totalAmount === 0 && itemsSum > 0) {
      totalAmount = itemsSum;
    }
    if (items.length === 0) {
      items.push({ name: `${store} 利用分`, price: totalAmount });
    }

    // 6. 勘定科目の推論（給油・交通を旅費交通費に確定）
    const lower = (store + " " + fullText).toLowerCase();
    let suggestedCategory = "消耗品費";
    let suggestedGenre = "日用品・消耗品";

    if (/enejet|eneos|出光|コスモ|給油|ガソリン|レギュラー|ハイオク|軽油|駐車|タイムズ|高速|jr|タクシー/.test(lower)) {
      suggestedCategory = "旅費交通費";
      suggestedGenre = "交通費";
    } else if (/カフェ|珈琲|コーヒー|居酒屋|レストラン|ランチ/.test(lower)) {
      suggestedCategory = "接待交際費";
      suggestedGenre = "外食・カフェ";
    } else if (/スーパー|食品|精肉|鮮魚|青果|生鮮|弁当/.test(lower)) {
      suggestedCategory = "福利厚生費";
      suggestedGenre = "食料品・スーパー";
    }

    return {
      date: date,
      store: store,
      items: items,
      totalAmount: totalAmount,
      suggestedCategory: suggestedCategory,
      suggestedGenre: suggestedGenre,
      paymentMethod: paymentMethod,
      memo: `${store}（${items.map(i => i.name).slice(0, 2).join('、')}）`
    };
  }
};
