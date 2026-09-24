/**
 * CSS-Module ambient declarations for the client halves.
 *
 * The host tsconfig excludes the client directories, and the client lane
 * (tsconfig.client.json) previously did not exist — so the client halves were
 * never typechecked at all. Enabling that lane requires the same two ambient
 * shapes the upstream client packages declare (mirrors the css-modules.d.ts
 * shipped by packages client ui-layout and friends): the class-map module and
 * the bare side-effect import.
 *
 * @module better-dsh/css-modules
 */

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'
