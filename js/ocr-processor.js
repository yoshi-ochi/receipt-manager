/**
 * Receipt OCR Processor (Universal Receipt Parser for Gas Stations, Supermarkets, Daiso & General Stores)
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

    console.log("=== Raw Receipt Text ===");
    console.log(annotation.text);

    return this.parseUniversalReceipt(annotation.text);
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

  parseUniversalReceipt(fullText) {
    const rawLines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "";
    let date = new Date().toISOString().split("T")[0];
    let totalAmount = 0;
    let items = [];

    // 1. 日付の検出 (2026/10/07, 2026年10月07日 等)
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    // 2. 店舗名・発行元の抽出
    // ブランド/SS名/店名パターンの優先探索
    const brandMatch = fullText.match(/(EneJet|ENEOS|出光|コスモ石油|apollostation|シェル|ダイソー|セリア|キャンドゥ|セブン[-ー]イレブン|ファミリーマート|ローソン|イオン|イトーヨーカドー|業務スーパー)/i);
    const ssMatch = fullText.match(/([^\n\r]{2,15}(?:SS|ＳＳ|給油所|店|支店|営業所))/);
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
      for (let i = 0; i < Math.min(4, rawLines.length); i++) {
        const l = rawLines[i];
        if (!l.match(/領収|納品|レシート|No|TEL|電話|登録|20\d{2}/i) && l.length >= 2) {
          store = l;
          break;
        }
      }
    }
    if (!store) store = "利用店舗";

    // 3. 管理番号・メタ情報の判定（合計や品名から絶対に除外するキーワード）
    const isMetaLine = (line) => {
      return /(端末|処理通番|通番|承認|伝票|番号|登録番号|T\d{7,13}|P\d{6,}|ID|会員|ポイント|P|クレジット|売上|JCB|VISA|Master|現\s*金|お釣|お預|係|担当|TEL|電話|保管|お願い|残高|対象額|内消費税|税)/i.test(line);
    };

    // 4. 合計金額の検出
    // 「合計」「合言十」「ご請求額」「小計」直近の数値を厳密探索
    const totalLines = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.match(/(合\s*[計言十]|お買上額|ご請求|支払総額|現\s*計|クレジット売上)/i)) {
        // 同じ行または直後3行以内の数値を検索
        for (let j = i; j <= Math.min(i + 3, rawLines.length - 1); j++) {
          const target = rawLines[j];
          // 通番や承認番号を除外
          if (target.match(/通番|承認|No|ID|ポイント|P\b/i)) continue;
          const m = target.replace(/[,，\s]/g, "").match(/[¥￥\\]?\s*([1-9]\d{1,6})\s*(円)?/);
          if (m) {
            const val = parseInt(m[1], 10);
            if (val > 0 && val < 5000000) {
              totalLines.push(val);
            }
          }
        }
      }
    }

    if (totalLines.length > 0) {
      totalAmount = totalLines[0]; // 最も「合計」に近い数値を採用
    } else {
      // フォールバック: ¥記号がついた代表的金額
      const yenMatches = [...fullText.matchAll(/[¥￥]\s*([1-9]\d{1,6})/g)];
      if (yenMatches.length > 0) {
        totalAmount = parseInt(yenMatches[yenMatches.length - 1][1].replace(/[,，]/g, ""), 10);
      }
    }

    // 5. 明細・品目の抽出（ガソリン給油、通常品目、ダイソー複数行すべてに対応）
    // (A) ガソリンスタンド特有の給油明細（レギュラー/ハイオク/軽油 + 金額）
    const gasMatch = fullText.match(/(レギュラー|ハイオク|軽油|灯油)[\s\S]*?[¥￥]?\s*([1-9]\d{2,5})/);
    if (gasMatch) {
      const fuelName = gasMatch[1];
      let fuelPrice = totalAmount; // 給油レシートは合計と品目価格が一致することが多い
      // 給油量があれば摘要に含める
      const literMatch = fullText.match(/(\d{1,3}(?:\.\d{1,2})?)\s*[Llリットル]/);
      const literInfo = literMatch ? ` (${literMatch[1]}L)` : "";
      items.push({
        name: `${fuelName}給油${literInfo}`,
        price: fuelPrice || totalAmount
      });
    }

    // (B) 一般レシート明細（ダイソー、スーパー等）
    if (items.length === 0) {
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (isMetaLine(line) || line.match(/合\s*[計言十]|小計/)) continue;

        // 同一行「品名 ¥金額」
        const m = line.match(/^(.*?)[¥￥\\]\s*([1-9]\d{1,5})\s*(外|内|円|※)?$/);
        if (m) {
          let name = m[1].replace(/^[0-9\-\s\*※・/／]+/, "").trim();
          let price = parseInt(m[2], 10);
          if (m[3] === "外") price = Math.round(price * 1.1);
          if (name.length >= 2 && !isMetaLine(name)) {
            items.push({ name: name, price: price });
          }
        }
      }
    }

    // (C) 品名と金額が別ブロックの場合のフォールバックペアリング
    if (items.length === 0) {
      const candidateNames = [];
      const candidatePrices = [];

      let detailZone = false;
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (line.match(/(明細|レジNo|お買上)/i)) detailZone = true;
        if (line.match(/合\s*[計言十]|小計|PayPay/i) && candidatePrices.length > 0) break;

        const pMatch = line.match(/^[¥￥\\]\s*([1-9]\d{1,5})\s*(外|内|円)?$/);
        if (pMatch && !line.match(/通番|承認/)) {
          let p = parseInt(pMatch[1], 10);
          if (pMatch[2] === "外") p = Math.round(p * 1.1);
          candidatePrices.push(p);
          continue;
        }

        if (detailZone && !isMetaLine(line) && line.length >= 2 && !line.match(/^[0-9A-Z\s\-\:]+$/i)) {
          candidateNames.push(line.replace(/^[0-9\-\s\*※・/／]+/, "").trim());
        }
      }

      const count = Math.min(candidateNames.length, candidatePrices.length);
      for (let i = 0; i < count; i++) {
        items.push({ name: candidateNames[i], price: candidatePrices[i] });
      }
    }

    // 明細が0件の場合のフォールバック
    if (items.length === 0) {
      items.push({ name: `${store} 利用分`, price: totalAmount });
    }

    // 6. 勘定科目・家計簿ジャンル判定（ガソリン・交通費を完全優先）
    const lower = (store + " " + fullText).toLowerCase();
    let suggestedCategory = "消耗品費";
    let suggestedGenre = "日用品・消耗品";

    if (/enejet|eneos|出光|コスモ|給油|ガソリン|レギュラー|ハイオク|軽油|駐車|タイムズ|高速|交通|jr|タクシー/.test(lower)) {
      suggestedCategory = "旅費交通費";
      suggestedGenre = "交通費";
    } else if (/カフェ|珈琲|コーヒー|喫茶|居酒屋|レストラン|ランチ|マクドナルド/.test(lower)) {
      suggestedCategory = "接待交際費";
      suggestedGenre = "外食・カフェ";
    } else if (/スーパー|食品|精肉|鮮魚|青果|生鮮|弁当|牛乳|パン/.test(lower)) {
      suggestedCategory = "福利厚生費";
      suggestedGenre = "食料品・スーパー";
    } else if (/ダイソー|セリア|キャンドゥ|無印|文具|事務|ホームセンター/.test(lower)) {
      suggestedCategory = "消耗品費";
      suggestedGenre = "日用品・消耗品";
    }

    return {
      date: date,
      store: store,
      items: items,
      totalAmount: totalAmount,
      suggestedCategory: suggestedCategory,
      suggestedGenre: suggestedGenre,
      memo: `${store}（${items.map(i => i.name).slice(0, 2).join('、')}）`
    };
  }
};
