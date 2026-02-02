const results = document.getElementById("results");
const dropArea = document.getElementById("dropArea");
const downloadArea = document.getElementById("downloadArea");

let droppedCards = [];
let baseImageSize = null; // { w, h }

// Enterで検索
document.getElementById("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    document.getElementById("searchBtn").click();
  }
});

// 言語自動判定
function detectLang(query) {
  const japaneseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/;
  return japaneseRegex.test(query) ? "ja" : "en";
}

// 検索
document.getElementById("searchBtn").addEventListener("click", async () => {
  const query = document.getElementById("searchInput").value.trim();
  const match = document.querySelector('input[name="match"]:checked').value;

  baseImageSize = null;

  if (!query) return;

  const lang = detectLang(query);

  let q = query;
  if (match === "exact") q = `!${query}`;
  q = `${q} lang:${lang}`;

  // unique=prints で版違いを取得、order=name でカード名順
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=name`;

  results.innerHTML = "";

  try {
    let allCards = [];

    while (url) {
      const res = await fetch(url);
      const data = await res.json();

      if (!data.data || data.data.length === 0) break;

      allCards = allCards.concat(data.data);
      url = data.has_more ? data.next_page : null;
    }

    if (allCards.length === 0) {
      results.innerHTML = "<p>検索結果がありません</p>";
      return;
    }

    // 同名カードを発売日順にソート
    allCards.sort((a, b) => {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;

      // 同名なら発売日順
      const da = new Date(a.released_at);
      const db = new Date(b.released_at);
      return da - db;
    });

    allCards.forEach(card => {
      addCardResult(card);
    });


  } catch (e) {
    results.innerHTML = "<p>検索に失敗しました</p>";
  }
});

function addCardResult(card) {
  const url = card.image_uris?.png || card.image_uris?.normal;
  if (!url) return;

  const el = document.createElement("div");
  el.className = "card-item";
  el.draggable = true;

  el.innerHTML = `
    <img src="${url}" alt="${card.name}" crossorigin="anonymous" />

    <div class="card-overlay">
      <div class="name">${card.name}</div>
      <div class="released">${card.released_at}</div>
      <div class="size"></div>
    </div>

    <div class="card-footer">
      <a class="card-link" href="${card.scryfall_uri}" target="_blank" title="Scryfallで詳細を見る">🌐</a>
      <div class="langArea"></div>
    </div>
  `;

  results.appendChild(el);

  // 画像サイズ表示
  const img = el.querySelector("img");
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    el.dataset.w = w;
    el.dataset.h = h;
    el.querySelector(".size").textContent = `${w} × ${h}px`;
  };

  // ドラッグ
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/url", url);
    
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({
        url,
        w: el.dataset.w,
        h: el.dataset.h
      })
    );
  });

  // 言語取得
  fetchAllPrints(card.prints_search_uri)
    .then(printCards => {
      const langs = {};
      printCards.forEach(p => {
        const imgUrl = p.image_uris?.png || p.image_uris?.normal;
        if (!imgUrl) return;
        langs[p.lang] = imgUrl;
      });
      renderLangButtons(el, langs, card.lang || "en");
    })
    .catch(() => {
      el.querySelector(".langArea").textContent = "言語情報取得失敗";
    });
}

async function fetchAllPrints(url) {
  let all = [];
  let next = url;

  while (next) {
    const res = await fetch(next);
    const data = await res.json();
    if (!data.data) break;
    all = all.concat(data.data);
    next = data.has_more ? data.next_page : null;
  }

  return all;
}

function renderLangButtons(el, langs, initialLang) {
  const langArea = el.querySelector(".langArea");
  langArea.innerHTML = "";

  const flagMap = {
    ja: "JP",
    en: "US",
    fr: "FR",
    de: "DE",
    es: "ES",
    it: "IT",
    pt: "PT",
    ru: "RU",
    ko: "KR",
    zh: "CN",
  };

  const keys = Object.keys(langs);
  if (keys.length === 0) {
    langArea.textContent = "言語なし";
    return;
  }

  // 初期表示言語
  let currentLang = initialLang && langs[initialLang] ? initialLang : keys[0];

  const updateHighlight = () => {
    langArea.querySelectorAll(".langBtn").forEach(btn => {
      if (btn.dataset.lang === currentLang) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  };

  keys.forEach(lang => {
    const btn = document.createElement("button");
    btn.className = "langBtn";
    btn.textContent = flagMap[lang] || lang.toUpperCase();
    btn.dataset.lang = lang;
    btn.dataset.url = langs[lang];

    btn.addEventListener("click", () => {
      const imgEl = el.querySelector("img");
      imgEl.src = btn.dataset.url;
      currentLang = lang;
      updateHighlight();
    });

    langArea.appendChild(btn);
  });

  // 初期強調
  updateHighlight();
}

// ドロップ領域（並び替え＋削除）
dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.classList.add("dragover");
});

dropArea.addEventListener("dragleave", () => {
  dropArea.classList.remove("dragover");
});

dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");

  const json = e.dataTransfer.getData("application/json");
  if (!json) return;

  const { url, w, h } = JSON.parse(json);

  // 初回ドロップ時に基準サイズ確定
  if (!baseImageSize) {
    baseImageSize = {
      w: Number(w),
      h: Number(h)
    };
  }

  droppedCards.push(url);
  renderDropPreview();
  updateSizeInfo();
});

// 生成フィールドの並び替え（ドロップで順序入れ替え）
function renderDropPreview() {
  dropArea.innerHTML = "";

  if (droppedCards.length === 0) {
    dropArea.innerHTML = '<p style="color:#666; margin-top:20px;">ここにカードをドラッグ＆ドロップ</p>';
    return;
  }

  const columns = parseInt(document.getElementById("columns").value) || 1;
  const cardWidth = parseInt(document.getElementById("cardWidth").value) || 200;
  const gap = parseInt(document.getElementById("gap").value) || 0;
  const userTotalWidth = parseInt(document.getElementById("totalWidth").value) || 0;
  const align = document.getElementById("align").value;

  const contentWidth = (columns * cardWidth) + ((columns - 1) * gap);
  const finalCanvasWidth = Math.max(contentWidth, userTotalWidth);

  const artboard = document.createElement("div");
  artboard.className = "artboard";
  artboard.style.width = `${finalCanvasWidth}px`;
  artboard.style.display = "grid";
  artboard.style.gridTemplateColumns = `repeat(${columns}, ${cardWidth}px)`;
  artboard.style.gap = `${gap}px`;
  
  const gridAlign = align === "left" ? "start" : align === "right" ? "end" : "center";
  artboard.style.justifyContent = gridAlign;
  dropArea.style.alignItems = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

  droppedCards.forEach((url, idx) => {
    const card = document.createElement("div");
    card.className = "canvas-card";
    card.draggable = true; // 並び替えのためにドラッグ可能に
    card.style.width = `${cardWidth}px`;

    card.innerHTML = `
      <img src="${url}" alt="card-${idx}" />
      <button class="remove-btn" title="削除">×</button>
    `;

    // --- 並び替え用イベントリスナー ---
    
    // ドラッグ開始: 自分のインデックスを保存
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/move-idx", idx);
      card.style.opacity = "0.4";
      card.classList.add("moving");
    });

    card.addEventListener("dragend", () => {
      card.style.opacity = "1";
      card.classList.remove("moving");
    });

    // 重なった時: 並び替え可能であることを示す
    card.addEventListener("dragover", (e) => {
      e.preventDefault(); // ドロップを許可
      card.style.transform = "scale(1.05)";
      card.style.zIndex = "10";
    });

    card.addEventListener("dragleave", () => {
      card.style.transform = "scale(1)";
      card.style.zIndex = "1";
    });

    // ドロップした時: 配列を入れ替えて再描画
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation(); // 親（dropArea）の追加イベントを防ぐ
      
      const fromIdx = e.dataTransfer.getData("text/move-idx");
      if (fromIdx !== "" && parseInt(fromIdx) !== idx) {
        moveCard(parseInt(fromIdx), idx);
      }
    });

    card.querySelector(".remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      removeCard(idx);
    });

    artboard.appendChild(card);
  });

  dropArea.appendChild(artboard);
}

function moveCard(from, to) {
  const card = droppedCards.splice(from, 1)[0];
  droppedCards.splice(to, 0, card);
  renderDropPreview();
  updateSizeInfo();
}

function removeCard(idx) {
  droppedCards.splice(idx, 1);
  renderDropPreview();
  updateSizeInfo();
}

// 画像生成ボタンの実装
document.getElementById("generateBtn").addEventListener("click", async () => {
  if (droppedCards.length === 0) {
    alert("カードをドロップしてください");
    return;
  }

  const columns = parseInt(document.getElementById("columns").value) || 1;
  const cardWidth = parseInt(document.getElementById("cardWidth").value) || 200;
  const gap = parseInt(document.getElementById("gap").value) || 0;
  const userTotalWidth = parseInt(document.getElementById("totalWidth").value) || 0;
  const align = document.getElementById("align").value;

  // 全画像を読み込み
  const imgs = await Promise.all(droppedCards.map(url => loadImage(url)));

  // 画像1枚の比率から高さを計算
  const firstImg = imgs[0];
  const cardHeight = Math.round((cardWidth * firstImg.naturalHeight) / firstImg.naturalWidth);
  const rows = Math.ceil(imgs.length / columns);
  
  // コンテンツ自体のサイズ
  const contentWidth = (columns * cardWidth) + ((columns - 1) * gap);
  const contentHeight = (rows * cardHeight) + ((rows - 1) * gap);

  // キャンバス幅の決定
  const canvasWidth = Math.max(contentWidth, userTotalWidth);

  // キャンバス作成（背景はデフォルトで透明）
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = contentHeight;
  const ctx = canvas.getContext("2d");

  // 配置オフセット計算
  let offsetX = 0;
  if (align === "center") offsetX = (canvasWidth - contentWidth) / 2;
  else if (align === "right") offsetX = canvasWidth - contentWidth;

  // 描画処理
  imgs.forEach((img, i) => {
    const r = Math.floor(i / columns);
    const c = i % columns;
    const x = offsetX + c * (cardWidth + gap);
    const y = r * (cardHeight + gap);

    // きれいな角丸を表現するためのクリッピング
    const radius = Math.round(cardWidth * 0.045); // 一般的なMTGカードの角丸比率
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + cardWidth - radius, y);
    ctx.quadraticCurveTo(x + cardWidth, y, x + cardWidth, y + radius);
    ctx.lineTo(x + cardWidth, y + cardHeight - radius);
    ctx.quadraticCurveTo(x + cardWidth, y + cardHeight, x + cardWidth - radius, y + cardHeight);
    ctx.lineTo(x + radius, y + cardHeight);
    ctx.quadraticCurveTo(x, y + cardHeight, x, y + cardHeight - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.clip();
    
    ctx.drawImage(img, x, y, cardWidth, cardHeight);
    ctx.restore();
  });

  // ファイル名の作成 (yyyymmddHHMMSSsss)
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0') +
    now.getMilliseconds().toString().padStart(3, '0');

  // ダウンロード実行
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${timestamp}.png`;
  link.click();
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // キャッシュ回避のためにURLにユニークな値を付与
    const cacheBuster = (url.indexOf('?') === -1 ? '?' : '&') + 't=' + new Date().getTime();
    
    img.crossOrigin = "anonymous"; // これがCanvas描画に必須
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像読み込み失敗: " + url));
    img.src = url + cacheBuster; 
  });
}

// サイズ情報更新関数
function updateSizeInfo() {
  const sizeInfo = document.getElementById("sizeInfo");

  if (droppedCards.length === 0) {
    sizeInfo.textContent = "画像サイズ: ―";
    return;
  }

  const columns = parseInt(document.getElementById("columns").value);
  const cardWidth = parseInt(document.getElementById("cardWidth").value);
  const gap = parseInt(document.getElementById("gap").value);
  const userTotalWidth = parseInt(document.getElementById("totalWidth").value);

  if (!baseImageSize) {
    sizeInfo.textContent = "画像サイズ: 取得中…";
    return;
  }

  const cardHeight = Math.round(
    (cardWidth * baseImageSize.h) / baseImageSize.w
  );

  const rows = Math.ceil(droppedCards.length / columns);

  // コンテンツ幅
  const contentWidth = columns * cardWidth + (columns - 1) * gap;
  const contentHeight = rows * cardHeight + (rows - 1) * gap;

  // 最終出力幅
  let finalWidth = contentWidth;
  if (!isNaN(userTotalWidth) && userTotalWidth > contentWidth) {
    finalWidth = userTotalWidth;
  }

  sizeInfo.textContent = `出力予定: ${finalWidth} × ${contentHeight}px`;
}

// イベントリスナーの登録（対象IDを配列に追加）
["columns", "cardWidth", "gap", "totalWidth", "align"].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", () => {
      // プレビューは "totalWidth" などの変更時にはカード再描画不要かもしれないが、
      // 既存ロジックに合わせて renderDropPreview も呼んでおく（配置プレビューは今のところ簡易的なので）
      if (id !== "totalWidth" && id !== "align") {
          renderDropPreview();
      }
      updateSizeInfo();
    });
  }
});


