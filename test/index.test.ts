import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import { Readable } from 'stream';

import { S3Store } from '../src/index';
import { S3StoreOptions, ConfigurationError, S3OperationError, SerializationError, TTLError } from '../src/types';

describe('cacheman-s3 TypeScript', function() {
  let cache: S3Store;
  let mockStorage: Map<string, { body: string; metadata: Record<string, string> }>;
  let s3SendStub: sinon.SinonStub;

  interface TestData {
    id: number;
    name: string;
    active: boolean;
    meta?: {
      tags: string[];
      score: number;
    };
  }

  beforeEach(function() {
    mockStorage = new Map();

    // Create a comprehensive stub for the S3 send method
    s3SendStub = sinon.stub();

    // Mock different S3 commands with proper TypeScript typing
    s3SendStub.callsFake((command: any) => {
      const commandName = command.constructor.name;

      return new Promise((resolve, reject) => {
        switch (commandName) {
          case 'GetObjectCommand':
            const stored = mockStorage.get(command.input.Key);
            if (!stored) {
              const error = new Error('The specified key does not exist.') as any;
              error.name = 'NoSuchKey';
              error.$metadata = { httpStatusCode: 404 };
              reject(error);
              return;
            }

            // Create a proper readable stream mock
            const mockStream = new Readable({
              read() {
                this.push(stored.body);
                this.push(null);
              }
            });

            resolve({
              Body: mockStream,
              Metadata: stored.metadata
            });
            break;

          case 'PutObjectCommand':
            mockStorage.set(command.input.Key, {
              body: command.input.Body,
              metadata: command.input.Metadata || {}
            });
            resolve({ ETag: 'mock-etag' });
            break;

          case 'DeleteObjectCommand':
            mockStorage.delete(command.input.Key);
            resolve({});
            break;

          case 'ListObjectsV2Command':
            const prefix = command.input.Prefix || '';
            const maxKeys = command.input.MaxKeys || 1000;

            const objects = Array.from(mockStorage.keys())
              .filter(key => key.startsWith(prefix))
              .slice(0, maxKeys)
              .map(key => ({ Key: key }));

            resolve({
              Contents: objects,
              IsTruncated: false
            });
            break;

          case 'DeleteObjectsCommand':
            command.input.Delete.Objects.forEach((obj: any) => {
              mockStorage.delete(obj.Key);
            });
            resolve({ Deleted: command.input.Delete.Objects });
            break;

          case 'HeadBucketCommand':
            resolve({});
            break;

          default:
            reject(new Error(`Unknown command: ${commandName}`));
        }
      });
    });

    // Create cache instance with proper TypeScript typing
    const options: S3StoreOptions = {
      bucket: 'test-bucket',
      region: 'us-east-1',
      prefix: 'test:',
      defaultTtl: 300
    };

    cache = new S3Store<TestData>(options);

    // Replace the S3 client's send method with our stub
    (cache as any).s3Client.send = s3SendStub;
  });

  afterEach(function() {
    sinon.restore();
  });

  describe('constructor and configuration', function() {
    it('should throw ConfigurationError if bucket is not provided', function() {
      assert.throws(() => {
        new S3Store({} as S3StoreOptions);
      }, ConfigurationError);
    });

    it('should throw ConfigurationError for invalid bucket type', function() {
      assert.throws(() => {
        new S3Store({ bucket: 123 } as any);
      }, ConfigurationError);
    });

    it('should create instance with default options', function() {
      const store = new S3Store({ bucket: 'my-bucket' });
      assert.ok(store);
      // Access private config through type assertion for testing
      const config = (store as any).config;
      assert.strictEqual(config.bucket, 'my-bucket');
      assert.strictEqual(config.prefix, '');
      assert.strictEqual(config.defaultTtl, 60);
    });

    it('should accept custom options with proper typing', function() {
      const options: S3StoreOptions = {
        bucket: 'my-bucket',
        prefix: 'custom:',
        defaultTtl: 300,
        storageClass: 'REDUCED_REDUNDANCY',
        region: 'eu-west-1'
      };

      const store = new S3Store(options);
      const config = (store as any).config;
      assert.strictEqual(config.prefix, 'custom:');
      assert.strictEqual(config.defaultTtl, 300);
      assert.strictEqual(config.storageClass, 'REDUCED_REDUNDANCY');
    });

    it('should validate credentials configuration', function() {
      assert.throws(() => {
        new S3Store({
          bucket: 'test',
          accessKeyId: 'test-key'
          // Missing secretAccessKey
        });
      }, ConfigurationError);
    });

    it('should validate TTL configuration', function() {
      assert.throws(() => {
        new S3Store({
          bucket: 'test',
          defaultTtl: 0 // Invalid TTL
        });
      }, ConfigurationError);
    });
  });

  describe('type-safe basic operations', function() {
    it('should have main methods with proper typing', function() {
      assert.ok(cache.get);
      assert.ok(cache.set);
      assert.ok(cache.del);
      assert.ok(cache.clear);
      assert.ok(cache.scan);
      assert.ok(cache.healthCheck);
    });

    it('should store and retrieve typed objects', function(done) {
      const testData: TestData = {
        id: 1,
        name: 'John Doe',
        active: true,
        meta: {
          tags: ['user', 'premium'],
          score: 95
        }
      };

      cache.set('user:1', testData, (error) => {
        if (error) return done(error);

        cache.get('user:1', (error, data) => {
          if (error) return done(error);
          assert.deepStrictEqual(data, testData);
          // TypeScript ensures data is of type TestData | null
          if (data) {
            assert.strictEqual(data.id, 1);
            assert.strictEqual(data.name, 'John Doe');
            assert.strictEqual(data.active, true);
            assert.deepStrictEqual(data.meta?.tags, ['user', 'premium']);
          }
          done();
        });
      });
    });

    it('should handle primitive types correctly', function(done) {
      const testCases = [
        { key: 'string', value: 'hello world' },
        { key: 'number', value: 42 },
        { key: 'boolean', value: true },
        { key: 'null', value: null },
        { key: 'array', value: [1, 2, 3] }
      ];

      let completed = 0;
      testCases.forEach(({ key, value }) => {
        cache.set(key, value, (error) => {
          if (error) return done(error);

          cache.get(key, (error, data) => {
            if (error) return done(error);
            assert.deepStrictEqual(data, value);
            completed++;
            if (completed === testCases.length) {
              done();
            }
          });
        });
      });
    });

    it('should return null for non-existent keys', function(done) {
      cache.get('non-existent-key', (error, data) => {
        if (error) return done(error);
        assert.strictEqual(data, null);
        done();
      });
    });

    it('should handle complex nested objects', function(done) {
      const complexData: TestData = {
        id: 999,
        name: 'Complex User',
        active: false,
        meta: {
          tags: ['admin', 'test', 'complex'],
          score: 100
        }
      };

      cache.set('complex:data', complexData, (error) => {
        if (error) return done(error);

        cache.get('complex:data', (error, data) => {
          if (error) return done(error);
          assert.deepStrictEqual(data, complexData);
          done();
        });
      });
    });

    it('should handle cache keys with slash characters', function(done) {
      const testData: TestData = {
        id: 1000,
        name: 'Slash Test User',
        active: true,
        meta: {
          tags: ['path', 'test'],
          score: 85
        }
      };

      const keyWithSlashes = 'users/profile/1000';

      cache.set(keyWithSlashes, testData, (error) => {
        if (error) return done(error);

        cache.get(keyWithSlashes, (error, data) => {
          if (error) return done(error);
          assert.deepStrictEqual(data, testData);

          // Verify the formatted key preserves slashes
          const formattedKey = (cache as any).formatKey(keyWithSlashes);
          assert.ok(formattedKey.includes('/'));
          assert.ok(formattedKey.includes('users/profile/1000'));
          done();
        });
      });
    });
  });

  describe('TTL functionality with type safety', function() {
    it('should accept TTL parameter with proper typing', function(done) {
      const testData: TestData = { id: 1, name: 'TTL Test', active: true };

      cache.set('ttl:test', testData, 10, (error) => {
        if (error) return done(error);

        cache.get('ttl:test', (error, data) => {
          if (error) return done(error);
          assert.deepStrictEqual(data, testData);
          done();
        });
      });
    });

    it('should handle TTL callback overload', function(done) {
      const testData: TestData = { id: 2, name: 'Callback Test', active: true };

      // Test callback without TTL
      cache.set('callback:test', testData, (error) => {
        if (error) return done(error);

        cache.get('callback:test', (error, data) => {
          if (error) return done(error);
          assert.deepStrictEqual(data, testData);
          done();
        });
      });
    });

    it('should expire entries after TTL', function(done) {
      this.timeout(5000);

      const testData: TestData = { id: 3, name: 'Expire Test', active: true };

      // Mock Date.now to simulate time passage
      const originalNow = Date.now;
      let currentTime = originalNow();

      const dateStub = sinon.stub(Date, 'now').callsFake(() => currentTime);

      cache.set('expire:test', testData, 1, (error) => {
        if (error) {
          dateStub.restore();
          return done(error);
        }

        // Advance time by 2 seconds
        currentTime += 2000;

        cache.get('expire:test', (error, data) => {
          dateStub.restore();
          if (error) return done(error);
          assert.strictEqual(data, null);
          done();
        });
      });
    });

    it('should support infinite TTL with -1', function(done) {
      const testData: TestData = { id: 4, name: 'Infinite Test', active: true };

      cache.set('infinite:test', testData, -1, (error) => {
        if (error) return done(error);

        // Verify no TTL metadata is set
        const key = (cache as any).formatKey('infinite:test');
        const stored = mockStorage.get(key);
        assert.ok(stored);
        assert.strictEqual(stored.metadata['cache-ttl'], undefined);
        done();
      });
    });

    it('should validate TTL values', function(done) {
      const testData: TestData = { id: 5, name: 'Invalid TTL', active: true };

      cache.set('invalid:ttl', testData, 0, (error) => {
        assert.ok(error);
        assert.ok(error instanceof TTLError);
        done();
      });
    });
  });

  describe('delete operations with type safety', function() {
    it('should delete items correctly', function(done) {
      const testData: TestData = { id: 6, name: 'Delete Test', active: true };

      cache.set('delete:test', testData, (error) => {
        if (error) return done(error);

        cache.get('delete:test', (error, data) => {
          if (error) return done(error);
          assert.deepStrictEqual(data, testData);

          cache.del('delete:test', (error) => {
            if (error) return done(error);

            cache.get('delete:test', (error, data) => {
              if (error) return done(error);
              assert.strictEqual(data, null);
              done();
            });
          });
        });
      });
    });

    it('should clear all items', function(done) {
      const testData1: TestData = { id: 7, name: 'Clear Test 1', active: true };
      const testData2: TestData = { id: 8, name: 'Clear Test 2', active: false };

      cache.set('clear:test1', testData1, (error) => {
        if (error) return done(error);

        cache.set('clear:test2', testData2, (error) => {
          if (error) return done(error);

          cache.clear((error) => {
            if (error) return done(error);

            cache.get('clear:test1', (error, data) => {
              if (error) return done(error);
              assert.strictEqual(data, null);

              cache.get('clear:test2', (error, data) => {
                if (error) return done(error);
                assert.strictEqual(data, null);
                done();
              });
            });
          });
        });
      });
    });
  });

  describe('scan functionality with type safety', function() {
    it('should scan and return typed entries', function(done) {
      const items: TestData[] = [
        { id: 9, name: 'Scan Test 1', active: true },
        { id: 10, name: 'Scan Test 2', active: false },
        { id: 11, name: 'Scan Test 3', active: true }
      ];

      let completed = 0;
      items.forEach((item, index) => {
        cache.set(`scan:item${index + 1}`, item, (error) => {
          if (error) return done(error);

          completed++;
          if (completed === items.length) {
            cache.scan('', 10, (error, result) => {
              if (error) return done(error);

              assert.ok(result);
              assert.strictEqual(result.entries.length, 3);
              assert.strictEqual(result.cursor, 0);

              // Verify type safety
              result.entries.forEach((entry) => {
                assert.ok(typeof entry.key === 'string');
                assert.ok(typeof entry.data === 'object');
                if (entry.data && typeof entry.data === 'object') {
                  const testData = entry.data as TestData;
                  assert.ok(typeof testData.id === 'number');
                  assert.ok(typeof testData.name === 'string');
                  assert.ok(typeof testData.active === 'boolean');
                }
              });

              done();
            });
          }
        });
      });
    });

    it('should handle scan parameter overloading', function(done) {
      const testData: TestData = { id: 12, name: 'Overload Test', active: true };

      cache.set('overload:test', testData, (error) => {
        if (error) return done(error);

        // Test with just callback
        cache.scan((error, result) => {
          if (error) return done(error);
          assert.ok(result);
          assert.ok(Array.isArray(result.entries));
          done();
        });
      });
    });

    it('should handle scan with slash characters in keys', function(done) {
      const testData: TestData = { id: 13, name: 'Slash Scan Test', active: true };
      const keyWithSlashes = 'api/v1/users/13';

      cache.set(keyWithSlashes, testData, (error) => {
        if (error) return done(error);

        cache.scan('', 10, (error, result) => {
          if (error) return done(error);
          assert.ok(result);

          // Find the entry with slash characters
          const slashEntry = result.entries.find(entry => entry.key === keyWithSlashes);
          assert.ok(slashEntry, 'Should find entry with slash characters');
          assert.deepStrictEqual(slashEntry?.data, testData);
          done();
        });
      });
    });
  });

  describe('health check with type safety', function() {
    it('should perform health check and return typed result', function(done) {
      cache.healthCheck((error, result) => {
        if (error) return done(error);

        assert.ok(result);
        assert.strictEqual(result.status, 'healthy');
        assert.strictEqual(result.bucket, 'test-bucket');
        assert.strictEqual(result.sdkVersion, 'v3');
        assert.strictEqual(typeof result.region, 'string');
        done();
      });
    });
  });

  describe('error handling with custom error types', function() {
    it('should handle undefined values with SerializationError', function(done) {
      cache.set('undefined:test', undefined as any, (error) => {
        assert.ok(error);
        assert.ok(error instanceof SerializationError);
        assert.ok(error.message.includes('undefined'));
        done();
      });
    });

    it('should handle JSON serialization errors', function(done) {
      // Create circular reference
      const circular: any = {};
      circular.self = circular;

      cache.set('circular:test', circular, (error) => {
        assert.ok(error);
        assert.ok(error instanceof SerializationError);
        done();
      });
    });

    it('should handle S3 operation errors', function(done) {
      // Mock S3 error
      s3SendStub.rejects(new Error('S3 Error'));

      cache.get('error:test', (error, data) => {
        assert.ok(error);
        assert.ok(error instanceof S3OperationError);
        assert.strictEqual(data, undefined);
        done();
      });
    });

    it('should handle invalid cache keys', function(done) {
      cache.set('', { id: 1 } as TestData, (error) => {
        assert.ok(error);
        assert.ok(error instanceof ConfigurationError);
        done();
      });
    });
  });

  describe('type constraints and generic typing', function() {
    it('should work with strongly typed interfaces', function(done) {
      interface User {
        id: number;
        email: string;
        preferences: {
          theme: 'light' | 'dark';
          notifications: boolean;
        };
      }

      const userCache = new S3Store<User>({
        bucket: 'user-bucket',
        prefix: 'users:'
      });

      (userCache as any).s3Client.send = s3SendStub;

      const userData: User = {
        id: 100,
        email: 'test@example.com',
        preferences: {
          theme: 'dark',
          notifications: true
        }
      };

      userCache.set('user:100', userData, (error) => {
        if (error) return done(error);

        userCache.get('user:100', (error, data) => {
          if (error) return done(error);

          // TypeScript ensures data is User | null
          if (data) {
            assert.strictEqual(data.id, 100);
            assert.strictEqual(data.email, 'test@example.com');
            assert.strictEqual(data.preferences.theme, 'dark');
            assert.strictEqual(data.preferences.notifications, true);
          }
          done();
        });
      });
    });
  });
});
