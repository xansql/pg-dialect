# xansql

<p align="center">
  <strong>Type-safe, event-driven SQL ORM with automatic schema synchronization, composable relations, granular hooks, and optional client execution bridge.</strong>
</p>

<p align="center">
<!-- Badges (replace placeholders when public) -->
<a href="#"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue"/></a>
<a href="#"><img alt="status" src="https://img.shields.io/badge/status-beta-orange"/></a>
<a href="#"><img alt="dialects" src="https://img.shields.io/badge/dialects-mysql%20%7C%20postgresql%20%7C%20sqlite-6A5ACD"/></a>
</p>

---

## Executive Summary
xansql is a minimalist but powerful ORM focusing on:
- Deterministic schema definition (single source of truth) with non-destructive migration.
- Relation traversal via declarative `select` trees (preventing circular graphs).
- Rich predicate language in `where` supporting deep `EXISTS` on nested relations.
- Event system & lifecycle hooks (global + per-model) for observability & cross-cutting concerns.
- Pluggable caching, file storage, fetch bridge (browser safe), and socket integration.
- Lightweight execution pipeline: thin SQL generation, no heavy runtime proxies.

---
## Contents
1. Features
2. Architecture Overview
3. Installation
4. Quick Start
5. Configuration Reference
6. Defining Models & Fields
7. Relations
8. Querying & Predicates
9. Aggregation & Helpers
10. Pagination & Convenience APIs
11. Transactions
12. Migrations
13. Events & Hooks
14. File Handling
15. Client Fetch Bridge
16. Caching Interface
17. Dialects & Custom Implementation
18. Error Handling & Validation
19. Security Considerations
20. Performance Guidance
21. FAQ
22. Roadmap
23. License

---
## 1. Features
- Multi-dialect: MySQL, PostgreSQL, SQLite (custom adapter friendly)
- Auto aliasing + integrity checks
- Declarative relations (`xt.schema` / array reverse mapping)
- Non-destructive migrate (add/modify/remove columns) + force rebuild
- Granular lifecycle hooks & event emission
- Rich `where` condition operators (logical AND/OR composition)
- Nested relational filtering through `EXISTS` semantics
- Aggregation inline or via helper methods
- Optional caching module contract
- Integrated file meta handling & streaming upload abstraction
- Client-side safe execution (no raw SQL leakage) via signed execution meta

---
## 2. Architecture Overview
Layered components:
- Core: `Xansql` orchestrates config, model registry, transactions, migration, fetch bridge and events.
- Model: Provides CRUD + query generation + relation resolution.
- Executers: Specialized operation builders (Find / Create / Update / Delete / Aggregate).
- Migration: Computes delta from declared schema vs dialect metadata and issues SQL.
- Types System: Field factories (`xt.*`) with metadata (length, unique, index, validators, transforms).
- Foreign Resolver: Normalizes forward & reverse relation mapping for join/exists generation.
- Fetch Bridge: Validates request meta for client-originated operations (server controlled).

---
## 3. Installation
```bash
npm install xansql mysql2 pg better-sqlite3
# Or only the drivers you need
```
SQLite usage recommends `better-sqlite3` for synchronous performance.

---
## 4. Quick Start
```ts
import { Xansql, Model, xt } from 'xansql';
import MysqlDialect from 'xansql/dist/libs/MysqlDialect';

const db = new Xansql({
  dialect: MysqlDialect({ host: '127.0.0.1', user: 'root', password: '', database: 'app' })
});

const User = db.model('users', {
  id: xt.id(),
  username: xt.username(),
  email: xt.email().unique(),
  password: xt.password().strong(),
  role: xt.role(['admin', 'member']),
  createdAt: xt.createdAt(),
  updatedAt: xt.updatedAt()
});

await db.migrate();
await User.create({ data: [{ username: 'alice', email: 'a@b.com', password: 'Pwd@1234', role: 'member' }] });
const result = await User.find({ where: { username: { equals: 'alice' } } });
```

---
## 5. Configuration Reference
```ts
new Xansql({
  dialect: MysqlDialect({...}),            // REQUIRED
  fetch: { url: '/xansql', mode: 'production' }, // optional (client bridge)
  socket: { open, message, close },        // optional WebSocket handlers
  cache: { cache, clear, onFind, onCreate, onUpdate, onDelete }, // optional
  file: { maxFilesize, chunkSize, upload, delete }, // optional file storage
  maxLimit: { find, create, update, delete },       // safety caps (default 100)
  hooks: { beforeFind, afterFind, transform, ... }  // global async hooks
});
```
Required dialect interface:
```ts
interface XansqlDialect {
  engine: 'mysql' | 'postgresql' | 'sqlite';
  execute(sql: string): Promise<{ results: any[]; affectedRows: number; insertId: number | null }>;
  getSchema(): Promise<{ [table: string]: { name: string; type: string; notnull: boolean; default_value: any; pk: boolean; index: boolean; unique: boolean }[] }>
}
```

---
## 6. Defining Models & Fields
```ts
const Post = db.model('posts', {
  id: xt.id(),
  title: xt.title().index(),
  slug: xt.slug().unique(),
  author: xt.schema('users', 'id'),         // FK forward
  tags: xt.array(xt.string(30)),            // array (not in where predicate)
  images: xt.array(xt.file()),              // file metadata entries
  createdAt: xt.createdAt(),
  updatedAt: xt.updatedAt()
});
```
Per-model hooks:
```ts
Post.options.hooks = {
  beforeCreate: async (args) => args,
  transform: async (row) => { delete row.password; return row; }
};
```
Field factory highlights: `id, string, number, boolean, date, enum, array, object, record, tuple, union, file, schema` + semantic shortcuts (`username`, `email`, `password`, `slug`, `role`, `title`, `amount`, etc.). Most fields accept chainable validators (`min`, `max`, `unique`, `index`, `transform`).

Foreign key patterns:
- Forward: `xt.schema('users','id')`
- Reverse (one-to-many): `xt.array(xt.schema('posts','id'))`

---
## 7. Relations
Select nested relations:
```ts
await User.find({
  select: {
    id: true,
    username: true,
    posts: {
      select: { id: true, title: true },
      where: { title: { contains: 'SQL' } },
      limit: { take: 5 }
    }
  }
});
```
Circular graphs are rejected early.

---
## 8. Querying & Predicates
Operators: `equals, not, lt, lte, gt, gte, in, notIn, between, notBetween, contains, notContains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty, isTrue, isFalse`.
- Object => AND
- Array of objects => OR
- Nested relation in `where` => EXISTS subquery
Example:
```ts
await Post.find({
  where: {
    author: { username: { startsWith: 'a' } },
    slug: { notContains: 'draft' },
    title: [{ contains: 'Guide' }, { contains: 'Intro' }]
  }
});
```

---
## 9. Aggregation & Helpers
Inline:
```ts
await User.find({ aggregate: { id: { count: true } } });
```
Helpers: `count(where)`, `min(col, where)`, `max`, `sum`, `avg`, `exists(where)`.

---
## 10. Pagination & Convenience
```ts
const page = await User.paginate(2, { perpage: 20, where: { role: { equals: 'member' } } });
// { page, perpage, pagecount, rowcount, results }
```
Also: `findOne(args)`, `findById(id, args)`.

---
## 11. Transactions
Automatic for create/update/delete unless within chained relation execution.
Manual wrapper:
```ts
await db.transaction(async () => {
  await User.create({ data: [{ username: 'temp' }] });
  await User.update({ data: { role: 'admin' }, where: { username: 'temp' } });
});
```
Rollback on error.

---
## 12. Migrations
```ts
await db.migrate();        // sync non-destructively
await db.migrate(true);    // drop + recreate (files cleaned)
const preview = await db.generateMigration(); // array of SQL statements
```
Rules:
- Skips ID column alterations.
- Adds new columns; drops removed ones; issues ALTER for changed definition.
- Force rebuild executes reverse-order drops then creates.

---
## 13. Events & Hooks
Events emitted: `BEFORE_CREATE, CREATE, BEFORE_UPDATE, UPDATE, BEFORE_DELETE, DELETE, BEFORE_FIND, FIND, BEFORE_AGGREGATE, AGGREGATE, BEFORE_FETCH, FETCH`.
Usage:
```ts
db.on('CREATE', ({ model, results }) => { /* audit */ });
```
Hooks (global & model-level) allow mutation of args/results or row transform.

---
## 14. File Handling
Define file fields: `xt.file(size?)` / arrays.
Configure storage:
```ts
file: {
  maxFilesize: 2048,        // KB
  chunkSize: 256,           // KB (streaming)
  upload: async (chunk, meta) => {},
  delete: async (filename) => {}
}
```
Client helpers: `uploadFile(file, executeId)`, `deleteFile(name, executeId)`.

---
## 15. Client Fetch Bridge
Provide `fetch: string | { url, mode }`.
Client side raw SQL blocked; operations require internally generated `executeId` (granted per model action via metadata).
Server integrates:
```ts
const response = await db.onFetch(req.url, {
  body: req.body,
  headers: req.headers,
  cookies: parseCookies(req),
  isAuthorized: async (meta) => {/* check meta.action, meta.model */ return true; }
});
```

---
## 16. Caching Interface
Implement partial or full row caching:
```ts
cache: {
  cache: async (sql, model) => /* rows or undefined */,
  clear: async (model) => {},
  onFind: async (sql, model, row) => {},
  onCreate: async (model, insertId) => {},
  onUpdate: async (model, rows) => {},
  onDelete: async (model, rows) => {},
}
```
You decide strategy (memory, redis, browser IndexedDB via example adapters).

---
## 17. Dialects & Custom Implementation
Built-ins: `MysqlDialect`, `PostgresDialect`, `SqliteDialect`.
Custom:
```ts
const CustomDialect = () => ({
  engine: 'mysql',
  execute: async (sql) => {/* run */ return { results: [], affectedRows: 0, insertId: 0 };},
  getSchema: async () => ({ /* table: columns[] */ })
});
```
`getSchema` must supply column index/unique flags for migration diffing.

---
## 18. Error Handling & Validation
Common thrown errors:
- Missing dialect or execute function
- Unsupported engine
- Model without ID field
- Duplicate model name / alias collision
- Invalid where operator or disallowed field type in predicate (array/object/record/tuple)
- Circular relation selection / where nesting
- Client usage without fetch configuration
- Raw query attempt from client without `executeId`
- Invalid foreign key definition

---
## 19. Security Considerations
- All value interpolation passes through escaping utilities.
- Client cannot send arbitrary SQL (requires signed meta created server-side).
- Hooks & events can enforce auditing, RBAC, masking.
- Password field helper automatically hashes via SHA-256 transform.
- Recommend additional app-layer input validation before invoking ORM.

---
## 20. Performance Guidance
- Prefer selective `select` trees over full-table scans.
- Use indexes via field `.index()` / `.unique()` early (migration will create).
- Enable caching for heavy read patterns.
- Use pagination helpers (`paginate`) to avoid large offset scans.
- Keep relation depth shallow to limit EXISTS nesting.
- Batch `create` with array `data` for reduced round trips.

---
## 21. FAQ
Q: Does xansql generate JOINs?  
A: Relation filters use `EXISTS` subqueries; selection fetches related sets separately.

Q: How are reverse (one-to-many) relations defined?  
A: `xt.array(xt.schema('childTable','id'))` inside the parent references children.

Q: Can I rename columns automatically?  
A: Rename support is planned (see roadmap). Current diff treats rename as drop + add.

Q: Can I use raw SQL?  
A: Server side `db.execute(sql)` is allowed; client side raw is blocked.

---
## 22. Roadmap
- Column / index rename migration operations
- CLI code generation & schema inspector
- Enhanced diff reporting (explain changes)
- Advanced relation eager constraints (depth limiting strategies)
- Pluggable authorization middleware bundle

---
## 23. License
MIT

---
## Attributions
Internal field validation leverages concepts from `xanv`. File handling meta uses `securequ` upload structures.

---
> Need adjustments (badges, examples, tutorials)? Open an issue or contribute.
