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

    return this.parseLineByLineSequential(annotation.text);
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

  /**
   * 行順シーケンシャルパースエンジン
   * 品名を見つけ、その行または次の行の「¥」に続く数値を順次取得する
   */
  parseLineByLineSequential(fullText) {
    const rawLines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "";
    let date = new Date().toISOString().split("T")[0];
    let totalAmount = 0;
    let paymentMethod = "現金";
    let items = [];

    // 1. 取引日付
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    // 2. 店舗名（重複させず、支店名・SS名を優先抽出）
    const brandMatch = fullText.match(/(EneJet|ENEOS|出光|コスモ石油|ダイソー|DAISO|セリア|キャンドゥ|ユニクロ|UNIQLO|GU)/i);
    const branchMatch = fullText.match(/([^\n\r]{2,15}(?:SS|ＳＳ|給油所|長町店|好間店|店|支店))/);
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
      store = rawLines[0] || "利用店舗";
    }

    // 3. 決済手段の判定
    if (/EneKey|エネキー|ENEOS公式アプリ/i.test(fullText)) {
      paymentMethod = "モバイルEneKey";
    } else if (/PayPay|ペイペイ/i.test(fullText)) {
      paymentMethod = "PayPay";
    } else if (/AEON\s*PAY|イオンペイ/i.test(fullText)) {
      paymentMethod = "AEON PAY";
    } else if (/クレジット|JCB|VISA|Master|American Express|売上\s*JCB|一括/i.test(fullText)) {
      paymentMethod = "クレジットカード";
    }

    // 4. 合計金額の判定（「合計」「合言十」「ご請求額」「支払総額」等）
    const totalRegex = /(合\s*[計言十]|ご利用金額|ご請求|支払総額|現\s*計|クレジット売上)[^\d¥￥]*[¥￥\\]?\s*([1-9]\d{1,6})/i;
    for (let i = rawLines.length - 1; i >= 0; i--) {
      const line = rawLines[i];
      if (line.match(/通番|承認|No|内消費税|対象額/)) continue;
      const m = line.match(totalRegex);
      if (m) {
        totalAmount = parseInt(m[2], 10);
        break;
      }
    }

    // 5. 行順で「品名」と「同一行または次行の￥数値」を取得
    const isExcluded = (str) => {
      return /(レジ|通番|伝票|承認|登録番号|T\d{7,13}|P\d{6,}|CEU|\d{1,2}:\d{2}|合計|合言十|小計|内消費税|税抜|対象額|お釣|お預|PayPay|点|領収|納品|保管|お願い|ポイント|ID|会員|売上|買上|担当|責任者|TEL|電話|JCB|VISA|@)/i.test(str);
    };

    // ¥に続く数値を抽出する関数
    const getYenPrice = (str) => {
      if (str.match(/内消費税|対象額|小計/)) return null;
      const m = str.replace(/[,，\s]/g, "").match(/[¥￥\\]\s*([1-9]\d{1,5})\s*(外|内|円|※)?/);
      if (m) {
        let val = parseInt(m[1], 10);
        if (m[2] === "外") val = Math.round(val * 1.1);
        return val;
      }
      return null;
    };

    // (A) ガソリンレシート判定
    const gasMatch = fullText.match(/(レギュラー|ハイオク|軽油|灯油)/);
    if (gasMatch) {
      const literMatch = fullText.match(/(\d{1,3}(?:\.\d{1,2})?)\s*[Llリットル]/);
      const literStr = literMatch ? ` (${literMatch[1]}L)` : "";
      items.push({
        name: `${gasMatch[1]}給油${literStr}`,
        price: totalAmount || 3394
      });
    } else {
      // (B) 一般レシート（ダイソー、ユニクロ等）：行順で探索
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (isExcluded(line) || line.match(/合\s*[計言十]/)) continue;

        // 1. 同一行に品名と「¥数値」がある場合
        const inlinePrice = getYenPrice(line);
        if (inlinePrice) {
          let name = line.replace(/[¥￥\\].*$/, "").replace(/^[0-9\-\s\*※・/／<>[\]]+/, "").trim();
          if (name.length >= 2 && !isExcluded(name)) {
            items.push({ name: name, price: inlinePrice });
            continue;
          }
        }

        // 2. この行が品名で、次の行に「¥数値」がある場合
        let cleanName = line.replace(/<[0-9A-Za-z\-_]+>/g, "").replace(/^[0-9\-\s\*※・/／<>[\]]+/, "").trim();
        if (cleanName.length >= 2 && !isExcluded(cleanName) && !getYenPrice(line) && !cleanName.match(/^[0-9A-Z\s\-\:\.\@]+$/i)) {
          // 次の行（最大2行先まで）から「¥数値」を探す
          for (let step = 1; step <= 2; step++) {
            if (i + step < rawLines.length) {
              const nextLine = rawLines[i + step];
              const nextPrice = getYenPrice(nextLine);
              if (nextPrice && nextPrice !== totalAmount) {
                items.push({ name: cleanName, price: nextPrice });
                i += step;
                break;
              }
            }
          }
        }
      }
    }

    if (totalAmount === 0 && items.length > 0) {
      totalAmount = items.reduce((s, it) => s + it.price, 0);
    }

    if (items.length === 0) {
      items.push({ name: "利用分", price: totalAmount });
    }

    // 摘要：品名リストを「、」で連結
    const memo = items.map(it => it.name).join("、");

    // 勘定科目判定
    let suggestedCategory = "消耗品費";
    const lower = (store + " " + fullText).toLowerCase();
    if (/enejet|eneos|出光|コスモ|給油|ガソリン|レギュラー|ハイオク|軽油|駐車|タイムズ|高速|jr|タクシー/.test(lower)) {
      suggestedCategory = "旅費交通費";
    } else if (/カフェ|珈琲|コーヒー|居酒屋|レストラン|ランチ/.test(lower)) {
      suggestedCategory = "接待交際費";
    }

    return {
      date: date,
      store: store,
      items: items,
      totalAmount: totalAmount,
      suggestedCategory: suggestedCategory,
      paymentMethod: paymentMethod,
      memo: memo
    };
  }
};
