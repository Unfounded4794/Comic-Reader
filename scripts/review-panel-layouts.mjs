import fs from 'node:fs/promises';
import sharp from 'sharp';
import { PanelDetector } from '../core/panels.mjs';
import { pageRaster, fusePanels, recoverLayout, layoutCoverage } from '../core/panel-layout.mjs';
const input = process.env.PANEL_READER_CANDIDATES || 'validation/candidates';
const output = process.env.PANEL_READER_SAMPLE_OUTPUT || 'validation/layout-review';
await fs.mkdir(output, { recursive: true });
const detector = new PanelDetector('models'), report = [];
for (let b = 1; b <= 5; b++) {
  const values = JSON.parse(await fs.readFile(`${input}/book-${b}.json`, 'utf8')), thumbs = [], results = [];
  for (const value of values) {
    const bytes = await fs.readFile(`${input}/${b}-${value.page}.png`), raster = await pageRaster(bytes);
    const candidates = fusePanels(value.western, value.detailed, value.segmented, value.bubbles, raster);
    const result = recoverLayout(candidates, value.bubbles, raster);
    result.panels = await detector.order(result.panels, 'ltr');
    result.coverage = layoutCoverage(result.panels, raster);
    results.push({ ...result, page: value.page, candidates: candidates.length });
    const scale = Math.min(400 / value.width, 580 / value.height), w = value.width * scale, h = value.height * scale, left = (400 - w) / 2, top = (580 - h) / 2;
    const background = await sharp(bytes).resize(400, 580, { fit: 'contain', background: '#181b20' }).toBuffer();
    const svg = `<svg width="400" height="610"><rect y="580" width="400" height="30" fill="#181b20"/><text x="4" y="601" fill="white" font-size="14">P${value.page}: ${result.panels.length} | page ${(result.coverage.page*100).toFixed(0)}% art ${(result.coverage.artwork*100).toFixed(0)}%</text>${result.panels.map((p,i)=>`<rect x="${left+p.x*w}" y="${top+p.y*h}" width="${p.w*w}" height="${p.h*h}" fill="none" stroke="${p.source==='recovered-region'?'#ffb454':'#00ff88'}" stroke-width="2"/><rect x="${left+p.x*w}" y="${top+p.y*h}" width="20" height="22" fill="#00ff88"/><text x="${left+p.x*w+3}" y="${top+p.y*h+17}" font-size="17">${i+1}</text>`).join('')}</svg>`;
    thumbs.push(await sharp({create:{width:400,height:610,channels:3,background:'#181b20'}}).composite([{input:background,left:0,top:0},{input:Buffer.from(svg),left:0,top:0}]).png().toBuffer());
  }
  for (let start=0; start<thumbs.length; start+=8) await sharp({create:{width:1600,height:Math.ceil(Math.min(8,thumbs.length-start)/4)*610,channels:3,background:'#181b20'}}).composite(thumbs.slice(start,start+8).map((input,i)=>({input,left:i%4*400,top:Math.floor(i/4)*610}))).jpeg({quality:90}).toFile(`${output}/book-${b}-sheet-${Math.floor(start/8)+1}.jpg`);
  report.push({ file: values[0].file, results });
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report,null,2));
  console.log(JSON.stringify({book:b,pages:results.length,low:results.filter(r=>r.coverage.page<.9||r.coverage.artwork<.95).map(r=>({pageNumber:r.page,...r.coverage})),recovered:results.reduce((s,r)=>s+r.recovered,0)}));
}
