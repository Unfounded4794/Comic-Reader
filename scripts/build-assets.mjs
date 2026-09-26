import fs from 'node:fs/promises';
import sharp from 'sharp';
await fs.mkdir('assets', { recursive: true });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="108" fill="#17231d"/><g fill="#ade8cb" transform="rotate(-5 256 256)"><rect x="104" y="100" width="304" height="124" rx="15"/><rect x="104" y="246" width="124" height="166" rx="15"/><rect x="250" y="246" width="158" height="166" rx="15"/></g></svg>';
await fs.writeFile('assets/icon.svg', svg);
await sharp(Buffer.from(svg)).png().toFile('assets/icon.png');
const png = await sharp(Buffer.from(svg)).resize(256,256).png().toBuffer();
const header = Buffer.alloc(22); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4); header.writeUInt16LE(1,10); header.writeUInt16LE(32,12); header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
await fs.writeFile('assets/icon.ico', Buffer.concat([header,png]));
