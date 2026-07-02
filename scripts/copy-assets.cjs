const { cpSync } = require('fs');
const { join } = require('path');
const src = join(__dirname, '..', 'src', 'server');
const dst = join(__dirname, '..', 'dist');
for (const f of ['viewer.html', 'projects.html', 'viewer-app.js']) {
  cpSync(join(src, f), join(dst, f))
}
cpSync(join(src, 'viewer'), join(dst, 'viewer'), {recursive: true});