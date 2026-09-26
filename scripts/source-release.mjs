import fs from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import yazl from 'yazl';
const pkg = JSON.parse(await fs.readFile('package.json','utf8'));
await fs.mkdir('release',{recursive:true});
const target = `release/Panel-Reader-${pkg.version}-source.zip`, zip = new yazl.ZipFile(), stream = createWriteStream(target);
zip.outputStream.pipe(stream);
async function add(file) {
  const stat = await fs.stat(file);
  if (stat.isDirectory()) { for (const entry of await fs.readdir(file)) await add(path.join(file,entry)); }
  else zip.addFile(file, 'Panel-Reader-source/' + file.replaceAll('\\','/'));
}
for (const file of ['src','core','electron','scripts','tests','assets','models','docs','package.json','package-lock.json','electron-builder.config.cjs','vite.config.mjs','index.html','.gitignore','README.md','LICENSE','THIRD_PARTY_NOTICES.md']) await add(file);
zip.end(); await finished(stream); console.log(target);
