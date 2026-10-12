const baseConfig = require('./package.json').build;
module.exports = {
  ...baseConfig,
  // Global extraFiles would also copy documentation into macOS Contents,
  // where codesign treats it as an unsigned code component.
  extraFiles: [],
  win: { ...baseConfig.win, extraFiles: baseConfig.extraFiles, icon: 'assets/icon.ico', files: [
    ...baseConfig.files,
    '!validation/**/*',
    '!node_modules/onnxruntime-node/bin/napi-v6/{linux,darwin}/**/*',
    '!node_modules/onnxruntime-node/bin/napi-v6/win32/arm64/**/*',
    '!node_modules/@img/{sharp-linux-*,sharp-libvips-linux-*,sharp-wasm32}/**/*',
  ] },
  linux: { ...baseConfig.linux, extraFiles: baseConfig.extraFiles, icon: 'assets/icon.png', files: [
    ...baseConfig.files,
    '!validation/**/*',
    '!node_modules/onnxruntime-node/bin/napi-v6/{win32,darwin}/**/*',
    '!node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**/*',
    '!node_modules/@img/{sharp-win32-*,sharp-wasm32}/**/*',
  ] },
  mac: { ...baseConfig.mac, extraResources: baseConfig.extraFiles, icon: 'assets/icon.png', files: [
    ...baseConfig.files,
    '!validation/**/*',
    '!node_modules/onnxruntime-node/bin/napi-v6/{win32,linux}/**/*',
    '!node_modules/onnxruntime-node/bin/napi-v6/darwin/x64/**/*',
    '!node_modules/@img/{sharp-win32-*,sharp-linux-*,sharp-libvips-linux-*,sharp-darwin-x64,sharp-libvips-darwin-x64,sharp-wasm32}/**/*',
  ] },
};
