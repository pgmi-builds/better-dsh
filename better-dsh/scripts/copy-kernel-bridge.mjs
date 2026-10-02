#!/usr/bin/env node
/**
 * Ship the Python kernel bridge beside the built entry.
 *
 * `tsdown` clears `lib/` on every build and only emits JavaScript, so the
 * stdio<->ZMQ bridge (`src/kernel-bridge.py`) is copied in afterwards:
 * `lib/kernel-bridge.py` is what `kernel-transport.ts` resolves through
 * `new URL('./kernel-bridge.py', import.meta.url)`. `files: ["lib", …]` then
 * carries it into the tarball with no extra manifest entry.
 *
 * Zero dependencies: `node:fs` only, like the rest of the build scripts.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', 'src', 'kernel-bridge.py')
const target = join(here, '..', 'lib', 'kernel-bridge.py')

if (!existsSync(join(here, '..', 'lib'))) mkdirSync(join(here, '..', 'lib'), { recursive: true })
copyFileSync(source, target)
console.log(`copy-kernel-bridge: ${statSync(target).size} bytes -> lib/kernel-bridge.py`)
