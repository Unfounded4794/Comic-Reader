import fs from 'node:fs';
// Local evaluation inputs are intentionally excluded from releases and source control.
export default JSON.parse(fs.readFileSync(process.env.PANEL_READER_SAMPLES || 'validation/sample-paths.json', 'utf8'));
