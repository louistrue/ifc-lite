/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { transpileTypeScript } from './transpile.js';

describe('transpileTypeScript', () => {
  it('strips interface declarations', async () => {
    const code = `
interface Foo {
  bar: string;
}
const x = 42;
`;
    const result = await transpileTypeScript(code);
    expect(result).not.toContain('interface Foo');
    expect(result).toContain('const x = 42');
  });

  it('strips type alias declarations', async () => {
    const code = `
type ID = string;
const x = 42;
`;
    const result = await transpileTypeScript(code);
    expect(result).not.toContain('type ID');
    expect(result).toContain('const x = 42');
  });

  it('strips type annotations from variables', async () => {
    const code = `const x: number = 42;`;
    const result = await transpileTypeScript(code);
    expect(result).toContain('const x');
    expect(result).toContain('42');
  });

  it('strips as casts', async () => {
    const code = `const x = y as string`;
    const result = await transpileTypeScript(code);
    expect(result).not.toContain(' as string');
    expect(result).toContain('const x = y');
  });

  it('passes plain JavaScript through unchanged', async () => {
    const code = `const x = 42;\nconsole.log(x);`;
    const result = await transpileTypeScript(code);
    expect(result).toContain('const x = 42');
    expect(result).toContain('console.log(x)');
  });
});

describe('transpileTypeScript (type annotations)', () => {
  it('handles export interface', async () => {
    const code = `
export interface Config {
  name: string;
}
const c = { name: 'test' };
`;
    const result = await transpileTypeScript(code);
    expect(result).not.toContain('export interface');
    expect(result).toContain("const c = { name: 'test' }");
  });

  it('strips function return type annotations', async () => {
    const code = `function foo(): string {\n  return 'bar';\n}`;
    const result = await transpileTypeScript(code);
    expect(result).toContain('function foo()');
    expect(result).not.toContain(': string {');
  });

  it('strips generic type parameters', async () => {
    const code = `const x = foo<string>()`;
    const result = await transpileTypeScript(code);
    expect(result).not.toContain('<string>');
    expect(result).toContain('foo()');
  });
});
