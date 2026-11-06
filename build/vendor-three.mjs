// Builds vendor/three.iife.js: classic IIFE exposing global THREE (MIT header kept).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const ver = JSON.parse(readFileSync('node_modules/three/package.json', 'utf8')).version;
const banner = `/**\n * @license\n * Copyright 2010-${new Date().getUTCFullYear()} Three.js Authors\n * SPDX-License-Identifier: MIT\n * three.js r${ver}, bundled as classic IIFE (global THREE).\n */`;
mkdirSync('vendor', { recursive: true });
const r = await build({
  stdin: { contents: "export * from 'three';", resolveDir: process.cwd() },
  bundle: true, minify: true, format: 'iife', globalName: 'THREE', target: 'es2020',
  legalComments: 'none', banner: { js: banner }, write: false,
});
writeFileSync('vendor/three.iife.js', r.outputFiles[0].text);
console.log('vendor/three.iife.js', r.outputFiles[0].text.length, 'bytes, three', ver);
