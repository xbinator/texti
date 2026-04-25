/* eslint-disable no-param-reassign */

type Mod = string | { [key: string]: any };
export type Mods = Mod | Mod[];

function genBem(name: string, mods?: Mods): string {
  if (!mods) {
    return '';
  }

  if (typeof mods === 'string') {
    return ` ${name}--${mods}`;
  }

  if (Array.isArray(mods)) {
    return (mods as Mod[]).reduce<string>((ret, item) => ret + genBem(name, item), '');
  }

  return Object.keys(mods).reduce((ret, key) => ret + (mods[key] ? genBem(name, key) : ''), '');
}

function createBEM(name: string) {
  return (el?: Mods, mods?: Mods): Mods => {
    if (el && typeof el !== 'string') {
      mods = el;
      el = '';
    }

    el = el ? `${name}__${el}` : name;

    return `${el}${genBem(el, mods)}`;
  };
}

export type BEM = ReturnType<typeof createBEM>;

/**
 * 创建命名空间，用于生成 BEM 风格的类名
 * @param name - 组件名称
 * @param prefix - 类名前缀，默认为 'b'
 * @returns 返回元组：[带前缀的类名, BEM 函数]
 */
export function createNamespace(name: string, prefix = 'b') {
  const prefixedName = [prefix, name].filter(Boolean).join('-');
  return [prefixedName, createBEM(prefixedName)] as const;
}
