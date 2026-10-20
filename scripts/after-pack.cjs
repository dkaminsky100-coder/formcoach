// electron-builder afterPack hook: remove Electron's built-in demo app, which FormCoach never uses.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const file = path.join(context.appOutDir, 'resources', 'default_app.asar');
  if (fs.existsSync(file)) fs.rmSync(file);
};
