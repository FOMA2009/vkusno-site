// Водяной знак на фото блюд. Все фото приводятся к одним пропорциям 4:3, а знак всегда стоит
// в нижнем правом углу, одного относительного размера и с одним отступом — на всех снимках.
// Чёрный фон логотипа становится прозрачным. У картинок с подписями цен снизу добавляется тёмная
// полоса, чтобы знак не закрывал надписи.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', '..', 'assets', 'watermark-source.png');
const WIDTH_RATIO = 0.14;  // ширина знака относительно ширины фото
const MARGIN_RATIO = 0.015;
const OPACITY = 0.85;
const MAX_W = 900;
// Фото-сетки с подписями цен на самом снимке (рис и лапша)
const PAD_SLUGS = new Set(['ris', 'ramen-yaichnaya-lapsha', 'udon-pshenichnaya-lapsha', 'harusame-risovaya-lapsha']);

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

// input — путь или Buffer; out — путь результата (webp). pad — добавить полосу под знак вместо наложения на кадр.
async function apply(input, out, { pad = false } = {}) {
  const L = await logo();
  const src = await sharp(input).rotate().toBuffer();
  const meta = await sharp(src).metadata();
  const W = Math.min(meta.width, MAX_W), H = Math.round(W * 3 / 4);
  const wmW = Math.max(84, Math.round(W * WIDTH_RATIO)), wmH = Math.round(wmW * L.h / L.w);
  const m = Math.max(4, Math.round(W * MARGIN_RATIO));
  const wm = await sharp(L.buf, { raw: { width: L.w, height: L.h, channels: 4 } }).resize(wmW, wmH, { kernel: 'lanczos3' }).png().toBuffer();

  let canvas;
  if (!pad) {
    canvas = await sharp(src).resize(W, H, { fit: 'cover', position: 'centre' }).toBuffer();
  } else {
    const contentH = H - (wmH + 2 * m);
    const content = await sharp(src).resize({ width: W, height: contentH, fit: 'inside' }).toBuffer();
    const cm = await sharp(content).metadata();
    const [r, g, b] = await sharp(content).resize(1, 1).removeAlpha().raw().toBuffer();
    canvas = await sharp({ create: { width: W, height: H, channels: 3, background: { r: Math.round(r * 0.55), g: Math.round(g * 0.55), b: Math.round(b * 0.55) } } })
      .composite([{ input: content, left: Math.round((W - cm.width) / 2), top: 0 }]).png().toBuffer();
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(canvas).composite([{ input: wm, left: W - wmW - m, top: H - wmH - m }]).webp({ quality: 86 }).toFile(out);
}

module.exports = { apply, PAD_SLUGS };
