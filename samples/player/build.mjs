// node samples/player/build.mjs -> samples/player/body-viewer.html (single offline file, three inlined)
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const r = await build({ entryPoints: [join(here, 'viewer.js')], bundle: true, write: false, minify: true, format: 'iife', target: 'es2020', legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Body viewer: old vs new</title>
<style>html,body{margin:0;height:100%;background:#f1ead9;color:#2b2a26;font:13px system-ui,sans-serif}#stage{position:absolute;inset:0}
#ui{position:absolute;top:8px;left:8px;background:#f1ead9e6;border:1px solid #2b2a26;padding:8px 10px;border-radius:4px;max-width:330px;line-height:1.9}
#ui button,#ui select,#ui input{font:inherit}#count{position:absolute;bottom:8px;left:8px;background:#f1ead9e6;padding:4px 8px;border:1px solid #2b2a26;font-size:12px;max-width:95vw}
label{margin-right:8px;white-space:nowrap}</style></head><body><div id="stage"></div>
<div id="ui"><b>OLD (left) | NEW (right)</b><br>
<label><input type="checkbox" id="wire">wireframe</label><label><input type="checkbox" id="turn">turntable</label><label><input type="checkbox" id="night">night + torch</label><br>
<label>anim <select id="anim"><option>idle</option><option>walk</option><option>run</option><option>stairs</option></select></label>
<label>pose <select id="pose"><option value="-1">animated</option><option value="0">0 T-pose</option><option value="1">1 slide sit</option><option value="2">2 slide lie</option><option value="3">3 dive</option></select></label><br>
<label>view <select id="view"><option>both</option><option>old</option><option>new</option></select></label>
<label><input type="checkbox" id="cap">swim cap</label><label>hair <select id="hair"><option>ponytail</option><option>bun</option><option>short</option></select></label><br>
<label>suit <input type="color" id="suit"></label><label>style <select id="style"><option>twopiece</option><option>plain</option><option>striped</option><option>trunks</option></select></label><br>
camera: <button data-cam="front">front</button><button data-cam="side">side</button><button data-cam="back">back</button><button data-cam="three">3/4</button><button data-cam="close">close</button><button data-cam="feet">feet</button><button data-cam="follow">follow</button></div>
<div id="count"></div><script>${js}</script></body></html>`;
writeFileSync(join(here, 'body-viewer.html'), html);
console.log('wrote body-viewer.html', (html.length / 1024).toFixed(0) + ' KB');
