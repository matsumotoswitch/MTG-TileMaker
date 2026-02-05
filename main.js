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

    allCards.sort((a, b) => {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
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

  const img = el.querySelector("img");
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    el.dataset.w = w;
    el.dataset.h = h;
    el.querySelector(".size").textContent = `${w} × ${h}px`;
  };

  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/json", JSON.stringify({
      url,
      w: el.dataset.w,
      h: el.dataset.h
    }));
  });

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
  const flagMap = { ja: "JP", en: "US", fr: "FR", de: "DE", es: "ES", it: "IT", pt: "PT", ru: "RU", ko: "KR", zh: "CN" };
  const keys = Object.keys(langs);
  if (keys.length === 0) return;

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
    btn.addEventListener("click", () => {
      el.querySelector("img").src = langs[lang];
      currentLang = lang;
      updateHighlight();
    });
    langArea.appendChild(btn);
  });
  updateHighlight();
}

// ドロップエリア
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
  if (e.dataTransfer.getData("text/reorder-idx")) return;

  const json = e.dataTransfer.getData("application/json");
  if (json) {
    try {
      const { url, w, h } = JSON.parse(json);
      if (!baseImageSize) baseImageSize = { w: Number(w), h: Number(h) };
      droppedCards.push(url);
      renderDropPreview();
      updateSizeInfo();
    } catch (err) { console.error(err); }
  }
});

function renderDropPreview() {
  dropArea.innerHTML = "";
  if (droppedCards.length === 0) {
    dropArea.innerHTML = '<p style="color:#666; margin-top:20px;">ここにカードをドラッグ＆ドロップ</p>';
    baseImageSize = null;
    return;
  }

  const columns = parseInt(document.getElementById("columns").value) || 1;
  const cardWidth = parseInt(document.getElementById("cardWidth").value) || 200;
  const gap = parseInt(document.getElementById("gap").value) || 0;
  const userTotalWidth = parseInt(document.getElementById("totalWidth").value) || 0;
  
  const alignSelect = document.getElementById("align");
  const align = alignSelect ? alignSelect.value : "center";

  // コンテンツそのものの計算幅
  const contentWidth = (columns * cardWidth) + ((columns - 1) * gap);
  
  // 出力画像幅の決定
  const finalCanvasWidth = Math.max(contentWidth, userTotalWidth);

  // --- アートボードの作成 ---
  const artboard = document.createElement("div");
  artboard.className = "artboard";
  
  // 枠の幅を厳密に固定
  artboard.style.display = "grid";
  artboard.style.width = finalCanvasWidth + "px";
  artboard.style.minWidth = finalCanvasWidth + "px";
  artboard.style.position = "relative"; // 配置の基準用
  
  // グリッド列の定義
  artboard.style.gridTemplateColumns = `repeat(${columns}, ${cardWidth}px)`;
  artboard.style.gap = gap + "px";
  
  // 横配置プロパティ
  const gridJustify = align === "left" ? "start" : align === "right" ? "end" : "center";
  artboard.style.justifyContent = gridJustify;

  // デザイン調整
  artboard.style.border = "1px solid #666";
  artboard.style.background = "#1a1a1a";
  artboard.style.boxSizing = "border-box";

  // 外枠の中での中央配置
  dropArea.style.display = "flex";
  dropArea.style.justifyContent = "center";
  dropArea.style.alignItems = "flex-start";

  // 【重要】透明なスペーサーの挿入
  // これにより、カードが1枚でもGridが縮まず、finalCanvasWidthまで広がります
  const spacer = document.createElement("div");
  spacer.style.gridColumn = `1 / span ${columns}`;
  spacer.style.height = "0";
  spacer.style.width = "100%";
  artboard.appendChild(spacer);

  droppedCards.forEach((url, idx) => {
    const card = document.createElement("div");
    card.className = "canvas-card";
    card.draggable = true;
    card.style.width = cardWidth + "px";

    card.innerHTML = `
      <img src="${url}" alt="card-${idx}" style="pointer-events: none; width:100%; display:block;" />
      <button class="remove-btn">×</button>
    `;

    // 並び替え・削除イベント（ロジックは維持）
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/reorder-idx", idx);
      card.style.opacity = "0.4";
    });
    card.addEventListener("dragover", (e) => e.preventDefault());
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fromIdx = e.dataTransfer.getData("text/reorder-idx");
      if (fromIdx !== "" && parseInt(fromIdx) !== idx) {
        const movedItem = droppedCards.splice(parseInt(fromIdx), 1)[0];
        droppedCards.splice(idx, 0, movedItem);
        renderDropPreview();
        updateSizeInfo();
      } else if (!fromIdx) {
        const json = e.dataTransfer.getData("application/json");
        if (json) {
          const { url } = JSON.parse(json);
          droppedCards.splice(idx, 0, url);
          renderDropPreview();
          updateSizeInfo();
        }
      }
    });
    card.addEventListener("dragend", () => card.style.opacity = "1");
    card.querySelector(".remove-btn").onclick = (e) => {
      e.stopPropagation();
      removeCard(idx);
    };

    artboard.appendChild(card);
  });
  
  dropArea.appendChild(artboard);
}

function removeCard(idx) {
  droppedCards.splice(idx, 1);
  renderDropPreview();
  updateSizeInfo();
}

// 画像生成
document.getElementById("generateBtn").addEventListener("click", async () => {
  if (droppedCards.length === 0) return;

  const columns = parseInt(document.getElementById("columns").value) || 1;
  const cardWidth = parseInt(document.getElementById("cardWidth").value) || 200;
  const gap = parseInt(document.getElementById("gap").value) || 0;
  const userTotalWidth = parseInt(document.getElementById("totalWidth").value) || 0;
  const align = document.getElementById("align").value;

  const imgs = await Promise.all(droppedCards.map(url => loadImage(url)));
  const cardHeight = Math.round((cardWidth * imgs[0].naturalHeight) / imgs[0].naturalWidth);
  const rows = Math.ceil(imgs.length / columns);
  const contentWidth = (columns * cardWidth) + ((columns - 1) * gap);
  const contentHeight = (rows * cardHeight) + ((rows - 1) * gap);
  const canvasWidth = Math.max(contentWidth, userTotalWidth);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = contentHeight;
  const ctx = canvas.getContext("2d");

  let offsetX = 0;
  if (align === "center") offsetX = (canvasWidth - contentWidth) / 2;
  else if (align === "right") offsetX = canvasWidth - contentWidth;

  imgs.forEach((img, i) => {
    const r = Math.floor(i / columns);
    const c = i % columns;
    const x = offsetX + c * (cardWidth + gap);
    const y = r * (cardHeight + gap);

    const radius = Math.round(cardWidth * 0.045);
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

  const now = new Date();
  const timestamp = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0') + now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0') + now.getSeconds().toString().padStart(2, '0') + now.getMilliseconds().toString().padStart(3, '0');

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${timestamp}.png`;
  link.click();
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const cacheBuster = (url.indexOf('?') === -1 ? '?' : '&') + 't=' + new Date().getTime();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("読み込み失敗"));
    img.src = url + cacheBuster;
  });
}

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
  if (!baseImageSize) return;

  const cardHeight = Math.round((cardWidth * baseImageSize.h) / baseImageSize.w);
  const rows = Math.ceil(droppedCards.length / columns);
  const contentWidth = columns * cardWidth + (columns - 1) * gap;
  const contentHeight = rows * cardHeight + (rows - 1) * gap;
  let finalWidth = Math.max(contentWidth, userTotalWidth);
  sizeInfo.textContent = `出力予定: ${finalWidth} × ${contentHeight}px`;
}

// --- 修正箇所：すべての設定変更でプレビューを更新する ---
["columns", "cardWidth", "gap", "totalWidth", "align"].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    // どんな変更があっても renderDropPreview() を実行するように修正
    el.addEventListener("input", () => {
      renderDropPreview(); 
      updateSizeInfo();
    });
  }
});



