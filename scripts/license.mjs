import fs from 'node:fs/promises';
const response = await fetch('https://raw.githubusercontent.com/spdx/license-list-data/main/text/AGPL-3.0-only.txt');
if (!response.ok) throw new Error('Could not download the license text.');
const text = await response.text();
if (!text.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) throw new Error('Unexpected license response.');
await fs.writeFile('LICENSE', text);
