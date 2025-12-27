import postpres, { PoolConfig } from 'pg';
import { ExecuterResult, XansqlFileConfig } from '@xansql/core';


const PostgresDialect = ({ file, ...config }: PoolConfig & { file?: XansqlFileConfig }) => {
   let pool = new postpres.Pool(config);

   const execute = async (sql: string): Promise<ExecuterResult> => {
      const client = await pool.connect()
      try {
         let results: any;
         let insertId = 0;
         let affectedRows = 0;

         if (sql.startsWith('SELECT')) {
            const res = await client.query(sql);
            results = res.rows;
            affectedRows = res.rowCount || 0;
         } else {
            const res = await client.query(sql + ' RETURNING *'); // capture inserted rows
            results = res.rows;
            affectedRows = res.rowCount || 0;
            if (results[0] && 'id' in results[0]) {
               insertId = results[0].id; // assumes primary key column is `id`
            }
         }
         return { results, insertId, affectedRows };
      } finally {
         client.release();
      }
   };



   const getSchema = async () => {
      // Get tables (only public schema)
      const client = await pool.connect()
      const tablesRes = await client.query(`
          SELECT table_name 
          FROM information_schema.tables
          WHERE table_schema = 'public';
       `);

      const schema: Record<string, any[]> = {};

      for (const row of tablesRes.rows) {
         const table = row.table_name;
         schema[table] = [];

         // Columns
         const columnsRes = await client.query(`
      SELECT 
        column_name AS name,
        data_type AS type,
        is_nullable,
        column_default,
        udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = '${table}';
    `);

         // Indexes
         const indexesRes = await client.query(`
      SELECT
        i.relname AS index_name,
        ix.indisunique AS unique,
        a.attname AS column_name
      FROM 
        pg_class t,
        pg_class i,
        pg_index ix,
        pg_attribute a
      WHERE 
        t.oid = ix.indrelid
        AND i.oid = ix.indexrelid
        AND a.attrelid = t.oid
        AND a.attnum = ANY(ix.indkey)
        AND t.relkind = 'r'
        AND t.relname = '${table}';
    `);

         // Primary keys
         const pkRes = await client.query(`
      SELECT
        kcu.column_name
      FROM 
        information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE 
        tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name = '${table}';
    `);

         const pkColumns = pkRes.rows.map(r => r.column_name);

         for (const col of columnsRes.rows) {
            const colName = col.name;

            const isIndexed = indexesRes.rows.some(i => i.column_name === colName);
            const isUnique = indexesRes.rows.some(i => i.column_name === colName && i.unique);

            schema[table].push({
               name: colName,
               type: col.udt_name ?? col.type,
               notnull: col.is_nullable === "NO",
               default_value: col.column_default,
               pk: pkColumns.includes(colName),
               index: isIndexed,
               unique: isUnique
            });
         }
      }

      return schema;
   };


   return {
      engine: 'postgres' as const,
      execute,
      getSchema,
      file
   };
};

export default PostgresDialect;
