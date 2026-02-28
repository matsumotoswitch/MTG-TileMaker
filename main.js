/**
 * ============================================================================
 * MTG-TileMaker メインロジック
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. 定数とDOM要素
// ----------------------------------------------------------------------------
// Scryfall APIへの過度なアクセスを防ぐため、リクエスト間にランダムな遅延(100-150ms)を設ける
const getRandomDelay = () => Math.floor(Math.random() * 51) + 100;

const ui = {
  results: document.getElementById("results"),
  dropArea: document.getElementById("dropArea"),
  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  generateBtn: document.getElementById("generateBtn"),
  infoBtn: document.getElementById("infoBtn"),
  infoModal: document.getElementById("infoModal"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  fileInput: document.getElementById("fileInput"),
  sizeInfo: document.getElementById("sizeInfo"),
  settings: {
    columns: document.getElementById("columns"),
    cardWidth: document.getElementById("cardWidth"),
    gap: document.getElementById("gap"),
    totalWidth: document.getElementById("totalWidth"),
    align: document.getElementById("align"),
  }
};

// ----------------------------------------------------------------------------
// 2. 状態管理
// ----------------------------------------------------------------------------
// ドロップされたカードのリスト。回転状態もここで管理する
let droppedCards = []; // Array<{ url: string, rotation: number }>
// 最初にドロップされた画像のサイズを基準とし、以降の画像のアスペクト比計算に使用する
let baseImageSize = null; // { w: number, h: number }

// ----------------------------------------------------------------------------
// 3. ユーティリティ関数
// ----------------------------------------------------------------------------

/**
 * 検索クエリに日本語が含まれているか判定し、Scryfallのlangパラメータを決定する
 * @param {string} query
 * @returns {'ja' | 'en'}
 */
function detectLang(query) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(query) ? "ja" : "en";
}

/**
 * カードオブジェクトから画像URLを取得
 * 両面カードの場合、検索クエリに一致する面を優先して返すロジックを含む
 * @param {Object} card Scryfall APIから返却されたカードオブジェクト
 * @param {string|null} query 検索クエリ
 * @returns {string} 画像URL
 */
function getCardImageUrl(card, query = null) {
  if (query && card.card_faces && card.card_faces.length > 1) {
    const lowerQ = query.toLowerCase();
    const matchedFaces = card.card_faces.filter(face => {
      return (face.name && face.name.toLowerCase().includes(lowerQ)) || (face.printed_name && face.printed_name.toLowerCase().includes(lowerQ));
    });

    if (matchedFaces.length > 0) {
      // 完全一致 > 前方一致 > 部分一致 の順でスコアリングし、最も適切な面を選択
      matchedFaces.sort((a, b) => {
        const getScore = (f) => {
          const n = (f.name || "").toLowerCase();
          const pn = (f.printed_name || "").toLowerCase();
          if (n === lowerQ || pn === lowerQ) return 0; // 完全一致
          if (n.startsWith(lowerQ) || pn.startsWith(lowerQ)) return 1; // 前方一致
          return 2; // 部分一致
        };
        return getScore(a) - getScore(b);
      });

      const bestFace = matchedFaces[0];
      if (bestFace.image_uris) {
        return bestFace.image_uris.png || bestFace.image_uris.normal;
      }
    }
  }

  if (card.image_uris) {
    return card.image_uris.png || card.image_uris.normal;
  } else if (card.card_faces && card.card_faces[0].image_uris) {
    return card.card_faces[0].image_uris.png || card.card_faces[0].image_uris.normal;
  }
  return "";
}

/**
 * 画像をロードし、Canvasで操作可能にするためにCORS設定を行う
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    if (url.startsWith("data:")) {
      img.src = url;
    } else {
      img.crossOrigin = "anonymous";
      // ブラウザのキャッシュがCORSヘッダーを含まない場合があるため、タイムスタンプでキャッシュを回避
      img.src = url + (url.includes('?') ? '&' : '?') + "t=" + new Date().getTime();
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img); // 画像生成プロセス全体を止めないよう、エラー時もresolveする
  });
}

// ----------------------------------------------------------------------------
// 4. API処理（キューシステム）
// ----------------------------------------------------------------------------
// APIリクエストを直列化して実行するためのキュー
const apiQueue = [];
let isApiProcessing = false;

/**
 * Scryfall APIへのリクエストをキューに追加して実行
 * @param {string} url
 * @returns {Promise<Object>}
 */
function fetchScryfall(url) {
  return new Promise((resolve, reject) => {
    apiQueue.push({ url, resolve, reject });
    processApiQueue();
  });
}

/**
 * キューに積まれたリクエストを1つずつ処理し、完了ごとに遅延を入れる
 */
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
    await new Promise(r => setTimeout(r, getRandomDelay()));
  }
  isApiProcessing = false;
}

// 検索入力欄でEnterキーが押されたら検索を実行
ui.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ui.searchBtn.click();
});

// 検索ボタンクリック時の処理
ui.searchBtn.addEventListener("click", async () => {
  const query = ui.searchInput.value.trim();
  const match = document.querySelector('input[name="match"]:checked').value;
  if (!query) return;

  const lang = detectLang(query);
  // Scryfallの検索構文: 完全一致の場合は "!" を付与
  let q = (match === "exact") ? `!${query}` : query;
  q += ` lang:${lang}`;

  // unique=prints: 同名カードでもセット違いなどを全て取得する
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=name`;
  ui.results.innerHTML = "<p style='padding:0 10px; margin-top:6px; color:#ccc;'>検索中...</p>";

  // ページネーションを辿って全件取得する
  try {
    let allCards = [];
    while (url) {
      const data = await fetchScryfall(url);
      if (!data.data) break;
      allCards = allCards.concat(data.data);
      url = data.has_more ? data.next_page : null;
    }

    ui.results.innerHTML = "";

    if (allCards.length === 0) {
      ui.results.innerHTML = "<p style='padding:0 10px; margin-top:6px; color:#ccc;'>該当するカードが見つかりませんでした。</p>";
      return;
    }

    allCards.forEach(card => {
      addCardResult(card, query);
    });
  } catch (e) {
    ui.results.innerHTML = "<p style='padding:0 10px; margin-top:6px;'>検索エラーが発生しました</p>";
  }
});

// 検索結果のカード要素を作成し、DOMに追加する
function addCardResult(card, query = null) {
  // 両面カードの場合、検索クエリにヒットした面を個別にリストアップする
  let targets = [];

  if (query && card.card_faces && card.card_faces.length > 1) {
    const lowerQ = query.toLowerCase();
    const matchedFaces = card.card_faces.filter(face => {
      return (face.name && face.name.toLowerCase().includes(lowerQ)) || 
             (face.printed_name && face.printed_name.toLowerCase().includes(lowerQ));
    });

    if (matchedFaces.length > 0) {
      matchedFaces.forEach(face => {
        if (face.image_uris) {
          targets.push({
            imgUrl: face.image_uris.png || face.image_uris.normal,
            displayName: face.printed_name || face.name,
            faceIndex: card.card_faces.indexOf(face)
          });
        }
      });
    }
  }

  // 通常カード、または特定の面マッチがない場合のフォールバック
  if (targets.length === 0) {
    const imgUrl = getCardImageUrl(card, query);
    if (imgUrl) {
      targets.push({
        imgUrl: imgUrl,
        displayName: card.name,
        faceIndex: -1
      });
    }
  }

  targets.forEach(target => {
    const el = document.createElement("div");
    el.className = "card-item";
    el.draggable = true;
    el.innerHTML = `
      <img src="${target.imgUrl}" crossorigin="anonymous" style="width:100%; display:block; pointer-events:none;" />
      <div class="card-overlay">
        <div class="name">${target.displayName}</div>
      <div class="set-name">${card.set_name}</div>
        <div class="size"></div>
      </div>
      <div class="card-footer">
        <a class="card-link" href="${card.scryfall_uri}" target="_blank" title="Scryfallで詳細を見る">🌐</a>
        <div class="langArea"></div>
      </div>
    `;
    ui.results.appendChild(el);

    // 画像本来のサイズを取得し、オーバーレイに表示
    const img = el.querySelector("img");
    img.onload = () => {
      el.dataset.w = img.naturalWidth;
      el.dataset.h = img.naturalHeight;
      el.querySelector(".size").textContent = `${img.naturalWidth}×${img.naturalHeight}px`;
    };

    // ドロップ先に渡すデータ。言語切り替え後のURLに対応するため img.src を使用
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/json", JSON.stringify({
        url: img.src, w: el.dataset.w, h: el.dataset.h
      }));
    });

    // 他言語版の検索URLを構築 (prints_search_uri はデフォルトで英語のみの場合があるため lang:any を付与)
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

    // 非同期で他言語版を取得し、ボタンを生成
    fetchAllPrints(printsUri).then(printCards => {
      const langs = {};
      printCards.forEach(p => {
        if (p.set !== card.set) return;
        if (p.collector_number !== card.collector_number) return;
        
        let pUrl = null;
        if (target.faceIndex >= 0 && p.card_faces && p.card_faces[target.faceIndex]) {
           const f = p.card_faces[target.faceIndex];
           if (f.image_uris) pUrl = f.image_uris.png || f.image_uris.normal;
        } else {
           pUrl = getCardImageUrl(p); // 通常カード
        }

        if (pUrl) langs[p.lang] = pUrl;
      });
      renderLangButtons(el, langs, card.lang || "en");
    });
  });
}

// Scryfallのページネーションを処理して全データを取得する
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

// 言語切り替えボタンのUI生成
function renderLangButtons(el, langs, initialLang) {
  const langArea = el.querySelector(".langArea");
  const flagMap = { 
    ja: "JP", en: "EN", fr: "FR", de: "DE", es: "ES", it: "IT", pt: "PT", ru: "RU", ko: "KR", 
    zhs: "CN", zht: "TW", ph: "Φ", he: "HE", la: "LA", grc: "GR", ar: "AR", sa: "SA" 
  };
  const keys = Object.keys(langs);
  if (keys.length === 0) return;

  langArea.innerHTML = ""; // クリア

  // 横スクロール操作の補助
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
    
    // ボタンクリック時にカード自体のドラッグが始まらないようにする
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

ui.dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  ui.dropArea.classList.add("dragover");
});
ui.dropArea.addEventListener("dragleave", () => ui.dropArea.classList.remove("dragover"));

// ドロップ処理：新規カードの追加または並び替え
ui.dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  ui.dropArea.classList.remove("dragover");

  // ローカルファイル（画像）のドロップ処理
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFiles(e.dataTransfer.files);
    return;
  }

  // 内部での並び替え（reorder-idxがある場合）はここでは処理せず、各カードのdropイベントで処理する
  if (e.dataTransfer.getData("text/reorder-idx")) return;

  // 検索結果からの新規ドロップ
  const json = e.dataTransfer.getData("application/json");
  if (json && !e.dataTransfer.getData("text/reorder-idx")) {
    const { url, w, h } = JSON.parse(json);
    if (!baseImageSize) baseImageSize = { w: Number(w), h: Number(h) };
    droppedCards.push({ url, rotation: 0 });
    renderDropPreview();
    updateSizeInfo();
  }
});

// 画像追加ボタンのクリックイベント
ui.uploadBtn.addEventListener("click", () => {
  ui.fileInput.click();
});

// ファイル選択時のイベント
ui.fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleFiles(e.target.files);
    // 同じファイルを再度選択できるようにリセット
    ui.fileInput.value = "";
  }
});

// ローカル画像を読み込み、角丸の透過処理を行ってからリストに追加する
async function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;

    try {
      const rawUrl = await readFileAsDataURL(file);
      const processedUrl = await processRoundCorners(rawUrl);
      const img = await loadImage(processedUrl);

      if (!baseImageSize) baseImageSize = { w: img.naturalWidth, h: img.naturalHeight };
      
      droppedCards.push({ url: processedUrl, rotation: 0 });
    } catch (err) {
      console.error("画像の読み込みに失敗しました:", err);
    }
  }
  renderDropPreview();
  updateSizeInfo();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

// 画像の四隅にある白い背景色を検知し、Flood Fillアルゴリズムで透明化する
async function processRoundCorners(url) {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  canvas.width = w;
  canvas.height = h;

  ctx.drawImage(img, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const visited = new Uint8Array(w * h); // 訪問済みフラグ

  const tolerance = 40; // 色の許容差
  const whiteThreshold = 200; // 白とみなす輝度の閾値

  const getIdx = (x, y) => (y * w + x) * 4;

  // 指定座標(x,y)を起点に、色が近い領域を塗りつぶす（透明にする）
  const removeCornerColor = (startX, startY) => {
    const startIdx = getIdx(startX, startY);
    const r0 = data[startIdx];
    const g0 = data[startIdx + 1];
    const b0 = data[startIdx + 2];
    const a0 = data[startIdx + 3];

    // 起点がすでに透明、または白っぽくない場合は処理をスキップ
    if (a0 < 20) return;
    if (r0 < whiteThreshold || g0 < whiteThreshold || b0 < whiteThreshold) return;

    const queue = [[startX, startY]];
    visited[startY * w + startX] = 1;

    // カード内部の白領域まで消さないよう、探索範囲を四隅付近（各辺の25%）に制限する
    const limitX = Math.floor(w * 0.25);
    const limitY = Math.floor(h * 0.25);
    const minX = (startX < w / 2) ? 0 : w - limitX;
    const maxX = (startX < w / 2) ? limitX : w;
    const minY = (startY < h / 2) ? 0 : h - limitY;
    const maxY = (startY < h / 2) ? limitY : h;

    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      const idx = getIdx(cx, cy);

      // 色差チェック
      if (Math.abs(data[idx] - r0) > tolerance || 
          Math.abs(data[idx+1] - g0) > tolerance || 
          Math.abs(data[idx+2] - b0) > tolerance) {
        continue;
      }

      // 透明化
      data[idx + 3] = 0;

      // 4近傍探索
      const neighbors = [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]];
      for (const [nx, ny] of neighbors) {
        if (nx >= minX && nx < maxX && ny >= minY && ny < maxY) {
          const vIdx = ny * w + nx;
          if (visited[vIdx] === 0) {
            visited[vIdx] = 1;
            queue.push([nx, ny]);
          }
        }
      }
    }
  };

  // 四隅それぞれに対して処理を実行
  removeCornerColor(0, 0);
  removeCornerColor(w - 1, 0);
  removeCornerColor(0, h - 1);
  removeCornerColor(w - 1, h - 1);

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * 現在のカードリストと設定値に基づいて、キャンバス上の配置座標とサイズを計算する
 * @returns {object|null} 計算されたレイアウト情報、またはカードがない場合はnull
 */
function calculateLayout() {
  if (droppedCards.length === 0 || !baseImageSize) {
    return null;
  }

  const columns = parseInt(ui.settings.columns.value) || 1;
  const cardWidth = parseInt(ui.settings.cardWidth.value) || 200;
  const gap = parseInt(ui.settings.gap.value) || 0;
  const userTotalWidth = parseInt(ui.settings.totalWidth.value) || 0;
  const align = ui.settings.align.value;
  const ratio = baseImageSize.h / baseImageSize.w;

  // カードリストを指定列数で分割して行を作成
  const cardRows = [];
  for (let i = 0; i < droppedCards.length; i += columns) {
    cardRows.push(droppedCards.slice(i, i + columns));
  }

  let maxWidth = 0;
  const rowMetrics = cardRows.map(row => {
    let rowW = 0;
    let rowH = 0;
    const items = row.map(card => {
      // 90度回転している場合、幅と高さの比率を入れ替えて計算する
      const isRotated = (card.rotation / 90) % 2 !== 0;
      const w = Math.round(isRotated ? cardWidth * ratio : cardWidth);
      const h = Math.round(isRotated ? cardWidth : cardWidth * ratio);
      rowW += w;
      rowH = Math.max(rowH, h);
      return { w, h, rotation: card.rotation, url: card.url };
    });
    rowW += Math.max(0, items.length - 1) * gap;
    maxWidth = Math.max(maxWidth, rowW);
    return { width: rowW, height: rowH, items };
  });

  const totalHeight = rowMetrics.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rowMetrics.length - 1) * gap;
  const finalCanvasWidth = userTotalWidth > 0 ? userTotalWidth : maxWidth;

  return {
    rows: rowMetrics,
    totalHeight,
    finalCanvasWidth,
    settings: { columns, cardWidth, gap, align }
  };
}

// プレビュー画面（ドロップエリア）の描画
function renderDropPreview() {
  ui.dropArea.innerHTML = "";
  const layout = calculateLayout();

  if (!layout) {
    ui.dropArea.innerHTML = '<p>ここにカードをドラッグ＆ドロップ</p>';
    ui.dropArea.style.display = 'flex';
    baseImageSize = null;
    return;
  }

  const { rows, finalCanvasWidth, settings } = layout;
  const { gap, align } = settings;

  ui.dropArea.style.display = "block";
  ui.dropArea.style.padding = "10px";

  const artboard = document.createElement("div");
  artboard.className = "artboard";
  artboard.style.width = finalCanvasWidth + "px";
  
  rows.forEach((row, rowIdx) => {
    const rowDiv = document.createElement("div");
    rowDiv.style.display = "flex";
    rowDiv.style.gap = gap + "px";
    if (rowIdx < rows.length - 1) {
      rowDiv.style.marginBottom = gap + "px";
    }
    rowDiv.style.justifyContent = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";    

    row.items.forEach((cardData, colIdx) => {
      const idx = rowIdx * settings.columns + colIdx;
      const card = document.createElement("div");
      card.className = "canvas-card";
      card.draggable = true;

      const isRotated = (cardData.rotation / 90) % 2 !== 0;
      const displayW = cardData.w;
      const displayH = cardData.h;

      card.style.width = displayW + "px";
      card.style.height = displayH + "px";

      // 画像自体の回転処理（CSS transform）
      const imgTransform = `translate(-50%, -50%) rotate(${cardData.rotation}deg)`;
      const imgW = isRotated ? displayH : displayW;
      const imgH = isRotated ? displayW : displayH;

      card.innerHTML = `
        <div style="width:100%; height:100%; overflow:hidden; position:relative;">
          <img src="${cardData.url}" style="position:absolute; left:50%; top:50%; width:${imgW}px; height:${imgH}px; transform:${imgTransform}; pointer-events:none;" />
        </div>
        <button class="rotate-btn rotate-l" title="左に90度回転">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"></path><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
        </button>
        <button class="rotate-btn rotate-r" title="右に90度回転">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
        <button class="remove-btn" title="削除">×</button>
      `;

      // ドラッグ＆ドロップによる並び替え処理
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/reorder-idx", idx);
        card.style.opacity = "0.4";
      });
      card.addEventListener("dragover", (e) => e.preventDefault());
      
      card.addEventListener("drop", (e) => {
        e.preventDefault(); e.stopPropagation();
        const fromIdx = e.dataTransfer.getData("text/reorder-idx");
        if (fromIdx !== "" && parseInt(fromIdx) !== idx) {
          const item = droppedCards.splice(parseInt(fromIdx), 1)[0];
          droppedCards.splice(idx, 0, item);
          renderDropPreview(); updateSizeInfo();
        // 新規ドロップがカード上に落ちた場合の挿入処理
        } else if (!fromIdx) {
          const json = e.dataTransfer.getData("application/json");
          if (json) {
            const { url } = JSON.parse(json);
            droppedCards.splice(idx, 0, { url, rotation: 0 });
            renderDropPreview(); updateSizeInfo();
          }
        }
      });
      card.addEventListener("dragend", () => card.style.opacity = "1");
      
      card.querySelector(".remove-btn").onclick = (e) => {
        e.stopPropagation();
        droppedCards.splice(idx, 1);
        renderDropPreview(); updateSizeInfo();
      };

      const currentCardData = droppedCards[idx];
      card.querySelector(".rotate-l").onclick = (e) => {
        e.stopPropagation();
        currentCardData.rotation = (currentCardData.rotation - 90) % 360;
        renderDropPreview(); updateSizeInfo();
      };
      card.querySelector(".rotate-r").onclick = (e) => {
        e.stopPropagation();
        currentCardData.rotation = (currentCardData.rotation + 90) % 360;
        renderDropPreview(); updateSizeInfo();
      };

      rowDiv.appendChild(card);
    });
    artboard.appendChild(rowDiv);
  });

  ui.dropArea.appendChild(artboard);
}

// 最終的な画像を生成してダウンロードする
ui.generateBtn.addEventListener("click", async () => {
  const layout = calculateLayout();
  if (!layout) return;

  const { rows, totalHeight, finalCanvasWidth, settings } = layout;
  const { gap, align } = settings;

  // 高解像度画像を順次取得（サーバー負荷軽減のため遅延を入れる）
  const imgs = [];
  for (const c of droppedCards) {
    imgs.push(await loadImage(c.url));
    await new Promise(r => setTimeout(r, getRandomDelay()));
  }
  
  // Canvasの作成
  const canvas = document.createElement("canvas");
  canvas.width = finalCanvasWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d");

  let currentY = 0;
  rows.forEach((row, rowIdx) => {
    let currentX = (align === "center") ? (finalCanvasWidth - row.width) / 2 : (align === "right") ? (finalCanvasWidth - row.width) : 0;
    
    row.items.forEach((item, itemIdx) => {
      const cardIdx = rowIdx * settings.columns + itemIdx;
      const img = imgs[cardIdx];

      ctx.save();
      const cx = currentX + item.w / 2;
      const cy = currentY + item.h / 2;
      ctx.translate(cx, cy);
      // Canvasコンテキストを回転させて描画
      ctx.rotate(item.rotation * Math.PI / 180);
      
      const isRotated = (item.rotation / 90) % 2 !== 0;
      // 回転している場合、描画する画像の幅と高さを入れ替える必要がある
      const drawW = isRotated ? item.h : item.w;
      const drawH = isRotated ? item.w : item.h;

      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
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
const clearBtn = document.createElement("button");
clearBtn.id = "clearBtn";
clearBtn.textContent = "クリア";
ui.generateBtn.parentNode.insertBefore(clearBtn, ui.generateBtn.nextSibling);

clearBtn.addEventListener("click", () => {
  if (droppedCards.length === 0) return;
  if (!confirm("配置したカードをすべて削除しますか？")) return;
  droppedCards = [];
  baseImageSize = null;
  renderDropPreview();
  updateSizeInfo();
});

// 出力予定サイズの情報を更新して表示する
function updateSizeInfo() {
  const layout = calculateLayout();
  if (!layout) {
    ui.sizeInfo.textContent = "出力予定: ―";
    return;
  }
  ui.sizeInfo.textContent = `出力予定: ${layout.finalCanvasWidth} × ${layout.totalHeight}px`;
}

// 設定入力欄の変更イベントリスナー
["columns", "cardWidth", "gap", "totalWidth", "align"].forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    renderDropPreview(); updateSizeInfo();
  });
});

// インフォメーションモーダルの制御
ui.infoBtn.addEventListener("click", () => {
  ui.infoModal.classList.add("show");
});
ui.closeModalBtn.addEventListener("click", () => {
  ui.infoModal.classList.remove("show");
});
ui.infoModal.addEventListener("click", (e) => {
  if (e.target === ui.infoModal) {
    ui.infoModal.classList.remove("show");
  }
});
