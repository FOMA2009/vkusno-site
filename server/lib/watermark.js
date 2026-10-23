// Водяной знак на фото блюд. Все фото приводятся к одним пропорциям 4:3, а знак всегда стоит
// в нижнем правом углу, одного относительного размера и с одним отступом — на всех снимках.
// Чёрный фон логотипа становится прозрачным. У картинок с подписями цен снизу добавляется тёмная
// знак меньше.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', '..', 'assets', 'watermark-source.png');
const WIDTH_RATIO = 0.14;  // ширина знака относительно ширины фото
const MARGIN_RATIO = 0.015;
const OPACITY = 0.85;
const MAX_W = 900;
// Фото из раздела «Лапша и рис» (в том числе сетки с подписями цен на самом снимке): остаются в исходном размере
// и пропорциях, знак на них меньше, чтобы не закрывать подписи.
const ORIGINAL_SIZE_SLUGS = new Set(['ris', 'ramen-yaichnaya-lapsha', 'soba-grechnevaya-lapsha', 'udon-pshenichnaya-lapsha', 'harusame-risovaya-lapsha']);
const SMALL_WIDTH_RATIO = 0.066;
const SMALL_MARGIN_RIGHT = 0.065; // правее краёвая часть обрезается карточкой 4:3, поэтому знак чуть отодвинут от края

let base;
async function logo() {
  if (base) return base;
  const { data, info } = await sharp(SRC).trim({ threshold: 30 }).resize({ width: 900 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    const a = Math.max(0, Math.min(1, (m - 26) / 70)); // тёмный фон → прозрачный, свечение → полупрозрачное
    if (a > 0 && a < 1) for (let k = 0; k < 3; k++) data[i + k] = Math.min(255, Math.round(data[i + k] / a)); // без тёмной каймы
    data[i + 3] = Math.round(a * 255 * OPACITY);
  }
  base = { buf: data, w: info.width, h: info.height };
  return base;
}

// input — путь или Buffer; out — путь результата (webp).
// original — сохранить исходный размер и пропорции фото (знак меньше); иначе фото приводится к 4:3.
async function apply(input, out, { original = false } = {}) {
  const L = await logo();
  const src = await sharp(input).rotate().toBuffer();
  const meta = await sharp(src).metadata();
  const W = original ? meta.width : Math.min(meta.width, MAX_W), H = original ? meta.height : Math.round(W * 3 / 4);
  const wmW = original ? Math.round(W * SMALL_WIDTH_RATIO) : Math.max(84, Math.round(W * WIDTH_RATIO)), wmH = Math.round(wmW * L.h / L.w);
  const m = Math.max(4, Math.round(W * MARGIN_RATIO));
  const mr = original ? Math.round(W * SMALL_MARGIN_RIGHT) : m;
  const wm = await sharp(L.buf, { raw: { width: L.w, height: L.h, channels: 4 } }).resize(wmW, wmH, { kernel: 'lanczos3' }).png().toBuffer();
  const canvas = original ? src : await sharp(src).resize(W, H, { fit: 'cover', position: 'centre' }).toBuffer();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(canvas).composite([{ input: wm, left: W - wmW - mr, top: H - wmH - m }]).webp({ quality: 86 }).toFile(out);
}

module.exports = { apply, ORIGINAL_SIZE_SLUGS };
