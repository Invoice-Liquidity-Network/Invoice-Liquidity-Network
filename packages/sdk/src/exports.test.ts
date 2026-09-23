import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

describe('package.json exports', () => {
  it('has sideEffects set to false', () => {
    expect(pkg.sideEffects).toBe(false);
  });

  it('has all required subpath exports', () => {
    const subpaths = Object.keys(pkg.exports).sort();
    expect(subpaths).toEqual(['.', './errors', './events', './tokens', './xdr']);
  });

  it.each(['.', './errors', './events', './tokens', './xdr'])(
    'subpath %s has import, require, and types conditions',
    (subpath) => {
      const entry = pkg.exports[subpath];
      expect(entry).toBeDefined();

      if (subpath === '.') {
        expect(entry.import).toBe('./dist/index.js');
        expect(entry.require).toBe('./dist/index.cjs');
        expect(entry.types).toBe('./dist/index.d.ts');
        expect(entry.browser).toBe('./dist/browser/index.js');
      } else {
        const name = subpath.replace('./', '');
        expect(entry.import).toBe(`./dist/${name}.js`);
        expect(entry.require).toBe(`./dist/${name}.cjs`);
        expect(entry.types).toBe(`./dist/${name}.d.ts`);
      }
    }
  );

  it.each(['./errors', './events', './tokens', './xdr'])(
    'subpath %s maps to an existing source file',
    (subpath) => {
      const name = subpath.replace('./', '');
      const srcFile = path.resolve(__dirname, `${name}.ts`);
      expect(fs.existsSync(srcFile)).toBe(true);
    }
  );

  it('has a build script that includes all entry points', () => {
    const buildScript = pkg.scripts.build;
    expect(buildScript).toContain('src/index.ts');
    expect(buildScript).toContain('src/tokens.ts');
    expect(buildScript).toContain('src/events.ts');
    expect(buildScript).toContain('src/errors.ts');
    expect(buildScript).toContain('src/xdr.ts');
  });
});

describe('import boundary', () => {
  it('does not expose internal source files via exports', () => {
    const subpaths = Object.keys(pkg.exports);
    const internalFiles = [
      './clients/InvoiceClient',
      './amount-formatting',
      './crypto-browser',
      './reputation',
      './index',
      './index.browser',
    ];
    for (const internal of internalFiles) {
      expect(subpaths).not.toContain(internal);
    }
  });
});
