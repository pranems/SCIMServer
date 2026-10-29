import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { satisfiesGhsaRange } from './check-dependency-pins';

type Package = {
  version: string;
  dependencies?: Record<string, string>;
  resolved?: string;
  integrity?: string;
};
type Uri = {
  parse(value: string): { scheme?: string; host?: string; error?: string };
  normalize(value: string, options?: { reference: string }): string;
  serialize(value: { path: string; scheme?: string }, options?: { reference: string }): string;
  resolve(base: string, relative: string): string;
};
type Query = {
  parse(value: string, options?: Record<string, unknown>): unknown;
  stringify(value: unknown, options?: Record<string, unknown>): string;
};

const apiRoot = resolve(__dirname, '../..');
const lock = JSON.parse(readFileSync(resolve(apiRoot, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, Package>;
};
const manifest = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8')) as {
  overrides: Record<string, string>;
};
const semver = require('semver') as { satisfies(version: string, range: string): boolean };
const ajvOwner = 'node_modules/@prisma/streams-local/node_modules/ajv';
const consumerModule = (owner: string, name: string): string =>
  require.resolve(name, { paths: [resolve(apiRoot, owner)] });
const uri = require(consumerModule(ajvOwner, 'fast-uri')) as Uri;

describe('API advisory pins and actual installed consumers', () => {
  it.each([
    ['GHSA-6pq8-jhm2-2vcw', '6.16.0', '6.16.1', '>= 6.7.0, <= 6.16.0'],
    ['GHSA-w74x-v6f9-j3xg', '4.1.5', '4.2.3', '>= 4.0.0, < 4.2.3'],
    ['GHSA-xhq7-xmqj-769h', '4.1.5', '4.2.3', '>= 4.0.0, < 4.2.3'],
    ['GHSA-wjr9-j795-jxcr', '4.1.5', '4.2.3', '>= 4.0.1, < 4.2.3'],
    ['GHSA-333x-w4r6-6crp', '4.1.5', '4.2.3', '>= 4.0.0, < 4.2.3'],
  ])('checks both sides of the published %s boundary', (_id, before, patched, range) => {
    expect(satisfiesGhsaRange(before, range)).toBe(true);
    expect(satisfiesGhsaRange(patched, range)).toBe(false);
  });

  it.each([
    ['qs', '6.16.1', '>= 6.7.0, <= 6.16.0'],
    ['fast-uri', '4.2.3', '>= 4.0.0, < 4.2.3'],
  ])('pins every %s occurrence outside its advisory boundary', (name, version, range) => {
    expect(manifest.overrides[name]).toBe(version);
    const occurrences = Object.entries(lock.packages).filter(([path]) =>
      path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`),
    );
    expect(occurrences.map(([path]) => path)).toEqual([`node_modules/${name}`]);
    for (const [, entry] of occurrences) {
      expect(entry.version).toBe(version);
      expect(satisfiesGhsaRange(entry.version, range)).toBe(false);
      expect(entry.resolved).toBe(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`);
      expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    }
  });

  it('resolves every declared qs owner to the compatible installed patch', () => {
    const owners = Object.entries(lock.packages).flatMap(([path, entry]) =>
      entry.dependencies?.qs ? [[path, entry.dependencies.qs]] : [],
    );
    expect(owners).toEqual([
      ['node_modules/body-parser', '^6.16.1'],
      ['node_modules/express', '^6.14.0'],
      ['node_modules/superagent', '^6.14.1'],
    ]);
    for (const [path, range] of owners) {
      const owner = JSON.parse(readFileSync(resolve(apiRoot, path, 'package.json'), 'utf8')) as Package;
      expect(owner.dependencies?.qs).toBe(range);
      expect(semver.satisfies('6.16.1', range)).toBe(true);
      const installedPath = consumerModule(path, 'qs/package.json');
      expect(installedPath).toBe(resolve(apiRoot, 'node_modules/qs/package.json'));
      expect((JSON.parse(readFileSync(installedPath, 'utf8')) as Package).version).toBe('6.16.1');
    }
  });

  it('records the real Ajv owner and does not mistake an existing forced major for semver acceptance', () => {
    const owners = Object.entries(lock.packages).flatMap(([path, entry]) =>
      entry.dependencies?.['fast-uri'] ? [[path, entry.dependencies['fast-uri']]] : [],
    );
    expect(owners).toEqual([[ajvOwner, '^3.0.1']]);
    const owner = JSON.parse(readFileSync(resolve(apiRoot, ajvOwner, 'package.json'), 'utf8')) as Package;
    expect(owner.version).toBe('8.20.0');
    expect(owner.dependencies?.['fast-uri']).toBe('^3.0.1');
    expect(semver.satisfies('4.2.3', '^3.0.1')).toBe(false);
    const installedPath = consumerModule(ajvOwner, 'fast-uri/package.json');
    expect(installedPath).toBe(resolve(apiRoot, 'node_modules/fast-uri/package.json'));
    expect((JSON.parse(readFileSync(installedPath, 'utf8')) as Package).version).toBe('4.2.3');
  });

  it.each(['body-parser', 'express', 'superagent'])(
    'keeps %s query parsing and serialization correct and handles non-callable comma elements',
    owner => {
      const qs = require(consumerModule(`node_modules/${owner}`, 'qs')) as Query;
      expect(qs.parse('filter=userName%20eq%20%22Ada%22&attributes=userName%2Cname&startIndex=1'))
        .toEqual({ filter: 'userName eq "Ada"', attributes: 'userName,name', startIndex: '1' });
      expect(qs.parse('profile[name]=Ada&tags[]=one&tags[]=two&__proto__[polluted]=yes', {
        allowPrototypes: true,
        depth: 32,
        arrayLimit: 100,
      })).toEqual({ profile: { name: 'Ada' }, tags: ['one', 'two'] });
      expect(qs.stringify({ filter: 'userName eq "Ada"', attributes: ['userName', 'name'] }))
        .toBe('filter=userName%20eq%20%22Ada%22&attributes%5B0%5D=userName&attributes%5B1%5D=name');
      expect(qs.stringify({ values: [{ toString: 'not callable' }] }, {
        arrayFormat: 'comma',
      })).toBe('values=%5Bobject%20Object%5D');
    },
  );

  it('uses the real Express query parser and Superagent form serializer', () => {
    const express = require('express') as {
      (): {
        set(name: string, value: string): void;
        get(name: string): (input: string) => unknown;
      };
    };
    const app = express();
    app.set('query parser', 'extended');
    expect(app.get('query parser fn')('filter=active%20eq%20true&name[givenName]=Ada'))
      .toEqual({ filter: 'active eq true', name: { givenName: 'Ada' } });
    const superagent = require('superagent') as {
      serialize: Record<string, (value: unknown) => string>;
    };
    expect(superagent.serialize['application/x-www-form-urlencoded']({
      filter: 'active eq true', attributes: ['userName', 'name'],
    })).toBe('filter=active%20eq%20true&attributes=userName&attributes=name');
  });

  it('parses a real body-parser URL-encoded request stream without opening a server', async () => {
    const body = 'profile[name]=Ada&tags[]=one&tags[]=two&__proto__[polluted]=yes';
    const request = Object.assign(Readable.from([Buffer.from(body)]), {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(Buffer.byteLength(body)),
      },
      method: 'POST',
      body: undefined,
    });
    const bodyParser = require('body-parser') as {
      urlencoded(options: { extended: boolean }): (
        req: typeof request, response: object, next: (error?: Error) => void
      ) => void;
    };
    await new Promise<void>((complete, reject) => {
      bodyParser.urlencoded({ extended: true })(request, {}, error => error ? reject(error) : complete());
    });
    expect(request.body).toEqual({ profile: { name: 'Ada' }, tags: ['one', 'two'] });
  });

  it('compiles external, relative, fragment and recursive references with the actual nested Ajv', () => {
    const Ajv = require(resolve(apiRoot, ajvOwner)) as new (options: Record<string, unknown>) => {
      opts: { uriResolver: Uri };
      addSchema(schema: unknown): void;
      compile(schema: unknown): ((data: unknown) => boolean) & {
        errors: { instancePath: string; keyword: string }[] | null;
      };
    };
    const ajv = new Ajv({ allErrors: true });
    expect(ajv.opts.uriResolver).toBe(uri);
    ajv.addSchema({
      $id: 'https://schemas.example/common.json',
      definitions: {
        name: { type: 'string', minLength: 2 },
        node: {
          type: 'object',
          properties: { name: { $ref: '#/definitions/name' }, child: { $ref: '#/definitions/node' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
    });
    const validate = ajv.compile({
      $id: 'https://schemas.example/team/user.json',
      type: 'object',
      properties: { profile: { $ref: '../common.json#/definitions/node' } },
      required: ['profile'],
      additionalProperties: false,
    });
    expect(validate({ profile: { name: 'Ada', child: { name: 'Grace' } } })).toBe(true);
    expect(validate({ profile: { name: 'A', child: { name: 7 }, extra: true } })).toBe(false);
    expect(validate.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ instancePath: '/profile/name', keyword: 'minLength' }),
      expect.objectContaining({ instancePath: '/profile/child/name', keyword: 'type' }),
      expect.objectContaining({ instancePath: '/profile', keyword: 'additionalProperties' }),
    ]));
    expect(() => ajv.compile({ $ref: 'missing.json#/absent' })).toThrow(/resolve reference/);
  });

  it('rejects encoded schemes through the actual Ajv URI resolver', () => {
    expect(uri.parse('%6Aavascript:alert(1)').error).toBe('URI scheme is malformed.');
    expect(uri.normalize('%6Aavascript:alert(1)')).toBe('%6Aavascript:alert(1)');
    expect(() => uri.resolve('https://schemas.example/', '%u006Aavascript:alert(1)')).toThrow();
  });

  it('preserves relative-reference meaning before actual Ajv URI resolution', () => {
    const base = 'https://schemas.example/team/schema.json';
    for (const relative of ['../common.json', 'a/../common.json', './child:part']) {
      expect(uri.resolve(base, uri.normalize(relative))).toBe(uri.resolve(base, relative));
    }
    expect(uri.normalize('../common.json')).toBe('../common.json');
  });

  it('rejects host confusion through the actual Ajv URI resolver', () => {
    expect(uri.parse('http://a@b@evil.example/').error).toBeDefined();
    expect(uri.parse('http://good\tevil.example/').error).toBeDefined();
  });

  it('escapes suffix colons through the actual Ajv URI resolver', () => {
    const suffix = uri.serialize({ scheme: 'x', path: 'javascript:alert(1)' }, { reference: 'suffix' });
    expect(suffix).toBe('javascript%3Aalert(1)');
    expect(uri.parse(suffix).scheme).toBeUndefined();
  });
});
