// Stub of the site's MdxPage module.
export function n() { return {}; }   // default component map (base tags are string literals in content chunks)
export function t(page, meta) {
  const C = (props) => {
    let tree = null;
    try { tree = typeof page === 'function' ? page(props || {}) : null; } catch (e) { tree = null; }
    return { kind: 'doc', meta: meta || {}, tree };
  };
  return C;
}
export default t;
