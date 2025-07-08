#!/bin/bash

# Setup script for LocalStack S3 testing
set -e

echo "🚀 Setting up LocalStack for S3 testing..."

# Wait for LocalStack to be ready
echo "⏳ Waiting for LocalStack to start..."
timeout 60 bash -c 'until curl -s http://localhost:4566/health | grep -q "s3"; do sleep 1; done'

# Set AWS CLI configuration for LocalStack
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

# Create S3 bucket
echo "📦 Creating S3 test bucket..."
aws --endpoint-url=http://localhost:4566 s3 mb s3://test-bucket 2>/dev/null || echo "Bucket may already exist"

# Verify bucket exists
echo "✅ Verifying S3 bucket..."
aws --endpoint-url=http://localhost:4566 s3 ls s3://test-bucket

echo "🎉 LocalStack S3 setup complete!"
echo "📋 Configuration:"
echo "   Endpoint: http://localhost:4566"
echo "   Bucket: test-bucket"
echo "   Region: us-east-1"
echo "   Access Key: test"
echo "   Secret Key: test"