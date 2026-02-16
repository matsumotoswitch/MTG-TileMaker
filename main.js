// DOM要素の参照取得
const results = document.getElementById("results");
const dropArea = document.getElementById("dropArea");

// 状態管理用変数
let droppedCards = [];
let baseImageSize = null;

// 検索入力欄でEnterキーが押されたら検索を実行
document.getElementById("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("searchBtn").click();
});

// 検索クエリから言語を自動判定（日本語文字が含まれる場合は 'ja'、それ以外は 'en'）
function detectLang(query) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(query) ? "ja" : "en";
}

// カードオブジェクトから画像URLを取得（通常カードと両面カードに対応）
function getCardImageUrl(card) {
  if (card.image_uris) {
    return card.image_uris.png || card.image_uris.normal;
  } else if (card.card_faces && card.card_faces[0].image_uris) {
    return card.card_faces[0].image_uris.png || card.card_faces[0].image_uris.normal;
  }
  return "";
}

// APIリクエスト管理用キューと処理関数
// Scryfall APIのレートリミット（平均10リクエスト/秒）を遵守するため、
// リクエストを直列化し、間に150msの遅延を入れる
const apiQueue = [];
let isApiProcessing = false;

function fetchScryfall(url) {
  return new Promise((resolve, reject) => {
    apiQueue.push({ url, resolve, reject });
    processApiQueue();
  });
}

async function processApiQueue() {
  if (isApiProcessing) return;
  isApiProcessing = true;

  while (apiQueue.length > 0) {
    const { url, resolve, reject } = apiQueue.shift();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const data = await res.json();
      resolve(data);
    } catch (e) {
      reject(e);
    }
    // 150msの遅延を入れる (50-100msの要求に対して余裕を持つ)
    await new Promise(r => setTimeout(r, 150));
  }
  isApiProcessing = false;
}

// 検索ボタンクリック時の処理
document.getElementById("searchBtn").addEventListener("click", async () => {
  const query = document.getElementById("searchInput").value.trim();
  const match = document.querySelector('input[name="match"]:checked').value;
  if (!query) return;

  // 言語判定と検索クエリの構築
  const lang = detectLang(query);
  let q = (match === "exact") ? `!${query}` : query;
  q += ` lang:${lang}`;

  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=name`;
  results.innerHTML = "<p style='padding:10px; color:#ccc;'>検索中...</p>";

  // Scryfall APIからデータを取得（ページネーション対応）
  try {
    let allCards = [];
    while (url) {
      const data = await fetchScryfall(url);
      if (!data.data) break;
      allCards = allCards.concat(data.data);
      url = data.has_more ? data.next_page : null;
    }

    results.innerHTML = "";

    if (allCards.length === 0) {
      results.innerHTML = "<p style='padding:10px; color:#ccc;'>該当するカードが見つかりませんでした。</p>";
      return;
    }

    // 取得したカードを画面に表示
    allCards.forEach(card => {
      addCardResult(card); // 整理された関数を呼び出す
    });
  } catch (e) {
    results.innerHTML = "<p>検索エラーが発生しました</p>";
  }
});

// 検索結果のカード要素を作成し、DOMに追加する
function addCardResult(card) {
  const imgUrl = getCardImageUrl(card);
  if (!imgUrl) return;

  // カード要素のHTML構造を作成
  const el = document.createElement("div");
  el.className = "card-item";
  el.draggable = true;
  el.innerHTML = `
    <img src="${imgUrl}" crossorigin="anonymous" style="width:100%; display:block; pointer-events:none;" />
    <div class="card-overlay">
      <div class="name">${card.name}</div>
      <div class="size"></div>
    </div>
    <div class="card-footer">
      <a class="card-link" href="${card.scryfall_uri}" target="_blank" title="Scryfallで詳細を見る">🌐</a>
      <div class="langArea"></div>
    </div>
  `;
  results.appendChild(el);

  // 画像読み込み完了時にサイズ情報を取得して表示
  const img = el.querySelector("img");
  img.onload = () => {
    el.dataset.w = img.naturalWidth;
    el.dataset.h = img.naturalHeight;
    el.querySelector(".size").textContent = `${img.naturalWidth}×${img.naturalHeight}px`;
  };

  // ドラッグ開始時のデータ設定（画像URLとサイズ）
  el.addEventListener("dragstart", (e) => {
    // 現在の img.src (言語切り替え後も考慮) を渡す
    e.dataTransfer.setData("application/json", JSON.stringify({
      url: img.src, w: el.dataset.w, h: el.dataset.h
    }));
  });

  // 他の言語版（プリント）を取得して切り替えボタンを生成
  let printsUri = card.prints_search_uri;
  if (printsUri) {
    try {
      const u = new URL(printsUri);
      const q = u.searchParams.get("q");
      if (q) {
        u.searchParams.set("q", q + " lang:any");
        printsUri = u.toString();
      }
    } catch (e) { console.error(e); }
  }

  fetchAllPrints(printsUri).then(printCards => {
    const langs = {};
    printCards.forEach(p => {
      if (p.set !== card.set) return;
      if (p.collector_number !== card.collector_number) return;
      const pUrl = getCardImageUrl(p);
      if (pUrl) langs[p.lang] = pUrl;
    });
    renderLangButtons(el, langs, card.lang || "en");
  });
}

// 指定されたURLから全ページのデータを取得するヘルパー関数
async function fetchAllPrints(url) {
  let all = [];
  let next = url;
  while (next) {
    const data = await fetchScryfall(next);
    if (!data.data) break;
    all = all.concat(data.data);
    next = data.has_more ? data.next_page : null;
  }
  return all;
}

// 言語切り替えボタンを描画し、クリックイベントを設定する
function renderLangButtons(el, langs, initialLang) {
  const langArea = el.querySelector(".langArea");
  const flagMap = { 
    ja: "JP", en: "EN", fr: "FR", de: "DE", es: "ES", it: "IT", pt: "PT", ru: "RU", ko: "KR", 
    zhs: "CN", zht: "TW", ph: "Φ", he: "HE", la: "LA", grc: "GR", ar: "AR", sa: "SA" 
  };
  const keys = Object.keys(langs);
  if (keys.length === 0) return;

  langArea.innerHTML = ""; // クリア

  // マウスホイールで横スクロールできるようにする
  langArea.addEventListener("wheel", (e) => {
    if (e.deltaY) {
      e.preventDefault();
      langArea.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  let currentLang = initialLang && langs[initialLang] ? initialLang : keys[0];

  const updateHighlight = () => {
    langArea.querySelectorAll(".langBtn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.lang === currentLang);
    });
  };

  keys.forEach(lang => {
    const btn = document.createElement("button");
    btn.className = "langBtn";
    btn.textContent = flagMap[lang] || lang.toUpperCase();
    btn.dataset.lang = lang;
    
    // ドラッグ開始を防ぐ
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.onclick = (e) => {
      e.stopPropagation();
      if (langs[lang]) {
        el.querySelector("img").src = langs[lang];
        currentLang = lang;
        updateHighlight();
      }
    };
    langArea.appendChild(btn);
  });
  
  updateHighlight();
}

// ドロップエリアのドラッグオーバー処理（スタイル変更）
dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.classList.add("dragover");
});
dropArea.addEventListener("dragleave", () => dropArea.classList.remove("dragover"));

// ドロップ処理：新規カードの追加または並び替え
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  if (e.dataTransfer.getData("text/reorder-idx")) return;

  const json = e.dataTransfer.getData("application/json");
  if (json && !e.dataTransfer.getData("text/reorder-idx")) {
    const { url, w, h } = JSON.parse(json);
    if (!baseImageSize) baseImageSize = { w: Number(w), h: Number(h) };
    droppedCards.push({ url, rotation: 0 });
    renderDropPreview();
    updateSizeInfo();
  }
});

// ドロップエリアの描画（プレビュー）
// グリッドレイアウトの計算と、ドラッグによる並び替え機能を提供
function renderDropPreview() {
  dropArea.innerHTML = "";
  if (droppedCards.length === 0) {
    dropArea.innerHTML = '<p>ここにカードをドラッグ＆ドロップ</p>';
    baseImageSize = null;
    return;
  }

  // 設定値の取得
  const columns = parseInt(document.getElementById("columns").value) || 1;
  const cardWidth = parseInt(document.getElementById("cardWidth").value) || 200;
  const gap = parseInt(document.getElementById("gap").value) || 0;
  const userTotalWidth = parseInt(document.getElementById("totalWidth").value) || 0;
  const align = document.getElementById("align").value;

  dropArea.style.display = "block";
  dropArea.style.padding = "10px";

  // アートボード（描画領域）の作成
  const artboard = document.createElement("div");
  artboard.className = "artboard";
  // 幅は後で計算するか、行ごとに制御するためここではスタイルのみ
  artboard.style.border = "1px solid #666";
  artboard.style.padding = "0";
  artboard.style.display = "block"; // 行を積む
  
  // 行ごとに分割して処理
  const rows = [];
  for (let i = 0; i < droppedCards.length; i += columns) {
    rows.push(droppedCards.slice(i, i + columns));
  }

  let maxRowWidth = 0;

  rows.forEach((rowItems, rowIdx) => {
    const rowDiv = document.createElement("div");
    rowDiv.style.display = "flex";
    rowDiv.style.gap = gap + "px";
    if (rowIdx < rows.length - 1) {
      rowDiv.style.marginBottom = gap + "px";
    }
    rowDiv.style.justifyContent = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
    
    let currentRowWidth = 0;

    rowItems.forEach((cardData, colIdx) => {
      const idx = rowIdx * columns + colIdx;
      const card = document.createElement("div");
      card.className = "canvas-card";
      card.draggable = true;
      card.style.position = "relative";

      // サイズ計算
      // baseImageSizeのアスペクト比を使用
      const ratio = baseImageSize ? (baseImageSize.h / baseImageSize.w) : 1.4;
      const isRotated = (cardData.rotation / 90) % 2 !== 0;
      
      // 回転時は高さがcardWidthになる仕様 -> 幅は cardWidth * ratio
      // 通常時は幅がcardWidthになる仕様 -> 高さは cardWidth * ratio
      const displayW = Math.round(isRotated ? cardWidth * ratio : cardWidth);
      const displayH = Math.round(isRotated ? cardWidth : cardWidth * ratio);

      card.style.width = displayW + "px";
      card.style.height = displayH + "px";
      currentRowWidth += displayW;

      // 画像の回転表示
      const imgTransform = `translate(-50%, -50%) rotate(${cardData.rotation}deg)`;
      card.innerHTML = `
        <div style="width:100%; height:100%; overflow:hidden; position:relative;">
          <img src="${cardData.url}" style="position:absolute; left:50%; top:50%; width:${isRotated ? displayH : displayW}px; height:${isRotated ? displayW : displayH}px; transform:${imgTransform}; pointer-events:none;" />
        </div>
        <button class="rotate-btn" title="右に90度回転" style="pointer-events:auto; position:absolute; bottom:5px; left:5px; z-index:10; background:rgba(0, 123, 255, 0.8); color:white; border:none; border-radius:50%; width:24px; height:24px; cursor:pointer; display:flex; align-items:center; justify-content:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
        <button class="remove-btn" title="削除" style="pointer-events:auto; position:absolute; top:5px; right:5px; z-index:10; background:rgba(255,0,0,0.6); color:white; border:none; border-radius:50%; width:24px; height:24px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:16px;">
          ×
        </button>
      `;

    // 並び替えのためのドラッグイベント
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/reorder-idx", idx);
      card.style.opacity = "0.4";
    });
    card.addEventListener("dragover", (e) => e.preventDefault());
    // ドロップ時の入れ替え処理
    card.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      const fromIdx = e.dataTransfer.getData("text/reorder-idx");
      if (fromIdx !== "" && parseInt(fromIdx) !== idx) {
        const item = droppedCards.splice(parseInt(fromIdx), 1)[0];
        droppedCards.splice(idx, 0, item);
        renderDropPreview(); updateSizeInfo();
      } else if (!fromIdx) {
        const json = e.dataTransfer.getData("application/json");
        if (json) {
          const { url } = JSON.parse(json); // 新規ドロップ
          droppedCards.splice(idx, 0, { url, rotation: 0 });
          renderDropPreview(); updateSizeInfo();
        }
      }
    });
    card.addEventListener("dragend", () => card.style.opacity = "1");
    
    // 削除ボタン
    card.querySelector(".remove-btn").onclick = (e) => {
      e.stopPropagation();
      droppedCards.splice(idx, 1);
      renderDropPreview(); updateSizeInfo();
    };

    // 回転ボタン
    card.querySelector(".rotate-btn").onclick = (e) => {
      e.stopPropagation();
      cardData.rotation = (cardData.rotation + 90) % 360;
      renderDropPreview(); updateSizeInfo();
    };

      rowDiv.appendChild(card);
    });

    currentRowWidth += Math.max(0, rowItems.length - 1) * gap;
    maxRowWidth = Math.max(maxRowWidth, currentRowWidth);
    artboard.appendChild(rowDiv);
  });

  const finalCanvasWidth = userTotalWidth > 0 ? userTotalWidth : maxRowWidth;
  artboard.style.width = finalCanvasWidth + "px";
  dropArea.appendChild(artboard);
}

// 画像生成とダウンロード処理
// Canvasを使用してタイル状に画像を配置し、PNGとして出力する
document.getElementById("generateBtn").addEventListener("click", async () => {
  if (droppedCards.length === 0) return;
  const columns = parseInt(document.getElementById("columns").value);
  const cardWidth = parseInt(document.getElementById("cardWidth").value);
  const gap = parseInt(document.getElementById("gap").value);
  const userTotalWidth = parseInt(document.getElementById("totalWidth").value) || 0;
  const align = document.getElementById("align").value;

  // 全画像の読み込みを待機
  const imgs = await Promise.all(droppedCards.map(c => loadImage(c.url)));
  
  // 行ごとのレイアウト計算
  const rows = [];
  for (let i = 0; i < droppedCards.length; i += columns) {
    rows.push({
      items: droppedCards.slice(i, i + columns),
      imgs: imgs.slice(i, i + columns)
    });
  }

  let maxWidth = 0;
  let totalHeight = 0;
  const rowMetrics = rows.map(row => {
    let rowW = 0;
    let rowH = 0;
    const items = row.items.map((card, idx) => {
      const img = row.imgs[idx];
      const ratio = img.naturalHeight / img.naturalWidth;
      const isRotated = (card.rotation / 90) % 2 !== 0;
      // 回転時は高さがcardWidthになる -> 幅は cardWidth * ratio
      const w = Math.round(isRotated ? cardWidth * ratio : cardWidth);
      const h = Math.round(isRotated ? cardWidth : cardWidth * ratio);
      rowW += w;
      rowH = Math.max(rowH, h);
      return { w, h, img, rotation: card.rotation };
    });
    rowW += Math.max(0, items.length - 1) * gap;
    maxWidth = Math.max(maxWidth, rowW);
    return { width: rowW, height: rowH, items };
  });

  totalHeight = rowMetrics.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rowMetrics.length - 1) * gap;
  const canvasWidth = userTotalWidth > 0 ? userTotalWidth : maxWidth;

  // Canvasの作成
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d");

  let currentY = 0;
  rowMetrics.forEach(row => {
    let currentX = (align === "center") ? (canvasWidth - row.width) / 2 : (align === "right") ? (canvasWidth - row.width) : 0;
    
    row.items.forEach(item => {
      const radius = Math.round(cardWidth * 0.045);
      ctx.save();
      // 中心へ移動して回転
      const cx = currentX + item.w / 2;
      const cy = currentY + item.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(item.rotation * Math.PI / 180);
      
      // 描画サイズ（回転コンテキスト上では、回転前の幅・高さで描画する）
      // item.w, item.h は回転後のサイズ。
      // 90度回転時: item.w は画像の高さ相当、item.h は画像の幅相当
      const drawW = (item.rotation / 90) % 2 !== 0 ? item.h : item.w;
      const drawH = (item.rotation / 90) % 2 !== 0 ? item.w : item.h;

      ctx.beginPath();
      ctx.roundRect(-drawW / 2, -drawH / 2, drawW, drawH, radius);
      ctx.clip();
      ctx.drawImage(item.img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      currentX += item.w + gap;
    });
    currentY += row.height + gap;
  });

  // 画像のダウンロード
  const link = document.createElement("a");
  link.download = `${new Date().getTime()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

// クリアボタンの追加とイベント設定
const generateBtn = document.getElementById("generateBtn");
const clearBtn = document.createElement("button");
clearBtn.id = "clearBtn";
clearBtn.textContent = "クリア";
generateBtn.parentNode.insertBefore(clearBtn, generateBtn.nextSibling);

clearBtn.addEventListener("click", () => {
  if (droppedCards.length === 0) return;
  if (!confirm("配置したカードをすべて削除しますか？")) return;
  droppedCards = [];
  baseImageSize = null;
  renderDropPreview();
  updateSizeInfo();
});

// 画像読み込みのヘルパー関数（CORS対応）
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.src = url + (url.includes('?') ? '&' : '?') + "t=" + new Date().getTime();
  });
}

// 出力予定サイズの情報を更新して表示する
function updateSizeInfo() {
  const sizeInfo = document.getElementById("sizeInfo");
  if (droppedCards.length === 0 || !baseImageSize) {
    sizeInfo.textContent = "画像サイズ: ―"; return;
  }
  const columns = parseInt(document.getElementById("columns").value);
  const cardWidth = parseInt(document.getElementById("cardWidth").value);
  const gap = parseInt(document.getElementById("gap").value);
  const userTotalWidth = parseInt(document.getElementById("totalWidth").value) || 0;
  
  // 簡易計算：行ごとの最大幅と高さを積算
  let maxWidth = 0;
  let totalHeight = 0;
  const ratio = baseImageSize.h / baseImageSize.w;

  for (let i = 0; i < droppedCards.length; i += columns) {
    const rowItems = droppedCards.slice(i, i + columns);
    let rowW = 0;
    let rowH = 0;
    rowItems.forEach(c => {
      const isRotated = (c.rotation / 90) % 2 !== 0;
      const w = Math.round(isRotated ? cardWidth * ratio : cardWidth);
      const h = Math.round(isRotated ? cardWidth : cardWidth * ratio);
      rowW += w;
      rowH = Math.max(rowH, h);
    });
    rowW += Math.max(0, rowItems.length - 1) * gap;
    maxWidth = Math.max(maxWidth, rowW);
    totalHeight += rowH + (i + columns < droppedCards.length ? gap : 0); // 最後の行以外gap追加
  }

  const finalWidth = userTotalWidth > 0 ? userTotalWidth : maxWidth;
  sizeInfo.textContent = `出力予定: ${finalWidth} × ${totalHeight}px`;
}

// 設定入力欄の変更イベントリスナー
["columns", "cardWidth", "gap", "totalWidth", "align"].forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    renderDropPreview(); updateSizeInfo();
  });
});
