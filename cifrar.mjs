// Cifra preguntas.json → banco.js (AES-GCM, clave derivada con PBKDF2).
// Uso: node cifrar.mjs <clave-anfitrion>
import { readFileSync, writeFileSync } from 'node:fs';

const clave = process.argv[2];
if (!clave) { console.error('Uso: node cifrar.mjs <clave-anfitrion>'); process.exit(1); }

const { subtle } = globalThis.crypto;
const b64 = u => Buffer.from(u).toString('base64');
const sal = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
const llave = await subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: 200000, hash: 'SHA-256' },
  base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const datos = await subtle.encrypt({ name: 'AES-GCM', iv }, llave, readFileSync('preguntas.json'));

writeFileSync('banco.js', '// Banco de preguntas cifrado. Solo se abre con la clave del anfitrión.\n'
  + `window.BANCO = ${JSON.stringify({ sal: b64(sal), iv: b64(iv), d: b64(new Uint8Array(datos)) })};\n`);
console.log('banco.js generado');
