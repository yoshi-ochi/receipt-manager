/**
 * Receipt OCR Processor - Universal Production Engine
 * 添付された全レシート種別（ガソリン各社、高速、JR、スーパー、ホームセンター、ユニクロ、専門店、郵便、旅館等）に適合
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
    let paymentMethod = "現金";
    let items = [];

    // 1. 取引日付の抽出（YYYY年MM月DD日 または YYYY/MM/DD）
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    // 2. 店舗名の抽出（ブランド名と支店名の組み合わせ）
    const brandPatterns = [
      "EneJet", "ENEOS", "COSMO", "コスモ石油", "セキショウ", "ヤシロ石油", "オカモト", "出光",
      "NEXCO東日本", "東日本旅客鉄道", "JR東日本",
      "イオン", "AEON STYLE", "ダイシン", "スーパービバホーム", "ビバホーム", "SHOE PLAZA",
      "ユニクロ", "UNIQLO", "GU", "ダイソー", "DAISO", "Seria", "セリア", "PLAZA", "日本郵便",
      "沢口旅館", "Puits D'amour", "ピュイドール"
    ];

    let foundBrand = "";
    for (const b of brandPatterns) {
      if (new RegExp(b, "i").test(fullText)) {
        foundBrand = b;
        break;
      }
    }

    const branchMatch = fullText.match(/([^\n\r]{2,15}(?:店|支店|SS|ＳＳ|給油所|料金所|郵便局|長町店|天童店|盛岡南|仙台中山店|いわき好間店|セルつ愛子|セルフ美里|大衡SS|盛岡北部SS))/i);

    if (foundBrand && branchMatch && !branchMatch[0].includes(foundBrand)) {
      store = `${foundBrand} ${branchMatch[0].replace(/[!！\*#=＝\-_\[\]\(\)]/g, "").trim()}`;
    } else if (foundBrand) {
      store = foundBrand;
    } else if (branchMatch) {
      store = branchMatch[0].replace(/[!！\*#=＝\-_\[\]\(\)]/g, "").trim();
    } else {
      for (let i = 0; i < Math.min(5, rawLines.length); i++) {
        if (!rawLines[i].match(/領収|納品|受領|No|TEL|電話|登録|20\d{2}/i) && rawLines[i].length >= 2) {
          store = rawLines[i];
          break;
        }
      }
    }
    if (!store) store = "利用店舗";

    // 3. 支払い方法の動的判定
    if (/EneKey|エネキー|M-EneKey/i.test(fullText)) {
      paymentMethod = "モバイルEneKey";
    } else if (/AEON\s*Pay|イオンペイ/i.test(fullText)) {
      paymentMethod = "AEON PAY";
    } else if (/PayPay|ペイペイ|他QR|コード決済/i.test(fullText)) {
      paymentMethod = "PayPay";
    } else if (/クレジット|一括|JCB|VISA|Master|AMEX|信計|売上\s*JCB|カード売上|コスモ・ザ・カード/i.test(fullText)) {
      paymentMethod = "クレジットカード";
    } else if (/現\s*金|現\s*計|お預|お釣り/i.test(fullText)) {
      paymentMethod = "現金";
    }

    // 4. 合計金額の動的判定（領収金額、合計、合言十、通行料金、金◯◯円等）
    // (A) 高速道路「通行料金 ¥3,400-」
    const highwayMatch = fullText.match(/通行料金\s*[¥￥]?\s*([0-9,，]+)/);
    if (highwayMatch) {
      totalAmount = parseInt(highwayMatch[1].replace(/[,，]/g, ""), 10);
    }

    // (B) JR「金33,560円」
    if (totalAmount === 0) {
      const jrMatch = fullText.match(/金\s*([0-9,，]+)\s*円/);
      if (jrMatch) {
        totalAmount = parseInt(jrMatch[1].replace(/[,，]/g, ""), 10);
      }
    }

    // (C) 一般レシート「合計」「合言十」「領収金額」「ご利用金額」「お買上額」
    if (totalAmount === 0) {
      const totalKeywords = /(合\s*[計言十]|領収金額|ご利用金額|ご請求額|支払総額|お買上額|現\s*計|信\s*計)[^\d¥￥]*[¥￥\\]?\s*([1-9][0-9,，]{1,8})/i;
      for (let i = rawLines.length - 1; i >= 0; i--) {
        const line = rawLines[i];
        if (line.match(/通番|承認|No|内消費税|対象額|登録番号|値引|割引/)) continue;
        const m = line.match(totalKeywords);
        if (m) {
          const val = parseInt(m[2].replace(/[,，\s]/g, ""), 10);
          if (val > 0 && val < 10000000) {
            totalAmount = val;
            break;
          }
        }
      }
    }

    // (D) フォールバック：後続行の探索
    if (totalAmount === 0) {
      for (let i = 0; i < rawLines.length; i++) {
        if (rawLines[i].match(/合\s*[計言十]|領収金額/)) {
          for (let step = 1; step <= 2; step++) {
            if (i + step < rawLines.length) {
              const target = rawLines[i + step].replace(/[,，\s]/g, "");
              const m = target.match(/[¥￥\\]?\s*([1-9]\d{1,6})/);
              if (m && !rawLines[i + step].match(/内消費税|対象額/)) {
                totalAmount = parseInt(m[1], 10);
                break;
              }
            }
          }
          if (totalAmount > 0) break;
        }
      }
    }

    // 5. 品名・内訳の抽出
    const isExcluded = (str) => {
      return /(レジ|通番|伝票|承認|登録番号|T\d{7,13}|P\d{6,}|CEU|\d{1,2}:\d{2}|合計|合言十|小計|内消費税|外税|税抜|対象額|お釣|お預|PayPay|点|領収|納品|保管|お願い|ポイント|ID|会員|売上|買上|担当|責任者|TEL|電話|JCB|VISA|@|割引|値引|課税計|非課税)/i.test(str);
    };

    const cleanItemName = (str) => {
      return str
        .replace(/<[0-9A-Za-z\-_]+>/g, "")
        .replace(/\[[0-9A-Za-z\-_]+\]/g, "")
        .replace(/^[0-9\-\s\*※・/／:：#]+/, "")
        .replace(/[\-—―\*※/／\s#]+$/, "")
        .trim();
    };

    // (A) ガソリンレシート（セキショウ、コスモ、ヤシロ、オカモト）
    const gasMatch = fullText.match(/(レギュラー(?:ガソリン)?|ハイオク|軽油|灯油)/);
    if (gasMatch) {
      const literMatch = fullText.match(/(\d{1,3}(?:\.\d{1,2})?)\s*(?:L|\(L\)|リットル)/i);
      const literStr = literMatch ? ` (${literMatch[1]}L)` : "";
      items.push({
        name: `${gasMatch[1]}給油${literStr}`,
        price: totalAmount
      });
    }

    // (B) 高速道路（NEXCO）
    else if (/通行料金|NEXCO/i.test(fullText)) {
      items.push({
        name: "高速道路通行料金",
        price: totalAmount
      });
    }

    // (C) JR切符（乗車券類）
    else if (/東日本旅客鉄道|乗車券/i.test(fullText)) {
      items.push({
        name: "JR乗車券代",
        price: totalAmount
      });
    }

    // (D) 一般店舗（イオン、ダイシン、ビバホーム、ユニクロ、シュープラザ、郵便、旅館等）
    else {
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (isExcluded(line) || line.match(/合\s*[計言十]/)) continue;

        // 金額の抽出（¥300、¥1,500外、198※、58※ 等）
        const priceMatch = line.replace(/[,，]/g, "").match(/[¥￥\\]?\s*([1-9]\d{1,5})\s*(外|内|円|※)?$/);
        if (priceMatch) {
          let p = parseInt(priceMatch[1], 10);
          if (priceMatch[2] === "外") p = Math.round(p * 1.1);

          let namePart = line.replace(/[,，]/g, "").substring(0, priceMatch.index);
          let cleaned = cleanItemName(namePart);

          // 同一行に品名がない場合は前の行を取得
          if (cleaned.length < 2 && i > 0) {
            const prev = rawLines[i - 1];
            if (!isExcluded(prev) && !prev.match(/[¥￥\\]/)) {
              cleaned = cleanItemName(prev);
            }
          }

          if (cleaned.length >= 2 && !isExcluded(cleaned) && p !== totalAmount) {
            if (!items.some(it => it.name === cleaned && it.price === p)) {
              items.push({ name: cleaned, price: p });
            }
          }
        }
      }
    }

    // 明細が0件の場合のフォールバック
    if (items.length === 0) {
      items.push({ name: `${store} 利用分`, price: totalAmount });
    }

    // 6. 摘要（内訳）のクリーン生成
    const memo = items.map(it => it.name).join("、");

    // 7. 勘定科目の自動推論
    let suggestedCategory = "消耗品費";
    const lower = (store + " " + fullText).toLowerCase();
    if (/enejet|eneos|出光|コスモ|オカモト|セキショウ|ヤシロ|給油|ガソリン|レギュラー|ハイオク|軽油|通行料金|nexco|乗車券|旅客鉄道|jr|交通|タクシー/.test(lower)) {
      suggestedCategory = "旅費交通費";
    } else if (/沢口旅館|旅館|ホテル|宿泊/.test(lower)) {
      suggestedCategory = "旅費交通費";
    } else if (/郵便|手紙|切手|速達/.test(lower)) {
      suggestedCategory = "通信費";
    } else if (/カフェ|珈琲|コーヒー|居酒屋|レストラン|ランチ/.test(lower)) {
      suggestedCategory = "接待交際費";
    } else if (/ロールケーキ|洋菓子|ケーキ/.test(lower)) {
      suggestedCategory = "接待交際費";
    } else if (/イオン|スーパー|食品|生鮮|青果|精肉|鮮魚/.test(lower)) {
      suggestedCategory = "福利厚生費";
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
