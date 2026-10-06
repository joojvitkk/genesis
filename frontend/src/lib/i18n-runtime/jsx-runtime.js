import { jsx as _jsx, jsxs as _jsxs, Fragment } from 'react/jsx-runtime';
import { localizeProps } from './localize';

export { Fragment };
export const jsx = (type, props, key) => _jsx(type, localizeProps(props), key);
export const jsxs = (type, props, key) => _jsxs(type, localizeProps(props), key);
