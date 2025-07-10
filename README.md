# @banana.inc/cacheman-s3

[![Build Status](https://github.com/dragonxsx/cacheman-s3/workflows/CI/badge.svg)](https://github.com/dragonxsx/cacheman-s3/actions)
[![NPM version](https://badge.fury.io/js/@banana.inc%2Fcacheman-s3.svg)](http://badge.fury.io/js/@banana.inc%2Fcacheman-s3)
[![Coverage Status](https://codecov.io/gh/dragonxsx/cacheman-s3/branch/main/graph/badge.svg)](https://codecov.io/gh/dragonxsx/cacheman-s3)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

TypeScript-first AWS S3 caching library for Node.JS and cache engine for [cacheman](https://github.com/cayasso/cacheman).

## Features

- 🚀 **High Performance**: Optimized for S3 operations with modern AWS SDK v3
- 🔒 **Type-Safe**: Full TypeScript support with comprehensive type definitions
- 🛡️ **Secure**: Supports IAM roles, encryption, and custom endpoints  
- ⏰ **TTL Support**: Automatic expiration with lazy cleanup
- 🔍 **Scanning**: Basic scan operations for cache inspection
- 📊 **Monitoring**: Built-in health checks
- 🌐 **AWS Integration**: Full AWS SDK v3 compatibility with LocalStack support
- 📞 **Callback API**: Traditional Node.js callback patterns with TypeScript typing
- 🎯 **Generic Support**: Type-safe caching for any data structure
- 📁 **Hierarchical Keys**: Native support for slash-separated cache keys creating S3 object paths

## Installation

```bash
npm install @banana.inc/cacheman-s3
```

## Quick Start

### TypeScript

```typescript
import { S3Store } from '@banana.inc/cacheman-s3';

interface User {
  id: number;
  name: string;
  email: string;
  preferences: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
}

const cache = new S3Store<User>({
  bucket: 'my-cache-bucket',
  region: 'us-east-1'
});

// Set a typed value
cache.set('user:123', {
  id: 123,
  name: 'John Doe',
  email: 'john@example.com',
  preferences: {
    theme: 'dark',
    notifications: true
  }
}, 3600, (error) => {
  if (error) throw error;
  console.log('User cached for 1 hour');
  
  // Get the typed value
  cache.get('user:123', (error, user) => {
    if (error) throw error;
    if (user) {
      // TypeScript knows user is of type User | null
      console.log(`Welcome ${user.name}!`);
      console.log(`Theme: ${user.preferences.theme}`);
    }
  });
});
```

### JavaScript

```javascript
const { S3Store } = require('@banana.inc/cacheman-s3');

const cache = new S3Store({
  bucket: 'my-cache-bucket',
  region: 'us-east-1'
});

cache.set('user:123', { name: 'John', age: 30 }, 3600, function(err) {
  if (err) throw err;
  
  cache.get('user:123', function(err, user) {
    if (err) throw err;
    console.log('User:', user); // { name: 'John', age: 30 }
  });
});
```

## Usage with Cacheman

### TypeScript

```typescript
import Cacheman from 'cacheman';
import { S3Store } from '@banana.inc/cacheman-s3';

interface CacheData {
  id: string;
  data: any;
  timestamp: number;
}

const cache = new Cacheman<CacheData>('users', {
  engine: S3Store,
  bucket: 'my-cache-bucket',
  region: 'us-east-1',
  ttl: 3600 // 1 hour default TTL
});

// Type-safe operations
cache.set('profile:123', {
  id: 'profile:123',
  data: { name: 'John', role: 'admin' },
  timestamp: Date.now()
}, (error) => {
  if (error) throw error;
  
  cache.get('profile:123', (error, data) => {
    if (error) throw error;
    if (data) {
      console.log(`Profile loaded: ${data.data.name}`);
    }
  });
});
```

## Configuration

### Basic Configuration

```typescript
import { S3Store, S3StoreOptions } from '@banana.inc/cacheman-s3';

const options: S3StoreOptions = {
  // Required
  bucket: 'my-cache-bucket',
  
  // AWS Configuration
  region: 'us-east-1',           // Default: 'us-east-1'
  accessKeyId: 'AKIA...',        // Use IAM roles when possible
  secretAccessKey: 'xxx',
  sessionToken: 'xxx',           // For temporary credentials
  
  // Cache Configuration
  prefix: 'cache:',              // Default: 'cacheman:'
  defaultTtl: 3600,              // Default TTL in seconds
  
  // S3 Specific
  storageClass: 'STANDARD',      // S3 storage class
  serverSideEncryption: 'AES256', // Encryption at rest
  
  // Performance
  maxRetries: 3,                 // AWS SDK retries
  httpTimeout: 30000             // Request timeout (ms)
};

const cache = new S3Store(options);
```

### Advanced Configuration with Types

```typescript
interface CacheConfig extends S3StoreOptions {
  customOption?: string;
}

const createCache = <T>(config: CacheConfig): S3Store<T> => {
  return new S3Store<T>({
    bucket: config.bucket,
    region: config.region || 'us-east-1',
    prefix: config.prefix || 'app:',
    defaultTtl: config.defaultTtl || 3600,
    storageClass: 'INTELLIGENT_TIERING',
    serverSideEncryption: 'AES256'
  });
};

// Type-safe cache creation
const userCache = createCache<User>({
  bucket: 'user-cache-bucket',
  prefix: 'users:'
});
```

## API Reference

### Constructor

```typescript
new S3Store<T>(options: S3StoreOptions): S3Store<T>
```

Creates a new type-safe S3Store instance.

### Methods

#### cache.set()

```typescript
set(key: string, value: T, ttl?: number, callback?: SetCallback<T>): void
set(key: string, value: T, callback?: SetCallback<T>): void
```

Store a typed value in the cache.

```typescript
interface Product {
  id: string;
  name: string;
  price: number;
}

const productCache = new S3Store<Product>({ bucket: 'products' });

productCache.set('product:123', {
  id: '123',
  name: 'Laptop',
  price: 999.99
}, 7200, (error) => {
  if (error) throw error;
  console.log('Product cached for 2 hours');
});
```

#### cache.get()

```typescript
get(key: string, callback: GetCallback<T>): void
```

Retrieve a typed value from the cache.

```typescript
productCache.get('product:123', (error, product) => {
  if (error) throw error;
  if (product) {
    // TypeScript knows product is Product | null
    console.log(`${product.name}: $${product.price}`);
  }
});
```

#### cache.del()

```typescript
del(key: string, callback?: DeleteCallback): void
```

Delete a value from the cache.

```typescript
productCache.del('product:123', (error) => {
  if (error) throw error;
  console.log('Product removed from cache');
});
```

#### cache.clear()

```typescript
clear(callback?: ClearCallback): void
```

Clear all cached values with the configured prefix.

```typescript
productCache.clear((error) => {
  if (error) throw error;
  console.log('All products cleared from cache');
});
```

#### cache.scan()

```typescript
scan(pattern?: string, limit?: number, callback?: ScanCallback<T>): void
scan(pattern?: string, callback?: ScanCallback<T>): void
scan(callback: ScanCallback<T>): void
```

Scan cache entries with optional prefix matching.

```typescript
productCache.scan('product', 100, (error, result) => {
  if (error) throw error;
  
  console.log(`Found ${result.entries.length} products`);
  result.entries.forEach(({ key, data }) => {
    // data is typed as Product
    console.log(`${key}: ${data.name} - $${data.price}`);
  });
});
```

#### cache.healthCheck()

```typescript
healthCheck(callback?: HealthCallback): void
```

Perform a health check on the S3 connection.

```typescript
cache.healthCheck((error, status) => {
  if (error) throw error;
  
  console.log('Health Status:', status);
  // {
  //   status: 'healthy',
  //   bucket: 'my-cache-bucket',
  //   region: 'us-east-1',
  //   sdkVersion: 'v3'
  // }
});
```

## Type Definitions

### Core Interfaces

```typescript
// Store options
interface S3StoreOptions {
  bucket: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  prefix?: string;
  defaultTtl?: number;
  storageClass?: 'STANDARD' | 'REDUCED_REDUNDANCY' | 'STANDARD_IA' | 'ONEZONE_IA' | 'INTELLIGENT_TIERING' | 'GLACIER' | 'DEEP_ARCHIVE';
  serverSideEncryption?: 'AES256' | 'aws:kms';
  maxRetries?: number;
  httpTimeout?: number;
}

// Scan result
interface ScanResult<T> {
  cursor: number | string;
  entries: Array<{
    key: string;
    data: T;
  }>;
}

// Health status
interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  bucket: string;
  region: string;
  sdkVersion: string;
  error?: string;
}

// Callback types
type GetCallback<T> = (error: Error | null, result?: T | null) => void;
type SetCallback<T> = (error: Error | null, result?: T) => void;
type DeleteCallback = (error: Error | null) => void;
type ClearCallback = (error: Error | null) => void;
type ScanCallback<T> = (error: Error | null, result?: ScanResult<T>) => void;
type HealthCallback = (error: Error | null, result?: HealthStatus) => void;
```

### Error Types

```typescript
// Base error class
class S3StoreError extends Error {
  code: string;
  statusCode?: number;
  originalError?: Error;
}

// Specific error types
class ConfigurationError extends S3StoreError {}
class S3OperationError extends S3StoreError {}
class SerializationError extends S3StoreError {}
class TTLError extends S3StoreError {}
```

## Advanced Usage

### Hierarchical Cache Keys

S3Store supports hierarchical cache keys using forward slashes, which are preserved as S3 object paths:

```typescript
const cache = new S3Store<any>({
  bucket: 'my-cache-bucket',
  prefix: 'app:'
});

// These create nested S3 object paths
cache.set('users/123/profile', { name: 'John' }, (error) => {
  // Creates S3 object: app:users/123/profile
});

cache.set('products/electronics/laptops/456', { name: 'MacBook' }, (error) => {
  // Creates S3 object: app:products/electronics/laptops/456
});

cache.set('api/v1/cache/session/abc123', { userId: 789 }, (error) => {
  // Creates S3 object: app:api/v1/cache/session/abc123
});

// Retrieve using the same hierarchical key
cache.get('users/123/profile', (error, profile) => {
  if (profile) {
    console.log('User profile:', profile);
  }
});
```

This allows for:
- **Organized Data**: Logical grouping of related cache entries
- **S3 Console Navigation**: Browse cache structure in AWS S3 console
- **Prefix-based Operations**: Efficient scanning and clearing of key groups
- **Natural Hierarchies**: Mirror your application's data structure

### Generic Type Constraints

```typescript
// Define strict interfaces
interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

interface User extends BaseEntity {
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
}

interface Product extends BaseEntity {
  name: string;
  price: number;
  category: string;
  inStock: boolean;
}

// Create type-safe caches
const userCache = new S3Store<User>({
  bucket: 'user-cache',
  prefix: 'users:'
});

const productCache = new S3Store<Product>({
  bucket: 'product-cache',
  prefix: 'products:'
});

// Type-safe operations
userCache.set('user:123', {
  id: '123',
  name: 'John Doe',
  email: 'john@example.com',
  role: 'admin', // TypeScript ensures valid role
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}, (error) => {
  // Handle result
});
```

### Utility Functions

```typescript
import { S3Store, isValidTTL, isDefined } from '@banana.inc/cacheman-s3';

// Type-safe cache wrapper
class TypedCache<T extends { id: string }> {
  private cache: S3Store<T>;

  constructor(options: S3StoreOptions) {
    this.cache = new S3Store<T>(options);
  }

  async setEntity(entity: T, ttl: number = 3600): Promise<void> {
    return new Promise((resolve, reject) => {
      this.cache.set(entity.id, entity, ttl, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async getEntity(id: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      this.cache.get(id, (error, entity) => {
        if (error) reject(error);
        else resolve(entity || null);
      });
    });
  }
}

// Usage
const userCache = new TypedCache<User>({
  bucket: 'users',
  prefix: 'user:'
});

// Async/await usage
try {
  await userCache.setEntity({
    id: '123',
    name: 'John',
    email: 'john@example.com',
    role: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const user = await userCache.getEntity('123');
  if (user) {
    console.log(`User: ${user.name}`);
  }
} catch (error) {
  console.error('Cache operation failed:', error);
}
```

## AWS IAM Permissions

Minimum required IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-cache-bucket",
        "arn:aws:s3:::my-cache-bucket/*"
      ]
    }
  ]
}
```

## Development

### Setup

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests (requires AWS credentials)
npm run test:integration

# Type checking
npm run typecheck

# Linting
npm run lint

# Coverage
npm run coverage
```

### LocalStack Integration Testing

This package supports testing with [LocalStack](https://localstack.cloud/), which provides a local AWS cloud stack for development and testing.

#### Prerequisites

- Docker installed and running
- Docker Compose (optional, for easier management)

#### Quick Start with LocalStack

```bash
# Option 1: Using npm scripts (recommended)
npm run test:integration

# Option 2: Manual setup
npm run localstack:start
npm run localstack:setup  # Creates S3 bucket
npm run test:integration
npm run localstack:stop
```

#### Docker Compose Method

```bash
# Start LocalStack using Docker Compose
npm run localstack:start

# Run tests
npm run test:integration

# Stop LocalStack
npm run localstack:stop
```

#### Manual Docker Method

```bash
# Start LocalStack container
docker run --rm -d -p 4566:4566 --name localstack-s3-test localstack/localstack:3.0

# Wait for LocalStack to be ready
curl --retry 10 --retry-delay 1 --retry-connrefused http://localhost:4566/health

# Create S3 bucket for testing
aws --endpoint-url=http://localhost:4566 s3 mb s3://test-bucket

# Run integration tests
LOCALSTACK_ENDPOINT=http://localhost:4566 \
S3_TEST_BUCKET=test-bucket \
AWS_ACCESS_KEY_ID=test \
AWS_SECRET_ACCESS_KEY=test \
AWS_REGION=us-east-1 \
npm run test:integration

# Cleanup
docker stop localstack-s3-test
```

#### Using LocalStack in Your Code

```typescript
import { S3Store } from '@banana.inc/cacheman-s3';

// Configure S3Store for LocalStack
const cache = new S3Store({
  bucket: 'test-bucket',
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',      // LocalStack endpoint
  forcePathStyle: true,                   // Required for LocalStack
  accessKeyId: 'test',                    // Any value works
  secretAccessKey: 'test'                 // Any value works
});

// Use normally
cache.set('key', { data: 'value' }, (error) => {
  if (error) throw error;
  console.log('Cached successfully with LocalStack!');
});
```

#### LocalStack Configuration

The package automatically detects LocalStack when the `endpoint` option is provided:

```typescript
const localstackOptions = {
  bucket: 'my-bucket',
  endpoint: 'http://localhost:4566',
  forcePathStyle: true,  // Automatically set to true for LocalStack
  accessKeyId: 'test',
  secretAccessKey: 'test',
  region: 'us-east-1'
};

const cache = new S3Store(localstackOptions);
```

#### Benefits of LocalStack Testing

- **No AWS Costs**: Test locally without incurring S3 charges
- **Fast Feedback**: No network latency to AWS
- **Isolation**: Tests don't affect production resources
- **CI/CD Friendly**: Easy to integrate in GitHub Actions
- **Offline Development**: Work without internet connection

### TypeScript Compilation

```bash
# Watch mode for development
npm run build:watch

# Clean build
npm run clean && npm run build
```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Write TypeScript-first code with proper type definitions
- Ensure test coverage for new features
- Follow the existing code style (enforced by ESLint)
- Update documentation for API changes
- Add type definitions for all public APIs

## Support

- 📖 [Documentation](https://github.com/dragonxsx/cacheman-s3#readme)
- 🐛 [Issues](https://github.com/dragonxsx/cacheman-s3/issues)
- 💬 [Discussions](https://github.com/dragonxsx/cacheman-s3/discussions)
- 📘 [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## Related Projects

- [cacheman](https://github.com/cayasso/cacheman) - Caching library for Node.js
- [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3) - AWS SDK for JavaScript