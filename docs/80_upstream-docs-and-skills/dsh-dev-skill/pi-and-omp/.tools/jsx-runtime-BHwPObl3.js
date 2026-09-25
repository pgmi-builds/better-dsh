// Stub of the site's jsx-runtime: records element trees as plain JSON.
export const i = undefined, n = undefined, o = undefined;
export function t() {
  return {
    Fragment: '@@FRAGMENT@@',
    jsx: el,
    jsxs: el,
  };
}
function el(type, props) {
  return { t: type, p: props || {} };
}
export default t;
