# PERK API

**Web Brain Project Educational Resource Knowledge API**

A Node.js/Express backend API that powers the Web Brain Project's educational resource management and AI-powered learning assistance features. This API manages a Neo4j knowledge graph of skills and learning resources, provides semantic search capabilities, and orchestrates LLM interactions for personalized learning recommendations.

## Intent

The PERK API serves as the central backend for the Web Brain Project ecosystem, providing:

- **Knowledge Graph Retrieval**: Read operations for skills, URLs, and their prerequisite relationships stored in Neo4j
- **Semantic Search**: Vector-based similarity search over educational resources using embeddings
- **AI Chat Orchestration**: LLM-powered conversational assistant with tool-calling capabilities for material search and recommendations

## Architecture

### Technology Stack

- **Runtime**: Node.js with Express.js
- **Database**: Neo4j graph database for skills and resources
- **AI/ML**:
  - Hugging Face Inference API for LLM chat completion
  - @xenova/transformers for local embedding generation
- **Security**: Helmet, CORS, rate limiting
- **Code Quality**: ESLint 9 (flat config), Prettier
- **Testing**: Jest

### File Structure

```
perk-api/
├── app.js                          # Express app configuration & routes
├── bin/www                         # Server startup script
├── package.json                    # Dependencies & scripts
├── eslint.config.js                # ESLint flat configuration
├── .prettierrc.json                # Prettier formatting rules
│
├── services/                       # Business logic modules
│   ├── service.js                  # Main service with endpoint handlers
│   ├── chatbot/
│   │   └── llmOrchestrator.js     # LLM message building & API calls
│   ├── embeddings/
│   │   └── searchService.js       # Semantic search with embeddings
│   └── neo4j/
│       └── neo4jHelpers.js        # Neo4j query builders & helpers
│
├── scripts/
│   └── generateEmbeddings.js      # Batch embedding generation for Neo4j nodes
│
├── __tests__/                      # Jest test suites
│   ├── chatbotChat.test.js        # Chat endpoint tests (15 tests)
│   ├── chatbotSearch.test.js      # Search endpoint tests (7 tests)
│   ├── generateEmbeddings.test.js # Embedding script tests (9 tests)
│   └── helpers/
│       └── chatbotChat.helpers.js # Shared test utilities
│
└── docs/
    └── implementation.md           # Detailed implementation notes
```

## API Endpoints

### Knowledge Graph Endpoints

- `GET /tree` - Retrieve the entire skill/URL knowledge graph
- `GET /paths/:startNodeId/:targetNodeId` - Find learning paths between two nodes

### Chatbot Endpoints

- `POST /chatbot/chat` - AI-powered chat with tool calling for material search
- `POST /chatbot/search` - Semantic search for educational materials

## Usage Flow

### External Repo Integration

The PERK API is consumed by two frontend applications:

#### 1. **webbrainproject-ts** (Main Learning Platform)

- **Repo**: React/TypeScript visualization app
- **Uses**:
  - `GET /tree` - Loads full knowledge graph for D3 visualization
  - `GET /paths/:startNodeId/:targetNodeId` - Generates learning paths
  - **Flow**: Initial page load calls `GET /tree` to load the graph; when the user requests a specific learning path the UI calls `GET /paths/:startNodeId/:targetNodeId` → API returns path → UI renders journey

#### 2. **wbp-chatbot** (RAG Chatbot Interface)

- **Repo**: React chatbot UI with RAG capabilities
  - **Uses**:
    - `POST /chatbot/chat` - Main conversational interface
    - `POST /chatbot/search` - Semantic material lookup (used for ad-hoc searches)
  - **Flow**:
    1. User asks question → Chatbot UI `POST`s to `POST /chatbot/chat`
    2. Server builds messages and calls the LLM; the LLM may reply with a `tool_call` (e.g., `search_materials`)
    3. When `search_materials` is requested the server executes semantic search logic and returns tool results to the LLM
    4. The LLM returns a final response with the search results or (if results are insufficient) asks the user if they have materials they'd like to contribute
    5. Server responds to the UI with the LLM message plus any `relatedMaterials` and suggested actions; the UI can also call `POST /chatbot/search` directly for ad-hoc material lookups

### LLM Tool-Calling Workflow

```
User Message (UI `POST /chatbot/chat`)
  ↓
chatbotChat endpoint (server-side handler)
  ↓
Build messages (system prompt + history + user input)
  ↓
Call HF LLM (openai/gpt-oss-120b)
  ↓
Parse response (JSON)
  ↓
Type: tool_call?
  ├─ YES → executeTool() (server executes internal tool logic)
  │         └─ `search_materials` → server performs semantic search
  │         ↓
  │   Re-invoke LLM with tool result
  │         ↓
  └─ NO → Return final response
        ↓
     Response to client (message + relatedMaterials + suggestedActions)
```

## Development

### Available Scripts

```bash
npm start              # Start production server
npm run devstart       # Start with nodemon (auto-reload)
npm run serverstart    # Start with debugging enabled
npm test               # Run all tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Generate coverage report
npm run lint           # Check code style
npm run lint:fix       # Auto-fix linting issues
npm run format         # Format all files with Prettier
npm run generate-embeddings  # Populate Neo4j node embeddings
```

### Code Quality

- **ESLint**: Enforces Node.js best practices, no unused vars, prefer const, etc.
- **Prettier**: Auto-formats code with semicolons, 80-char lines, LF endings
- **Pre-commit**: Run `npm run lint:fix` before committing

## Data Model

The Neo4j graph database follows this structure:

```
(:Skill)-[:IS_PREREQUISITE_TO]->(:URL)
(:URL)-[:TEACHES]->(:Skill)
```

Each node has:

- `id`: UUID
- `name`: Display name (for URLs, this is the actual URL string)
- `type`: "skill" or "url"
- `embedding`: 384-dimensional vector (all-MiniLM-L6-v2 model)

## Contributing

This is part of the Web Brain Project ecosystem. See the main organization for contribution guidelines.

## License

MIT License

Copyright (c) 2024 Salvador Pio Alonday
