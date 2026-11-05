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

    return this.parseSmartReceiptClean(annotation.text);
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

  parseSmartReceiptClean(fullText) {
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

    // 2. 店舗名抽出（支店名を優先）
    const brandMatch = fullText.match(/(EneJet|ENEOS|出光|コスモ石油|ダイソー|DAISO|セリア|キャンドゥ|ユニクロ|UNIQLO|GU|ジーユー|セブン[-ー]イレブン|ファミリーマート|ローソン|イオン)/i);
    const branchMatch = fullText.match(/([^\n\r]{2,15}(?:SS|ＳＳ|給油所|インター店|長町店|好間店|店|支店|営業所))/);
    const corpMatch = fullText.match(/(株式会社[^\n\r]{2,15}|[^\n\r]{2,15}株式会社)/);

    if (brandMatch && branchMatch) {
      store = `${brandMatch[0]} ${branchMatch[1].replace(/[!！\*#=＝\-_]/g, "").trim()}`;
    } else if (branchMatch) {
      store = branchMatch[1].replace(/[!！\*#=＝\-_]/g, "").trim();
    } else if (brandMatch) {
      store = brandMatch[0];
    } else if (corpMatch) {
      store = corpMatch[0].trim();
    } else {
      store = lines[0] || "利用店舗";
    }

    // 3. 決済手段の推論
    if (/EneKey|エネキー|ENEOS公式アプリ/i.test(fullText)) {
      paymentMethod = "モバイルEneKey";
    } else if (/PayPay|ペイペイ/i.test(fullText)) {
      paymentMethod = "PayPay";
    } else if (/AEON\s*PAY|イオンペイ/i.test(fullText)) {
      paymentMethod = "AEON PAY";
    } else if (/クレジット|JCB|VISA|Master|American Express|売上\s*JCB|一括/i.test(fullText)) {
      paymentMethod = "クレジットカード";
    }

    // 4. 合計金額の厳密判定
    // 「合計」「合言十」「ご請求額」「支払総額」「ご利用金額」に続く数値を最優先
    const totalRegex = /(合\s*[計言十]|ご利用金額|ご請求|支払総額|現\s*計|クレジット売上)[^\d¥￥]*[¥￥\\]?\s*([1-9]\d{1,6})/i;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.match(/通番|承認|No|内消費税|対象額/)) continue;
      const m = line.match(totalRegex);
      if (m) {
        totalAmount = parseInt(m[2], 10);
        break;
      }
    }

    if (totalAmount === 0) {
      const allPrices = [...fullText.matchAll(/[¥￥\\]\s*([1-9]\d{1,6})/g)];
      if (allPrices.length > 0) {
        // 末尾付近の最大値を採用
        totalAmount = parseInt(allPrices[allPrices.length - 1][1], 10);
      }
    }

    // 5. 品名・内訳の抽出（不要コード・管理タグの除去）
    const cleanItemName = (name) => {
      return name
        .replace(/<[0-9A-Za-z\-_]+>/g, "") // <0838> などの商品管理コードを除去
        .replace(/\[[0-9A-Za-z\-_]+\]/g, "")
        .replace(/^[0-9\-\s\*※・/／:：#]+/, "")
        .replace(/[\-—―\*※/／\s#]+$/, "")
        .replace(/（ステ|（横型/g, "")
        .trim();
    };

    const isGarbage = (str) => {
      return /(レジ|通番|伝票|承認|登録番号|T\d{7,13}|P\d{6,}|CEU|\d{1,2}:\d{2}|合計|合言十|小計|内消費税|税抜|対象額|お釣|お預|PayPay|点|領収|納品|保管|お願い|ポイント|ID|会員|売上|買上|担当|責任者|TEL|電話|JCB|VISA)/i.test(str);
    };

    // (A) ガソリンスタンド（給油量情報のみを抽出）
    const gasMatch = fullText.match(/(レギュラー|ハイオク|軽油|灯油)/);
    if (gasMatch) {
      const literMatch = fullText.match(/(\d{1,3}(?:\.\d{1,2})?)\s*[Llリットル]/);
      const literInfo = literMatch ? ` (${literMatch[1]}L)` : "";
      items.push({
        name: `${gasMatch[1]}給油${literInfo}`,
        price: totalAmount
      });
    }

    // (B) 一般レシート（ダイソー、ユニクロ等）
    if (items.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isGarbage(line) || line.match(/合\s*[計言十]/)) continue;

        // 金額抽出ヘルパー
        const priceMatch = line.match(/[¥￥\\]\s*([1-9]\d{1,5})\s*(外|内|円|※)?/);
        if (priceMatch) {
          let p = parseInt(priceMatch[1], 10);
          if (priceMatch[2] === "外") p = Math.round(p * 1.1);

          let namePart = line.replace(/[¥￥\\].*$/, "");
          let cleaned = cleanItemName(namePart);

          // 同一行に商品名がなければ前行を確認
          if (cleaned.length < 2 && i > 0) {
            const prev = lines[i - 1];
            if (!isGarbage(prev)) {
              cleaned = cleanItemName(prev);
            }
          }

          // 合計金額と同じ行（合計の再検出）は除外
          if (p === totalAmount && cleaned.match(/合計|買上|支払/)) continue;

          if (cleaned.length >= 2 && !isGarbage(cleaned)) {
            // 重複登録防止
            if (!items.some(it => it.name === cleaned && it.price === p)) {
              items.push({ name: cleaned, price: p });
            }
          }
        }
      }
    }

    // 品名が取れなかった場合のフォールバック
    if (items.length === 0) {
      items.push({ name: "利用分", price: totalAmount });
    }

    // 6. 摘要（内訳）のスマート生成
    // 余計な店舗名は含めず、純粋な商品・用途リストのみを出力
    let memo = "";
    if (gasMatch) {
      memo = items[0].name; // 「レギュラー給油 (22.18L)」
    } else {
      memo = items.map(it => it.name).filter(n => n.length > 0).join("、");
    }

    // 7. 勘定科目判定
    const lower = (store + " " + fullText).toLowerCase();
    let suggestedCategory = "消耗品費";
    if (/enejet|eneos|出光|コスモ|給油|ガソリン|レギュラー|ハイオク|軽油|駐車|タイムズ|高速|jr|タクシー/.test(lower)) {
      suggestedCategory = "旅費交通費";
    } else if (/カフェ|珈琲|コーヒー|居酒屋|レストラン|ランチ/.test(lower)) {
      suggestedCategory = "接待交際費";
    } else if (/スーパー|食品|精肉|鮮魚|青果|生鮮|弁当/.test(lower)) {
      suggestedCategory = "福利厚生費";
    }

    return {
      date: date,
      store: store,
      items: items,
      totalAmount: totalAmount, // 正確な合計金額をセット
      suggestedCategory: suggestedCategory,
      paymentMethod: paymentMethod,
      memo: memo
    };
  }
};
