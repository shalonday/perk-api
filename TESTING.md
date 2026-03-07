# Perk API Testing Guide

## Test Coverage

### Chatbot Search Tests (7 tests) ✅

**File:** `__tests__/chatbotSearch.test.js`

Tests for the `/chatbot/search` endpoint with semantic similarity search:

1. ✅ **Should return search results with similarity scores**
   - Verifies endpoint returns array of results
   - Results include node info and similarity scores
   - Response includes query and timestamp

2. ✅ **Should return 400 when query is missing**
   - Tests input validation
   - Checks for proper error message

3. ✅ **Should return 400 when query is not a string**
   - Tests type checking
   - Ensures non-string queries are rejected

4. ✅ **Should use default limit of 5**
   - Verifies default limit parameter works
   - Ensures results don't exceed limit

5. ✅ **Should return empty results when no embeddings exist**
   - Tests graceful handling when no embeddings in database
   - Includes helpful note in response

6. ✅ **Should handle errors gracefully**
   - Tests error handling
   - Returns 500 with error message

7. ✅ **Should sort results by similarity in descending order**
   - Verifies results are ranked correctly
   - Validates similarity-based sorting

### Embedding Generation Tests (9 tests) ✅

**File:** `__tests__/generateEmbeddings.test.js`

Tests for embedding generation script and Neo4j integration:

1. ✅ **Should successfully connect to Neo4j**
   - Verifies driver initialization
   - Tests connection setup

2. ✅ **Should fetch nodes without embeddings**
   - Tests querying nodes lacking embeddings
   - Validates Cypher query structure

3. ✅ **Should batch process nodes**
   - Tests batching logic (batch size of 10)
   - Validates batch splitting

4. ✅ **Should update nodes with embeddings**
   - Tests embedding storage in Neo4j
   - Validates parameterized updates

5. ✅ **Should calculate node statistics**
   - Tests node counting
   - Validates stats query

6. ✅ **Should handle connection errors**
   - Tests error handling for failed connections
   - Validates error paths

7. ✅ **Should close Neo4j session properly**
   - Tests resource cleanup
   - Validates session.close() calls

8. ✅ **Should generate normalized embeddings**
   - Tests embedding generation
   - Verifies 384-dimensional output from all-MiniLM-L6-v2

9. ✅ **Should handle errors during embedding generation**
   - Tests error handling in embedding pipeline
   - Validates error propagation

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode (re-run on file changes)
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Test Configuration

**File:** `jest.config.js`

- Environment: Node.js
- Test pattern: `**/__tests__/**/*.test.js`
- Coverage includes: `services/`, `scripts/`
- Timeout: 30 seconds per test

## Mock Strategy

### Neo4j Driver Mocking

- Mocks `neo4j-driver` module entirely
- Provides mock `session()`, `executeRead()`, `executeWrite()` methods
- Allows test control over database responses

### Transformers Library Mocking

- Mocks `@xenova/transformers` pipeline
- Returns deterministic 384-dimensional embeddings
- Embeddings normalized for testing

## Key Test Data

### Mock Node Records

```javascript
{
  id: "uuid-1",
  name: "Node Name",
  type: "Skill" | "URL",
  embedding: Float32Array(384) // 384-dimensional vector
}
```

### API Request/Response Format

**POST /chatbot/search:**

```json
{
  "query": "JavaScript",
  "limit": 5
}
```

Response:

```json
{
  "results": [
    {
      "node": { "id": "uuid-1", "name": "...", "type": "..." },
      "similarity": 0.85
    }
  ],
  "query": "JavaScript",
  "timestamp": "2026-01-28T04:30:00.000Z"
}
```

## Coverage Status

- **Tests:** 16/16 passing ✅
- **Test Suites:** 2/2 passing ✅
- **Coverage Areas:** Core API functionality, error handling, data validation
- **Mocked External Dependencies:** Neo4j, Transformers

## Next Steps

1. Run embedding generation script: `npm run generate-embeddings`
2. Test actual `/chatbot/search` against real embeddings
3. Implement `/chatbot/material-request` endpoint
4. Add integration tests with real Neo4j instance (optional)
