import { strict as assert } from 'assert';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';

import { S3Store } from '../src/index';
import { S3StoreOptions, HealthStatus } from '../src/types';

// Integration tests require real S3 bucket and AWS credentials
describe('cacheman-s3 integration (TypeScript)', function() {
  let cache: S3Store<any>;
  const bucket = process.env['S3_TEST_BUCKET'];
  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  const endpoint = process.env['LOCALSTACK_ENDPOINT'];

  // Define test data interface
  interface TestUser {
    id: number;
    name: string;
    email: string;
    metadata: {
      createdAt: string;
      lastLogin: string;
      roles: string[];
    };
  }

  before(async function() {
    if (!bucket) {
      this.skip();
    }

    if (!process.env['AWS_ACCESS_KEY_ID'] || !process.env['AWS_SECRET_ACCESS_KEY']) {
      this.skip();
    }

    const options: S3StoreOptions = {
      bucket: bucket,
      region: region,
      prefix: 'integration-test:',
      defaultTtl: 300
    };

    // Configure for LocalStack if endpoint is provided
    if (endpoint) {
      options.endpoint = endpoint;
      options.forcePathStyle = true;
      options.accessKeyId = process.env['AWS_ACCESS_KEY_ID'];
      options.secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'];
    }

    cache = new S3Store<TestUser>(options);

    // If using LocalStack, ensure bucket exists
    if (endpoint) {
      const s3Client = new S3Client({
        region: region,
        endpoint: endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? 'test',
          secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'test'
        }
      });

      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
        console.log(`✅ Created test bucket: ${bucket}`);
      } catch (error: any) {
        if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists') {
          console.warn(`⚠️  Could not create bucket: ${error.message}`);
        }
      }
    }
  });

  after(function(done) {
    if (cache) {
      cache.clear((error) => {
        if (error) console.warn('Failed to clear integration test cache:', error);
        done();
      });
    } else {
      done();
    }
  });

  describe('real S3 operations', function() {
    it('should connect to S3 and perform health check', function(done) {
      cache.healthCheck((error, result: HealthStatus | undefined) => {
        if (error) return done(error);

        assert.ok(result);
        assert.strictEqual(result.status, 'healthy');
        assert.strictEqual(result.bucket, bucket);
        assert.strictEqual(result.sdkVersion, 'v3');
        done();
      });
    });

    it('should store and retrieve typed data from real S3', function(done) {
      const testData: TestUser = {
        id: Date.now(),
        name: 'Integration Test User',
        email: 'integration@test.com',
        metadata: {
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          roles: ['user', 'tester']
        }
      };

      cache.set('integration:user', testData, 300, (error) => {
        if (error) return done(error);

        cache.get('integration:user', (error, retrieved) => {
          if (error) return done(error);

          assert.ok(retrieved);
          assert.deepStrictEqual(retrieved, testData);

          // TypeScript type checking
          assert.strictEqual(typeof retrieved.id, 'number');
          assert.strictEqual(typeof retrieved.name, 'string');
          assert.strictEqual(typeof retrieved.email, 'string');
          assert.ok(Array.isArray(retrieved.metadata.roles));

          cache.del('integration:user', (error) => {
            if (error) return done(error);
            done();
          });
        });
      });
    });

    it('should handle complex nested objects with S3', function(done) {
      const complexData: TestUser = {
        id: 999999,
        name: 'Complex User',
        email: 'complex@example.com',
        metadata: {
          createdAt: '2023-01-01T00:00:00.000Z',
          lastLogin: '2023-12-31T23:59:59.999Z',
          roles: ['admin', 'super-user', 'integration-tester']
        }
      };

      cache.set('integration:complex', complexData, 600, (error) => {
        if (error) return done(error);

        cache.get('integration:complex', (error, data) => {
          if (error) return done(error);

          assert.ok(data);
          assert.deepStrictEqual(data, complexData);
          assert.strictEqual(data.metadata.roles.length, 3);
          assert.ok(data.metadata.roles.includes('admin'));

          cache.del('integration:complex', (error) => {
            if (error) return done(error);
            done();
          });
        });
      });
    });

    it('should handle TTL expiration in real S3', function(done) {
      this.timeout(15000);

      const testData: TestUser = {
        id: 123456,
        name: 'TTL Test User',
        email: 'ttl@test.com',
        metadata: {
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          roles: ['temporary']
        }
      };

      cache.set('ttl:expiration', testData, 2, (error) => {
        if (error) return done(error);

        // Verify data is initially present
        cache.get('ttl:expiration', (error, data) => {
          if (error) return done(error);
          assert.deepStrictEqual(data, testData);

          // Wait for expiration
          setTimeout(() => {
            cache.get('ttl:expiration', (error, data) => {
              if (error) return done(error);
              assert.strictEqual(data, null);
              done();
            });
          }, 3000);
        });
      });
    });

    it('should handle scan operations with real S3', function(done) {
      const testUsers: TestUser[] = [
        {
          id: 1001,
          name: 'Scan User 1',
          email: 'scan1@test.com',
          metadata: {
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            roles: ['user']
          }
        },
        {
          id: 1002,
          name: 'Scan User 2',
          email: 'scan2@test.com',
          metadata: {
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            roles: ['admin']
          }
        }
      ];

      let completed = 0;
      testUsers.forEach((user, index) => {
        cache.set(`scan:user${index + 1}`, user, 300, (error) => {
          if (error) return done(error);

          completed++;
          if (completed === testUsers.length) {
            cache.scan('scan:', 10, (error, result) => {
              if (error) return done(error);

              assert.ok(result);
              assert.ok(result.entries.length >= 2);

              // Verify type safety in scan results
              result.entries.forEach((entry) => {
                assert.ok(typeof entry.key === 'string');
                assert.ok(typeof entry.data === 'object');
                if (entry.data.id) {
                  assert.ok(typeof entry.data.id === 'number');
                  assert.ok(typeof entry.data.name === 'string');
                  assert.ok(typeof entry.data.email === 'string');
                }
              });

              // Cleanup
              cache.del('scan:user1', () => {
                cache.del('scan:user2', () => {
                  done();
                });
              });
            });
          }
        });
      });
    });

    it('should handle clear operations with real S3', function(done) {
      const testData: TestUser = {
        id: 2001,
        name: 'Clear Test User',
        email: 'clear@test.com',
        metadata: {
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          roles: ['test']
        }
      };

      cache.set('clear:test1', testData, (error) => {
        if (error) return done(error);

        cache.set('clear:test2', testData, (error) => {
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

  describe('error handling with real S3', function() {
    it('should handle network errors gracefully', function(done) {
      // Create a cache instance with invalid credentials
      const invalidCache = new S3Store({
        bucket: 'non-existent-bucket-12345',
        region: 'us-east-1',
        accessKeyId: 'invalid-key',
        secretAccessKey: 'invalid-secret'
      });

      invalidCache.healthCheck((_error, result) => {
        // Should not throw, but return unhealthy status
        assert.ok(result);
        assert.strictEqual(result.status, 'unhealthy');
        assert.ok(result.error);
        done();
      });
    });

    it('should handle invalid bucket names', function(done) {
      const invalidCache = new S3Store({
        bucket: 'this-bucket-definitely-does-not-exist-12345',
        region: region
      });

      invalidCache.get('test-key', (error, data) => {
        // Should handle S3 errors gracefully
        assert.ok(error);
        assert.strictEqual(data, undefined);
        done();
      });
    });
  });

  describe('performance and scalability', function() {
    it('should handle multiple concurrent operations', function(done) {
      this.timeout(10000);

      const concurrentOps = 10;
      const testData: TestUser = {
        id: 3001,
        name: 'Concurrent User',
        email: 'concurrent@test.com',
        metadata: {
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          roles: ['performance']
        }
      };

      let completed = 0;
      let errors = 0;

      for (let i = 0; i < concurrentOps; i++) {
        cache.set(`concurrent:${i}`, testData, 300, (error) => {
          if (error) {
            errors++;
            console.warn(`Concurrent operation ${i} failed:`, error);
          }

          completed++;
          if (completed === concurrentOps) {
            assert.ok(errors < concurrentOps / 2, `Too many errors: ${errors}/${concurrentOps}`);

            // Cleanup
            let cleanupCompleted = 0;
            for (let j = 0; j < concurrentOps; j++) {
              cache.del(`concurrent:${j}`, () => {
                cleanupCompleted++;
                if (cleanupCompleted === concurrentOps) {
                  done();
                }
              });
            }
          }
        });
      }
    });
  });
});
